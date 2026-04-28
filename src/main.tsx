import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import "./index.css";

// Capture Supabase auth recovery / error params before HashRouter mounts.
// Supabase emails (password reset, email confirmation, OAuth callbacks)
// land with the token directly in the URL hash, e.g.
// `#access_token=xyz&refresh_token=abc&type=recovery`. HashRouter sees
// that as a malformed path, hits the catch-all `<Navigate to="/" />`,
// and rewrites the hash to `#/` — wiping the recovery token before
// AuthProvider can read it. Stash the original hash on window now, while
// we're still synchronous and pre-render, so AuthProvider can consume it
// on mount via setSession.
declare global {
  interface Window {
    __initialAuthHash?: string;
  }
}
{
  const h = window.location.hash;
  if (
    h.startsWith("#access_token=") ||
    h.startsWith("#error=") ||
    h.startsWith("#error_code=") ||
    h.startsWith("#error_description=")
  ) {
    // Strip the leading "#" — AuthProvider parses the rest with URLSearchParams.
    window.__initialAuthHash = h.substring(1);
    // Clean the URL bar so the token isn't visible/leakable. HashRouter
    // will write its own `#/` once it mounts.
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* HashRouter avoids the 404-on-refresh issue on GitHub Pages.
        ThemeProvider is the outermost provider so the rest of the tree
        (including auth-state branches like the login screen) can use
        useTheme without exception. The initial paint is already
        themed via the inline bootstrap script in index.html. */}
    <HashRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </HashRouter>
  </React.StrictMode>,
);
