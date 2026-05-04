import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/toast";
import { DownloadProgress } from "../components/DownloadProgress";
import { TrashButton } from "../components/TrashButton";
import type { DownloadRow, VideoFile } from "../lib/types";

function isPlayable(s: string): boolean {
  return s === `done`;
}

function isProcessing(s: string): boolean {
  return s === `starting` || s === `running`;
}

function humanSize(bytes?: number | null) {
  if (!bytes) return `–`;
  const u = [`B`, `KB`, `MB`, `GB`, `TB`];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function Library() {
  const [items, setItems] = useState<DownloadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api<{ downloads: DownloadRow[] }>(`/api/downloads`);
      setItems(res.downloads);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [load]);

  const remove = async (id: string) => {
    try {
      await api(`/api/downloads/${id}?removeFiles=true`, { method: `DELETE` });
      toast.push(`success`, `Removed`);
      await load();
    } catch (err) {
      toast.push(`error`, err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Library</h1>
      {error && <div className="text-sm text-rose-400">{error}</div>}
      {items === null ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-zinc-900 rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-zinc-400">
          Nothing here yet.{` `}
          <Link to="/" className="text-indigo-400 hover:underline">Find something</Link>.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <DownloadItem key={d.id} d={d} onRemove={remove} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case `done`:
      return (
        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/40 border border-emerald-700/50 text-emerald-300">
          ready
        </span>
      );
    case `running`:
    case `starting`:
      return (
        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900/40 border border-amber-700/50 text-amber-200">
          processing
        </span>
      );
    case `queued`:
      return (
        <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
          queued
        </span>
      );
    case `error`:
      return (
        <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900/40 border border-rose-700/50 text-rose-300">
          error
        </span>
      );
    case `pending`:
    case `idle`:
      return null;
    default:
      return (
        <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/40 border border-indigo-700/50 text-indigo-300">
          {status}
        </span>
      );
  }
}

/** Slim progress bar for HLS post-processing (0..1). */
function ProcessBar({ progress }: { progress: number }) {
  const pct = Math.max(0, Math.min(100, progress * 100));
  return (
    <div className="space-y-1">
      <div className="h-1 bg-zinc-800 rounded overflow-hidden">
        <div
          className="h-full bg-amber-500 transition-all duration-500"
          style={{ width: `${pct.toFixed(1)}%` }}
        />
      </div>
      <div className="text-[10px] text-zinc-500 tabular-nums">processing · {pct.toFixed(0)}%</div>
    </div>
  );
}

function DownloadItem({ d, onRemove }: { d: DownloadRow; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<VideoFile[] | null>(null);

  useEffect(() => {
    if (d.status !== `done`) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api<{ files: VideoFile[] }>(`/api/library/${d.id}/files`);
        if (!cancelled) setFiles(res.files);
      } catch {
        // ignore
      }
    };
    void tick();
    // Re-poll faster while expanded OR while there's any file still processing.
    const anyProcessing = (files ?? []).some((f) =>
      [`queued`, `starting`, `running`].includes(f.hlsStatus),
    );
    if (open || anyProcessing) {
      const t = setInterval(tick, 1500);
      return () => {
        cancelled = true;
        clearInterval(t);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [d.id, d.status, open, files]);

  const isMulti = (files?.length ?? 0) > 1;
  const primaryPlayable = isPlayable(d.hlsStatus);

  return (
    <li className="rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-sm leading-tight truncate" title={d.title}>
          {d.title}
          {isMulti && (
            <span className="ml-2 text-[10px] text-zinc-500">{files!.length} files</span>
          )}
        </div>
        <StatusBadge status={d.status === `done` ? d.hlsStatus : d.status} />
        {primaryPlayable && !isMulti && (
          <Link
            to={`/library/${d.id}/play`}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded px-3 py-1 transition-colors"
          >
            ▶ Play
          </Link>
        )}
        {d.status === `done` && isMulti && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded px-3 py-1 transition-colors"
          >
            {open ? `Hide` : `Open`}
          </button>
        )}
        <TrashButton onClick={() => onRemove(d.id)} />
      </div>

      {/* Download progress (still downloading) */}
      {d.status !== `done` && <DownloadProgress d={d} />}

      {/* Post-processing progress for the primary file (single-file downloads only —
          multi-file shows per-file bars in the expand panel). */}
      {d.status === `done` && !isMulti && isProcessing(d.hlsStatus) && (
        <ProcessBar progress={d.hlsProgress} />
      )}

      {open && isMulti && files && (
        <ul className="pt-1.5 space-y-1.5 border-t border-zinc-800">
          {files.map((f) => (
            <FileRow key={f.relativePath} downloadId={d.id} file={f} />
          ))}
        </ul>
      )}
    </li>
  );
}

function FileRow({ downloadId, file }: { downloadId: string; file: VideoFile }) {
  const playable = isPlayable(file.hlsStatus);
  const processing = isProcessing(file.hlsStatus);

  return (
    <li className="px-2 py-1.5 rounded bg-zinc-950/40 space-y-1.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-xs leading-tight truncate" title={file.name}>
          {file.name}
        </div>
        <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">
          {humanSize(file.size)}
        </span>
        <StatusBadge status={file.hlsStatus} />
        {playable ? (
          <Link
            to={`/library/${downloadId}/play?file=${encodeURIComponent(file.relativePath)}`}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded px-2.5 py-0.5 transition-colors"
          >
            ▶
          </Link>
        ) : (
          <button
            disabled
            className="text-xs bg-zinc-800 text-zinc-600 rounded px-2.5 py-0.5 cursor-not-allowed"
            title="Not ready yet"
          >
            ▶
          </button>
        )}
      </div>
      {processing && <ProcessBar progress={file.progress} />}
    </li>
  );
}
