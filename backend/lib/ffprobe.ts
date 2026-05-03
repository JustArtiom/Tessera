import { spawn } from "node:child_process";

export interface StreamInfo {
  index: number;
  codec_type: `video` | `audio` | `subtitle` | string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  tags?: Record<string, string>;
}

export interface ProbeResult {
  format?: { format_name?: string; duration?: string };
  streams: StreamInfo[];
}

export function ffprobe(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      `-v`,
      `error`,
      `-print_format`,
      `json`,
      `-show_format`,
      `-show_streams`,
      filePath,
    ];
    const proc = spawn(`ffprobe`, args);
    let out = ``;
    let err = ``;
    proc.stdout.on(`data`, (b: Buffer) => (out += b.toString(`utf8`)));
    proc.stderr.on(`data`, (b: Buffer) => (err += b.toString(`utf8`)));
    proc.on(`error`, reject);
    proc.on(`close`, (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with ${code}: ${err.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const BROWSER_VIDEO = new Set([`h264`, `vp8`, `vp9`, `av1`]);
const BROWSER_AUDIO = new Set([`aac`, `mp3`, `opus`, `vorbis`]);

export type StreamStrategy = `direct` | `remux` | `transcode`;

const BROWSER_DIRECT_EXTS = new Set([`mp4`, `m4v`, `mov`, `webm`]);

export function pickStrategy(probe: ProbeResult, ext: string): StreamStrategy {
  const video = probe.streams.find((s) => s.codec_type === `video`);
  const audio = probe.streams.find((s) => s.codec_type === `audio`);

  const videoOk = !!video && BROWSER_VIDEO.has((video.codec_name ?? ``).toLowerCase());
  const audioOk = !audio || BROWSER_AUDIO.has((audio.codec_name ?? ``).toLowerCase());

  if (!videoOk || !audioOk) return `transcode`;

  // Use file extension to decide container. ffprobe reports "matroska,webm" for both
  // MKV and WebM, so the format name alone can't disambiguate.
  if (BROWSER_DIRECT_EXTS.has(ext.toLowerCase())) return `direct`;
  // mkv / mka / avi / ts → lossless remux to fragmented mp4
  return `remux`;
}
