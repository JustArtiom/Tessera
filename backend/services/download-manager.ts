import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type WebTorrent from "webtorrent";
import type { Torrent, TorrentFile } from "webtorrent";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { getConfigValues } from "../plugins/config-store";
import { AppError } from "../middleware/error";
import { cancelJobsFor as cancelHlsJobs } from "./hls.service";
import { finalizeDownload } from "./finalize.service";

const VIDEO_EXTS = new Set([`.mp4`, `.mkv`, `.webm`, `.avi`, `.mov`, `.m4v`, `.ts`, `.mpeg`]);
const PROGRESS_PERSIST_MS = 2000;

interface StartParams {
  magnet: string;
  pluginId: string;
  mediaId: string;
  title: string;
  poster?: string;
  userId?: string;
}

export interface ProgressSnapshot {
  id: string;
  status: string;
  downloadedBytes: number;
  totalBytes: number | null;
  progress: number; // 0..1
  downloadSpeed: number;
  numPeers: number;
  primaryFile: string | null;
  filePath: string | null;
}

class DownloadManager {
  private clientPromise: Promise<WebTorrent> | null = null;
  private active = new Map<string, Torrent>();
  private emitter = new EventEmitter();
  private lastPersistAt = new Map<string, number>();

  private async getClient(): Promise<WebTorrent> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        // Bundlers compile static `import()` to `require()` in CJS output, which fails
        // for webtorrent v2 (async ESM). The Function constructor hides the import from
        // the bundler so Node executes it as a true dynamic import at runtime.
        const dynImport = new Function(`s`, `return import(s)`) as (
          s: string,
        ) => Promise<{ default: new (opts?: Record<string, unknown>) => WebTorrent }>;
        const mod = await dynImport(`webtorrent`);
        const Ctor = mod.default;
        return new Ctor();
      })();
    }
    return this.clientPromise;
  }

  private resolveDownloadDir(pluginConfig: Record<string, unknown>, pluginId: string): string {
    const raw = (pluginConfig.downloadDir as string | undefined)?.trim();
    if (raw) {
      return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    }
    return path.resolve(process.cwd(), `downloads`, pluginId);
  }

  private pickPrimaryFile(torrent: Torrent): TorrentFile | null {
    let best: TorrentFile | null = null;
    for (const f of torrent.files) {
      const ext = path.extname(f.path).toLowerCase();
      if (!VIDEO_EXTS.has(ext)) continue;
      if (!best || f.length > best.length) best = f;
    }
    return best ?? (torrent.files.length ? torrent.files[0] : null);
  }

  private async persistProgress(downloadId: string, t: Torrent, status?: string) {
    const now = Date.now();
    const last = this.lastPersistAt.get(downloadId) ?? 0;
    if (!status && now - last < PROGRESS_PERSIST_MS) return;
    this.lastPersistAt.set(downloadId, now);

    await prisma.download.update({
      where: { id: downloadId },
      data: {
        downloadedBytes: BigInt(Math.floor(t.downloaded)),
        totalBytes: t.length ? BigInt(t.length) : null,
        ...(status ? { status } : {}),
      },
    });
  }

  private snapshot(downloadId: string, t: Torrent, statusOverride?: string): ProgressSnapshot {
    return {
      id: downloadId,
      status: statusOverride ?? (t.done ? `done` : `downloading`),
      downloadedBytes: Math.floor(t.downloaded),
      totalBytes: t.length || null,
      progress: t.progress,
      downloadSpeed: t.downloadSpeed,
      numPeers: t.numPeers,
      primaryFile: null,
      filePath: t.path,
    };
  }

  private wireTorrent(downloadId: string, torrent: Torrent) {
    this.active.set(downloadId, torrent);

    const onMetadata = async () => {
      const primary = this.pickPrimaryFile(torrent);
      if (primary) primary.select();
      await prisma.download.update({
        where: { id: downloadId },
        data: {
          totalBytes: torrent.length ? BigInt(torrent.length) : null,
          primaryFile: primary?.path ?? null,
          status: `downloading`,
        },
      });
      this.emitter.emit(downloadId, this.snapshot(downloadId, torrent));
      this.emitter.emit(`*`, this.snapshot(downloadId, torrent));
    };

    if (torrent.ready) {
      void onMetadata();
    } else {
      torrent.once(`ready`, onMetadata);
    }

    const onProgress = async () => {
      try {
        await this.persistProgress(downloadId, torrent);
      } catch (err) {
        console.error(`[downloads] progress persist failed:`, err);
      }
      const snap = this.snapshot(downloadId, torrent);
      this.emitter.emit(downloadId, snap);
      this.emitter.emit(`*`, snap);
    };
    torrent.on(`download`, onProgress);

    torrent.once(`done`, async () => {
      try {
        await this.persistProgress(downloadId, torrent, `done`);
      } catch (err) {
        console.error(`[downloads] done persist failed:`, err);
      }
      const snap = this.snapshot(downloadId, torrent, `done`);
      this.emitter.emit(downloadId, snap);
      this.emitter.emit(`*`, snap);

      // Run the full finalize pipeline: HLS prep → subtitle extract → delete original.
      // Sequential per file to keep weak-CPU servers from being pinned.
      try {
        const row = await prisma.download.findUnique({ where: { id: downloadId } });
        if (row?.filePath) {
          finalizeDownload(downloadId, row.filePath, row.primaryFile).catch((err) => {
            console.error(`[downloads] finalize failed for ${downloadId}:`, err);
          });
          console.log(`[downloads] ${downloadId} done — finalizing in background`);
        }
      } catch (err) {
        console.error(`[downloads] could not start finalize for ${downloadId}:`, err);
      }
    });

    torrent.on(`error`, async (err: Error | string) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[downloads] torrent error (${downloadId}):`, message);
      try {
        await prisma.download.update({
          where: { id: downloadId },
          data: { status: `error`, errorMessage: message },
        });
      } catch {
        // ignore
      }
      const snap = this.snapshot(downloadId, torrent, `error`);
      this.emitter.emit(downloadId, snap);
      this.emitter.emit(`*`, snap);
    });
  }

  async start(params: StartParams): Promise<{ id: string; infoHash: string }> {
    const config = await getConfigValues(params.pluginId);
    const baseDir = this.resolveDownloadDir(config, params.pluginId);
    fs.mkdirSync(baseDir, { recursive: true });

    const client = await this.getClient();

    // Pre-check info hash to avoid creating a duplicate DB row.
    const m = params.magnet.match(/btih:([a-f0-9]{40})/i);
    const presumedHash = m ? m[1].toLowerCase() : null;
    if (presumedHash) {
      const existing = await prisma.download.findUnique({ where: { infoHash: presumedHash } });
      if (existing) {
        // If somehow not active, try to resume.
        if (!this.active.has(existing.id) && existing.status !== `done`) {
          await this.resumeOne(existing.id);
        }
        return { id: existing.id, infoHash: presumedHash };
      }
    }

    const row = await prisma.download.create({
      data: {
        pluginId: params.pluginId,
        mediaId: params.mediaId,
        title: params.title,
        poster: params.poster,
        magnet: params.magnet,
        infoHash: presumedHash,
        status: `queued`,
        userId: params.userId,
      },
    });

    const downloadDir = path.join(baseDir, row.id);
    fs.mkdirSync(downloadDir, { recursive: true });

    const torrent = client.add(params.magnet, { path: downloadDir });
    this.wireTorrent(row.id, torrent);

    await prisma.download.update({
      where: { id: row.id },
      data: { filePath: downloadDir, infoHash: presumedHash ?? null },
    });

    return { id: row.id, infoHash: presumedHash ?? `` };
  }

  private async resumeOne(downloadId: string): Promise<void> {
    const row = await prisma.download.findUnique({ where: { id: downloadId } });
    if (!row || !row.filePath) return;
    const client = await this.getClient();
    if (this.active.has(downloadId)) return;
    fs.mkdirSync(row.filePath, { recursive: true });
    const torrent = client.add(row.magnet, { path: row.filePath });
    this.wireTorrent(downloadId, torrent);
  }

  async resumeAll(): Promise<number> {
    const rows = await prisma.download.findMany({
      where: { status: { in: [`downloading`, `queued`] } },
    });
    for (const row of rows) {
      try {
        await this.resumeOne(row.id);
      } catch (err) {
        console.error(`[downloads] failed to resume ${row.id}:`, err);
      }
    }
    return rows.length;
  }

  /**
   * For every already-done download whose source file is still on disk, ensure the HLS
   * cache exists (no-op if so, kicks ffmpeg if not). Silently skips orphans whose
   * underlying files were removed.
   */
  async ensureHlsForCompleted(): Promise<number> {
    const rows = await prisma.download.findMany({ where: { status: `done` } });
    let kicked = 0;
    for (const row of rows) {
      if (!row.filePath) continue;
      try {
        // finalizeDownload is idempotent — skips fully-prepped files.
        finalizeDownload(row.id, row.filePath, row.primaryFile).catch((err) => {
          console.error(`[downloads] startup finalize failed for ${row.id}:`, err);
        });
        kicked++;
      } catch {
        // ignore
      }
    }
    return kicked;
  }

  getActive(downloadId: string): Torrent | null {
    return this.active.get(downloadId) ?? null;
  }

  async cancel(downloadId: string, removeFiles: boolean): Promise<void> {
    const row = await prisma.download.findUnique({ where: { id: downloadId } });
    if (!row) throw new AppError(404, `Download not found`);

    cancelHlsJobs(downloadId);

    const torrent = this.active.get(downloadId);
    if (torrent) {
      await new Promise<void>((resolve) => {
        torrent.destroy({ destroyStore: removeFiles }, () => resolve());
      });
      this.active.delete(downloadId);
    }

    // WebTorrent's destroyStore deletes the files it wrote, but leaves our parent
    // <downloadId> dir behind. Tear it down ourselves.
    if (removeFiles && row.filePath && fs.existsSync(row.filePath)) {
      fs.rmSync(row.filePath, { recursive: true, force: true });
    }

    await prisma.download.delete({ where: { id: downloadId } });
  }

  async getProgress(downloadId: string): Promise<ProgressSnapshot | null> {
    const row = await prisma.download.findUnique({ where: { id: downloadId } });
    if (!row) return null;
    const torrent = this.active.get(downloadId);
    if (torrent) {
      const snap = this.snapshot(downloadId, torrent, row.status);
      snap.primaryFile = row.primaryFile;
      return snap;
    }
    return {
      id: row.id,
      status: row.status,
      downloadedBytes: Number(row.downloadedBytes),
      totalBytes: row.totalBytes ? Number(row.totalBytes) : null,
      progress:
        row.totalBytes && Number(row.totalBytes) > 0
          ? Number(row.downloadedBytes) / Number(row.totalBytes)
          : 0,
      downloadSpeed: 0,
      numPeers: 0,
      primaryFile: row.primaryFile,
      filePath: row.filePath,
    };
  }

  on(downloadId: string, listener: (snap: ProgressSnapshot) => void): () => void {
    this.emitter.on(downloadId, listener);
    return () => this.emitter.off(downloadId, listener);
  }
}

export const downloadManager = new DownloadManager();

// silence eslint about env import being unused once we wire in MAX storage caps later
void env;
