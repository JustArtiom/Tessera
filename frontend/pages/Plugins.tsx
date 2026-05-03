import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { PluginUpload } from "../components/PluginUpload";
import { PluginConfigForm } from "../components/PluginConfigForm";

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  contentTypes: string[];
  type: `source` | `metadata`;
}

interface PluginsResponse {
  plugins: PluginManifest[];
}

export function Plugins() {
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api<PluginsResponse>(`/api/plugins`);
      setPlugins(res.plugins);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Plugins</h1>

      <PluginUpload onUploaded={load} />

      <section>
        <h2 className="font-medium mb-3">Installed</h2>
        {loading ? (
          <div className="text-sm text-zinc-400">Loading…</div>
        ) : error ? (
          <div className="text-sm text-rose-400">{error}</div>
        ) : plugins.length === 0 ? (
          <div className="text-sm text-zinc-400">No plugins installed yet.</div>
        ) : (
          <ul className="space-y-3">
            {plugins.map((p) => (
              <PluginRow key={p.id} plugin={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PluginRow({ plugin }: { plugin: PluginManifest }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg bg-zinc-900 border border-zinc-800 p-3">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {plugin.name}{` `}
            <span className="text-xs text-zinc-500">v{plugin.version}</span>
          </div>
          <div className="text-xs text-zinc-400">
            {plugin.id} · {plugin.type} · {plugin.contentTypes.join(`, `)}
            {plugin.author && ` · by ${plugin.author}`}
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-indigo-400 hover:underline shrink-0"
        >
          {open ? `Hide config` : `Configure`}
        </button>
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <PluginConfigForm pluginId={plugin.id} />
        </div>
      )}
    </li>
  );
}
