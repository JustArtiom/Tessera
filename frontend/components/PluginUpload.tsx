import { useRef, useState } from "react";
import { api, ApiError } from "../lib/api";

interface UploadResponse {
  pluginId: string;
}

export function PluginUpload({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append(`file`, file);
      const result = await api<UploadResponse>(`/api/plugins/upload`, { raw: fd });
      setMessage(`Installed plugin: ${result.pluginId}`);
      onUploaded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ``;
    }
  };

  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4">
      <h2 className="font-medium mb-2">Install a plugin</h2>
      <p className="text-sm text-zinc-400 mb-3">
        Upload a <code className="text-zinc-300">.zip</code> containing a{` `}
        <code className="text-zinc-300">manifest.json</code> and{` `}
        <code className="text-zinc-300">index.js</code>.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="block text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-indigo-600 file:text-white hover:file:bg-indigo-500"
      />
      {busy && <div className="mt-2 text-sm text-zinc-400">Uploading…</div>}
      {message && <div className="mt-2 text-sm text-emerald-400">{message}</div>}
      {error && <div className="mt-2 text-sm text-rose-400">{error}</div>}
    </div>
  );
}
