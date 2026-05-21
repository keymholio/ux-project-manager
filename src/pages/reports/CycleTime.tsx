import {
  AlertTriangle,
  Clock,
  Layers,
  RefreshCw,
  Rocket,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  Spinner,
  formatDate,
} from "../../components/ui";
import { supabase } from "../../lib/supabase";
import {
  CATEGORY_LABEL,
  CATEGORY_COLOR,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  isTaskActive,
  type Profile,
  type Project,
  type ProjectStatus,
  type StatusEvent,
  type Task,
  type TaskStatus,
} from "../../lib/types";
import type { ReportDef } from "../../lib/reports";
import {
  BarRow,
  ProjectRow,
  ReportHeader,
  Section,
  Stat,
  TaskRow,
  daysBetween,
  groupBy,
  todayLocalMidnight,
} from "./_shared";

// Cycle time report. Two layers:
//
//   1. Total cycle time (created → done): straightforward, uses
//      completed_at - created_at on each row.
//
//   2. Time in each stage: derived from public.status_history
//      (migration 021). For each completed project/task in the
//      window we walk the chronological list of events and tally
//      duration spent in each `to_status`, then aggregate across
//      subjects to get an average per stage. Subjects with only a
//      single history event — typically backfilled-only rows from
//      before migration 021 — drop out of the per-stage calculation,
//      since we genuinely don't know how their time was distributed.

interface CycleData {
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
  events: StatusEvent[];
}

const STALE_DAYS = 14;
const LOOKBACK_DAYS = 90;

