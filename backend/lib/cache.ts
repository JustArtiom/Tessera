/**
 * Trivial in-memory cache with per-entry TTL. Used to avoid hammering
 * upstream APIs (Jikan, nyaa) when the same query repeats within a short window.
 *
 * Lives for the lifetime of the Node process; no eviction beyond TTL expiry,
 * which is fine for the small cardinality we expect (a few hundred keys).
 */

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

export const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await fn();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function size(): number {
  return store.size;
}

export function debug(): { keys: number; expired: number } {
  let expired = 0;
  const now = Date.now();
  for (const e of store.values()) if (e.expiresAt <= now) expired++;
  return { keys: store.size, expired };
}
