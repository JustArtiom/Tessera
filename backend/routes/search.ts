import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import * as registry from "../plugins/registry";
import type { MediaResult } from "../types/plugin";
import { cached } from "../lib/cache";
import { prisma } from "../lib/prisma";
import { infoHashFromMagnet, infoHashFromResultId } from "../lib/infohash";

const router = Router();

interface AnnotatedResult extends MediaResult {
  pluginId: string;
  /** When set, the torrent is already in the user's library — disable Download. */
  existing?: { id: string; status: string };
}

const querySchema = z.object({ q: z.string().min(1) });

router.get(`/`, requireAuth, async (req, res, next) => {
  try {
    const { q } = querySchema.parse(req.query);

    // The plugin search is what we cache — annotation against the live downloads
    // table happens AFTER the cache lookup so newly-downloaded torrents flip to
    // "existing" right away even on cached results.
    const baseResults = await cached(`search:${q.toLowerCase()}`, async () => {
      const plugins = registry.sources();
      const settled = await Promise.allSettled(
        plugins.map(async (p) => {
          const items = await p.module.search(q);
          return items.map((it) => ({ ...it, pluginId: p.manifest.id }));
        }),
      );
      const out: AnnotatedResult[] = [];
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === `fulfilled`) {
          out.push(...r.value);
        } else {
          console.error(`[search] ${plugins[i].manifest.id} failed:`, r.reason);
        }
      }
      out.sort((a, b) => (b.streams[0]?.seeders ?? 0) - (a.streams[0]?.seeders ?? 0));
      return out;
    });

    // Annotate against live DB state.
    const downloads = await prisma.download.findMany({
      where: { infoHash: { not: null } },
      select: { id: true, infoHash: true, status: true },
    });
    const byHash = new Map<string, { id: string; status: string }>();
    for (const d of downloads) if (d.infoHash) byHash.set(d.infoHash, { id: d.id, status: d.status });

    const results: AnnotatedResult[] = baseResults.map((r) => {
      const hash =
        infoHashFromResultId(r.id) ?? infoHashFromMagnet(r.streams[0]?.url ?? null);
      const existing = hash ? byHash.get(hash) : undefined;
      return existing ? { ...r, existing } : r;
    });

    res.json({ results });
  } catch (err) {
    next(err);
  }
});

export default router;
