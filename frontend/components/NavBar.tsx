import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm transition-colors ${
      isActive ? `bg-zinc-800 text-white` : `text-zinc-400 hover:text-white hover:bg-zinc-900`
    }`;

  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-zinc-950/85 border-b border-zinc-900">
      <div className="flex items-center gap-3 md:gap-6 px-4 md:px-8 h-14">
        <Link
          to="/"
          className="font-bold tracking-tight text-lg bg-gradient-to-br from-indigo-400 to-fuchsia-400 bg-clip-text text-transparent"
        >
          Tessera
        </Link>
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={linkCls}>
            Search
          </NavLink>
          <NavLink to="/library" className={linkCls}>
            Library
          </NavLink>
          <NavLink to="/plugins" className={linkCls}>
            Plugins
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden md:inline text-zinc-500">{user.email}</span>
          <button
            onClick={() => {
              logout();
              navigate(`/login`, { replace: true });
            }}
            className="text-zinc-400 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
