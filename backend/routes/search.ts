import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import * as registry from "../plugins/registry";
import type { MediaResult } from "../types/plugin";
import { cached } from "../lib/cache";

const router = Router();

interface AnnotatedResult extends MediaResult {
  pluginId: string;
}

const querySchema = z.object({ q: z.string().min(1) });

router.get(`/`, requireAuth, async (req, res, next) => {
  try {
    const { q } = querySchema.parse(req.query);
    const results = await cached(`search:${q.toLowerCase()}`, async () => {
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
      // Globally sort by seeders desc so users see best results first regardless of source.
      out.sort((a, b) => (b.streams[0]?.seeders ?? 0) - (a.streams[0]?.seeders ?? 0));
      return out;
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

export default router;
