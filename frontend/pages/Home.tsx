import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/toast";
import type { DownloadRow, SearchResult } from "../lib/types";

function humanSize(bytes?: number): string | null {
  if (!bytes) return null;
  const u = [`B`, `KB`, `MB`, `GB`, `TB`];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function Home() {
  const [q, setQ] = useState(``);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api<{ results: SearchResult[] }>(
        `/api/search?q=${encodeURIComponent(q.trim())}`,
      );
      setResults(res.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const startDownload = async (r: SearchResult) => {
    const stream = r.streams[0];
    if (!stream || stream.type !== `magnet`) {
      toast.push(`error`, `Only magnet links supported`);
      return;
    }
    setBusyId(r.id);
    try {
      await api<DownloadRow>(`/api/downloads`, {
        body: {
          magnet: stream.url,
          pluginId: r.pluginId,
          mediaId: r.id,
          title: r.title,
        },
      });
      toast.push(`success`, `Download started — see Library`);
    } catch (err) {
      toast.push(`error`, err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="px-4 md:px-8 py-6 max-w-4xl mx-auto space-y-5">
      <form onSubmit={onSearch} className="flex gap-2">
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search nyaa.si — anime title, season, episode…"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={searching || !q.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-md px-5 py-2.5 text-sm font-medium transition-colors"
        >
          {searching ? `…` : `Search`}
        </button>
      </form>

      {error && <div className="text-sm text-rose-400">{error}</div>}

      {results === null && !searching && (
        <div className="text-sm text-zinc-500 pt-4">
          Type something above and hit Search. Results come straight from nyaa.si — sorted by seeders.
        </div>
      )}

      {results && results.length === 0 && (
        <div className="text-sm text-zinc-400">No results.</div>
      )}

      {results && results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map((r) => {
            const s = r.streams[0];
            return (
              <li
                key={r.id}
                className="rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-tight truncate" title={r.title}>
                      {r.title}
                    </div>
                    {r.description && (
                      <div className="text-xs text-zinc-500 truncate mt-0.5">{r.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs tabular-nums shrink-0">
                    {s?.quality && <span className="text-zinc-300">{s.quality}</span>}
                    {humanSize(s?.size) && <span className="text-zinc-400">{humanSize(s?.size)}</span>}
                    {s?.seeders !== undefined && (
                      <span className="text-emerald-400">{s.seeders}se</span>
                    )}
                  </div>
                  {r.existing ? (
                    <Link
                      to="/library"
                      title="Already in library"
                      className="shrink-0 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded px-3 py-1.5 transition-colors"
                    >
                      ✓ In library
                    </Link>
                  ) : (
                    <button
                      onClick={() => startDownload(r)}
                      disabled={busyId === r.id}
                      className="shrink-0 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded px-3 py-1.5 transition-colors"
                    >
                      {busyId === r.id ? `…` : `Download`}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
