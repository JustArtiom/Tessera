import fs from "node:fs";
import path from "node:path";
import { ensureHls, hlsDirFor, waitForJobDone } from "./hls.service";
import { prepareSubtitles } from "./subtitles.service";
import { listVideoFiles } from "./files.service";

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
 * Per-file post-download pipeline:
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
    // Already finalized in a previous run; just make sure meta is present.
    if (readFileMeta(downloadFilePath, fileRelativePath)) {
      return { ok: true };
    }
    return { ok: false, reason: `source missing and no meta.json` };
  }

  const stat = fs.statSync(fileAbsPath);

  // 1. HLS prep — this returns once first segment exists; we wait for the full encode.
  await ensureHls(downloadId, downloadFilePath, fileAbsPath, fileRelativePath);
  const job = await waitForJobDone(downloadId, fileRelativePath);
  if (job.status !== `done`) {
    return { ok: false, reason: job.errorMessage ?? `HLS prep failed` };
  }

  // 2. Pre-extract subtitles before we delete the source.
  try {
    await prepareSubtitles(fileAbsPath, downloadFilePath, fileRelativePath);
  } catch (err) {
    console.warn(
      `[finalize] subtitle prep had issues for ${fileRelativePath}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // 3. Persist a meta record so the library can list this file after the source is gone.
  writeFileMeta(downloadFilePath, fileRelativePath, {
    originalRelativePath: fileRelativePath,
    originalName: path.basename(fileRelativePath),
    originalSize: stat.size,
    isPrimary,
    finalizedAt: Date.now(),
  });

  // 4. Delete the original. The HLS dir + meta + subs cache stay.
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

  return { ok: true };
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
 * Sequentially finalize every video file under a download. Sequential keeps weak-CPU
 * servers from being pinned by N concurrent ffmpegs.
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

    // Process primary first so the user can play the most-likely-wanted file ASAP.
    files.sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));

    for (const f of files) {
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
    }
  } finally {
    inFlight.delete(downloadId);
  }
}
