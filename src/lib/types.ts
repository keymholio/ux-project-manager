// Hand-rolled types that match supabase/migrations/001_init.sql.
// If you change the schema, also update this file (or generate with
// `supabase gen types typescript` from the Supabase CLI).

export type UserRole = "manager" | "designer" | "viewer";

// Display label for the role chip in the sidebar / user admin page.
// Underlying enum values stay snake-case to match the DB; labels are the
// human-readable form.
export const USER_ROLE_LABEL: Record<UserRole, string> = {
  manager: "Manager",
  designer: "Designer",
  viewer: "Viewer",
};

export type ProjectCategory =
  | "marketing"
  | "campaigns"
  | "design_system"
  | "ab_testing"
  | "research_dev";

export type ProjectStatus =
  | "backlog"
  | "on_hold"
  | "discovery"
  | "in_progress"
  | "needs_review"
  | "hand_off"
  | "in_development"
  | "vdqa"
  | "done";

export type TaskStatus =
  | "backlog"
  | "on_hold"
  | "on_deck"
  | "in_progress"
  | "done"
  | "canceled";

export type TaskType =
  | "design"
  | "discovery"
  | "handoff"
  | "vdqa"
  | "vdqa_r1"
  | "vdqa_r2"
  | "vdqa_int"
  | "review"
  | "revisions"
  | "other";

export type Priority = "low" | "medium" | "high";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  avatar_color: string;
  // Added in migration 008. Managers flip this to false from the User
  // Administration page to hide someone from the team roster without
  // deleting their work history. Defaults to true at the DB level so
  // rows that pre-date the migration still read as active.
  is_active: boolean;
  created_at: string;
}

// User-defined link attached to a project. Stored as a jsonb array on
// projects.links. Legacy figma_url / figjam_url / workfront_url / jira_url
// columns still exist on the row but are no longer edited from the UI —
// they were backfilled into this array by migration 004.
//
// `type` is constrained to a fixed set so the UI can pick an icon/color
// without having to guess at freeform labels. You can stack as many of
// each type as you want (two Figma links, three docs under "web", etc.).
export const LINK_TYPES = [
  "figma",
  "workfront",
  "figjam",
  "jira",
  "presentation",
  "web",
  "other",
] as const;
export type ProjectLinkType = (typeof LINK_TYPES)[number];

export const LINK_TYPE_LABEL: Record<ProjectLinkType, string> = {
  figma: "Figma",
  workfront: "Workfront",
  figjam: "FigJam",
  jira: "Jira",
  presentation: "Presentation",
  web: "Web",
  other: "Other",
};

export interface ProjectLink {
  type: ProjectLinkType;
  url: string;
  // Optional human-readable label for the link. When present, the chip
  // renders this text (e.g. "Mobile mocks — v3") instead of the type
  // name, making a dense list of links easier to scan. Older rows don't
  // have this field; readers must treat it as optional.
  title?: string;
}

// Short, human-readable ID formatters. The DB hands out a sequential int
// per table (see migration 006); we present it as `P-12` / `T-45` in the
// UI — breadcrumbs, list rows, cards, anywhere the UUID would be noise.
export const fmtProjectId = (n: number) => `P-${n}`;
export const fmtTaskId = (n: number) => `T-${n}`;

export interface Project {
  id: string;
  short_id: number;
  name: string;
  description: string | null;
  category: ProjectCategory;
  status: ProjectStatus;
  priority: Priority;
  due_date: string | null;
  figma_url: string | null;
  workfront_url: string | null;
  jira_url: string | null;
  figjam_url: string | null;
  links: ProjectLink[];
  owner_id: string;
  completed_at: string | null;
  // Soft-delete timestamp (migration 024). RLS filters rows where this
  // is non-null out of SELECT, so reads typically never see it set —
  // it only matters to the DeleteProjectModal undo flow.
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectAssignee {
  project_id: string;
  user_id: string;
}

export interface Task {
  id: string;
  short_id: number;
  title: string;
  description: string | null;
  task_type: TaskType;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  // Legacy per-tool URL columns. Still in the DB but no longer edited
  // from the UI — their values were folded into `links` by migration 007.
  figma_url: string | null;
  workfront_url: string | null;
  jira_url: string | null;
  figjam_url: string | null;
  // User-defined links — same shape as projects.links. See ProjectLink.
  links: ProjectLink[];
  project_id: string | null;
  assignee_id: string | null;
  created_by: string;
  position: number;
  completed_at: string | null;
  // Soft-delete timestamp (migration 024). See Project.deleted_at.
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  body: string;
  author_id: string;
  task_id: string | null;
  project_id: string | null;
  created_at: string;
  // Bumped by the touch_updated_at trigger on every UPDATE (migration 019).
  // Equal to created_at until the comment has been edited; the UI uses
  // that equality to decide whether to render the "(edited)" indicator.
  updated_at: string;
}

// =============================================================================
// Status history (migration 021) — append-only ledger of every transition
// =============================================================================
// One row per status change on a project or task. Triggers populate the
// table automatically:
//   * INSERT trigger logs the starting status with from_status = null
//   * UPDATE trigger logs each transition with both sides populated
//
// Exactly one of project_id / task_id is set per row (DB CHECK enforced).
// from_status / to_status are stored as text because the column has to
// accept either set of enum values; cast to ProjectStatus or TaskStatus
// based on which subject is set.
export interface StatusEvent {
  id: string;
  project_id: string | null;
  task_id: string | null;
  // null on the initial-state event written when the row was created
  // (or backfilled by migration 021). Always populated for true
  // transitions.
  from_status: string | null;
  to_status: string;
  // Whoever made the change (auth.uid() at the time the trigger fired).
  // Can be null for service-role writes or backfilled events.
  changed_by: string | null;
  changed_at: string;
}

// =============================================================================
// Display labels — the single source of truth for status/category copy in UI.
// =============================================================================
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  on_hold: "On hold",
  discovery: "Discovery",
  in_progress: "In progress",
  needs_review: "Needs review",
  hand_off: "Hand-off",
  // Underlying enum value stays `in_development` (no migration needed)
  // — only the display label changes. Captures projects sitting with
  // the prod / dev / copy team after design hand-off, waiting on
  // implementation or copy.
  in_development: "With prod/dev/copy",
  vdqa: "VDQA",
  done: "Done",
};

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  "backlog",
  "on_hold",
  "discovery",
  "in_progress",
  "needs_review",
  "hand_off",
  "in_development",
  "vdqa",
  "done",
];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  on_hold: "On hold",
  on_deck: "On deck",
  in_progress: "In progress",
  done: "Done",
  canceled: "Canceled",
};

