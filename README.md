# Tessera

Self-hosted, plugin-based media streaming server. Browse anime via **MyAnimeList** (through the free Jikan v4 API), find torrents via **nyaa.si**, download with **WebTorrent**, and stream from your library with on-the-fly MKV→HLS remux.

## Stack

- TypeScript everywhere (plugins may be plain JS)
- Backend: Express 5, Prisma + PostgreSQL, JWT (HS256), bcrypt, Zod
- Frontend: React 19, Vite 7, React Router 7, Tailwind v4, hls.js
- Torrent: WebTorrent v2 (loaded via dynamic ESM import)
- Media: ffmpeg / ffprobe (HLS prep + subtitle extraction)
- Tooling: tsup, nodemon, concurrently, ESLint + Prettier

## Layout

```
backend/    Express app, plugin loader, download manager, HLS, subs
frontend/   React + Vite SPA
plugins/
  jikan-metadata/  Browse/search/details/episodes via Jikan v4 (MyAnimeList)
  nyaa-scraper/    Episode-aware torrent search on nyaa.si with smart title parsing
prisma/     Schema + migrations
downloads/  Per-plugin storage roots (auto-created when downloading)
```

## Caching

All metadata and source plugin calls go through an in-memory **30-minute cache** (`backend/lib/cache.ts`). Repeated browses, searches, episode lookups, and torrent searches within that window hit memory — no upstream API calls. The cache resets on backend restart.

| Path | Cold | Cached |
|---|---|---|
| `/api/metadata/browse` | ~2 s (4 sequential Jikan requests) | ~30 ms |
| `/api/sources/episode` | ~2-4 s (3-4 nyaa RSS calls) | ~40 ms |

## Prerequisites

- Node 20+, npm 10+
- **ffmpeg** + **ffprobe** on `$PATH`
- PostgreSQL (anywhere — local Docker, hosted, etc.)
- (no API keys needed — Jikan v4 and nyaa.si are both free and unauthenticated)

## First-run

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL and JWT_SECRET
npm run prisma:migrate -- --name init
npm run dev
```

Open http://localhost:5173. Register if `ALLOW_REGISTER=true`, otherwise log in with an existing account.

## Browse-and-download flow

1. **Home** — Jikan/MAL browse rows: Airing Now, Top Rated, Most Popular, Upcoming. Hero banner pulled from the first row.
2. **Search** — type into the nav search bar. Jikan returns matching anime entries; each cour is its own entry (Re:Zero S1, S2, S2 Part 2, S3, S4 are five separate cards).
3. **Show page** — hero with poster + overview + genres + themes, then a flat list of episodes. Each row shows the episode number, name (or `Episode XX` if MAL doesn't have one), air date, and runtime.
4. **Click an episode** — expands a panel underneath with torrents from nyaa. The nyaa plugin parses the show title (e.g. "Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season" → base + season=2), runs multiple search variants, and filters out wrong-cour matches.
5. **Click Download** — torrent starts in the background. Library shows progress.
6. **When `status === done`** — Play button appears on both the show page (per-episode) and Library. The Player only loads finished downloads (no streaming-while-downloading; once you click play, ffmpeg pre-segments the file to disk for HLS, takes ~1-3 s for `-c copy` paths).

## Plugin types

Plugins live under `plugins/<id>/` with `manifest.json` + `index.js` (or `index.cjs`). Two flavors:

### Metadata plugins (`type: "metadata"`)

Provide browse rows, search, show details, and episode listings. Stateful (must export `init({ config, logger }) → instance`).

Required methods on the instance:

- `search(query) → MetadataItem[]`
- `getDetails(id) → ShowDetails`
- `getEpisodes(showId, seasonNumber) → Episode[]`

Optional:

- `browse() → BrowseRow[]` — one or more curated rows for the home page

### Source plugins (`type: "source"`)

Find torrents/streams. Stateless or stateful.

At least one of:

- `findForEpisode({ show, seasonNumber, episodeNumber }) → MediaResult[]` — preferred path
- `search(query) → MediaResult[]` — fallback / free-text

Each `MediaResult` carries one or more `streams: { type: "magnet"|"http"|"hls", url, quality?, size?, seeders? }`.

## Endpoints

| Path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/{login,register}` | public | JWT auth (register gated by `ALLOW_REGISTER`) |
| `GET /api/config` | public | `{ allowRegister }` |
| `GET /api/metadata/browse` | yes | Aggregated rows from every metadata plugin |
| `GET /api/metadata/search?q=…` | yes | Aggregated search across metadata plugins |
| `GET /api/metadata/show/:pid/:id` | yes | Full show details (cached 1h) |
| `GET /api/metadata/show/:pid/:id/season/:n` | yes | Season episodes (cached 1h) |
| `POST /api/sources/episode` | yes | Body `{ show, episodeNumber }` → torrents from every source plugin (nyaa parses cour from `show.title` and `show.originalTitle` itself) |
| `POST /api/downloads` | yes | `{ magnet, pluginId, mediaId, title, poster? }` — start a torrent |
| `GET /api/downloads`, `/:id`, `DELETE /:id` | yes | List/inspect/cancel |
| `GET /api/downloads/:id/events` | yes | SSE progress stream |
| `POST /api/library/:id/stream-token` | yes | 4h JWT scoped to one download |
| `GET /api/library/:id/playlist.m3u8?token=…` | scoped | HLS playlist (triggers prep on first call) |
| `GET /api/library/:id/segment/:filename?token=…` | scoped | TS segment from disk |
| `GET /api/library/:id/subtitles` | yes | List embedded + sidecar subtitle tracks |
| `GET /api/library/:id/subtitles/:trackId?token=…` | scoped | WebVTT |
| `GET /api/plugins` | yes | List loaded plugins |
| `GET /api/plugins/:id/config`, `PUT` | yes | Per-plugin config |
| `POST /api/plugins/upload` | yes | Install a zipped plugin |

