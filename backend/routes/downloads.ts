import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { AppError } from "../middleware/error";
import { prisma } from "../lib/prisma";
import { downloadManager } from "../services/download-manager";
import { getJob as getHlsJob, isHlsCompleteFor } from "../services/hls.service";
import { isFileQueued, isFileRunning } from "../services/finalize.service";

const router = Router();

function annotateHls<
  T extends { id: string; status: string; primaryFile?: string | null; filePath?: string | null },
>(row: T) {
  let hlsStatus = `pending`;
  let hlsProgress = 0;
  if (row.status === `done` && row.primaryFile && row.filePath) {
    const job = getHlsJob(row.id, row.primaryFile);
    if (job) {
      hlsStatus = job.status;
      hlsProgress = job.progress;
    } else if (isHlsCompleteFor(row.filePath, row.primaryFile)) {
      hlsStatus = `done`;
      hlsProgress = 1;
    } else if (isFileQueued(row.id, row.primaryFile)) {
      hlsStatus = `queued`;
    } else if (isFileRunning(row.id, row.primaryFile)) {
      hlsStatus = `starting`;
    } else {
      hlsStatus = `idle`;
    }
  } else if (row.status !== `done`) {
    hlsStatus = `pending`;
  }
  return { ...row, hlsStatus, hlsProgress };
}

const createSchema = z.object({
  magnet: z.string().min(1).startsWith(`magnet:?`, `Only magnet URIs are supported in v0.2`),
  pluginId: z.string().min(1),
  mediaId: z.string().min(1),
  title: z.string().min(1),
  poster: z.string().url().optional(),
});

router.post(`/`, requireAuth, async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const result = await downloadManager.start({
      ...body,
      userId: req.user?.sub,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

function serializeDownload<
  T extends { totalBytes: bigint | null; downloadedBytes: bigint },
>(row: T) {
  return {
    ...row,
    totalBytes: row.totalBytes !== null ? Number(row.totalBytes) : null,
    downloadedBytes: Number(row.downloadedBytes),
  };
}

router.get(`/`, requireAuth, async (_req, res, next) => {
  try {
    const rows = await prisma.download.findMany({ orderBy: { createdAt: `desc` } });
    const withProgress = await Promise.all(
      rows.map(async (row) => {
        const live = await downloadManager.getProgress(row.id);
        const base = serializeDownload(row);
        const merged = live ? { ...base, ...live } : base;
        return annotateHls(merged);
      }),
    );
    res.json({ downloads: withProgress });
  } catch (err) {
    next(err);
  }
});

router.get(`/:id`, requireAuth, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const row = await prisma.download.findUnique({ where: { id } });
    if (!row) throw new AppError(404, `Download not found`);
    const live = await downloadManager.getProgress(id);
    const base = serializeDownload(row);
    const merged = live ? { ...base, ...live } : base;
    res.json(annotateHls(merged));
  } catch (err) {
    next(err);
  }
});

router.delete(`/:id`, requireAuth, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const removeFiles = req.query.removeFiles === `true`;
    await downloadManager.cancel(id, removeFiles);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get(`/:id/events`, requireAuth, async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const initial = await downloadManager.getProgress(id);
    if (!initial) throw new AppError(404, `Download not found`);

    res.setHeader(`Content-Type`, `text/event-stream`);
    res.setHeader(`Cache-Control`, `no-cache, no-transform`);
    res.setHeader(`Connection`, `keep-alive`);
    res.flushHeaders?.();

    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    send(initial);

    const unsubscribe = downloadManager.on(id, (snap) => send(snap));

    const heartbeat = setInterval(() => res.write(`: hb\n\n`), 15_000);

    req.on(`close`, () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
});

export default router;
