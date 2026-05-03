import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ffprobe } from "../lib/ffprobe";

const SEGMENT_DURATION = 6;
const BROWSER_VIDEO = new Set([`h264`, `vp8`, `vp9`, `av1`]);
const TS_AUDIO_COPYABLE = new Set([`aac`, `mp3`]);
const FIRST_SEGMENT_TIMEOUT_MS = 30_000;
const FIRST_SEGMENT_POLL_MS = 200;

export type HlsStatus = `starting` | `running` | `done` | `error`;

export interface HlsJob {
  status: HlsStatus;
  duration: number;
  hlsDir: string;
  errorMessage?: string;
  process: ChildProcess | null;
  startedAt: number;
}

const jobs = new Map<string, HlsJob>();

function jobKey(downloadId: string, fileRelativePath: string): string {
  return `${downloadId}::${fileRelativePath}`;
}

interface CodecPlan {
  videoCopy: boolean;
  audioCopy: boolean;
  duration: number;
}

async function planCodecs(absPath: string): Promise<CodecPlan> {
  const probe = await ffprobe(absPath);
  const duration = parseFloat(probe.format?.duration ?? `0`) || 0;
  const v = probe.streams.find((s) => s.codec_type === `video`);
  const a = probe.streams.find((s) => s.codec_type === `audio`);
  const videoCopy = !!v && BROWSER_VIDEO.has((v.codec_name ?? ``).toLowerCase());
  const audioCopy = !a || TS_AUDIO_COPYABLE.has((a.codec_name ?? ``).toLowerCase());
  return { videoCopy, audioCopy, duration };
}

/**
 * One HLS subdir per file, namespaced by a short hash of the file's relative path
 * so siblings with similar names don't collide.
 */
export function hlsDirFor(downloadFilePath: string, fileRelativePath: string): string {
  const hash = crypto.createHash(`sha1`).update(fileRelativePath).digest(`hex`).slice(0, 8);
  const stem = path
    .basename(fileRelativePath, path.extname(fileRelativePath))
    .replace(/[^a-zA-Z0-9._-]/g, `_`)
    .slice(0, 60);
  return path.join(downloadFilePath, `hls`, `${stem}-${hash}`);
}

function playlistFile(hlsDir: string): string {
  return path.join(hlsDir, `playlist.m3u8`);
}

function isComplete(hlsDir: string): boolean {
  const p = playlistFile(hlsDir);
  if (!fs.existsSync(p)) return false;
  return fs.readFileSync(p, `utf8`).includes(`#EXT-X-ENDLIST`);
}

function hasFirstSegment(hlsDir: string): boolean {
  const p = playlistFile(hlsDir);
  if (!fs.existsSync(p)) return false;
  return /seg_\d+\.ts/.test(fs.readFileSync(p, `utf8`));
}

function spawnFfmpeg(key: string, absPath: string, hlsDir: string, plan: CodecPlan): ChildProcess {
  const args = [`-hide_banner`, `-loglevel`, `error`, `-i`, absPath];
  if (plan.videoCopy) {
    args.push(`-c:v`, `copy`);
  } else {
    args.push(
      `-c:v`, `libx264`, `-preset`, `veryfast`, `-crf`, `23`,
      `-force_key_frames`, `expr:gte(t,n_forced*${SEGMENT_DURATION})`,
    );
  }
  if (plan.audioCopy) {
    args.push(`-c:a`, `copy`);
  } else {
    args.push(`-c:a`, `aac`, `-b:a`, `192k`);
  }
  args.push(
    `-hls_time`, String(SEGMENT_DURATION),
    `-hls_list_size`, `0`,
    `-hls_playlist_type`, `event`,
    `-hls_flags`, `independent_segments+temp_file`,
    `-hls_segment_filename`, path.join(hlsDir, `seg_%05d.ts`),
    playlistFile(hlsDir),
  );
  console.log(`[hls ${key}] spawning ffmpeg (videoCopy=${plan.videoCopy}, audioCopy=${plan.audioCopy})`);
  return spawn(`ffmpeg`, args, { stdio: [`ignore`, `ignore`, `pipe`] });
}

