// Shared primitives for the Reports hub. Visual components and small
// helpers used across multiple report pages. Anything specific to a
// single report lives next to that report's file.
//
// Naming: prefix the file with `_` to signal "internal to this folder"
// and keep it from showing up next to real route files in alpha-sorted
// directory listings.

import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Breadcrumbs,
  formatDate,
} from "../../components/ui";
import {
  fmtProjectId,
  fmtTaskId,
  type Profile,
  type Project,
  type Task,
} from "../../lib/types";
import type { ReportDef } from "../../lib/reports";

// ---------- Date helpers ----------

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Today at local midnight. Hoisted so callers can derive "X days ago"
 *  windows without ever crossing a midnight boundary mid-render. */
export function todayLocalMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Days between two timestamps, rounded down. Positive when `later`
 *  is after `earlier`. Used to compute things like "how many days
 *  ago did this ship" and "how long has this been stale". */
export function daysBetween(earlier: Date | string, later: Date | string): number {
  const a = typeof earlier === "string" ? new Date(earlier) : earlier;
  const b = typeof later === "string" ? new Date(later) : later;
  return Math.floor((b.getTime() - a.getTime()) / ONE_DAY_MS);
}

// ---------- groupBy ----------

export function groupBy<T, K>(items: T[], keyFn: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(item);
  }
  return m;
}

// ---------- Report header ----------
// Every report uses the same shape: breadcrumb back to the hub, then a
// header with icon + title + subtitle. Centralizing it means a future
// change (e.g. adding a date picker, an export button) only touches
// one place.

export function ReportHeader({
  report,
  subtitle,
  trailing,
}: {
  report: ReportDef;
  /** Defaults to the report's description from reports.ts; pass a
   *  string (or any node) to override for reports that show a date
   *  range, a selected quarter, etc. */
  subtitle?: React.ReactNode;
  /** Optional right-aligned element — typically a Refresh button. */
  trailing?: React.ReactNode;
}) {
  const Icon = report.icon;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Reports", to: "/reports" },
          { label: report.title, current: true },
        ]}
      />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100">
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink-900">{report.title}</h1>
            <div className="text-sm text-ink-500">
              {subtitle ?? report.description}
            </div>
          </div>
        </div>
        {trailing}
      </header>
    </>
  );
}

// ---------- Section ----------

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

// ---------- Stat ----------
// Mini-card used in the "top stats" grid at the head of each report.
// Tone tints the icon background — neutral default, rose for "bad",
// emerald for "good". Matches the Dashboard's Stat visually.

export function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: "rose" | "emerald" | "amber";
}) {
  const toneCls =
    tone === "rose"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
      : tone === "emerald"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
        : tone === "amber"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
          : "bg-ink-100 text-ink-700";
  return (
    <div className="card flex items-center gap-3 p-4">
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${toneCls}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold text-ink-900">{value}</div>
        <div className="text-xs text-ink-500">{label}</div>
      </div>
    </div>
  );
}

// ---------- TaskRow ----------
// Compact one-line summary of a task — id, title, optional project
// pill, optional trailing content (due date, completion date, etc.).
// Wrapped in a Link to the task detail so the whole row is clickable.

export function TaskRow({
  task,
  project,
  assignee,
  trailing,
  emphasizeTrailing,
}: {
  task: Task;
  project?: Project | undefined;
  /** When provided, renders an avatar to the left of the task id.
   *  Pass `null` explicitly (vs undefined) to show the unassigned chip. */
  assignee?: Profile | null;
  trailing?: React.ReactNode;
  /** Tints the trailing text rose — used for overdue dates. */
  emphasizeTrailing?: "rose";
}) {
  const trailingCls = emphasizeTrailing === "rose"
    ? "ml-auto text-xs text-rose-600 dark:text-rose-300"
    : "ml-auto text-xs text-ink-500";
  return (
    <li>
      <Link
        to={`/tasks/${task.id}`}
        className="group flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-100"
      >
        {assignee !== undefined && <Avatar profile={assignee} size={20} />}
        <span className="font-mono text-xs text-ink-500">
          {fmtTaskId(task.short_id)}
        </span>
        <span className="truncate font-medium text-ink-900">{task.title}</span>
        {project && (
          <span
            className="chip bg-ink-100 text-ink-600"
            title={`Project ${fmtProjectId(project.short_id)}: ${project.name}`}
          >
            {project.name}
          </span>
        )}
        {trailing && <span className={trailingCls}>{trailing}</span>}
      </Link>
    </li>
  );
}

// ---------- ProjectRow ----------
// Compact one-line summary of a project — id, name, category, optional
// trailing content. Wrapped in a Link to the project detail.

export function ProjectRow({
  project,
  trailing,
  emphasizeTrailing,
}: {
  project: Project;
  trailing?: React.ReactNode;
  emphasizeTrailing?: "rose";
}) {
  const trailingCls = emphasizeTrailing === "rose"
    ? "ml-auto text-xs text-rose-600 dark:text-rose-300"
    : "ml-auto text-xs text-ink-500";
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className="group flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-100"
      >
        <span className="font-mono text-xs text-ink-500">
          {fmtProjectId(project.short_id)}
        </span>
        <span className="truncate font-medium text-ink-900">{project.name}</span>
        {project.completed_at && (
          <span className="text-xs text-ink-500">
            {formatDate(project.completed_at)}
          </span>
        )}
        {trailing && <span className={trailingCls}>{trailing}</span>}
      </Link>
    </li>
  );
}

// ---------- BarRow ----------
// Single horizontal bar in a category/throughput chart. Uses the same
// rounded-full bar treatment as the Dashboard workload chart so the
// reports feel like they belong to the same product. Bar width is
// passed in as a percentage so the caller controls scale.

export function BarRow({
  label,
  count,
  percent,
  color,
  icon,
}: {
  label: React.ReactNode;
  count: number;
  /** 0–100. Caller computes this against whatever max it cares about
   *  so two bars stacked next to each other share a scale (or don't,
   *  depending on intent). */
  percent: number;
  /** Tailwind bg-* class for the filled portion. */
  color?: string;
  /** Optional icon (e.g. category swatch, avatar) shown before the
   *  label. Caller is responsible for the right size. */
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-sm">
          <span className="truncate font-medium text-ink-900">{label}</span>
          <span className="text-ink-500">{count}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-100">
          <div
            className={`h-2 ${color ?? "bg-brand-500"}`}
            style={{ width: `${Math.max(percent, count > 0 ? 2 : 0)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------- Icon re-export type ----------
// Convenience for report files that want to type-check icons they pass
// to local helpers without pulling the lucide types directly.
export type { LucideIcon };
