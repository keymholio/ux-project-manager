import { useState, type FormEvent } from "react";
import { Button, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";

export default function ResetPassword() {
  const { updatePassword, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await updatePassword(password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setDone(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="h-9 w-9 rounded-md bg-brand-600 text-white flex items-center justify-center font-bold">
            UX
          </div>
          <div>
            <div className="text-base font-semibold text-ink-900">
              Set a new password
            </div>
            <div className="text-xs text-ink-500">
              Choose something you haven't used before.
            </div>
          </div>
        </div>

        {done ? (
          <div className="card p-5 space-y-3 text-sm">
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">
              Password updated. You can close this tab or keep using the app.
            </div>
            <Button
              variant="primary"
              onClick={() => {
                // Reload to land on the authenticated app.
                window.location.hash = "#/";
                window.location.reload();
              }}
              className="w-full justify-center"
            >
              Continue to app
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card p-5 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600">
                New password
              </label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600">
                Confirm new password
              </label>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            {error && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              className="w-full justify-center"
            >
              {busy ? <Spinner /> : "Update password"}
            </Button>
            <button
              type="button"
              onClick={signOut}
              className="w-full text-center text-xs text-ink-500 hover:text-ink-900"
            >
              Cancel and sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
