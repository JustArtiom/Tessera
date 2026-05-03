import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ffprobe, type StreamInfo } from "../lib/ffprobe";

export interface SubtitleTrack {
  /** Stable identifier used in the URL: e.g. "embed:0:2" or "sidecar:eng" */
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
  const entries = fs.readdirSync(dir);
  for (const file of entries) {
    const ext = path.extname(file).toLowerCase();
    if (!SIDECAR_EXTS.includes(ext)) continue;
    if (!file.toLowerCase().startsWith(stem.toLowerCase())) continue;
    // e.g. "Frieren.eng.srt" → label "eng"
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

export async function listTracks(videoAbsPath: string): Promise<SubtitleTrack[]> {
  const probe = await ffprobe(videoAbsPath);
  const tracks: SubtitleTrack[] = [];
  let subIdx = 0;
  for (const s of probe.streams) {
    if (s.codec_type !== `subtitle`) continue;
    const codec = (s.codec_name ?? ``).toLowerCase();
    if (!TEXT_SUB_CODECS.has(codec)) {
      subIdx++;
      continue; // skip image-based PGS/DVD subs in v0.2
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

function srtToVtt(srt: string): string {
  // WebVTT cues use "." as decimal separator (SRT uses ","). Header is required.
  return (
    `WEBVTT\n\n` +
    srt
      .replace(/\r/g, ``)
      .replace(/^\d+\s*\n(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})/gm,
        (_, a, ms1, b, ms2) => `${a}.${ms1} --> ${b}.${ms2}`)
  );
}

function spawnExtract(input: string, streamIndex: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ff = spawn(`ffmpeg`, [
      `-hide_banner`,
      `-loglevel`,
      `error`,
      `-i`,
      input,
      `-map`,
      `0:${streamIndex}`,
      `-c:s`,
      `webvtt`,
      `-f`,
      `webvtt`,
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

function ensureCacheDir(downloadFilePath: string): string {
  const dir = path.join(downloadFilePath, `subs`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function getTrackVtt(
  videoAbsPath: string,
  downloadFilePath: string,
  trackId: string,
): Promise<string> {
  const cacheDir = ensureCacheDir(downloadFilePath);

  if (trackId.startsWith(`embed:`)) {
    const idxStr = trackId.slice(`embed:`.length);
    const idx = Number(idxStr);
    if (!Number.isInteger(idx)) throw new Error(`Invalid track id`);
    const cachePath = path.join(cacheDir, `embed-${idx}.vtt`);
    if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, `utf8`);
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
    if (ext === `.vtt`) return fs.readFileSync(sidecarPath, `utf8`);
    if (ext === `.srt`) return srtToVtt(fs.readFileSync(sidecarPath, `utf8`));
    // ass/ssa: re-encode via ffmpeg (loses styling)
    const cachePath = path.join(cacheDir, `${filename}.vtt`);
    if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, `utf8`);
    const vtt = await spawnExtract(sidecarPath, 0);
    fs.writeFileSync(cachePath, vtt, `utf8`);
    return vtt;
  }

  throw new Error(`Unknown subtitle track id`);
}