export default function CycleTime({ report }: { report: ReportDef }) {
  const [data, setData] = useState<CycleData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [projectsRes, tasksRes, profilesRes, eventsRes] = await Promise.all([
      supabase.from("projects").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("*"),
      // Cap the history fetch to the lookback window + a safety margin
      // (2x) so we still see events that *started* outside the window
      // but ended inside it. For a small team this is cheap; for a
      // larger one we'd push this filter server-side.
      supabase
        .from("status_history")
        .select("*")
        .gte(
          "changed_at",
          new Date(
            Date.now() - 2 * LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString(),
        )
        .order("changed_at", { ascending: true }),
    ]);
    const error =
      projectsRes.error?.message ??
      tasksRes.error?.message ??
      profilesRes.error?.message ??
      eventsRes.error?.message ??
      null;
    if (error) setErr(error);
    setData({
      projects: projectsRes.data ?? [],
      tasks: tasksRes.data ?? [],
      profiles: profilesRes.data ?? [],
      events: eventsRes.data ?? [],
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
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const sinceISO = new Date(today.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // ---------- Completed work in window ----------
  const recentDoneProjects = data.projects.filter(
    (p) =>
      p.status === "done" &&
      p.completed_at &&
      new Date(p.completed_at) >= sinceISO,
  );
  const recentDoneTasks = data.tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completed_at &&
      new Date(t.completed_at) >= sinceISO,
  );

  const projectDurations = recentDoneProjects.map((p) =>
    daysBetween(p.created_at, p.completed_at!),
  );
  const taskDurations = recentDoneTasks.map((t) =>
    daysBetween(t.created_at, t.completed_at!),
  );

  // ---------- Cycle time by category ----------
  const projectsByCategory = groupBy(recentDoneProjects, (p) => p.category);
  const categoryStats = Array.from(projectsByCategory.entries())
    .map(([category, ps]) => ({
      category,
      avg: avg(ps.map((p) => daysBetween(p.created_at, p.completed_at!))),
      count: ps.length,
    }))
    .sort((a, b) => b.avg - a.avg);
  const maxCategoryAvg = Math.max(1, ...categoryStats.map((c) => c.avg));

  // ---------- Per-stage durations ----------
  // Build event lists per subject, then accumulate "time in stage" by
  // walking adjacent pairs. Only subjects with 2+ events contribute —
  // a single event is either a freshly created row that hasn't moved
  // yet (no transition to measure), or a pre-migration backfill (no
  // intermediate history). Either way it can't tell us per-stage time.
  const projectEvents = groupBy(
    data.events.filter((e) => e.project_id),
    (e) => e.project_id!,
  );
  const taskEvents = groupBy(
    data.events.filter((e) => e.task_id),
    (e) => e.task_id!,
  );

  const projectStageStats = computeStageAverages(
    recentDoneProjects.map((p) => projectEvents.get(p.id) ?? []),
    PROJECT_STATUS_ORDER as readonly ProjectStatus[],
  );
  const taskStageStats = computeStageAverages(
    recentDoneTasks.map((t) => taskEvents.get(t.id) ?? []),
    TASK_STATUS_ORDER as readonly TaskStatus[],
  );

  const projectsWithFullHistory = recentDoneProjects.filter(
    (p) => (projectEvents.get(p.id) ?? []).length >= 2,
  ).length;
  const tasksWithFullHistory = recentDoneTasks.filter(
    (t) => (taskEvents.get(t.id) ?? []).length >= 2,
  ).length;

  // ---------- Stalled active items ----------
  const stalledProjects = data.projects
    .filter(
      (p) =>
        p.status !== "done" &&
        daysBetween(p.updated_at, today) >= STALE_DAYS,
    )
    .sort(
      (a, b) =>
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
    );
  const stalledTasks = data.tasks
    .filter(
      (t) =>
        isTaskActive(t.status) &&
        daysBetween(t.updated_at, today) >= STALE_DAYS,
    )
    .sort(
      (a, b) =>
        new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
    );

  // ---------- Long-running completions ----------
  const longestProjects = [...recentDoneProjects]
    .sort(
      (a, b) =>
        daysBetween(b.created_at, b.completed_at!) -
        daysBetween(a.created_at, a.completed_at!),
    )
    .slice(0, 5);

  const projectMedian = median(projectDurations);
  const taskMedian = median(taskDurations);

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-6">
      <ReportHeader
        report={report}
        subtitle={`Based on completions in the last ${LOOKBACK_DAYS} days. Per-stage durations use the status_history ledger (migration 021).`}
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<Rocket size={18} />}
          label="Avg days to ship a project"
          value={fmtDays(avg(projectDurations))}
        />
        <Stat
          icon={<Rocket size={18} />}
          label="Avg days to ship a task"
          value={fmtDays(avg(taskDurations))}
        />
        <Stat
          icon={<Clock size={18} />}
          label="Median project"
          value={fmtDays(projectMedian)}
        />
        <Stat
          icon={<Clock size={18} />}
          label="Median task"
          value={fmtDays(taskMedian)}
        />
      </div>

      {/* ----- Time in each stage (projects) ----- */}
      <Section
        title="Time in each stage — projects"
        hint={
          projectsWithFullHistory > 0
            ? `Average days a project spends in each stage, across the ${projectsWithFullHistory} ${plural(projectsWithFullHistory, "project")} with full transition history shipped in the last ${LOOKBACK_DAYS} days.`
            : "No projects in the lookback window have full transition history yet."
        }
      >
        {projectStageStats.length === 0 ? (
          <EmptyState
            title="No per-stage data yet"
            hint="Status history accrues going forward — pre-migration items only show as a single backfill event and drop out of these averages."
          />
        ) : (
          <div className="space-y-3">
            {projectStageStats.map((s) => (
              <BarRow
                key={s.status}
                label={
                  <span className="flex items-center gap-2">
                    <Layers size={12} className="text-ink-400" />
                    <span>
                      {PROJECT_STATUS_LABEL[s.status as ProjectStatus] ?? s.status}
                    </span>
                    <span className="text-xs text-ink-500">
                      ({s.sampleCount} {plural(s.sampleCount, "sample")})
                    </span>
                  </span>
                }
                count={Math.round(s.avgDays)}
                percent={s.percentOfMax}
                color="bg-brand-500"
              />
            ))}
          </div>
        )}
      </Section>

      {/* ----- Time in each stage (tasks) ----- */}
      <Section
        title="Time in each stage — tasks"
        hint={
          tasksWithFullHistory > 0
            ? `Average days a task spends in each stage, across the ${tasksWithFullHistory} ${plural(tasksWithFullHistory, "task")} with full transition history shipped in the last ${LOOKBACK_DAYS} days.`
            : "No tasks in the lookback window have full transition history yet."
        }
      >
        {taskStageStats.length === 0 ? (
          <EmptyState
            title="No per-stage data yet"
            hint="Once a few tasks ship after migration 021 ran, this chart populates."
          />
        ) : (
          <div className="space-y-3">
            {taskStageStats.map((s) => (
              <BarRow
                key={s.status}
                label={
                  <span className="flex items-center gap-2">
                    <Layers size={12} className="text-ink-400" />
                    <span>{TASK_STATUS_LABEL[s.status as TaskStatus] ?? s.status}</span>
                    <span className="text-xs text-ink-500">
                      ({s.sampleCount} {plural(s.sampleCount, "sample")})
                    </span>
                  </span>
                }
                count={Math.round(s.avgDays)}
                percent={s.percentOfMax}
                color="bg-brand-500"
              />
            ))}
          </div>
        )}
      </Section>

      {/* ----- Project cycle time by category ----- */}
      <Section
        title="Project cycle time by category"
        hint={`Average days from created to done, for projects completed in the last ${LOOKBACK_DAYS} days. Total duration only — see the per-stage section above for the breakdown.`}
      >
        {categoryStats.length === 0 ? (
          <EmptyState title="No projects completed in this window" />
        ) : (
          <div className="space-y-3">
            {categoryStats.map((c) => (
              <BarRow
                key={c.category}
                label={
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: CATEGORY_COLOR[c.category] }}
                    />
                    <span>{CATEGORY_LABEL[c.category]}</span>
                    <span className="text-xs text-ink-500">
                      ({c.count} shipped)
                    </span>
                  </span>
                }
                count={Math.round(c.avg)}
                percent={(c.avg / maxCategoryAvg) * 100}
                color="bg-brand-500"
              />
            ))}
          </div>
        )}
      </Section>

      {/* ----- Stalled work ----- */}
      <Section
        title={`Stalled work (no edits in ${STALE_DAYS}+ days)`}
        hint="Approximated by last edit on the row. Any field change resets the clock, so this overestimates how long things have been stuck in one stage — useful as a 'have we forgotten about this?' list, less so as a strict SLA."
      >
        {stalledProjects.length === 0 && stalledTasks.length === 0 ? (
          <EmptyState
            title="Nothing's been stale"
            hint={`Every open project and task was touched in the last ${STALE_DAYS} days.`}
          />
        ) : (
          <div className="space-y-4">
            {stalledProjects.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <AlertTriangle size={12} className="text-amber-500" />
                  Projects ({stalledProjects.length})
                </h3>
                <ul className="space-y-1.5">
                  {stalledProjects.map((p) => {
                    const days = daysBetween(p.updated_at, today);
                    return (
                      <ProjectRow
                        key={p.id}
                        project={p}
                        trailing={
                          <span title={`Status: ${PROJECT_STATUS_LABEL[p.status]}`}>
                            {PROJECT_STATUS_LABEL[p.status]} · {days}d stale
                          </span>
                        }
                        emphasizeTrailing={days >= STALE_DAYS * 2 ? "rose" : undefined}
                      />
                    );
                  })}
                </ul>
              </div>
            )}
            {stalledTasks.length > 0 && (
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <AlertTriangle size={12} className="text-amber-500" />
                  Tasks ({stalledTasks.length})
                </h3>
                <ul className="space-y-1.5">
                  {stalledTasks.map((t) => {
                    const days = daysBetween(t.updated_at, today);
                    return (
                      <TaskRow
                        key={t.id}
                        task={t}
                        project={t.project_id ? projectById.get(t.project_id) : undefined}
                        trailing={<span>{days}d stale</span>}
                        emphasizeTrailing={days >= STALE_DAYS * 2 ? "rose" : undefined}
                      />
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ----- Longest-running recent completions ----- */}
      <Section
        title="Longest-running recent completions"
        hint={`The five longest projects we shipped in the last ${LOOKBACK_DAYS} days. Useful retro fodder.`}
      >
        {longestProjects.length === 0 ? (
          <EmptyState title="No projects completed in this window" />
        ) : (
          <ul className="space-y-1.5">
            {longestProjects.map((p) => {
              const days = daysBetween(p.created_at, p.completed_at!);
              return (
                <ProjectRow
                  key={p.id}
                  project={p}
                  trailing={
                    <span>
                      {days}d · shipped {formatDate(p.completed_at!)}
                    </span>
                  }
                />
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ---------- Per-stage computation ----------

// For one subject's event list (already chronologically sorted), tally
// the days spent in each `to_status`. A subject with < 2 events
// contributes nothing — that's either a freshly created item that
// hasn't transitioned yet, or a backfilled-only row from before
// migration 021. Either way we don't have enough information.
function durationsForSubject(events: StatusEvent[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (events.length < 2) return out;
  for (let i = 0; i < events.length - 1; i++) {
    const status = events[i].to_status;
    const days = daysBetween(events[i].changed_at, events[i + 1].changed_at);
    // Drop negative durations defensively — shouldn't happen, but if a
    // clock skew or backfill ordering quirk produces one we'd rather
    // skip it than poison the average.
    if (days < 0) continue;
    if (!out.has(status)) out.set(status, []);
    out.get(status)!.push(days);
  }
  return out;
}

interface StageStat {
  status: string;
  avgDays: number;
  sampleCount: number;
  /** Percent of the largest bar's avgDays — for the bar chart's
   *  internal scale. */
  percentOfMax: number;
}

// Aggregate per-stage durations across many subjects. `order` defines
// which stages to display and in what order (we sort the output by it
// rather than by avg so the chart matches the funnel reading order).
function computeStageAverages(
  perSubjectEvents: StatusEvent[][],
  order: readonly string[],
): StageStat[] {
  const buckets = new Map<string, number[]>();
  for (const events of perSubjectEvents) {
    const subjectDurations = durationsForSubject(events);
    for (const [status, days] of subjectDurations) {
      if (!buckets.has(status)) buckets.set(status, []);
      buckets.get(status)!.push(...days);
    }
  }
  const rows: StageStat[] = [];
  for (const status of order) {
    const samples = buckets.get(status) ?? [];
    if (samples.length === 0) continue;
    rows.push({
      status,
      avgDays: avg(samples),
      sampleCount: samples.length,
      percentOfMax: 0, // filled below
    });
  }
  const maxAvg = Math.max(1, ...rows.map((r) => r.avgDays));
  for (const r of rows) {
    r.percentOfMax = (r.avgDays / maxAvg) * 100;
  }
  return rows;
}

// ---------- Local stat helpers ----------

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtDays(n: number): string {
  if (n <= 0) return "—";
  if (n < 1) return "<1d";
  return `${Math.round(n)}d`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
