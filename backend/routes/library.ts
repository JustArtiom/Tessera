import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { signStreamToken, verifyStreamToken } from "../lib/stream-token";
import { listVideoFiles } from "../services/files.service";
import { getTrackVtt, listTracks } from "../services/subtitles.service";
import {
  ensureHls,
  getJob,
  hlsDirFor,
  readAndRewritePlaylist,
  resolveSegment,
} from "../services/hls.service";
import { isFileQueued, isFileRunning } from "../services/finalize.service";

const router = Router();

const idParam = z.object({ id: z.string().min(1) });

/**
 * Picks the file to operate on. Returns absPath even if the source has been deleted
 * after finalize — callers must check needsSource if they actually need to read it.
 */
function pickFile(
  row: { filePath: string | null; primaryFile: string | null },
  fileParam: string | undefined,
) {
  if (!row.filePath || !row.primaryFile) {
    throw new AppError(404, `Stream not available`);
  }
  const fileRel = (fileParam ?? row.primaryFile).trim();
  const absPath = path.resolve(row.filePath, fileRel);
  const root = path.resolve(row.filePath);
  if (absPath !== root && !absPath.startsWith(root + path.sep)) {
    throw new AppError(400, `File escapes download directory`);
  }
  return { fileRel, absPath, downloadFilePath: row.filePath };
}

router.post(`/:id/stream-token`, requireAuth, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const row = await prisma.download.findUnique({ where: { id } });
    if (!row) throw new AppError(404, `Download not found`);
    if (!row.filePath || !row.primaryFile) {
      throw new AppError(409, `Download has no media yet`);
    }
    const userId = req.user!.sub;
    const token = signStreamToken(id, userId);
    res.json({ token, expiresInSeconds: 4 * 60 * 60 });
  } catch (err) {
    next(err);
  }
});

router.get(`/:id/files`, requireAuth, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const row = await prisma.download.findUnique({ where: { id } });
    if (!row || !row.filePath) throw new AppError(404, `Download not found`);
    const files = listVideoFiles(row.filePath, row.primaryFile);
    const annotated = files.map((f) => {
      if (f.finalized) {
        return { ...f, hlsStatus: `done`, progress: 1 };
      }
      const job = getJob(id, f.relativePath);
      if (job) {
        return { ...f, hlsStatus: job.status, progress: job.progress };
      }
      // No active in-memory job — could be queued waiting for a slot, or not started.
      if (isFileQueued(id, f.relativePath)) {
        return { ...f, hlsStatus: `queued`, progress: 0 };
      }
      if (isFileRunning(id, f.relativePath)) {
        return { ...f, hlsStatus: `starting`, progress: 0 };
      }
      return { ...f, hlsStatus: `idle`, progress: 0 };
    });
    res.json({ files: annotated });
  } catch (err) {
    next(err);
  }
});

