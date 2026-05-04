/**
 * Helpers for normalising BitTorrent v1 info hashes between the two encodings
 * you find in real magnet URIs:
 *   - 40-char hex   (e.g. "08ada5a7…")     — what nyaa's RSS feed exposes
 *   - 32-char base32 (RFC 4648, e.g. "Q2SY…") — what some clients build by default
 * Everything internal to Tessera uses lowercase 40-char hex.
 */

const BASE32_ALPHABET = `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`;

function base32ToHex(b32: string): string | null {
  const upper = b32.toUpperCase();
  let bits = ``;
  for (const ch of upper) {
    const v = BASE32_ALPHABET.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, `0`);
  }
  // 32 base32 chars × 5 bits = 160 bits = 40 hex chars
  if (bits.length < 160) return null;
  let hex = ``;
  for (let i = 0; i < 160; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Parse a magnet URI's `xt=urn:btih:…` and return a lowercase 40-char hex hash.
 * Accepts both hex and base32 forms. Returns null if no parseable hash.
 */
export function infoHashFromMagnet(magnet: string | null | undefined): string | null {
  if (!magnet) return null;
  const m = magnet.match(/[?&]xt=urn:btih:([a-zA-Z0-9]+)/) ?? magnet.match(/btih:([a-zA-Z0-9]+)/);
  if (!m) return null;
  return normalizeInfoHash(m[1]);
}

/**
 * Accepts either a 40-char hex or 32-char base32 infohash and returns lowercase hex.
 */
export function normalizeInfoHash(raw: string): string | null {
  if (/^[a-fA-F0-9]{40}$/.test(raw)) return raw.toLowerCase();
  if (/^[A-Z2-7]{32}$/i.test(raw)) return base32ToHex(raw);
  return null;
}

/**
 * Pulls an infohash out of a plugin-namespaced result id like "nyaa:abcd…" or "tpb:…".
 * Falls back to checking the whole string for a hex/base32 match.
 */
export function infoHashFromResultId(id: string): string | null {
  const idx = id.lastIndexOf(`:`);
  const tail = idx >= 0 ? id.slice(idx + 1) : id;
  return normalizeInfoHash(tail);
}
