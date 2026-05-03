"use strict";

const ENDPOINT = "https://feed.animetosho.org/json";

function parseQualityHint(title) {
  const m = title.match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i);
  return m ? m[1].toLowerCase() : undefined;
}

function init({ config, logger }) {
  const minSeeders = Math.max(0, Number(config.minSeeders ?? 1));
  const maxResults = Math.max(1, Math.min(100, Number(config.maxResults ?? 50)));
  const userAgent = String(config.userAgent ?? "Tessera/0.5");

  async function search(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) return [];

    const url = `${ENDPOINT}?q=${encodeURIComponent(trimmed)}`;

    let items;
    try {
      const res = await fetch(url, { headers: { "User-Agent": userAgent } });
      if (!res.ok) {
        logger.error(`animetosho HTTP ${res.status}`);
        return [];
      }
      items = await res.json();
    } catch (err) {
      logger.error("animetosho fetch failed:", err.message);
      return [];
    }

    if (!Array.isArray(items)) return [];

    return items
      .filter((it) => (it.seeders ?? 0) >= minSeeders)
      .sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))
      .slice(0, maxResults)
      .map((it) => {
        const sizeText = it.total_size
          ? `${(it.total_size / 1024 ** 3).toFixed(2)} GB`
          : "?";
        const fileCount = it.num_files ?? 1;
        const fileLabel = fileCount > 1 ? ` · ${fileCount} files` : "";
        return {
          id: `at:${(it.info_hash || "").toLowerCase()}`,
          title: it.title,
          description: `AnimeTosho · ${sizeText}${fileLabel}`,
          streams: [
            {
              type: "magnet",
              url: it.magnet_uri,
              quality: parseQualityHint(it.title),
              size: it.total_size ?? undefined,
              seeders: it.seeders ?? 0,
            },
          ],
        };
      });
  }

  logger.log(`AnimeTosho ready (max=${maxResults}, minSeeders=${minSeeders})`);
  return { search };
}

module.exports = { init };
