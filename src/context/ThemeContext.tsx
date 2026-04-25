import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Persisted preference. "system" follows the OS-level prefers-color-scheme
// media query and updates live when the user toggles their system theme.
// "light" / "dark" pin the app regardless of system. We store the user's
// original choice (not the resolved color) so a user who picked "system"
// keeps following the OS even after the OS flips.
export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "ui:theme";

const readStoredPreference = (): ThemePreference => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // localStorage may be unavailable (e.g. SSR, private mode). Fall
    // through to default.
  }
  return "system";
};

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;

const resolveTheme = (pref: ThemePreference): ResolvedTheme => {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
};

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
  // Convenience: flips between light and dark, mapping "system" to the
  // opposite of whatever it currently resolves to. Used by the sidebar
  // quick-toggle button.
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    readStoredPreference,
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredPreference()),
  );

  // Apply the resolved theme to <html>. We toggle a class rather than a
  // data-attribute because Tailwind's darkMode: 'class' looks for `.dark`
  // on an ancestor of the rendered tree. The root element is the safest
  // place — it covers portals, modals, and the body itself.
  useEffect(() => {
    const root = document.documentElement;
    if (resolved === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [resolved]);

  // Keep the resolved theme in sync with the OS when preference is
  // "system". MediaQueryList change events fire whenever the user flips
  // their OS theme; for explicit light/dark we don't subscribe, since
  // the resolved value is constant.
  useEffect(() => {
    setResolved(resolveTheme(preference));
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // ignore — preference will revert to default next session
    }
  }, []);

  const toggle = useCallback(() => {
    setPreferenceState((current) => {
      const currentResolved = resolveTheme(current);
      const next: ThemePreference = currentResolved === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
