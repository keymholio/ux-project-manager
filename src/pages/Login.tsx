import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { Button, Spinner } from "../components/ui";

type Mode = "signin" | "forgot";

export default function Login() {
  const { signIn, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setBusy(false);
  };

  const onForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    const { error } = await requestPasswordReset(email.trim());
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setInfo(
      "Check your email for a reset link. It may take a minute to arrive.",
    );
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
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
              Project Tracker
            </div>
            <div className="text-xs text-ink-500">
              {mode === "signin" ? "Sign in to continue" : "Reset your password"}
            </div>
          </div>
        </div>

        {mode === "signin" ? (
          <form onSubmit={onSignIn} className="card p-5 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600">
                Email
              </label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <div className="mb-1 flex items-baseline justify-between">
                <label className="block text-xs font-medium text-ink-600">
                  Password
                </label>
                <button
                  type="button"
                  className="text-xs text-brand-700 hover:underline"
                  onClick={() => switchMode("forgot")}
                >
                  Forgot password?
                </button>
              </div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
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
              {busy ? <Spinner /> : "Sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={onForgot} className="card p-5 space-y-3">
            <p className="text-sm text-ink-600">
              Enter the email tied to your account and we'll send you a reset
              link.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-600">
                Email
              </label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            {error && (
              <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {info}
              </div>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={busy}
              className="w-full justify-center"
            >
              {busy ? <Spinner /> : "Send reset link"}
            </Button>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="w-full text-center text-xs text-ink-500 hover:text-ink-900"
            >
              Back to sign in
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-xs text-ink-500">
          Accounts are created by your admin in the Supabase dashboard.
        </p>
      </div>
    </div>
  );
}
