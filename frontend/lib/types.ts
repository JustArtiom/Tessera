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
}

export interface VideoFile {
  relativePath: string;
  name: string;
  size: number;
  isPrimary: boolean;
  hlsStatus: string;
}

export interface DownloadRow {
  id: string;
  pluginId: string;
  mediaId: string;
  title: string;
  poster?: string | null;
  status: string;
  /** "pending" while download isn't done, then "idle"|"starting"|"running"|"done"|"error" */
  hlsStatus: string;
  errorMessage?: string | null;
  totalBytes: number | null;
  downloadedBytes: number;
  primaryFile?: string | null;
  filePath?: string | null;
  progress?: number;
  downloadSpeed?: number;
  numPeers?: number;
}
