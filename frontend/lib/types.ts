export interface StreamSource {
  type: `magnet` | `http` | `hls`;
  url: string;
  quality?: string;
  size?: number;
  seeders?: number;
}

export interface SearchResult {
  id: string;
  title: string;
  year?: number;
  poster?: string;
  description?: string;
  streams: StreamSource[];
  pluginId: string;
  /** Set when the torrent is already in the user's library — show a Library link instead of Download. */
  existing?: { id: string; status: string };
}

export interface VideoFile {
  relativePath: string;
  name: string;
  size: number;
  isPrimary: boolean;
  /** "idle" | "queued" | "starting" | "running" | "done" | "error" */
  hlsStatus: string;
  /** 0..1 — how much of the file ffmpeg has processed */
  progress: number;
  finalized?: boolean;
}

export interface DownloadRow {
  id: string;
  pluginId: string;
  mediaId: string;
  title: string;
  poster?: string | null;
  status: string;
  /** "pending"|"idle"|"queued"|"starting"|"running"|"done"|"error" */
  hlsStatus: string;
  /** 0..1 — primary file's processing progress */
  hlsProgress: number;
  errorMessage?: string | null;
  totalBytes: number | null;
  downloadedBytes: number;
  primaryFile?: string | null;
  filePath?: string | null;
  progress?: number;
  downloadSpeed?: number;
  numPeers?: number;
}
