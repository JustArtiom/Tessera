import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ffprobe, type StreamInfo } from "../lib/ffprobe";
import { hlsDirFor } from "./hls.service";

export interface SubtitleTrack {
  id: string;
  source: `embed` | `sidecar`;
  label: string;
  language?: string;
  default?: boolean;
}

const TEXT_SUB_CODECS = new Set([`subrip`, `srt`, `ass`, `ssa`, `webvtt`, `mov_text`]);
const SIDECAR_EXTS = [`.vtt`, `.srt`, `.ass`, `.ssa`];

function langFromTags(tags?: Record<string, string>): string | undefined {
  if (!tags) return undefined;
  return tags.language ?? tags.LANGUAGE ?? undefined;
}

function labelFromStream(s: StreamInfo, idx: number): string {
  const title = s.tags?.title ?? s.tags?.TITLE;
  const lang = langFromTags(s.tags);
  if (title) return title;
  if (lang) return `${lang} (track ${idx})`;
  return `Track ${idx}`;
}

function findSidecars(videoAbsPath: string): SubtitleTrack[] {
  const dir = path.dirname(videoAbsPath);
  const stem = path.basename(videoAbsPath, path.extname(videoAbsPath));
  if (!fs.existsSync(dir)) return [];
  const out: SubtitleTrack[] = [];
  for (const file of fs.readdirSync(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (!SIDECAR_EXTS.includes(ext)) continue;
    if (!file.toLowerCase().startsWith(stem.toLowerCase())) continue;
    const remainder = file.slice(stem.length, file.length - ext.length).replace(/^\./, ``);
    const lang = remainder || undefined;
    out.push({
      id: `sidecar:${file}`,
      source: `sidecar`,
      label: lang ? lang : `External (${ext.slice(1)})`,
      language: lang,
    });
  }
  return out;
}

function subsCacheDir(downloadFilePath: string, fileRelativePath: string): string {
  const dir = path.join(hlsDirFor(downloadFilePath, fileRelativePath), `subs`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function manifestPath(downloadFilePath: string, fileRelativePath: string): string {
  return path.join(hlsDirFor(downloadFilePath, fileRelativePath), `subs.json`);
}

interface SubsManifest {
  tracks: SubtitleTrack[];
}

function readManifest(downloadFilePath: string, fileRelativePath: string): SubsManifest | null {
  const p = manifestPath(downloadFilePath, fileRelativePath);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, `utf8`)) as SubsManifest;
  } catch {
    return null;
  }
}

function writeManifest(
  downloadFilePath: string,
  fileRelativePath: string,
  manifest: SubsManifest,
): void {
  const p = manifestPath(downloadFilePath, fileRelativePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2), `utf8`);
}

async function probeTracks(videoAbsPath: string): Promise<SubtitleTrack[]> {
  const probe = await ffprobe(videoAbsPath);
  const tracks: SubtitleTrack[] = [];
  let subIdx = 0;
  for (const s of probe.streams) {
    if (s.codec_type !== `subtitle`) continue;
    const codec = (s.codec_name ?? ``).toLowerCase();
    if (!TEXT_SUB_CODECS.has(codec)) {
      subIdx++;
      continue;
    }
    tracks.push({
      id: `embed:${s.index}`,
      source: `embed`,
      label: labelFromStream(s, subIdx),
      language: langFromTags(s.tags),
    });
    subIdx++;
  }
  tracks.push(...findSidecars(videoAbsPath));
  return tracks;
}

/**
 * Lists subtitle tracks. Prefers a cached manifest (works after the original mkv has been
 * deleted post-finalize); falls back to live ffprobe if the manifest hasn't been written yet.
 */
export async function listTracks(
  videoAbsPath: string,
  downloadFilePath: string,
  fileRelativePath: string,
): Promise<SubtitleTrack[]> {
  const cached = readManifest(downloadFilePath, fileRelativePath);
  if (cached) return cached.tracks;
  if (!fs.existsSync(videoAbsPath)) return [];
  return probeTracks(videoAbsPath);
}

function srtToVtt(srt: string): string {
  return (
    `WEBVTT\n\n` +
    srt
      .replace(/\r/g, ``)
      .replace(
        /^\d+\s*\n(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})/gm,
        (_, a, ms1, b, ms2) => `${a}.${ms1} --> ${b}.${ms2}`,
      )
  );
}

