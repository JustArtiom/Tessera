"use strict";

const ENDPOINT = "https://yts.mx/api/v2/list_movies.json";
const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
];

function buildMagnet(infoHash, name) {
  const dn = encodeURIComponent(name);
  const tr = TRACKERS.map((t) => `tr=${encodeURIComponent(t)}`).join("&");
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}&${tr}`;
}

function init({ config, logger }) {
  const qualityFilter = String(config.quality ?? "all");
  const minSeeders = Math.max(0, Number(config.minSeeders ?? 1));
  const maxMovies = Math.max(1, Math.min(50, Number(config.maxMovies ?? 25)));
  const userAgent = String(
    config.userAgent ?? "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  );

  async function search(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) return [];

    const params = new URLSearchParams({
      query_term: trimmed,
      limit: String(maxMovies),
      sort_by: "year",
      order_by: "desc",
    });
    if (qualityFilter !== "all") params.set("quality", qualityFilter);

    const url = `${ENDPOINT}?${params}`;
    let payload;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent, Accept: "application/json" },
      });
      if (!res.ok) {
        logger.error(`yts HTTP ${res.status}`);
        return [];
      }
      payload = await res.json();
    } catch (err) {
      // YTS frequently blocks data-center IPs / non-residential networks. Tell the user
      // exactly what's happening so they don't think the plugin is buggy.
      logger.error(
        "yts fetch failed (often blocked from VPS networks — try with a different network or skip this plugin):",
        err.message,
      );
      return [];
    }

    if (payload?.status !== "ok") {
      logger.error("yts returned non-ok status:", payload?.status_message);
      return [];
    }

    const movies = payload.data?.movies ?? [];
    const out = [];
    for (const m of movies) {
      for (const t of m.torrents ?? []) {
        if ((t.seeds ?? 0) < minSeeders) continue;
        const label = `${m.title} (${m.year}) [${t.quality}${t.type ? ` ${t.type}` : ""}]`;
        out.push({
          id: `yts:${(t.hash || "").toLowerCase()}`,
          title: label,
          year: m.year,
          poster: m.medium_cover_image || m.large_cover_image,
          description: `YTS · ${t.quality} ${t.type ?? ""} · ${t.size ?? "?"}`,
          streams: [
            {
              type: "magnet",
              url: buildMagnet(t.hash, label),
              quality: t.quality,
              size: t.size_bytes,
              seeders: t.seeds,
            },
          ],
        });
      }
    }
    out.sort((a, b) => (b.streams[0]?.seeders ?? 0) - (a.streams[0]?.seeders ?? 0));
    return out;
  }

  logger.log(`YTS ready (quality=${qualityFilter}, maxMovies=${maxMovies})`);
  return { search };
}

module.exports = { init };
