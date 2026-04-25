import {
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  FolderKanban,
  Moon,
  Sun,
  Users,
} from "lucide-react";
import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Avatar } from "./ui";

export default function Layout({ children }: { children: ReactNode }) {
  const { profile, signOut, isManager } = useAuth();
  const { resolved, toggle } = useTheme();

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

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-ink-200 bg-surface">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="h-8 w-8 rounded-md bg-brand-600 text-white flex items-center justify-center font-bold">
            UX
          </div>
          <div>
            <div className="text-sm font-semibold text-ink-900">
              Project Tracker
            </div>
            <div className="text-xs text-ink-500">Northwell Design Team</div>
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
                  {isManager ? "Manager" : "Designer"}
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
      </aside>

      {/* Main area */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
