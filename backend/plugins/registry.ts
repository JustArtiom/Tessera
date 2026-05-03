import type { LoadedPlugin } from "../types/plugin";

const plugins = new Map<string, LoadedPlugin>();

export function register(plugin: LoadedPlugin): void {
  plugins.set(plugin.manifest.id, plugin);
}

export function unregister(id: string): void {
  plugins.delete(id);
}

export function clear(): void {
  plugins.clear();
}

export function get(id: string): LoadedPlugin | undefined {
  return plugins.get(id);
}

export function all(): LoadedPlugin[] {
  return Array.from(plugins.values());
}

export const sources = all;
