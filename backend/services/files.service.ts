import fs from "node:fs";
import path from "node:path";

const VIDEO_EXTS = new Set([`.mp4`, `.mkv`, `.webm`, `.avi`, `.mov`, `.m4v`, `.ts`, `.mpeg`]);
const SKIP_DIRS = new Set([`hls`]);

export interface VideoFile {
  relativePath: string;
  name: string;
  size: number;
  isPrimary: boolean;
  /** True when the original is gone but the HLS prep is on disk and ready to play. */
  finalized?: boolean;
}

/**
 * Returns every playable file for a download:
 *   - Video files still on disk (pre-finalize), AND
 *   - Files whose source has been deleted but whose HLS subdir + meta.json are intact.
 * Deduplicates by relativePath.
 */
export function listVideoFiles(downloadFilePath: string, primaryFile: string | null): VideoFile[] {
  if (!fs.existsSync(downloadFilePath)) return [];

  const map = new Map<string, VideoFile>();

  // 1. Live video files on disk (still pre-finalize).
  walkDisk(downloadFilePath, ``, map);

  // 2. Finalized files (HLS dir + meta.json, source already deleted).
  const hlsRoot = path.join(downloadFilePath, `hls`);
  if (fs.existsSync(hlsRoot)) {
    for (const entry of fs.readdirSync(hlsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const subdir = path.join(hlsRoot, entry.name);
      const metaPath = path.join(subdir, `meta.json`);
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, `utf8`)) as {
          originalRelativePath?: string;
          originalName?: string;
          originalSize?: number;
        };
        if (!meta.originalRelativePath) continue;
        if (map.has(meta.originalRelativePath)) {
          // Source still on disk; nothing to add.
          continue;
        }
        map.set(meta.originalRelativePath, {
          relativePath: meta.originalRelativePath,
          name: meta.originalName ?? path.basename(meta.originalRelativePath),
          size: meta.originalSize ?? 0,
          isPrimary: false, // set below
          finalized: true,
        });
      } catch {
        // ignore
      }
    }
  }

  for (const f of map.values()) f.isPrimary = f.relativePath === primaryFile;
  return Array.from(map.values()).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }),
  );
}

function walkDisk(root: string, sub: string, out: Map<string, VideoFile>): void {
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
      walkDisk(root, childSub, out);
    } else if (VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      const rel = sub ? path.join(sub, entry.name) : entry.name;
      const full = path.join(root, rel);
      try {
        const st = fs.statSync(full);
        const relPosix = rel.split(path.sep).join(`/`);
        out.set(relPosix, {
          relativePath: relPosix,
          name: entry.name,
          size: st.size,
          isPrimary: false,
          finalized: false,
        });
      } catch {
        // ignore mid-walk vanish
      }
    }
  }
}
