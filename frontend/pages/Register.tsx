import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ApiError } from "../lib/api";
import { useServerConfig } from "../lib/server-config";

export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const cfg = useServerConfig();
  const [email, setEmail] = useState(``);
  const [password, setPassword] = useState(``);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, password);
      navigate(`/`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (cfg && !cfg.allowRegister) {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-3">
          <h1 className="text-xl font-semibold">Registration is disabled</h1>
          <p className="text-sm text-zinc-400">
            This Tessera server is not accepting new accounts. Contact the administrator if you
            need access.
          </p>
          <Link to="/login" className="text-indigo-400 hover:underline text-sm">
            ← Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold">Create your Tessera account</h1>
        <label className="block">
          <span className="text-sm text-zinc-400">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Password (min 8)</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </label>
        {error && <div className="text-sm text-rose-400">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded px-3 py-2 text-sm transition-colors"
        >
          {busy ? `Creating…` : `Create account`}
        </button>
        <div className="text-sm text-zinc-400">
          Already have one?{` `}
          <Link to="/login" className="text-indigo-400 hover:underline">
            Sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
