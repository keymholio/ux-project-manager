// Tiny toast system: a context provider with a `useToast()` hook.
// Call `toast("Project created")` from anywhere inside the app tree to surface
// a short confirmation in the bottom-right corner. Pass "error" as the second
// arg for a red tone.
//
// Kept deliberately small — no queue limit, no animation library, no action
// buttons. If we grow into needing those, swap for a library (sonner, etc).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "success" | "error";
interface ToastEntry {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ToastCtx = createContext<{
  toast: (message: string, variant?: ToastVariant) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      // Random suffix in case two toasts are queued in the same millisecond.
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message, variant }]);
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {/* Bottom-right stack. pointer-events-none on the wrapper so the
          dimmed area behind toasts remains clickable; individual toasts
          re-enable pointer events so the × button works. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: () => void;
}) {
  // Fade in on mount, fade out before removal. We auto-dismiss after 3s.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Paint once with opacity-0 then flip to opacity-100 on the next frame
    // so the CSS transition actually runs.
    const raf = requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => setVisible(false), 2700);
    const cleanup = setTimeout(onDismiss, 3000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(cleanup);
    };
  }, [onDismiss]);

  const toneCls =
    toast.variant === "success"
      ? "bg-emerald-600 text-white"
      : "bg-rose-600 text-white";

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-3 rounded-md px-4 py-2 text-sm shadow-lg transition-all duration-200 ${toneCls} ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      <span>{toast.message}</span>
      <button
        onClick={onDismiss}
        className="rounded text-white/80 hover:text-white"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
