// Small, self-contained UI primitives used across pages. Kept in one file
// because they're each tiny and this avoids a forest of one-liner components.

import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from "react";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  LINK_TYPE_LABEL,
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  TASK_TYPE_LABEL,
  type ProjectCategory,
  type ProjectLink,
  type ProjectLinkType,
  type ProjectStatus,
  type Priority,
  type Profile,
  type TaskStatus,
  type TaskType,
} from "../lib/types";

// ---------- Avatar ----------
export function Avatar({
  profile,
  size = 28,
}: {
  profile: Pick<Profile, "full_name" | "avatar_color"> | null;
  size?: number;
}) {
  if (!profile)
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-ink-200 text-ink-500"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        aria-label="unassigned"
      >
        ?
      </span>
    );
  const initials = profile.full_name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: profile.avatar_color,
      }}
      title={profile.full_name}
      aria-label={profile.full_name}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({
  profiles,
  size = 24,
}: {
  profiles: Profile[];
  size?: number;
}) {
  return (
    <div className="flex -space-x-1.5">
      {profiles.slice(0, 4).map((p) => (
        <span
          key={p.id}
          className="ring-2 ring-white rounded-full"
          style={{ lineHeight: 0 }}
        >
          <Avatar profile={p} size={size} />
        </span>
      ))}
      {profiles.length > 4 && (
        <span
          className="inline-flex items-center justify-center rounded-full bg-ink-200 text-ink-600 ring-2 ring-white font-medium"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          +{profiles.length - 4}
        </span>
      )}
    </div>
  );
}

// ---------- Badges ----------
const STATUS_COLORS: Record<ProjectStatus | TaskStatus, string> = {
  backlog: "bg-ink-100 text-ink-700",
  discovery: "bg-sky-100 text-sky-800",
  on_deck: "bg-sky-100 text-sky-800",
  in_progress: "bg-amber-100 text-amber-800",
  needs_review: "bg-purple-100 text-purple-800",
  in_review: "bg-purple-100 text-purple-800",
  hand_off: "bg-fuchsia-100 text-fuchsia-800",
  in_development: "bg-indigo-100 text-indigo-800",
  vdqa: "bg-rose-100 text-rose-800",
  done: "bg-emerald-100 text-emerald-800",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`chip ${STATUS_COLORS[status]}`}>
      {PROJECT_STATUS_LABEL[status]}
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`chip ${STATUS_COLORS[status]}`}>
      {TASK_STATUS_LABEL[status]}
    </span>
  );
}