router.get(`/:id/hls-status`, requireAuth, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const fileParam = z.string().optional().parse(req.query.file);
    const row = await prisma.download.findUnique({ where: { id } });
    if (!row || !row.filePath || !row.primaryFile) {
      throw new AppError(404, `Stream not available`);
    }
    const fileRel = fileParam ?? row.primaryFile;
    const job = getJob(id, fileRel);
    let status = job?.status ?? `idle`;
    if (!job) {
      if (isFileQueued(id, fileRel)) status = `queued`;
      else if (isFileRunning(id, fileRel)) status = `starting`;
    }
    res.json({
      status,
      duration: job?.duration ?? 0,
      progress: job?.progress ?? 0,
      errorMessage: job?.errorMessage ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.get(`/:id/playlist.m3u8`, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const token = z.string().min(1).parse(req.query.token);
    const fileParam = z.string().optional().parse(req.query.file);
    try {
      verifyStreamToken(token, id);
    } catch {
      throw new AppError(401, `Invalid or expired stream token`);
    }
    const row = await prisma.download.findUnique({ where: { id } });
    if (!row) throw new AppError(404, `Download not found`);
    const { fileRel, absPath, downloadFilePath } = pickFile(row, fileParam);
    const hlsDir = hlsDirFor(downloadFilePath, fileRel);
    const playlistPath = path.join(hlsDir, `playlist.m3u8`);

    // Fast path: playlist already on disk → don't need the source.
    if (fs.existsSync(playlistPath)) {
      const playlist = readAndRewritePlaylist(hlsDir, token, fileRel);
      res.setHeader(`Content-Type`, `application/vnd.apple.mpegurl`);
      res.setHeader(`Cache-Control`, `private, no-cache`);
      res.send(playlist);
      return;
    }

    // Slow path: need to spawn ffmpeg, which requires the source.
    if (!fs.existsSync(absPath)) {
      throw new AppError(404, `Source file missing — can't prepare HLS`);
    }
    const job = await ensureHls(id, downloadFilePath, absPath, fileRel);
    if (job.status === `error`) {
      throw new AppError(500, `HLS preparation failed: ${job.errorMessage ?? `unknown`}`);
    }
    const playlist = readAndRewritePlaylist(job.hlsDir, token, fileRel);
    res.setHeader(`Content-Type`, `application/vnd.apple.mpegurl`);
    res.setHeader(`Cache-Control`, `private, no-cache`);
    res.send(playlist);
  } catch (err) {
    next(err);
  }
});

router.get(`/:id/segment/:filename`, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const filename = req.params.filename;
    const token = z.string().min(1).parse(req.query.token);
    const fileParam = z.string().optional().parse(req.query.file);
    try {
      verifyStreamToken(token, id);
    } catch {
      throw new AppError(401, `Invalid or expired stream token`);
    }
    const row = await prisma.download.findUnique({ where: { id } });
    if (!row || !row.filePath || !row.primaryFile) {
      throw new AppError(404, `Stream not available`);
    }
    const fileRel = fileParam ?? row.primaryFile;
    const hlsDir = hlsDirFor(row.filePath, fileRel);
    let absPath: string;
    try {
      absPath = resolveSegment(hlsDir, filename);
    } catch {
      throw new AppError(400, `Invalid segment filename`);
    }
    if (!fs.existsSync(absPath)) {
      res.setHeader(`Retry-After`, `1`);
      throw new AppError(503, `Segment not ready yet`);
    }
    res.setHeader(`Content-Type`, `video/mp2t`);
    res.setHeader(`Cache-Control`, `private, max-age=3600`);
    fs.createReadStream(absPath).pipe(res);
  } catch (err) {
    next(err);
  }
});

router.get(`/:id/subtitles`, requireAuth, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const fileParam = z.string().optional().parse(req.query.file);
    const row = await prisma.download.findUnique({ where: { id } });
    if (!row) throw new AppError(404, `Download not found`);
    const { fileRel, absPath, downloadFilePath } = pickFile(row, fileParam);
    const tracks = await listTracks(absPath, downloadFilePath, fileRel);
    res.json({ tracks });
  } catch (err) {
    next(err);
  }
});

router.get(`/:id/subtitles/:trackId`, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const trackId = z.string().min(1).parse(req.params.trackId);
    const token = z.string().min(1).parse(req.query.token);
    const fileParam = z.string().optional().parse(req.query.file);
    try {
      verifyStreamToken(token, id);
    } catch {
      throw new AppError(401, `Invalid or expired stream token`);
    }
    const row = await prisma.download.findUnique({ where: { id } });
    if (!row) throw new AppError(404, `Download not found`);
    const { fileRel, absPath, downloadFilePath } = pickFile(row, fileParam);
    const vtt = await getTrackVtt(absPath, downloadFilePath, fileRel, trackId);
    res.setHeader(`Content-Type`, `text/vtt; charset=utf-8`);
    res.setHeader(`Cache-Control`, `private, max-age=3600`);
    res.send(vtt);
  } catch (err) {
    next(err);
  }
});

export default router;
