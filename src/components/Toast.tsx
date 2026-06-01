// Small toast system: a context provider with a `useToast()` hook.
// Call `toast("Project created")` from anywhere inside the app tree to
// surface a short confirmation in the bottom-right corner.
//
// Two argument shapes:
//   toast("Project created")                  // success, auto-dismiss 3s
//   toast("Couldn't save", "error")            // red tone, 3s
//   toast("Project deleted", {                 // custom: action button, longer
//     action: { label: "Undo", onClick: ... },
//     durationMs: 10000,
//   })
//
// The action shape is what enables Undo flows: the toast stays around
// long enough for the user to react, and clicking the action button
// runs the callback (typically a restore) before dismissing.
//
// Still deliberately small — no queue limit, no animation library, no
// stacking rules beyond "newest at bottom". If we outgrow this, swap
// for sonner.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "success" | "error";

interface ToastAction {
  label: string;
  /** Called when the user clicks the action button. Toast dismisses
   *  automatically afterward — the handler doesn't need to call dismiss. */
  onClick: () => void;
}

interface ToastOptions {
  variant?: ToastVariant;
  action?: ToastAction;
  /** Override the auto-dismiss timer. Default: 3000ms, or 10000ms when
   *  an action is set (so users have time to read and click). */
  durationMs?: number;
}

interface ToastEntry {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  durationMs: number;
}

// Back-compat for existing call sites: the second arg can be either
// the variant string ("error" | "success") or a full options object.
type ToastInput = ToastVariant | ToastOptions;

const ToastCtx = createContext<{
  toast: (message: string, opts?: ToastInput) => void;
} | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}

function normalizeOpts(opts: ToastInput | undefined): Required<
  Pick<ToastOptions, "variant" | "durationMs">
> & {
  action?: ToastAction;
} {
  if (!opts) return { variant: "success", durationMs: 3000 };
  if (typeof opts === "string") return { variant: opts, durationMs: 3000 };
  const variant = opts.variant ?? "success";
  // Action toasts hang around longer so the user can actually click.
  const durationMs = opts.durationMs ?? (opts.action ? 10000 : 3000);
  return { variant, durationMs, action: opts.action };
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const toast = useCallback((message: string, opts?: ToastInput) => {
    const norm = normalizeOpts(opts);
    // Random suffix in case two toasts are queued in the same millisecond.
    const id = Date.now() + Math.random();
    setToasts((prev) => [
      ...prev,
      {
        id,
        message,
        variant: norm.variant,
        durationMs: norm.durationMs,
        action: norm.action,
      },
    ]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {/* Bottom-right stack. pointer-events-none on the wrapper so the
          dimmed area behind toasts remains clickable; individual toasts
          re-enable pointer events so the buttons work. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} dismiss={dismiss} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({
  toast,
  dismiss,
}: {
  toast: ToastEntry;
  // Stable reference — ToastProvider wraps `dismiss` in useCallback with []
  // deps. Passing it down as-is keeps this component's effect dependencies
  // stable, so the fade-in/auto-dismiss timers aren't torn down every time
  // ToastProvider re-renders.
  dismiss: (id: number) => void;
}) {
  // Fade in on mount, fade out shortly before removal.
  const [visible, setVisible] = useState(false);
  const id = toast.id;
  const duration = toast.durationMs;

  useEffect(() => {
    // Paint once with opacity-0 then flip to opacity-100 on the next frame
    // so the CSS transition actually runs.
    const raf = requestAnimationFrame(() => setVisible(true));
    const fadeTimer = setTimeout(() => setVisible(false), Math.max(0, duration - 300));
    const dismissTimer = setTimeout(() => dismiss(id), duration);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fadeTimer);
      clearTimeout(dismissTimer);
    };
  }, [dismiss, id, duration]);

  const toneCls =
    toast.variant === "success"
      ? "bg-emerald-600 text-white"
      : "bg-rose-600 text-white";

  const handleAction = () => {
    toast.action?.onClick();
    dismiss(id);
  };

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-center gap-3 rounded-md px-4 py-2 text-sm shadow-lg transition-all duration-200 ${toneCls} ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button
          onClick={handleAction}
          className="rounded px-2 py-0.5 text-xs font-semibold text-white underline-offset-2 hover:underline"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => dismiss(id)}
        className="rounded text-white/80 hover:text-white"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
