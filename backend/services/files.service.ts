import fs from "node:fs";
import path from "node:path";

const VIDEO_EXTS = new Set([`.mp4`, `.mkv`, `.webm`, `.avi`, `.mov`, `.m4v`, `.ts`, `.mpeg`]);
const SKIP_DIRS = new Set([`hls`]); // our prep cache

export interface VideoFile {
  relativePath: string; // path relative to download.filePath, posix-style
  name: string;
  size: number;
  isPrimary: boolean;
}

/**
 * Walks the download directory and returns every video file we know how to play.
 * Cheap: just stat() per file, no probing.
 */
export function listVideoFiles(downloadFilePath: string, primaryFile: string | null): VideoFile[] {
  if (!fs.existsSync(downloadFilePath)) return [];
  const out: VideoFile[] = [];
  walk(downloadFilePath, ``, out);
  for (const f of out) f.isPrimary = f.relativePath === primaryFile;
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
  return out;
}

function walk(root: string, sub: string, out: VideoFile[]): void {
  const dir = sub ? path.join(root, sub) : root;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const childSub = sub ? path.join(sub, entry.name) : entry.name;
      walk(root, childSub, out);
    } else if (VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      const rel = sub ? path.join(sub, entry.name) : entry.name;
      const full = path.join(root, rel);
      try {
        const st = fs.statSync(full);
        out.push({
          relativePath: rel.split(path.sep).join(`/`),
          name: entry.name,
          size: st.size,
          isPrimary: false,
        });
      } catch {
        // ignore mid-walk vanish
      }
    }
  }
}