export function CategoryBadge({ category }: { category: ProjectCategory }) {
  return (
    <span
      className="chip text-white"
      style={{ background: CATEGORY_COLOR[category] }}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  // Priority is only noteworthy when it's high. Medium and low are the
  // default state of most work and don't need a visual chip.
  if (priority !== "high") return null;
  return (
    <span className="chip bg-rose-100 text-rose-800">
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function TaskTypeBadge({ type }: { type: TaskType }) {
  return (
    <span className="chip bg-ink-100 text-ink-700 uppercase tracking-wide">
      {TASK_TYPE_LABEL[type]}
    </span>
  );
}

// ---------- Buttons ----------
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
}
export function Button({
  variant = "secondary",
  icon,
  children,
  className = "",
  ...rest
}: ButtonProps) {
  const variantCls =
    variant === "primary"
      ? "btn-primary"
      : variant === "ghost"
        ? "btn-ghost"
        : "btn-secondary";
  return (
    <button className={`btn ${variantCls} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

// ---------- Modal ----------
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  dismissOnBackdropClick = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  // When false, clicking the dimmed backdrop won't close the modal.
  // Useful for create/edit forms so an accidental click doesn't wipe progress.
  dismissOnBackdropClick?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-900/40 p-4 pt-16"
      onClick={dismissOnBackdropClick ? onClose : undefined}
    >
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ---------- Empty / Loading ----------
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 bg-white/50 p-10 text-center">
      <p className="text-base font-medium text-ink-900">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner(props: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      aria-label="loading"
      {...props}
      className={`h-5 w-5 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600 ${props.className ?? ""}`}
    />
  );
}

// ---------- Tool-link pill ----------
export function ToolLinks({
  figma,
  workfront,
  jira,
  figjam,
}: {
  figma?: string | null;
  workfront?: string | null;
  jira?: string | null;
  figjam?: string | null;
}) {
  const links: { label: string; url: string; cls: string }[] = [];
  if (figma) links.push({ label: "Figma", url: figma, cls: "bg-[#ff6b2b]/10 text-[#b44800]" });
  if (figjam) links.push({ label: "FigJam", url: figjam, cls: "bg-[#ffd64a]/20 text-[#8a6d00]" });
  if (workfront) links.push({ label: "Workfront", url: workfront, cls: "bg-[#00b2e3]/10 text-[#00657f]" });
  if (jira) links.push({ label: "Jira", url: jira, cls: "bg-[#2684ff]/10 text-[#0747a6]" });
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className={`chip hover:underline ${l.cls}`}
          onClick={(e) => e.stopPropagation()}
        >
          {l.label} ↗
        </a>
      ))}
    </div>
  );
}

// ---------- Link list (projects) ----------
// Renders { type, url } chips. `type` is one of the fixed link types so
// we always know which brand color to use. Duplicates are fine —
// a project can have two Figma links, three "web" links, whatever.
//
// NB: the renderer also tolerates the legacy { label, url } shape that
// migration 004's first pass produced. Migration 005 normalizes those rows
// to the new shape, but until that migration runs the UI would otherwise
// render a blank chip — so we fall back to matching the old label here.
export function LinkList({
  links,
  max,
}: {
  links: ProjectLink[] | null | undefined;
  /** If set, cap visible chips at this count and show a "+N more" pill. */
  max?: number;
}) {
  if (!links || links.length === 0) return null;
  const visible = typeof max === "number" ? links.slice(0, max) : links;
  const hidden = typeof max === "number" ? links.length - visible.length : 0;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((l, i) => {
        const type = resolveLinkType(l);
        return (
          <a
            key={`${type}-${l.url}-${i}`}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className={`chip hover:underline ${brandChipClass(type)}`}
            onClick={(e) => e.stopPropagation()}
            title={l.url}
          >
            {LINK_TYPE_LABEL[type]} ↗
          </a>
        );
      })}
      {hidden > 0 && (
        <span
          className="chip bg-ink-100 text-ink-600"
          title={links
            .slice(visible.length)
            .map((l) => `${LINK_TYPE_LABEL[resolveLinkType(l)]}: ${l.url}`)
            .join(", ")}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}

// Coerce a link row to a known ProjectLinkType. Handles both the new
// { type, url } shape and the legacy { label, url } shape still present
// in rows that were backfilled before migration 005.
function resolveLinkType(l: ProjectLink | { label?: string; url: string }): ProjectLinkType {
  const t = (l as ProjectLink).type;
  if (t && (Object.prototype.hasOwnProperty.call(LINK_TYPE_LABEL, t))) return t;
  const legacy = (l as { label?: string }).label?.trim().toLowerCase();
  if (legacy && (Object.prototype.hasOwnProperty.call(LINK_TYPE_LABEL, legacy))) {
    return legacy as ProjectLinkType;
  }
  return "other";
}

function brandChipClass(type: ProjectLinkType): string {
  switch (type) {
    case "figma":
      return "bg-[#ff6b2b]/10 text-[#b44800]";
    case "figjam":
      return "bg-[#ffd64a]/20 text-[#8a6d00]";
    case "workfront":
      return "bg-[#00b2e3]/10 text-[#00657f]";
    case "jira":
      return "bg-[#2684ff]/10 text-[#0747a6]";
    case "web":
    case "other":
    default:
      return "bg-ink-100 text-ink-700";
  }
}

// ---------- Date helpers ----------
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.round((then - now) / 1000);
  const abs = Math.abs(diff);
  const past = diff < 0;
  if (abs < 60) return past ? "just now" : "in a moment";
  const mins = Math.round(abs / 60);
  if (mins < 60) return past ? `${mins}m ago` : `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return past ? `${hrs}h ago` : `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return past ? `${days}d ago` : `in ${days}d`;
  return formatDate(iso);
}
