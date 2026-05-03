import {
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  FolderKanban,
  Menu,
  Moon,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { USER_ROLE_LABEL } from "../lib/types";
import { Avatar } from "./ui";

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut, isManager } = useAuth();
  const { resolved, toggle } = useTheme();
  const location = useLocation();

  // Mobile drawer open/closed. The sidebar is always-visible on md+
  // (Tailwind 768px+); below that breakpoint it slides in over the
  // content with a backdrop. We close on every route change so a tap
  // on a nav link doesn't leave the drawer hovering on the new page.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  // Lock body scroll while the drawer is open — otherwise a touch on
  // the backdrop can scroll the content underneath instead of dismissing.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // Esc closes the drawer — standard expectation for any modal-style
  // overlay, and keeps keyboard users from getting trapped in it.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // Admin link appears only for managers. Everyone else gets the same
  // three-item nav they had before — the route is also guarded on the
  // page itself (and by RLS on the write side) so hiding the nav entry
  // is a UX nicety rather than the security boundary.
  const navItems = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    { to: "/tasks", label: "Tasks", icon: KanbanSquare },
    ...(isManager
      ? [{ to: "/admin/users", label: "Users", icon: Users }]
      : []),
  ];

  // Sidebar contents extracted so we can render them in two places — once
  // inline as the desktop sidebar (md+), and once inside the off-canvas
  // drawer (below md). Keeping a single source avoids the two getting
  // out of sync as nav items or footer controls evolve.
  const sidebarContent = (
    <>
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="h-8 w-8 rounded-md bg-brand-600 text-white flex items-center justify-center font-bold">
          UX
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-900">
            Project Tracker
          </div>
          <div className="truncate text-xs text-ink-500">
            Northwell UX Team (Web)
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-2">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-500/25 dark:text-brand-100"
                  : "text-ink-700 hover:bg-ink-100 hover:text-ink-900"
              }`
            }
          >
            <item.icon size={16} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-ink-200 p-3">
        <div className="flex items-center gap-2">
          <NavLink
            to="/settings"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 hover:bg-ink-100"
            title="Edit your profile"
          >
            <Avatar profile={profile} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink-900">
                {profile?.full_name ?? "—"}
              </div>
              <div className="text-xs text-ink-500">
                {profile?.role ? USER_ROLE_LABEL[profile.role] : "—"}
              </div>
            </div>
          </NavLink>
          <button
            onClick={toggle}
            className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            title={
              resolved === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            aria-label={
              resolved === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
          >
            {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            onClick={signOut}
            className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Desktop sidebar — visible at md and up. Below that the same
          contents render inside the drawer instead. */}
      <aside className="hidden md:flex w-60 flex-shrink-0 flex-col border-r border-ink-200 bg-surface">
        {sidebarContent}
      </aside>

      {/* Mobile drawer — backdrop + sliding panel. Hidden at md+ where
          the inline sidebar takes over. The translate-x trick keeps the
          panel mounted (so animations work) but slid out when closed,
          and pointer-events-none on the backdrop prevents the closed
          drawer from intercepting taps on the content. */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-ink-900/40 transition-opacity ${
          drawerOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col border-r border-ink-200 bg-surface shadow-xl transition-transform ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Main navigation"
      >
        {sidebarContent}
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile-only top bar: hamburger + app name. Hidden at md+ since
            the sidebar already shows the brand identity. */}
        <header className="md:hidden flex items-center gap-2 border-b border-ink-200 bg-surface px-3 py-2">
          <button
            onClick={() => setDrawerOpen(true)}
            className="rounded-md p-1.5 text-ink-700 hover:bg-ink-100"
            aria-label="Open navigation"
          >
            {drawerOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-brand-600 text-white flex items-center justify-center text-xs font-bold">
              UX
            </div>
            <div className="text-sm font-semibold text-ink-900">
              Project Tracker
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
