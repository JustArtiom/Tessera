import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { AppError } from "../middleware/error";
import * as registry from "../plugins/registry";
import { installFromZip } from "../plugins/installer";
import {
  defaultsForSchema,
  getConfigValues,
  setConfigValues,
  validateAgainstSchema,
} from "../plugins/config-store";
import { reloadOne } from "../plugins/loader";
import type { PluginConfigField } from "../types/plugin";

const router = Router();

function maskSecrets(
  schema: PluginConfigField[] | undefined,
  values: Record<string, unknown>,
): Record<string, unknown> {
  if (!schema) return values;
  const out: Record<string, unknown> = { ...values };
  for (const field of schema) {
    if (field.secret && out[field.key]) out[field.key] = `••••`;
  }
  return out;
}

const MAX_PLUGIN_BYTES = 10 * 1024 * 1024; // 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PLUGIN_BYTES, files: 1 },
});

router.get(`/`, requireAuth, (_req, res) => {
  const list = registry.all().map((p) => ({ ...p.manifest }));
  res.json({ plugins: list });
});

router.post(`/upload`, requireAuth, upload.single(`file`), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, `Expected a "file" field with a zip upload`);
    }
    const result = await installFromZip(req.file.buffer);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

const idParam = z.object({ id: z.string().min(1) });

router.get(`/:id/config`, requireAuth, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const plugin = registry.get(id);
    if (!plugin) throw new AppError(404, `Plugin not found`);
    const stored = await getConfigValues(id);
    const schema = plugin.manifest.configSchema ?? [];
    const merged = { ...defaultsForSchema(schema), ...stored };
    res.json({ schema, values: maskSecrets(schema, merged) });
  } catch (err) {
    next(err);
  }
});

router.put(`/:id/config`, requireAuth, async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const plugin = registry.get(id);
    if (!plugin) throw new AppError(404, `Plugin not found`);
    const schema = plugin.manifest.configSchema ?? [];
    const incoming = z.record(z.string(), z.unknown()).parse(req.body);

    // Don't overwrite secrets when the UI sends back the placeholder.
    const stored = await getConfigValues(id);
    for (const field of schema) {
      if (field.secret && incoming[field.key] === `••••`) {
        incoming[field.key] = stored[field.key];
      }
    }

    const cleaned = validateAgainstSchema(schema, incoming);
    const saved = await setConfigValues(id, cleaned);
    await reloadOne(id);
    res.json({ schema, values: maskSecrets(schema, saved) });
  } catch (err) {
    next(err);
  }
});

export default router;