## Streaming pipeline (still HLS, on-disk)

The flow you described — wait for full download, then watch — is enforced: the Player shows "this download isn't complete yet" until `status === 'done'`, then takes the user to HLS playback.

On first play of a file, a single `ffmpeg` writes `<filePath>/hls/playlist.m3u8` + `seg_NNNNN.ts` segments. With H.264/AAC sources `-c copy` is used (essentially a fast remux); other codecs go through `libx264 -preset veryfast -crf 23` and `aac 192k`. Subsequent plays are pure static-file serves.

Disk cost: ~1× source size for the HLS cache. Removing a download (`?removeFiles=true`) wipes both the original files and the HLS cache.

## Scripts

| Script | What |
| --- | --- |
| `npm run dev` | Backend + frontend in parallel |
| `npm run dev:backend` | nodemon → tsup → node |
| `npm run dev:frontend` | Vite |
| `npm run build` | Build both |
| `npm start` | Run built backend (serves frontend in prod) |
| `npm run prisma:migrate` | Run Prisma migrations |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run lint` | ESLint |

## Known limitations (v0.3)

- **HEVC / DTS / AC3 → CPU transcode**, no hardware acceleration.
- **No streaming-while-downloading** — by design; the file must be fully downloaded before play.
- **Episode-number ambiguity for split-cour anime**: TMDB sometimes lumps S1+S2 into one season (e.g. Frieren), while nyaa's fansubs label per-cour. The nyaa plugin tries both query styles, but you may see mixed results — pick the one with seeders that matches the release group you trust.
- **No plugin sandboxing** — `index.js` runs in the main Node process. Only install trusted plugins.
- **ASS/SSA subtitle styling is dropped** during WebVTT conversion (text + timing kept).
- **Single-user authentication** — every authenticated user can manage every download.
- **TMDB ratelimiting**: search is per-IP (currently ~50 req/sec), but heavy concurrent users behind one egress IP may bottleneck. Browse rows are cached for 10 minutes; show/episode details for 1 hour.
