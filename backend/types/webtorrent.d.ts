/**
 * Minimal type stubs for the runtime API surface we use from webtorrent v2.
 * The official @types are out of date for v2; we stub only what we touch.
 */
declare module "webtorrent" {
  import type { Readable } from "node:stream";
  import type { EventEmitter } from "node:events";

  export interface TorrentFile {
    name: string;
    path: string; // relative to torrent.path
    length: number;
    createReadStream(opts?: { start?: number; end?: number }): Readable;
    select(): void;
    deselect(): void;
  }

  export interface Torrent extends EventEmitter {
    infoHash: string;
    name: string;
    length: number;
    downloaded: number;
    uploaded: number;
    progress: number; // 0..1
    downloadSpeed: number;
    uploadSpeed: number;
    numPeers: number;
    files: TorrentFile[];
    path: string; // base directory where files live
    ready: boolean;
    done: boolean;
    destroy(opts?: { destroyStore?: boolean }, cb?: (err?: Error) => void): void;
  }

  export interface AddOptions {
    path?: string;
  }

  export default class WebTorrent {
    constructor(opts?: Record<string, unknown>);
    add(
      magnetOrInfoHash: string,
      opts?: AddOptions,
      cb?: (torrent: Torrent) => void,
    ): Torrent;
    get(infoHashOrMagnet: string): Torrent | null;
    remove(infoHash: string, cb?: (err?: Error) => void): void;
    destroy(cb?: (err?: Error) => void): void;
    torrents: Torrent[];
  }
}
