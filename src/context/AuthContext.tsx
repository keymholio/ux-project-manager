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
  isRecovering: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (
    email: string,
  ) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  clearRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((evt, newSession) => {
      setSession(newSession);
      // When the user clicks a password-reset link from email, Supabase fires
      // PASSWORD_RECOVERY with a short-lived session. We stash a flag so the
      // app shows the "set new password" screen instead of the normal UI.
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
    // After the user clicks the email link, Supabase will redirect back here,
    // detect the recovery token in the URL, and fire PASSWORD_RECOVERY.
    // HashRouter-friendly: land on the app root so the client picks up the
    // hash fragment.
    const redirectTo =
      window.location.origin + window.location.pathname + "#/";
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

  const value: AuthContextValue = {
    session,
    profile,
    loading,
    isManager: profile?.role === "manager",
    isRecovering,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    clearRecovery,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