// All task statuses in display order — used by the status select on the
// task detail page and any other place that needs the full list.
export const TASK_STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "on_hold",
  "on_deck",
  "in_progress",
  "done",
  "canceled",
];

// Subset of statuses that get their own column on the kanban board.
// on_hold and canceled aren't here — they share columns with their
// parent state (Backlog and Done respectively) so the board stays
// compact and parked statuses sit visually next to the active flow.
export const TASK_BOARD_COLUMNS: TaskStatus[] = [
  "backlog",
  "on_deck",
  "in_progress",
  "done",
];

// Returns true when a task with `status` belongs in the kanban column
// labeled by `column`. Backlog accepts on_hold tasks; Done accepts
// canceled tasks; everywhere else is a 1:1 match. Used by the board to
// decide which cards live in each column, and by the drop handler to
// know whether a drag is "within the same column" (just a reorder) or
// "into a different column" (which also rewrites the status).
export const tasksInColumn = (
  column: TaskStatus,
  status: TaskStatus,
): boolean => {
  if (column === "backlog") return status === "backlog" || status === "on_hold";
  if (column === "done") return status === "done" || status === "canceled";
  return status === column;
};

// =============================================================================
// Notifications (migration 022) — in-app bell notifications
// =============================================================================
// One row per recipient per event. Types:
//   task_assignment    — someone assigned a task to you
//   project_assignment — someone added you to a project
//   mention            — someone @mentioned you in a comment
//
// Exactly one of task_id / project_id / comment_id is typically set per row
// to provide a deep-link target; `actor_id` is who triggered the event.
export type NotificationType =
  | "task_assignment"
  | "project_assignment"
  | "mention";

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  actor_id: string | null;
  task_id: string | null;
  project_id: string | null;
  comment_id: string | null;
  read: boolean;
  created_at: string;
}

// "Active" task = anything that isn't a terminal state. Used by the
// Dashboard for workload counts, overdue checks, and similar — canceled
// tasks shouldn't pad those numbers any more than completed tasks do.
export const isTaskActive = (status: TaskStatus): boolean =>
  status !== "done" && status !== "canceled";

export const CATEGORY_LABEL: Record<ProjectCategory, string> = {
  marketing: "Marketing",
  campaigns: "Campaigns",
  design_system: "Design system",
  ab_testing: "A/B testing",
  research_dev: "Research & development",
};

export const CATEGORY_COLOR: Record<ProjectCategory, string> = {
  marketing: "#6366f1",
  campaigns: "#ec4899",
  design_system: "#14b8a6",
  ab_testing: "#f59e0b",
  research_dev: "#8b5cf6",
};

// Labels — free-form tags that live alongside categories (migration 009).
// Unlike categories (one-of taxonomy), a project can have any number of
// labels. Good fit for initiatives that span multiple categories or for
// time-bounded work that shouldn't pollute the top-level taxonomy.
export interface Label {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ProjectLabel {
  project_id: string;
  label_id: string;
}

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  design: "Design",
  discovery: "Discovery",
  handoff: "Handoff",
  vdqa: "VDQA",
  vdqa_r1: "VDQA R1",
  vdqa_r2: "VDQA R2",
  vdqa_int: "VDQA Internal",
  review: "Review",
  revisions: "Revisions",
  other: "Other",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
