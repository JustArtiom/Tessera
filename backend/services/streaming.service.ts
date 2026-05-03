import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { ffprobe, pickStrategy, type StreamStrategy } from "../lib/ffprobe";

export interface ResolvedFile {
  absPath: string;
  size: number;
  ext: string;
}

export function resolvePrimaryFile(filePath: string, primaryFile: string): ResolvedFile {
  const abs = path.resolve(filePath, primaryFile);
  // Defensive: resolved path must stay under filePath
  const filePathResolved = path.resolve(filePath);
  if (abs !== filePathResolved && !abs.startsWith(filePathResolved + path.sep)) {
    throw new Error(`primaryFile escapes download directory`);
  }
  const stat = fs.statSync(abs);
  return { absPath: abs, size: stat.size, ext: path.extname(abs).toLowerCase().slice(1) };
}

export interface StreamPlan {
  strategy: StreamStrategy;
  contentType: string;
}

export async function planStream(file: ResolvedFile, override?: string): Promise<StreamPlan> {
  if (override === `direct`) {
    return { strategy: `direct`, contentType: mimeFor(file.ext) };
  }

  const probe = await ffprobe(file.absPath);
  let strategy: StreamStrategy;
  if (override === `remux` || override === `transcode`) {
    strategy = override;
  } else {
    strategy = pickStrategy(probe, file.ext);
  }

  const contentType =
    strategy === `direct` ? mimeFor(file.ext) : `video/mp4`;

  return { strategy, contentType };
}

function mimeFor(ext: string): string {
  switch (ext) {
    case `mp4`:
    case `m4v`:
      return `video/mp4`;
    case `webm`:
      return `video/webm`;
    case `mkv`:
      return `video/x-matroska`;
    case `mov`:
      return `video/quicktime`;
    default:
      return `application/octet-stream`;
  }
}

interface RangeSpec {
  start: number;
  end: number;
}

export function parseRange(header: string | undefined, size: number): RangeSpec | null {
  if (!header) return null;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const startStr = m[1];
  const endStr = m[2];
  if (startStr === `` && endStr === ``) return null;
  let start: number;
  let end: number;
  if (startStr === ``) {
    // suffix: last N bytes
    const n = Math.min(parseInt(endStr, 10), size);
    start = size - n;
    end = size - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === `` ? size - 1 : Math.min(parseInt(endStr, 10), size - 1);
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || end >= size) {
    return null;
  }
  return { start, end };
}

export function streamDirect(
  res: Response,
  file: ResolvedFile,
  plan: StreamPlan,
  range: RangeSpec | null,
): void {
  if (range) {
    res.status(206);
    res.setHeader(`Content-Range`, `bytes ${range.start}-${range.end}/${file.size}`);
    res.setHeader(`Content-Length`, range.end - range.start + 1);
  } else {
    res.status(200);
    res.setHeader(`Content-Length`, file.size);
  }
  res.setHeader(`Accept-Ranges`, `bytes`);
  res.setHeader(`Content-Type`, plan.contentType);
  const opts = range ? { start: range.start, end: range.end } : {};
  fs.createReadStream(file.absPath, opts).pipe(res);
}

export function streamFFmpeg(
  res: Response,
  file: ResolvedFile,
  plan: StreamPlan,
  range: RangeSpec | null,
): void {
  // For ffmpeg-driven streams we cannot honor byte-precise ranges (the byte layout of
  // the output mp4 differs from the input). We send 200 with the full pipeline and
  // rely on fragmented mp4 + the browser's media-element seek to re-request streams.
  // For "request a fresh stream from byte 0" calls we always start ffmpeg from 0.
  // Future: translate byte ranges to time seeks via probe duration + size.
  if (range && range.start === 0) {
    // Treat as a normal start.
  }

  const inputArgs = [`-hide_banner`, `-loglevel`, `error`, `-i`, file.absPath];

  let codecArgs: string[];
  if (plan.strategy === `remux`) {
    codecArgs = [`-c`, `copy`];
  } else {
    // transcode
    codecArgs = [
      `-c:v`,
      `libx264`,
      `-preset`,
      `veryfast`,
      `-crf`,
      `23`,
      `-c:a`,
      `aac`,
      `-b:a`,
      `192k`,
    ];
  }

  const muxArgs = [
    `-movflags`,
    `frag_keyframe+empty_moov+default_base_moof`,
    `-f`,
    `mp4`,
    `pipe:1`,
  ];

  const args = [...inputArgs, ...codecArgs, ...muxArgs];
  const ff: ChildProcess = spawn(`ffmpeg`, args);

  res.status(200);
  res.setHeader(`Content-Type`, plan.contentType);
  // No Accept-Ranges — we don't truly support byte ranges in this mode.

  ff.stdout?.pipe(res);
  ff.stderr?.on(`data`, (b: Buffer) => {
    const line = b.toString(`utf8`).trim();
    if (line) console.warn(`[ffmpeg] ${line}`);
  });
  ff.on(`error`, (err) => {
    console.error(`[ffmpeg] spawn error:`, err);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });

  res.on(`close`, () => {
    if (!ff.killed) ff.kill(`SIGKILL`);
  });
}
