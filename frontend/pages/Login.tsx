import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { ApiError } from "../lib/api";
import { useServerConfig } from "../lib/server-config";

interface LocationState {
  from?: string;
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
      await login(email, password);
      const from = (location.state as LocationState | null)?.from ?? `/`;
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold">Sign in to Tessera</h1>
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
          <span className="text-sm text-zinc-400">Password</span>
          <input
            type="password"
            required
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
          {busy ? `Signing in…` : `Sign in`}
        </button>
        {cfg?.allowRegister && (
          <div className="text-sm text-zinc-400">
            No account?{` `}
            <Link to="/register" className="text-indigo-400 hover:underline">
              Register
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