async function waitForFirstSegment(hlsDir: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < FIRST_SEGMENT_TIMEOUT_MS) {
    if (hasFirstSegment(hlsDir)) return true;
    await new Promise((r) => setTimeout(r, FIRST_SEGMENT_POLL_MS));
  }
  return false;
}

export async function ensureHls(
  downloadId: string,
  downloadFilePath: string,
  fileAbsPath: string,
  fileRelativePath: string,
): Promise<HlsJob> {
  const key = jobKey(downloadId, fileRelativePath);
  const hlsDir = hlsDirFor(downloadFilePath, fileRelativePath);

  if (isComplete(hlsDir)) {
    let job = jobs.get(key);
    if (!job) {
      const plan = await planCodecs(fileAbsPath);
      job = { status: `done`, duration: plan.duration, hlsDir, process: null, startedAt: 0 };
      jobs.set(key, job);
    } else {
      job.status = `done`;
    }
    return job;
  }

  const existing = jobs.get(key);
  if (existing && (existing.status === `starting` || existing.status === `running`)) {
    return existing;
  }

  if (fs.existsSync(hlsDir)) fs.rmSync(hlsDir, { recursive: true, force: true });
  fs.mkdirSync(hlsDir, { recursive: true });

  const plan = await planCodecs(fileAbsPath);
  const proc = spawnFfmpeg(key, fileAbsPath, hlsDir, plan);

  const job: HlsJob = {
    status: `starting`,
    duration: plan.duration,
    hlsDir,
    process: proc,
    startedAt: Date.now(),
  };
  jobs.set(key, job);

  proc.stderr?.on(`data`, (b: Buffer) => {
    const msg = b.toString(`utf8`).trim();
    if (msg) console.warn(`[hls ${key}] ${msg}`);
  });
  proc.on(`error`, (err) => {
    console.error(`[hls ${key}] spawn error:`, err);
    job.status = `error`;
    job.errorMessage = err.message;
    job.process = null;
  });
  proc.on(`close`, (code) => {
    job.process = null;
    if (code === 0) {
      job.status = `done`;
      console.log(`[hls ${key}] complete`);
    } else if (job.status !== `error`) {
      job.status = `error`;
      job.errorMessage = `ffmpeg exited with code ${code}`;
      console.error(`[hls ${key}] ffmpeg exited with ${code}`);
    }
  });

  const ready = await waitForFirstSegment(hlsDir);
  if (!ready) {
    if (job.status === `starting`) {
      job.status = `error`;
      job.errorMessage = `Timed out waiting for ffmpeg to produce a segment`;
    }
    proc.kill(`SIGKILL`);
  } else if (job.status === `starting`) {
    job.status = `running`;
  }
  return job;
}

export function getJob(downloadId: string, fileRelativePath: string): HlsJob | null {
  return jobs.get(jobKey(downloadId, fileRelativePath)) ?? null;
}

export function cancelJobsFor(downloadId: string): void {
  const prefix = `${downloadId}::`;
  for (const [k, j] of jobs) {
    if (!k.startsWith(prefix)) continue;
    if (j.process && !j.process.killed) j.process.kill(`SIGKILL`);
    jobs.delete(k);
  }
}

export function readAndRewritePlaylist(
  hlsDir: string,
  token: string,
  fileRelativePath: string,
): string {
  const raw = fs.readFileSync(playlistFile(hlsDir), `utf8`);
  return raw.replace(
    /^(seg_\d+\.ts)$/gm,
    `segment/$1?token=${encodeURIComponent(token)}&file=${encodeURIComponent(fileRelativePath)}`,
  );
}

export function resolveSegment(hlsDir: string, filename: string): string {
  if (!/^seg_\d+\.ts$/.test(filename)) throw new Error(`Invalid segment filename`);
  const abs = path.join(hlsDir, filename);
  const root = path.resolve(hlsDir);
  if (!path.resolve(abs).startsWith(root + path.sep)) {
    throw new Error(`Segment escapes hls dir`);
  }
  return abs;
}
