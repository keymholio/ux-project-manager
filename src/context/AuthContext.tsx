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
  // True when the user arrived via a magic-link invite (first login, no
  // password set yet) as opposed to a password-reset link.
  isNewAccount: boolean;
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
  const [isNewAccount, setIsNewAccount] = useState(false);

  useEffect(() => {
    let active = true;
    // Tracks what kind of auth link init() detected from the URL hash so the
    // onAuthStateChange handler below can tell recovery links apart from
    // invite links without racing on React state.
    let urlLinkType: "recovery" | "invite" | null = null;

    const init = async () => {
      const captured = window.__initialAuthHash;
      if (captured) {
        delete window.__initialAuthHash;
        const params = new URLSearchParams(captured);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        const type = params.get("type");
        if (access_token && refresh_token) {
          // Mark the link type BEFORE setSession() so it's visible to
          // onAuthStateChange when it fires synchronously inside setSession.
          if (type === "recovery") urlLinkType = "recovery";
          if (type === "magiclink" || type === "signup") urlLinkType = "invite";
          const { data, error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (!active) return;
          if (!error) {
            setSession(data.session);
            if (!data.session) setLoading(false);
            return;
          }
          urlLinkType = null;
          // Fall through to getSession on error — token may have expired.
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      if (!data.session) {
        setLoading(false);
      } else if (data.session.user.user_metadata?.must_change_password) {
        // Page-refresh case: INITIAL_SESSION won't fire SIGNED_IN, so we
        // catch the flag here too.
        setIsRecovering(true);
        setIsNewAccount(true);
      }
    };
    init();

    const { data: sub } = supabase.auth.onAuthStateChange((evt, newSession) => {
      setSession(newSession);

      if (evt === "PASSWORD_RECOVERY") {
        // Covers the rare case where Supabase fires this event directly
        // (i.e. detectSessionInUrl works outside HashRouter context).
        setIsRecovering(true);
      }

      // INITIAL_SESSION fires on page-load with an existing session;
      // SIGNED_IN fires on a fresh login. Handle must_change_password in both.
      if ((evt === "SIGNED_IN" || evt === "INITIAL_SESSION") && newSession) {
        if (newSession.user.user_metadata?.must_change_password) {
          // Account was created with a temporary password by a manager.
          setIsNewAccount(true);
          setIsRecovering(true);
        } else if (urlLinkType === "recovery") {
          setIsRecovering(true);
          urlLinkType = null;
        } else if (urlLinkType === "invite") {
          setIsRecovering(true);
          setIsNewAccount(true);
          urlLinkType = null;
        }
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
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    // Check flag immediately on the auth response — don't rely solely on
    // onAuthStateChange, which can race or be skipped in some environments.
    if (!error && data.user?.user_metadata?.must_change_password) {
      setIsRecovering(true);
      setIsNewAccount(true);
    }
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
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
      data: { must_change_password: false },
    });
    if (!error) { setIsRecovering(false); setIsNewAccount(false); }
    return { error: error?.message ?? null };
  };

  const clearRecovery = () => { setIsRecovering(false); setIsNewAccount(false); };

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
    isNewAccount,
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
