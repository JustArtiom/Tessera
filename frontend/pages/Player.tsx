import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { DownloadRow } from "../lib/types";

interface SubtitleTrack {
  id: string;
  source: `embed` | `sidecar`;
  label: string;
  language?: string;
}

interface HlsStatus {
  status: `idle` | `starting` | `running` | `done` | `error`;
  duration: number;
  errorMessage: string | null;
}

const PREP_POLL_MS = 1000;

export function Player() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const fileParam = searchParams.get(`file`) ?? undefined;
  const fileQS = useMemo(() => (fileParam ? `&file=${encodeURIComponent(fileParam)}` : ``), [fileParam]);
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<DownloadRow | null>(null);
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [prep, setPrep] = useState<HlsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load info first; only fetch token + subs once download is complete.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const dl = await api<DownloadRow>(`/api/downloads/${id}`);
        if (cancelled) return;
        setInfo(dl);
        if (dl.status !== `done`) {
          setError(`This download isn't complete yet (${dl.status}). Wait for it to finish.`);
          return;
        }
        const subsUrl = fileParam
          ? `/api/library/${id}/subtitles?file=${encodeURIComponent(fileParam)}`
          : `/api/library/${id}/subtitles`;
        const [tokenRes, subs] = await Promise.all([
          api<{ token: string }>(`/api/library/${id}/stream-token`, { method: `POST` }),
          api<{ tracks: SubtitleTrack[] }>(subsUrl).catch(() => ({ tracks: [] })),
        ]);
        if (!cancelled) {
          setToken(tokenRes.token);
          setTracks(subs.tracks);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, fileParam]);

  // Trigger HLS prep + poll status until ready
  useEffect(() => {
    if (!id || !token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        await fetch(
          `/api/library/${id}/playlist.m3u8?token=${encodeURIComponent(token)}${fileQS}`,
          { method: `HEAD` },
        );
        const statusUrl = fileParam
          ? `/api/library/${id}/hls-status?file=${encodeURIComponent(fileParam)}`
          : `/api/library/${id}/hls-status`;
        const status = await api<HlsStatus>(statusUrl);
        if (cancelled) return;
        setPrep(status);
        if (status.status === `running` || status.status === `done`) return;
        if (status.status === `error`) {
          setError(status.errorMessage ?? `HLS preparation failed`);
          return;
        }
        timer = setTimeout(tick, PREP_POLL_MS);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, token, fileQS, fileParam]);

  // Wire up HLS playback once prep is ready
  useEffect(() => {
    if (!videoRef.current || !id || !token) return;
    if (!prep || (prep.status !== `running` && prep.status !== `done`)) return;
    const video = videoRef.current;
    const playlistUrl = `/api/library/${id}/playlist.m3u8?token=${encodeURIComponent(token)}${fileQS}`;

    if (video.canPlayType(`application/vnd.apple.mpegurl`)) {
      video.src = playlistUrl;
      return () => {
        video.removeAttribute(`src`);
        video.load();
      };
    }

    let cancelled = false;
    let hls: { destroy(): void } | null = null;
    (async () => {
      const { default: Hls } = await import(`hls.js`);
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setError(`HLS playback isn't supported in this browser`);
        return;
      }
      const instance = new Hls({ enableWorker: true, lowLatencyMode: false });
      instance.loadSource(playlistUrl);
      instance.attachMedia(video);
      instance.on(Hls.Events.ERROR, (_evt, errData) => {
        if (errData.fatal) {
          console.error(`[hls.js fatal]`, errData);
          setError(`HLS error: ${errData.details}`);
        } else {
          console.warn(`[hls.js]`, errData.details);
        }
      });
      hls = instance;
    })();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      video.removeAttribute(`src`);
      video.load();
    };
  }, [id, token, prep?.status, fileQS]);

  if (!id) return <div className="p-6">No id.</div>;

  if (info && info.status !== `done`) {
    return (
      <div className="px-4 md:px-8 py-6 space-y-3 max-w-3xl mx-auto">
        <h1 className="text-xl font-medium">{info.title}</h1>
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 space-y-2">
          <p className="text-sm text-zinc-300">
            This download is still <code className="text-zinc-100">{info.status}</code>.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link to="/library" className="text-indigo-400 hover:underline">← Library</Link>
          <button onClick={() => navigate(0)} className="text-zinc-400 hover:text-white">Refresh</button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 space-y-3 max-w-3xl mx-auto">
        <div className="text-rose-400 text-sm">{error}</div>
        <Link to="/library" className="text-indigo-400 hover:underline text-sm">← Library</Link>
      </div>
    );
  }

  if (!info || !token) return <div className="p-6 text-zinc-400">Loading…</div>;

  const preparing = !prep || prep.status === `idle` || prep.status === `starting`;
  const playable = prep && (prep.status === `running` || prep.status === `done`);
  const playingFile = fileParam ?? info.primaryFile;

  return (
    <div className="px-4 md:px-8 py-4 space-y-3 max-w-6xl mx-auto">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-medium truncate">{info.title}</h1>
        <Link to="/library" className="text-indigo-400 hover:underline text-sm shrink-0">← Library</Link>
      </div>

      {preparing && (
        <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 text-sm text-zinc-300 space-y-1">
          <div>Preparing video for streaming…</div>
          <div className="text-xs text-zinc-500">
            ffmpeg is segmenting this file once. Subsequent plays start instantly.
          </div>
        </div>
      )}

      {playable && (
        <div className="rounded-lg overflow-hidden bg-black">
          <video
            ref={videoRef}
            controls
            autoPlay
            crossOrigin="anonymous"
            className="w-full max-h-[80vh] bg-black"
          >
            {tracks.map((t, i) => (
              <track
                key={t.id}
                src={`/api/library/${id}/subtitles/${encodeURIComponent(
                  t.id,
                )}?token=${encodeURIComponent(token)}${fileQS}`}
                kind="subtitles"
                srcLang={t.language ?? `und`}
                label={t.label}
                default={i === 0}
              />
            ))}
          </video>
        </div>
      )}

      <div className="text-xs text-zinc-500">
        File: <code className="text-zinc-300">{playingFile}</code>
        {prep && prep.status === `running` && (
          <> · HLS: <span className="text-amber-400">building in background</span></>
        )}
        {prep && prep.status === `done` && (
          <> · HLS: <span className="text-emerald-400">cached</span></>
        )}
      </div>
    </div>
  );
}
