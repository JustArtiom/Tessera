"use strict";

const ENDPOINT = "https://apibay.org/q.php";
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

function parseQualityHint(title) {
  const m = title.match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i);
  return m ? m[1].toLowerCase() : undefined;
}

const CATEGORY_LABELS = {
  "201": "Movies SD",
  "207": "Movies HD",
  "211": "Movies 4K",
  "205": "TV",
  "208": "TV HD",
  "212": "TV 4K",
  "299": "Video other",
};

function init({ config, logger }) {
  const cat = String(config.category ?? "0");
  const minSeeders = Math.max(0, Number(config.minSeeders ?? 1));
  const maxResults = Math.max(1, Math.min(100, Number(config.maxResults ?? 50)));
  const userAgent = String(config.userAgent ?? "Tessera/0.5");

  async function search(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) return [];

    const url = `${ENDPOINT}?q=${encodeURIComponent(trimmed)}&cat=${encodeURIComponent(cat)}`;

    let items;
    try {
      const res = await fetch(url, { headers: { "User-Agent": userAgent } });
      if (!res.ok) {
        logger.error(`apibay HTTP ${res.status}`);
        return [];
      }
      items = await res.json();
    } catch (err) {
      logger.error("apibay fetch failed:", err.message);
      return [];
    }

    // apibay returns a sentinel "no results" entry with id="0" instead of an empty array.
    if (!Array.isArray(items)) return [];
    if (items.length === 1 && items[0].id === "0") return [];

    return items
      .filter((it) => parseInt(it.seeders ?? "0", 10) >= minSeeders)
      .sort((a, b) => parseInt(b.seeders, 10) - parseInt(a.seeders, 10))
      .slice(0, maxResults)
      .map((it) => {
        const seeders = parseInt(it.seeders ?? "0", 10) || 0;
        const size = parseInt(it.size ?? "0", 10) || undefined;
        const catLabel = CATEGORY_LABELS[String(it.category)] ?? `cat ${it.category}`;
        return {
          id: `tpb:${String(it.info_hash || "").toLowerCase()}`,
          title: it.name,
          description: `${catLabel} · ${it.status ?? "unknown"}`,
          streams: [
            {
              type: "magnet",
              url: buildMagnet(it.info_hash, it.name),
              quality: parseQualityHint(it.name),
              size,
              seeders,
            },
          ],
        };
      });
  }

  logger.log(`Pirate Bay ready (cat=${cat}, max=${maxResults})`);
  return { search };
}

module.exports = { init };
