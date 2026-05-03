import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { useToast } from "../lib/toast";

interface ConfigField {
  key: string;
  label: string;
  type: `string` | `number` | `boolean` | `path` | `select`;
  description?: string;
  default?: unknown;
  options?: { value: string; label: string }[];
  required?: boolean;
  secret?: boolean;
}

interface ConfigPayload {
  schema: ConfigField[];
  values: Record<string, unknown>;
}

export function PluginConfigForm({ pluginId }: { pluginId: string }) {
  const [data, setData] = useState<ConfigPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<ConfigPayload>(`/api/plugins/${pluginId}/config`);
        if (!cancelled) {
          setData(res);
          setDraft(res.values);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  if (error) return <div className="text-sm text-rose-400">{error}</div>;
  if (!data) return <div className="text-sm text-zinc-400">Loading config…</div>;
  if (data.schema.length === 0) {
    return <div className="text-sm text-zinc-500 italic">This plugin has no configurable options.</div>;
  }

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<ConfigPayload>(`/api/plugins/${pluginId}/config`, {
        method: `PUT`,
        body: draft,
      });
      setData(res);
      setDraft(res.values);
      toast.push(`success`, `Saved ${pluginId} config`);
    } catch (err) {
      toast.push(`error`, err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSave} className="space-y-3">
      {data.schema.map((f) => (
        <label key={f.key} className="block text-sm">
          <div className="flex items-baseline gap-2">
            <span className="text-zinc-200">{f.label}</span>
            {f.required && <span className="text-rose-400 text-xs">required</span>}
          </div>
          {f.description && <p className="text-xs text-zinc-400 mb-1">{f.description}</p>}
          {f.type === `boolean` ? (
            <input
              type="checkbox"
              checked={Boolean(draft[f.key])}
              onChange={(e) => set(f.key, e.target.checked)}
              className="mt-1 h-4 w-4"
            />
          ) : f.type === `select` ? (
            <select
              value={String(draft[f.key] ?? ``)}
              onChange={(e) => set(f.key, e.target.value)}
              className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
            >
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.secret ? `password` : f.type === `number` ? `number` : `text`}
              value={String(draft[f.key] ?? ``)}
              onChange={(e) =>
                set(f.key, f.type === `number` ? Number(e.target.value) : e.target.value)
              }
              className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-indigo-500"
            />
          )}
        </label>
      ))}
      <button
        type="submit"
        disabled={busy}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-3 py-1.5 text-sm"
      >
        {busy ? `Saving…` : `Save`}
      </button>
    </form>
  );
}
