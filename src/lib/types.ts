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
  | "lit"
  | "comm_pop";

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

export interface Project {
  id: string;
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
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectAssignee {
  project_id: string;
  user_id: string;
}

export interface Task {
  id: string;
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
  lit: "Lit",
  comm_pop: "Comm & Pop",
};

export const CATEGORY_COLOR: Record<ProjectCategory, string> = {
  marketing: "#6366f1",
  campaigns: "#ec4899",
  design_system: "#14b8a6",
  ab_testing: "#f59e0b",
  research_dev: "#8b5cf6",
  lit: "#0ea5e9",
  comm_pop: "#10b981",
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
