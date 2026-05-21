import { Activity, CheckCircle2, FolderKanban, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Spinner } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  isTaskActive,
  type ProjectCategory,
  type Profile,
  type Project,
  type Task,
} from "../../lib/types";
import type { ReportDef } from "../../lib/reports";
import {
  BarRow,
  ReportHeader,
  Section,
  Stat,
  todayLocalMidnight,
} from "./_shared";

// Category mix — where the team's time is actually going.
//
// Three views, each over its own window:
//   1. Completed tasks per category, last 30 days
//   2. Completed projects per category, last 90 days
//   3. Active work per category (no time window; current snapshot)
//
// Tasks don't carry a category themselves — they inherit it from their
// parent project. Tasks with no project_id roll into a "No project"
// bucket so the totals reconcile.

interface MixData {
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
}

// Reusable shape for "a bucket of work the chart is going to draw".
// Includes a synthetic "no_project" key so the renderer can handle it
// uniformly without checking for null at each render site.
type CategoryKey = ProjectCategory | "no_project";
const NO_PROJECT_LABEL = "No project";
const NO_PROJECT_COLOR = "#94a3b8"; // slate-400 — visually distinct from category swatches

const TASK_WINDOW_DAYS = 30;
const PROJECT_WINDOW_DAYS = 90;

export default function CategoryMix({ report }: { report: ReportDef }) {
  const [data, setData] = useState<MixData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [projectsRes, tasksRes, profilesRes] = await Promise.all([
      supabase.from("projects").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("*"),
    ]);
    const error =
      projectsRes.error?.message ??
      tasksRes.error?.message ??
      profilesRes.error?.message ??
      null;
    if (error) setErr(error);
    setData({
      projects: projectsRes.data ?? [],
      tasks: tasksRes.data ?? [],
      profiles: profilesRes.data ?? [],
    });
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) {
    return (
      <div className="p-4 sm:p-6 pb-20 space-y-6">
        <ReportHeader report={report} />
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Couldn't load the report: {err}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const today = todayLocalMidnight();
  const taskSince = new Date(today.getTime() - TASK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const projectSince = new Date(today.getTime() - PROJECT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const projectById = new Map(data.projects.map((p) => [p.id, p]));

  // Tasks shipped in the window — bucket by their parent project's
  // category. project_id=null falls in the "no_project" bucket.
  const shippedTasks = data.tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completed_at &&
      new Date(t.completed_at) >= taskSince,
  );
  const taskCounts = bucketByCategory(shippedTasks, (t) =>
    t.project_id ? projectById.get(t.project_id)?.category ?? null : null,
  );

  // Projects shipped in the window — bucket directly by project.category.
  const shippedProjects = data.projects.filter(
    (p) =>
      p.status === "done" &&
      p.completed_at &&
      new Date(p.completed_at) >= projectSince,
  );
  const projectCounts = bucketByCategory(shippedProjects, (p) => p.category);

  // Active work right now — same task bucketing, but anything not in a
  // terminal state. The denominator is "current work in flight", not
  // "what we shipped", so the bars answer "where are we spending time
  // right now?" vs. "where did time go last month?".
  const activeTasks = data.tasks.filter((t) => isTaskActive(t.status));
  const activeCounts = bucketByCategory(activeTasks, (t) =>
    t.project_id ? projectById.get(t.project_id)?.category ?? null : null,
  );

  const totalShippedTasks = shippedTasks.length;
  const totalShippedProjects = shippedProjects.length;
  const totalActiveTasks = activeTasks.length;

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-6">
      <ReportHeader
        report={report}
        subtitle="Where the team's time has been going lately."
        trailing={
          <Button
            variant="ghost"
            icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />}
            onClick={() => void load()}
            disabled={refreshing}
          >
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          icon={<CheckCircle2 size={18} />}
          label={`Tasks shipped (${TASK_WINDOW_DAYS}d)`}
          value={totalShippedTasks}
          tone="emerald"
        />
        <Stat
          icon={<FolderKanban size={18} />}
          label={`Projects shipped (${PROJECT_WINDOW_DAYS}d)`}
          value={totalShippedProjects}
          tone="emerald"
        />
        <Stat
          icon={<Activity size={18} />}
          label="Active tasks right now"
          value={totalActiveTasks}
        />
      </div>

      <Section
        title={`Completed tasks by category — last ${TASK_WINDOW_DAYS} days`}
        hint="Each task inherits its project's category. Tasks without a project roll into 'No project'."
      >
        <CategoryBars
          buckets={taskCounts}
          total={totalShippedTasks}
          emptyTitle="No tasks completed in the last 30 days"
        />
      </Section>

      <Section
        title={`Projects shipped by category — last ${PROJECT_WINDOW_DAYS} days`}
      >
        <CategoryBars
          buckets={projectCounts}
          total={totalShippedProjects}
          emptyTitle="No projects shipped in the last 90 days"
        />
      </Section>

      <Section
        title="Active work by category — right now"
        hint="Open tasks (not done, not canceled), bucketed by their project's category. Useful counterweight to the historical views."
      >
        <CategoryBars
          buckets={activeCounts}
          total={totalActiveTasks}
          emptyTitle="No open tasks"
        />
      </Section>
    </div>
  );
}

// ---------- Helpers ----------

// Bucket a list into per-category counts, preserving the canonical
// category order so the bars don't reshuffle between renders. Returns
// only non-empty buckets (so a category nobody touched doesn't pad the
// chart with a zero row).
function bucketByCategory<T>(
  items: T[],
  catFn: (t: T) => ProjectCategory | null,
): { key: CategoryKey; count: number }[] {
  const counts = new Map<CategoryKey, number>();
  for (const item of items) {
    const c = catFn(item);
    const key: CategoryKey = c ?? "no_project";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // Drive the order off the CATEGORY_LABEL key list so we get a stable
  // sort regardless of insertion order, then append no_project last.
  const order: CategoryKey[] = [
    ...(Object.keys(CATEGORY_LABEL) as ProjectCategory[]),
    "no_project",
  ];
  return order
    .map((k) => ({ key: k, count: counts.get(k) ?? 0 }))
    .filter((row) => row.count > 0);
}

function labelFor(key: CategoryKey): string {
  return key === "no_project" ? NO_PROJECT_LABEL : CATEGORY_LABEL[key];
}
function colorFor(key: CategoryKey): string {
  return key === "no_project" ? NO_PROJECT_COLOR : CATEGORY_COLOR[key];
}

function CategoryBars({
  buckets,
  total,
  emptyTitle,
}: {
  buckets: { key: CategoryKey; count: number }[];
  total: number;
  emptyTitle: string;
}) {
  if (buckets.length === 0) {
    return <EmptyState title={emptyTitle} />;
  }
  // Percent is share-of-total so the bars read as "% of the team's
  // time this period" rather than "max-normalized within this chart".
  // Two charts on the same page can then be compared directly.
  return (
    <div className="space-y-3">
      {buckets.map((b) => {
        const pct = total > 0 ? (b.count / total) * 100 : 0;
        return (
          <BarRow
            key={b.key}
            label={
              <span className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: colorFor(b.key) }}
                />
                <span>{labelFor(b.key)}</span>
                <span className="text-xs text-ink-500">
                  {Math.round(pct)}%
                </span>
              </span>
            }
            count={b.count}
            percent={pct}
            color="bg-brand-500"
          />
        );
      })}
    </div>
  );
}
