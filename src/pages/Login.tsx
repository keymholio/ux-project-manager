import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { Button, Spinner } from "../components/ui";

export default function Login() {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setBusy(false);
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
            <div className="text-xs text-ink-500">Sign in to continue</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="card p-5 space-y-3">
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
            <label className="mb-1 block text-xs font-medium text-ink-600">
              Password
            </label>
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

          <div className="relative my-2 flex items-center">
            <div className="flex-1 border-t border-ink-200" />
            <span className="px-2 text-xs text-ink-400">or</span>
            <div className="flex-1 border-t border-ink-200" />
          </div>

          <Button
            type="button"
            onClick={async () => {
              setError(null);
              const { error } = await signInWithGoogle();
              if (error) setError(error);
            }}
            className="w-full justify-center"
          >
            Continue with Google
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">
          Accounts are created by your admin in the Supabase dashboard.
        </p>
      </div>
    </div>
  );
}
