import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface Toast {
  id: number;
  kind: `info` | `success` | `error`;
  message: string;
}

interface ToastApi {
  push: (kind: Toast[`kind`], message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Toast[`kind`], message: string) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              `rounded shadow-lg px-4 py-2 text-sm border ` +
              (t.kind === `success`
                ? `bg-emerald-900/80 border-emerald-700 text-emerald-100`
                : t.kind === `error`
                  ? `bg-rose-900/80 border-rose-700 text-rose-100`
                  : `bg-zinc-900/80 border-zinc-700 text-zinc-100`)
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error(`useToast must be used inside <ToastProvider>`);
  return ctx;
}
