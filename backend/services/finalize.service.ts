import fs from "node:fs";
import path from "node:path";
import { ensureHls, hlsDirFor, waitForJobDone } from "./hls.service";
import { prepareSubtitles } from "./subtitles.service";
import { listVideoFiles } from "./files.service";
import { JobQueue } from "../lib/job-queue";
import { env } from "../config/env";

/**
 * Global concurrency cap for ffmpeg post-processing across every download.
 * Configured via POST_PROCESS_CONCURRENCY (default 5).
 */
export const postProcessQueue = new JobQueue(env.POST_PROCESS_CONCURRENCY);

function fileQueueKey(downloadId: string, fileRelativePath: string): string {
  return `${downloadId}::${fileRelativePath}`;
}

export function isFileQueued(downloadId: string, fileRelativePath: string): boolean {
  return postProcessQueue.isQueued(fileQueueKey(downloadId, fileRelativePath));
}

export function isFileRunning(downloadId: string, fileRelativePath: string): boolean {
  return postProcessQueue.isRunning(fileQueueKey(downloadId, fileRelativePath));
}

export interface FileMeta {
  originalRelativePath: string;
  originalName: string;
  originalSize: number;
  isPrimary: boolean;
  finalizedAt: number;
}

function metaPath(downloadFilePath: string, fileRelativePath: string): string {
  return path.join(hlsDirFor(downloadFilePath, fileRelativePath), `meta.json`);
}

export function readFileMeta(
  downloadFilePath: string,
  fileRelativePath: string,
): FileMeta | null {
  const p = metaPath(downloadFilePath, fileRelativePath);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, `utf8`)) as FileMeta;
  } catch {
    return null;
  }
}

function writeFileMeta(
  downloadFilePath: string,
  fileRelativePath: string,
  meta: FileMeta,
): void {
  const p = metaPath(downloadFilePath, fileRelativePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(meta, null, 2), `utf8`);
}

/**
 * Per-file post-download pipeline (executed inside the post-process queue so we never
 * exceed POST_PROCESS_CONCURRENCY concurrent ffmpegs):
 *   1. ensureHls + wait for ffmpeg to fully finish
 *   2. pre-extract all subtitle tracks to .vtt files
 *   3. write meta.json so the file shows in the library after the original is gone
 *   4. delete the original mkv/mp4
 *
 * Idempotent — picks up where it left off (won't re-prep done HLS, won't re-extract subs).
 */
async function finalizeOneFile(
  downloadId: string,
  downloadFilePath: string,
  fileRelativePath: string,
  fileAbsPath: string,
  isPrimary: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  if (!fs.existsSync(fileAbsPath)) {
    if (readFileMeta(downloadFilePath, fileRelativePath)) return { ok: true };
    return { ok: false, reason: `source missing and no meta.json` };
  }

  const stat = fs.statSync(fileAbsPath);
  const key = fileQueueKey(downloadId, fileRelativePath);

  let result: { ok: boolean; reason?: string } = { ok: true };

  await postProcessQueue.enqueue(key, async () => {
    // ─── HLS prep ───────────────────────────────────────────────────────────
    await ensureHls(downloadId, downloadFilePath, fileAbsPath, fileRelativePath);
    const job = await waitForJobDone(downloadId, fileRelativePath);
    if (job.status !== `done`) {
      result = { ok: false, reason: job.errorMessage ?? `HLS prep failed` };
      return;
    }

    // ─── Subtitles ──────────────────────────────────────────────────────────
    try {
      await prepareSubtitles(fileAbsPath, downloadFilePath, fileRelativePath);
    } catch (err) {
      console.warn(
        `[finalize] subtitle prep had issues for ${fileRelativePath}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // ─── Meta record + delete source ────────────────────────────────────────
    writeFileMeta(downloadFilePath, fileRelativePath, {
      originalRelativePath: fileRelativePath,
      originalName: path.basename(fileRelativePath),
      originalSize: stat.size,
      isPrimary,
      finalizedAt: Date.now(),
    });
    try {
      fs.rmSync(fileAbsPath, { force: true });
      console.log(`[finalize] removed original: ${fileRelativePath}`);
      cleanEmptyDirs(downloadFilePath, path.dirname(fileAbsPath));
    } catch (err) {
      console.warn(
        `[finalize] could not remove ${fileAbsPath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  });

  return result;
}

/** Walks up from `dir` deleting empty directories until we hit `downloadFilePath`. */
function cleanEmptyDirs(downloadRoot: string, dir: string): void {
  const root = path.resolve(downloadRoot);
  let cur = path.resolve(dir);
  while (cur.startsWith(root) && cur !== root) {
    try {
      const entries = fs.readdirSync(cur);
      if (entries.length === 0) {
        fs.rmdirSync(cur);
        cur = path.dirname(cur);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

const inFlight = new Set<string>();

/**
 * Enqueues every video file under a download for post-processing. Each file goes
 * through {@link postProcessQueue}, which globally caps concurrent ffmpegs at
 * POST_PROCESS_CONCURRENCY. Primary file enqueues first so it usually finishes first.
 */
export async function finalizeDownload(
  downloadId: string,
  downloadFilePath: string,
  primaryFile: string | null,
): Promise<void> {
  if (inFlight.has(downloadId)) return;
  inFlight.add(downloadId);
  try {
    const files = listVideoFiles(downloadFilePath, primaryFile);
    if (files.length === 0) return;

    files.sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));

    // Fire-and-forget per-file. The queue serialises beyond its concurrency cap.
    await Promise.all(
      files.map(async (f) => {
        const abs = path.join(downloadFilePath, f.relativePath);
        const result = await finalizeOneFile(
          downloadId,
          downloadFilePath,
          f.relativePath,
          abs,
          f.isPrimary,
        );
        if (!result.ok) {
          console.error(
            `[finalize ${downloadId}] ${f.relativePath} failed: ${result.reason ?? `unknown`}`,
          );
        }
      }),
    );
  } finally {
    inFlight.delete(downloadId);
  }
}
