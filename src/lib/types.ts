// Hand-rolled types that match supabase/migrations/001_init.sql.
// If you change the schema, also update this file (or generate with
// `supabase gen types typescript` from the Supabase CLI).

export type UserRole = "manager" | "designer";

export type ProjectCategory =
  | "marketing"
  | "campaigns"
  | "design_system"
  | "ab_testing"
  | "research_dev"
  | "nuvance";

export type ProjectStatus =
  | "backlog"
  | "discovery"
  | "in_progress"
  | "needs_review"
  | "hand_off"
  | "in_development"
  | "vdqa"
  | "done";

export type TaskStatus =
  | "backlog"
  | "on_deck"
  | "in_progress"
  | "in_review"
  | "done";

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
  "web",
  "other",
] as const;
export type ProjectLinkType = (typeof LINK_TYPES)[number];

export const LINK_TYPE_LABEL: Record<ProjectLinkType, string> = {
  figma: "Figma",
  workfront: "Workfront",
  figjam: "FigJam",
  jira: "Jira",
  web: "Web",
  other: "Other",
};

export interface ProjectLink {
  type: ProjectLinkType;
  url: string;
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
  figma_url: string | null;
  workfront_url: string | null;
  jira_url: string | null;
  figjam_url: string | null;
  project_id: string | null;
  assignee_id: string | null;
  created_by: string;
  position: number;
  completed_at: string | null;
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
}

// =============================================================================
// Display labels — the single source of truth for status/category copy in UI.
// =============================================================================
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  backlog: "Backlog",
  discovery: "Discovery",
  in_progress: "In progress",
  needs_review: "Needs review",
  hand_off: "Hand-off",
  in_development: "In development",
  vdqa: "VDQA",
  done: "Done",
};

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  "backlog",
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
  on_deck: "On deck",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

export const TASK_STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "on_deck",
  "in_progress",
  "in_review",
  "done",
];

export const CATEGORY_LABEL: Record<ProjectCategory, string> = {
  marketing: "Marketing",
  campaigns: "Campaigns",
  design_system: "Design system",
  ab_testing: "A/B testing",
  research_dev: "Research & development",
  nuvance: "Nuvance",
};

export const CATEGORY_COLOR: Record<ProjectCategory, string> = {
  marketing: "#6366f1",
  campaigns: "#ec4899",
  design_system: "#14b8a6",
  ab_testing: "#f59e0b",
  research_dev: "#8b5cf6",
  nuvance: "#0ea5e9",
};

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
