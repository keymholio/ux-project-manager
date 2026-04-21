import { useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { Button, Spinner } from "../components/ui";

export default function Login() {
  const { signIn } = useAuth();
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
        </form>

        <p className="mt-4 text-center text-xs text-ink-500">
          Accounts are created by your admin in the Supabase dashboard.
        </p>
      </div>
    </div>
  );
}
