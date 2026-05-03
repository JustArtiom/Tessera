import { Router } from "express";
import fs from "node:fs";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { signStreamToken, verifyStreamToken } from "../lib/stream-token";
import { resolvePrimaryFile } from "../services/streaming.service";
import { listVideoFiles } from "../services/files.service";
import { getTrackVtt, listTracks } from "../services/subtitles.service";
import {
  ensureHls,
  getJob,
  hlsDirFor,
  readAndRewritePlaylist,
  resolveSegment,
} from "../services/hls.service";

const router = Router();

const idParam = z.object({ id: z.string().min(1) });

/** Resolve which file to operate on given an optional ?file= query (default: primaryFile). */
function pickFile(row: { filePath: string | null; primaryFile: string | null }, fileParam: string | undefined) {
  if (!row.filePath || !row.primaryFile) {
    throw new AppError(404, `Stream not available`);
  }
  const fileRel = (fileParam ?? row.primaryFile).trim();
  // Defensive: must exist within the download dir
  const file = resolvePrimaryFile(row.filePath, fileRel);
  if (!fs.existsSync(file.absPath)) {
    throw new AppError(404, `File missing on disk: ${fileRel}`);
  }
  return { fileRel, file };
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
      const job = getJob(id, f.relativePath);
      return { ...f, hlsStatus: job?.status ?? `idle` };
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
    res.json({
      status: job?.status ?? `idle`,
      duration: job?.duration ?? 0,
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
    const { fileRel, file } = pickFile(row, fileParam);
    const job = await ensureHls(id, row.filePath!, file.absPath, fileRel);
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
    const { file } = pickFile(row, fileParam);
    const tracks = await listTracks(file.absPath);
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
    const { file } = pickFile(row, fileParam);
    const vtt = await getTrackVtt(file.absPath, row.filePath!, trackId);
    res.setHeader(`Content-Type`, `text/vtt; charset=utf-8`);
    res.setHeader(`Cache-Control`, `private, max-age=3600`);
    res.send(vtt);
  } catch (err) {
    next(err);
  }
});

export default router;
