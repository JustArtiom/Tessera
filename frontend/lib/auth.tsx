import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export interface AuthUser {
  id: string;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

interface AuthResponse {
  token: string;
  user: AuthUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Decode the JWT just to grab the user id/email — no signature check needed client-side.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const [, payloadB64] = token.split(`.`);
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, `+`).replace(/_/g, `/`)));
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        setToken(null);
      } else {
        setUser({ id: payload.sub, email: payload.email });
      }
    } catch {
      setToken(null);
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<AuthResponse>(`/api/auth/login`, { body: { email, password } });
    setToken(data.token);
    setUser(data.user);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const data = await api<AuthResponse>(`/api/auth/register`, { body: { email, password } });
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
