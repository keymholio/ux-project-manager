// Single source of truth for the Reports hub. Both Reports.tsx (the
// landing grid) and ReportDetail.tsx (the per-report page) read from
// this list. Adding a new report = add a row here, then fill in the
// detail view in ReportDetail.tsx (or split it out into its own file
// once the report grows beyond a stub).

import {
  BarChart3,
  CalendarDays,
  GitBranch,
  PieChart,
  Timer,
  UserSearch,
  type LucideIcon,
} from "lucide-react";

export type ReportStatus = "ready" | "coming_soon";

export interface ReportDef {
  /** URL-safe slug used in /reports/:slug. */
  slug: string;
  /** Card / page title. */
  title: string;
  /** One-line summary shown on the landing card. */
  summary: string;
  /** Longer description shown on the detail page. */
  description: string;
  /** Lucide icon used on the card and the detail header. */
  icon: LucideIcon;
  /** "ready" reports link through; "coming_soon" still link through but
   *  the detail view shows a placeholder. Status surfaces as a chip on
   *  the card so users know what to expect. */
  status: ReportStatus;
}

export const REPORTS: ReportDef[] = [
  {
    slug: "weekly-digest",
    title: "Weekly digest",
    summary:
      "Monday-morning recap: what shipped last week, what's in flight, what's overdue.",
    description:
      "A scheduled weekly recap covering tasks moved to Done in the last seven days, current in-flight work by designer, overdue items, and due-this-week deadlines. Designed to be skimmed before a Monday standup or sent out as an email.",
    icon: CalendarDays,
    status: "ready",
  },
  {
    slug: "cycle-time",
    title: "Cycle time by stage",
    summary:
      "How long projects and tasks sit in each stage. Find the bottlenecks.",
    description:
      "Average days-in-stage across the eight project stages (Backlog → Done) and the five task stages. Answers \"where do things get stuck?\" — Needs Review, VDQA, In Development — in a way the live Dashboard can't.",
    icon: Timer,
    status: "ready",
  },
  {
    slug: "category-mix",
    title: "Category mix",
    summary:
      "Where the team's time goes across categories, over the last month or quarter.",
    description:
      "Tasks and projects completed per category (Marketing, Campaigns, Design System, A/B Testing, etc.) over a selectable date range. Useful for the \"are we actually working on what we said we would?\" conversation.",
    icon: PieChart,
    status: "ready",
  },
  {
    slug: "one-on-one",
    title: "1:1 prep",
    summary:
      "Per-designer recap: completed work, current load, overdue items, recent activity.",
    description:
      "One page per teammate summarizing tasks completed since the last check-in, current open load, overdue items, upcoming due dates, and recent comment activity. Generated on demand before each 1:1.",
    icon: UserSearch,
    status: "ready",
  },
  {
    slug: "handoff-pipeline",
    title: "Handoff & VDQA pipeline",
    summary:
      "Health of the design → dev → QA flow. What's parked where, and for how long.",
    description:
      "Focused view of the Hand-off, In Development, and VDQA stages (including the VDQA R1 / R2 / Internal task types). Shows items currently in each stage with time-in-stage, so QA debt and stalled handoffs become visible.",
    icon: GitBranch,
    status: "ready",
  },
  {
    slug: "quarterly-recap",
    title: "Quarterly recap",
    summary:
      "Throughput by designer, shipped projects by category, cycle-time trends.",
    description:
      "End-of-quarter rollup: tasks shipped per designer, projects delivered by category, and cycle-time deltas vs. the prior quarter. Designed for performance review prep and for telling the team's story upward.",
    icon: BarChart3,
    status: "ready",
  },
];

/** Look up a report by its slug. Returns undefined for unknown slugs so
 *  the detail page can render a "report not found" state instead of
 *  blowing up. */
export function findReport(slug: string | undefined): ReportDef | undefined {
  if (!slug) return undefined;
  return REPORTS.find((r) => r.slug === slug);
}
