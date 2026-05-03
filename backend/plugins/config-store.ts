import { z } from "zod";
import { prisma } from "../lib/prisma";
import type { PluginConfigField } from "../types/plugin";

export async function getConfigValues(pluginId: string): Promise<Record<string, unknown>> {
  const row = await prisma.pluginConfig.findUnique({ where: { pluginId } });
  if (!row) return {};
  return (row.values ?? {}) as Record<string, unknown>;
}

export async function setConfigValues(
  pluginId: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const row = await prisma.pluginConfig.upsert({
    where: { pluginId },
    create: { pluginId, values: values as object },
    update: { values: values as object },
  });
  return row.values as Record<string, unknown>;
}

export function defaultsForSchema(
  schema: PluginConfigField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema) {
    if (field.default !== undefined) out[field.key] = field.default;
  }
  return out;
}

/**
 * Validates `values` against `schema` field-by-field. Unknown keys are dropped.
 * Throws ZodError if any field violates its declared shape.
 */
export function validateAgainstSchema(
  schema: PluginConfigField[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const field of schema) {
    const v = values[field.key];
    if (v === undefined || v === null || v === ``) {
      if (field.required && field.default === undefined) {
        throw new z.ZodError([
          {
            code: `custom`,
            path: [field.key],
            message: `${field.label} is required`,
          },
        ]);
      }
      if (field.default !== undefined) cleaned[field.key] = field.default;
      continue;
    }
    switch (field.type) {
      case `string`:
      case `path`:
        cleaned[field.key] = z.string().parse(v);
        break;
      case `number`:
        cleaned[field.key] = z.coerce.number().parse(v);
        break;
      case `boolean`:
        cleaned[field.key] = z.coerce.boolean().parse(v);
        break;
      case `select`: {
        const allowed = (field.options ?? []).map((o) => o.value);
        cleaned[field.key] = z.enum(allowed as [string, ...string[]]).parse(v);
        break;
      }
    }
  }
  return cleaned;
}
