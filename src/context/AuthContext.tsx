import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  isManager: boolean;
  // True for roles that can mutate data (manager + designer); false for
  // viewers. UI uses this to hide create / edit / delete affordances.
  // RLS enforces the same rule at the DB layer (migration 016) so this
  // is a UX gate, not a security boundary.
  canWrite: boolean;
  isRecovering: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (
    email: string,
  ) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  clearRecovery: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    let active = true;

    const init = async () => {
      // First, consume any auth hash captured by main.tsx before HashRouter
      // could clobber it. Supabase's automatic detectSessionInUrl can't
      // read the original hash by the time the client is initialized
      // (HashRouter has already rewritten it to `#/`), so we restore the
      // session manually with setSession. PASSWORD_RECOVERY won't fire from
      // onAuthStateChange in this flow either, so we infer recovery from
      // the captured `type=recovery` param.
      const captured = window.__initialAuthHash;
      if (captured) {
        delete window.__initialAuthHash;
        const params = new URLSearchParams(captured);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        const type = params.get("type");
        if (access_token && refresh_token) {
          const { data, error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (!active) return;
          if (!error) {
            if (type === "recovery") setIsRecovering(true);
            setSession(data.session);
            if (!data.session) setLoading(false);
            return;
          }
          // Fall through to getSession on error — token may have expired.
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    };
    init();

    const { data: sub } = supabase.auth.onAuthStateChange((evt, newSession) => {
      setSession(newSession);
      // When the user clicks a password-reset link from email, Supabase fires
      // PASSWORD_RECOVERY with a short-lived session. We stash a flag so the
      // app shows the "set new password" screen instead of the normal UI.
      // (Note: with HashRouter we usually catch recovery via the captured
      // hash in init() above; this branch covers any path where Supabase's
      // own URL detection still fires the event.)
      if (evt === "PASSWORD_RECOVERY") {
        setIsRecovering(true);
      }
      if (!newSession) {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load the profile row whenever session.user.id changes.
  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      return;
    }
    let active = true;
    setLoading(true);
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          // eslint-disable-next-line no-console
          console.error("Failed to load profile:", error.message);
        }
        setProfile(data ?? null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  const signIn: AuthContextValue["signIn"] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsRecovering(false);
  };

  const requestPasswordReset: AuthContextValue["requestPasswordReset"] = async (
    email,
  ) => {
    // After the user clicks the email link, Supabase appends the recovery
    // token to this URL as a hash fragment (`#access_token=...&type=recovery`).
    // We deliberately drop any trailing `#/` here — Supabase's hash regex
    // matches `[#&]access_token=` and a `#/` between would prevent the
    // match, so the recovery params would never be detected. main.tsx
    // captures the raw hash on load and AuthProvider's init() consumes
    // it via setSession, so HashRouter doesn't get a chance to rewrite
    // it first.
    const redirectTo =
      window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    return { error: error?.message ?? null };
  };

  const updatePassword: AuthContextValue["updatePassword"] = async (
    newPassword,
  ) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) setIsRecovering(false);
    return { error: error?.message ?? null };
  };

  const clearRecovery = () => setIsRecovering(false);

  const refreshProfile = async () => {
    if (!session?.user) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to refresh profile:", error.message);
      return;
    }
    setProfile(data ?? null);
  };

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    isManager: profile?.role === "manager",
    canWrite: profile?.role === "manager" || profile?.role === "designer",
    isRecovering,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    clearRecovery,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