function spawnExtract(input: string, streamIndex: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ff = spawn(`ffmpeg`, [
      `-hide_banner`, `-loglevel`, `error`,
      `-i`, input,
      `-map`, `0:${streamIndex}`,
      `-c:s`, `webvtt`,
      `-f`, `webvtt`,
      `pipe:1`,
    ]);
    let out = ``;
    let err = ``;
    ff.stdout.on(`data`, (b: Buffer) => (out += b.toString(`utf8`)));
    ff.stderr.on(`data`, (b: Buffer) => (err += b.toString(`utf8`)));
    ff.on(`error`, reject);
    ff.on(`close`, (code) => {
      if (code !== 0) reject(new Error(`ffmpeg subtitle extract failed: ${err.trim()}`));
      else resolve(out);
    });
  });
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, `_`).slice(0, 120);
}

function cachePathForTrack(cacheDir: string, trackId: string): string {
  if (trackId.startsWith(`embed:`)) {
    const idx = trackId.slice(`embed:`.length);
    return path.join(cacheDir, `embed-${idx}.vtt`);
  }
  if (trackId.startsWith(`sidecar:`)) {
    const fn = trackId.slice(`sidecar:`.length);
    return path.join(cacheDir, `sidecar-${safeFilename(fn)}.vtt`);
  }
  throw new Error(`Unknown subtitle track id`);
}

export async function getTrackVtt(
  videoAbsPath: string,
  downloadFilePath: string,
  fileRelativePath: string,
  trackId: string,
): Promise<string> {
  const cacheDir = subsCacheDir(downloadFilePath, fileRelativePath);
  const cachePath = cachePathForTrack(cacheDir, trackId);

  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, `utf8`);

  // No cache hit — need the original to extract. If it's gone, we can't recover.
  if (!fs.existsSync(videoAbsPath)) {
    throw new Error(`Subtitle source missing on disk and no cached copy available`);
  }

  if (trackId.startsWith(`embed:`)) {
    const idx = Number(trackId.slice(`embed:`.length));
    if (!Number.isInteger(idx)) throw new Error(`Invalid track id`);
    const vtt = await spawnExtract(videoAbsPath, idx);
    fs.writeFileSync(cachePath, vtt, `utf8`);
    return vtt;
  }

  if (trackId.startsWith(`sidecar:`)) {
    const filename = trackId.slice(`sidecar:`.length);
    if (filename.includes(`/`) || filename.includes(`..`)) throw new Error(`Invalid sidecar id`);
    const sidecarPath = path.join(path.dirname(videoAbsPath), filename);
    if (!fs.existsSync(sidecarPath)) throw new Error(`Sidecar not found`);
    const ext = path.extname(sidecarPath).toLowerCase();
    let vtt: string;
    if (ext === `.vtt`) vtt = fs.readFileSync(sidecarPath, `utf8`);
    else if (ext === `.srt`) vtt = srtToVtt(fs.readFileSync(sidecarPath, `utf8`));
    else vtt = await spawnExtract(sidecarPath, 0);
    fs.writeFileSync(cachePath, vtt, `utf8`);
    return vtt;
  }

  throw new Error(`Unknown subtitle track id`);
}

/**
 * Probe + extract every text subtitle track for a file. Called once at finalize time
 * so the original can be deleted afterwards. Idempotent — skips tracks already cached.
 */
export async function prepareSubtitles(
  videoAbsPath: string,
  downloadFilePath: string,
  fileRelativePath: string,
): Promise<SubtitleTrack[]> {
  const existing = readManifest(downloadFilePath, fileRelativePath);
  if (existing) return existing.tracks;

  const tracks = await probeTracks(videoAbsPath);
  // Eagerly extract each so playback doesn't need the original.
  for (const t of tracks) {
    try {
      await getTrackVtt(videoAbsPath, downloadFilePath, fileRelativePath, t.id);
    } catch (err) {
      console.warn(
        `[subs] failed to pre-extract ${t.id} for ${fileRelativePath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  writeManifest(downloadFilePath, fileRelativePath, { tracks });
  return tracks;
}
