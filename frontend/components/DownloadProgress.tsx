import type { DownloadRow } from "../lib/types";

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

export function DownloadProgress({ d }: { d: DownloadRow }) {
  const pct = d.totalBytes ? Math.min(100, (d.downloadedBytes / d.totalBytes) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <StatusBadge status={d.status} />
        <span>
          {humanSize(d.downloadedBytes)} / {humanSize(d.totalBytes)}
        </span>
        {d.downloadSpeed ? <span>· {humanSize(d.downloadSpeed)}/s</span> : null}
        {d.numPeers !== undefined && d.numPeers > 0 && <span>· {d.numPeers} peers</span>}
      </div>
      {d.status !== `done` && d.status !== `error` && (
        <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${pct.toFixed(1)}%` }}
          />
        </div>
      )}
      {d.errorMessage && <div className="text-xs text-rose-400">{d.errorMessage}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === `done`
      ? `bg-emerald-900/40 border-emerald-700/50 text-emerald-300`
      : status === `error`
        ? `bg-rose-900/40 border-rose-700/50 text-rose-300`
        : status === `downloading`
          ? `bg-indigo-900/40 border-indigo-700/50 text-indigo-300`
          : `bg-zinc-800 border-zinc-700 text-zinc-300`;
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-medium ${cls}`}>
      {status}
    </span>
  );
}
