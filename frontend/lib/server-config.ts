import { useEffect, useState } from "react";

interface ServerConfig {
  allowRegister: boolean;
}

let cache: Promise<ServerConfig> | null = null;

function fetchConfig(): Promise<ServerConfig> {
  if (!cache) {
    cache = fetch(`/api/config`)
      .then((r) => r.json() as Promise<ServerConfig>)
      .catch(() => ({ allowRegister: false }));
  }
  return cache;
}

export function useServerConfig(): ServerConfig | null {
  const [cfg, setCfg] = useState<ServerConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchConfig().then((c) => {
      if (!cancelled) setCfg(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return cfg;
}
