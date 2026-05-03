"use strict";

const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
];

const ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#34;": '"',
  "&#39;": "'",
};

function htmlDecode(s) {
  if (!s) return s;
  return s
    .replace(/&(amp|lt|gt|quot|apos|#34|#39);/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripCdata(s) {
  return s.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
}

function extract(item, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = item.match(re);
  if (!m) return null;
  return htmlDecode(stripCdata(m[1].trim()));
}

function buildMagnet(infoHash, title) {
  const dn = encodeURIComponent(title);
  const tr = TRACKERS.map((t) => `tr=${encodeURIComponent(t)}`).join("&");
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}&${tr}`;
}

const SIZE_UNITS = {
  B: 1,
  KB: 1024, KIB: 1024,
  MB: 1024 ** 2, MIB: 1024 ** 2,
  GB: 1024 ** 3, GIB: 1024 ** 3,
  TB: 1024 ** 4, TIB: 1024 ** 4,
};

function parseSize(text) {
  if (!text) return undefined;
  const m = text.match(/^([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)$/i);
  if (!m) return undefined;
  return Math.round(parseFloat(m[1]) * (SIZE_UNITS[m[2].toUpperCase()] ?? 1));
}

function parseQualityHint(title) {
  const m = title.match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i);
  return m ? m[1].toLowerCase() : undefined;
}

async function fetchRss(url, userAgent) {
  const res = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!res.ok) throw new Error(`Nyaa returned HTTP ${res.status}`);
  return await res.text();
}

function parseItems(xml, limit) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = re.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const infoHash = extract(block, "nyaa:infoHash");
    const title = extract(block, "title");
    if (!infoHash || !title) continue;
    items.push({
      infoHash: infoHash.toLowerCase(),
      title,
      seeders: parseInt(extract(block, "nyaa:seeders") ?? "0", 10) || 0,
      sizeText: extract(block, "nyaa:size") ?? "",
      category: extract(block, "nyaa:category"),
    });
  }
  return items;
}

function init({ config, logger }) {
  const cat = String(config.category ?? "1_0");
  const minSeeders = Math.max(0, Number(config.minSeeders ?? 1));
  const maxResults = Math.max(1, Math.min(75, Number(config.maxResults ?? 50)));
  const userAgent = String(config.userAgent ?? "Tessera/0.5");

  async function search(query) {
    const trimmed = (query || "").trim();
    if (!trimmed) return [];

    const url =
      `https://nyaa.si/?page=rss&c=${encodeURIComponent(cat)}` +
      `&s=seeders&o=desc&q=${encodeURIComponent(trimmed)}`;

    let xml;
    try {
      xml = await fetchRss(url, userAgent);
    } catch (err) {
      logger.error("RSS fetch failed:", err.message);
      return [];
    }

    const items = parseItems(xml, maxResults).filter((it) => it.seeders >= minSeeders);
    return items.map((it) => ({
      id: `nyaa:${it.infoHash}`,
      title: it.title,
      description: it.category
        ? `${it.category} · ${it.sizeText}`
        : undefined,
      streams: [
        {
          type: "magnet",
          url: buildMagnet(it.infoHash, it.title),
          quality: parseQualityHint(it.title),
          size: parseSize(it.sizeText),
          seeders: it.seeders,
        },
      ],
    }));
  }

  return { search };
}

module.exports = { init };
