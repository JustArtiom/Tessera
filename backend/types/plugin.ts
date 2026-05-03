import { z } from "zod";

export const contentTypeSchema = z.enum([`anime`, `movie`, `tv`, `music`]);
export type ContentType = z.infer<typeof contentTypeSchema>;

export const pluginConfigFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum([`string`, `number`, `boolean`, `path`, `select`]),
  description: z.string().optional(),
  default: z.unknown().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
});
export type PluginConfigField = z.infer<typeof pluginConfigFieldSchema>;

export const pluginManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-_]*$/, `id must be a slug (lowercase, digits, - and _)`),
  name: z.string().min(1),
  version: z.string().min(1),
  author: z.string().optional(),
  contentTypes: z.array(contentTypeSchema).min(1),
  // Only "source" plugins are supported now. Older manifests with type=metadata are rejected.
  type: z.literal(`source`),
  configSchema: z.array(pluginConfigFieldSchema).optional(),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export interface StreamSource {
  type: `magnet` | `http` | `hls`;
  url: string;
  quality?: string;
  size?: number;
  seeders?: number;
}

export interface MediaResult {
  id: string;
  title: string;
  year?: number;
  poster?: string;
  description?: string;
  streams: StreamSource[];
}

export interface SourcePluginInstance {
  search(query: string): Promise<MediaResult[]>;
}

export interface PluginContext {
  config: Record<string, unknown>;
  logger: Pick<Console, `log` | `warn` | `error`>;
}

export interface PluginModuleStateful {
  init: (ctx: PluginContext) => SourcePluginInstance | Promise<SourcePluginInstance>;
}

export type PluginModule = SourcePluginInstance | PluginModuleStateful;

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  module: SourcePluginInstance;
}
