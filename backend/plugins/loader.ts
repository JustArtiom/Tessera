import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env";
import {
  pluginManifestSchema,
  type LoadedPlugin,
  type PluginContext,
  type PluginModule,
  type PluginModuleStateful,
  type SourcePluginInstance,
} from "../types/plugin";
import * as registry from "./registry";
import { defaultsForSchema, getConfigValues } from "./config-store";

export function pluginsRoot(): string {
  return path.resolve(process.cwd(), env.PLUGINS_DIR);
}

function bustRequireCache(dir: string): void {
  const prefix = path.resolve(dir) + path.sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) delete require.cache[key];
  }
}

function resolveEntry(dir: string): string | null {
  for (const candidate of [`index.js`, `index.cjs`]) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function isStateful(mod: PluginModule): mod is PluginModuleStateful {
  return typeof (mod as PluginModuleStateful).init === `function`;
}

async function loadOne(dir: string): Promise<LoadedPlugin> {
  const manifestPath = path.join(dir, `manifest.json`);
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest.json in ${dir}`);
  const raw = JSON.parse(fs.readFileSync(manifestPath, `utf8`));
  const manifest = pluginManifestSchema.parse(raw);

  const entry = resolveEntry(dir);
  if (!entry) throw new Error(`Missing index.js (or index.cjs) in ${dir}`);

  bustRequireCache(dir);

  const required = require(entry) as PluginModule | { default?: PluginModule };
  const exported = (`default` in required && required.default
    ? required.default
    : required) as PluginModule;

  const persistedConfig = await getConfigValues(manifest.id);
  const defaults = defaultsForSchema(manifest.configSchema ?? []);
  const config = { ...defaults, ...persistedConfig };

  const ctx: PluginContext = {
    config,
    logger: {
      log: (...a: unknown[]) => console.log(`[${manifest.id}]`, ...a),
      warn: (...a: unknown[]) => console.warn(`[${manifest.id}]`, ...a),
      error: (...a: unknown[]) => console.error(`[${manifest.id}]`, ...a),
    },
  };

  const instance: SourcePluginInstance = isStateful(exported)
    ? await Promise.resolve(exported.init(ctx))
    : (exported as SourcePluginInstance);

  if (typeof instance.search !== `function`) {
    throw new Error(`Plugin "${manifest.id}" does not export search()`);
  }

  return { manifest, dir, module: instance };
}

export interface LoadReport {
  loaded: string[];
  failed: { dir: string; error: string }[];
}

export async function loadAll(): Promise<LoadReport> {
  const root = pluginsRoot();
  const report: LoadReport = { loaded: [], failed: [] };
  if (!fs.existsSync(root)) return report;

  registry.clear();

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      const plugin = await loadOne(dir);
      registry.register(plugin);
      report.loaded.push(plugin.manifest.id);
    } catch (err) {
      report.failed.push({ dir, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}

export async function reloadOne(pluginId: string): Promise<LoadedPlugin> {
  const root = pluginsRoot();
  const dir = path.join(root, pluginId);
  if (!fs.existsSync(dir)) throw new Error(`Plugin directory not found: ${dir}`);
  const plugin = await loadOne(dir);
  registry.register(plugin);
  return plugin;
}
