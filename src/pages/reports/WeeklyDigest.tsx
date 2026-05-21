import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Button,
  EmptyState,
  Spinner,
  formatDate,
  parseDateLocal,
} from "../../components/ui";
import { supabase } from "../../lib/supabase";
import {
  CATEGORY_LABEL,
  TASK_STATUS_LABEL,
  fmtProjectId,
  isTaskActive,
  type Profile,
  type Project,
  type Task,
} from "../../lib/types";
import type { ReportDef } from "../../lib/reports";
import {
  ONE_DAY_MS,
  ReportHeader,
  Section,
  Stat,
  TaskRow,
  groupBy,
  todayLocalMidnight,
} from "./_shared";

// Weekly digest — the first real report. Single scrollable page,
// snapshot of the team's last 7 days and next 7 days. No realtime
// subscriptions on purpose: a report is a moment in time. There's a
// Refresh button at the top for the (rare) case where someone wants
// to see what just changed.
//
// Sections:
//   1. Top stats (shipped tasks/projects, overdue, due this week)
//   2. Shipped last week — grouped by assignee
//   3. In flight — current open work, grouped by assignee
//   4. Overdue — flat list, oldest first
//   5. Due this week — flat list, soonest first
//
// "Last week" is a rolling 7-day window ending today, not the previous
// calendar week. Rolling is more useful for an ad-hoc opens-it-whenever
// digest; calendar weeks make more sense once we schedule this and want
// a stable "week N" identity. Trivial to swap when that lands.

interface DigestData {
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
}

export default function WeeklyDigest({ report }: { report: ReportDef }) {
  const [data, setData] = useState<DigestData | null>(null);
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

  // Date boundaries computed once per render. "Today" is local midnight
  // so a task due today doesn't slip into "overdue" depending on what
  // hour the user opens the report.
  const today = useMemo(() => todayLocalMidnight(), []);
  const weekAgo = useMemo(() => new Date(today.getTime() - 7 * ONE_DAY_MS), [today]);
  const weekAhead = useMemo(() => new Date(today.getTime() + 7 * ONE_DAY_MS), [today]);

  if (err) {
    return (
      <div className="p-4 sm:p-6 pb-20 space-y-6">
        <ReportHeader report={report} />
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Couldn't load the digest: {err}
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

  // Active team — same definition the Dashboard uses, so the digest
  // doesn't disagree with the workload chart about who's on the team.
  // Viewer-role profiles and deactivated accounts drop out.
  const team = [...data.profiles]
    .filter((p) => (p.is_active ?? true) && p.role !== "viewer")
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const profileById = new Map(data.profiles.map((p) => [p.id, p]));

  // Last 7 days: tasks/projects whose completed_at falls in the window.
  // completed_at is null for anything not in 'done', so the filter
  // doubles as a "shipped" check.
  const shippedTasks = data.tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completed_at &&
      new Date(t.completed_at) >= weekAgo,
  );
  const shippedProjects = data.projects.filter(
    (p) =>
      p.status === "done" &&
      p.completed_at &&
      new Date(p.completed_at) >= weekAgo,
  );

  const activeTasks = data.tasks.filter((t) => isTaskActive(t.status));

  const overdueTasks = activeTasks
    .filter((t) => t.due_date && parseDateLocal(t.due_date) < today)
    .sort(
      (a, b) =>
        parseDateLocal(a.due_date!).getTime() -
        parseDateLocal(b.due_date!).getTime(),
    );

  const dueThisWeek = activeTasks
    .filter(
      (t) =>
        t.due_date &&
        parseDateLocal(t.due_date) >= today &&
        parseDateLocal(t.due_date) < weekAhead,
    )
    .sort(
      (a, b) =>
        parseDateLocal(a.due_date!).getTime() -
        parseDateLocal(b.due_date!).getTime(),
    );

  const shippedByAssignee = groupBy(shippedTasks, (t) => t.assignee_id ?? "unassigned");
  const inFlightByAssignee = groupBy(activeTasks, (t) => t.assignee_id ?? "unassigned");

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-6">
      <ReportHeader
        report={report}
        subtitle={`${formatDate(weekAgo.toISOString())} → ${formatDate(today.toISOString())}`}
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

      {/* ----- Stats ----- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<CheckCircle2 size={18} />}
          label="Tasks shipped"
          value={shippedTasks.length}
          tone="emerald"
        />
        <Stat
          icon={<CheckCircle2 size={18} />}
          label="Projects shipped"
          value={shippedProjects.length}
          tone="emerald"
        />
        <Stat
          icon={<AlertCircle size={18} />}
          label="Overdue"
          value={overdueTasks.length}
          tone="rose"
        />
        <Stat
          icon={<CalendarClock size={18} />}
          label="Due this week"
          value={dueThisWeek.length}
        />
      </div>

      {/* ----- Shipped ----- */}
      <Section
        title="Shipped last week"
        hint="Tasks and projects moved to Done in the last 7 days."
      >
        {shippedTasks.length === 0 && shippedProjects.length === 0 ? (
          <EmptyState
            title="Nothing shipped in the last 7 days"
            hint="That can be normal — long projects, holiday weeks, kickoff sprints. Worth a glance if it's a surprise."
          />
        ) : (
          <div className="space-y-4">
            {shippedProjects.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Projects ({shippedProjects.length})
                </h3>
                <ul className="space-y-1.5">
                  {shippedProjects.map((p) => (
                    <li key={p.id}>
                      <Link
                        to={`/projects/${p.id}`}
                        className="group flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-100"
                      >
                        <span className="font-mono text-xs text-ink-500">
                          {fmtProjectId(p.short_id)}
                        </span>
                        <span className="font-medium text-ink-900">{p.name}</span>
                        <span className="text-xs text-ink-500">
                          {CATEGORY_LABEL[p.category]}
                        </span>
                        {p.completed_at && (
                          <span className="ml-auto text-xs text-ink-500">
                            {formatDate(p.completed_at)}
                          </span>
                        )}
                        <ArrowUpRight
                          size={12}
                          className="text-ink-400 opacity-0 transition group-hover:opacity-100"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {shippedTasks.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Tasks ({shippedTasks.length})
                </h3>
                <div className="space-y-3">
                  {team.map((d) => {
                    const mine = shippedByAssignee.get(d.id) ?? [];
                    if (mine.length === 0) return null;
                    return (
                      <PersonGroup key={d.id} profile={d} count={mine.length}>
                        {mine
                          .sort(
                            (a, b) =>
                              new Date(b.completed_at!).getTime() -
                              new Date(a.completed_at!).getTime(),
                          )
                          .map((t) => (
                            <TaskRow
                              key={t.id}
                              task={t}
                              project={t.project_id ? projectById.get(t.project_id) : undefined}
                              trailing={
                                t.completed_at ? formatDate(t.completed_at) : null
                              }
                            />
                          ))}
                      </PersonGroup>
                    );
                  })}
                  {(shippedByAssignee.get("unassigned") ?? []).length > 0 && (
                    <PersonGroup
                      profile={null}
                      count={(shippedByAssignee.get("unassigned") ?? []).length}
                    >
                      {(shippedByAssignee.get("unassigned") ?? []).map((t) => (
                        <TaskRow
                          key={t.id}
                          task={t}
                          project={t.project_id ? projectById.get(t.project_id) : undefined}
                          trailing={t.completed_at ? formatDate(t.completed_at) : null}
                        />
                      ))}
                    </PersonGroup>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ----- In flight ----- */}
      <Section
        title="In flight"
        hint="Open work right now, grouped by designer. On hold counts toward backlog, the same way the Dashboard groups it."
      >
        {team.every((d) => (inFlightByAssignee.get(d.id) ?? []).length === 0) ? (
          <EmptyState
            title="No open work assigned"
            hint="Either you cleared the queue or no one has picked anything up yet."
          />
        ) : (
          <div className="space-y-2">
            {team.map((d) => {
              const mine = inFlightByAssignee.get(d.id) ?? [];
              const breakdown = countByStatus(mine);
              return (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2"
                >
                  <Avatar profile={d} size={28} />
                  <span className="text-sm font-medium text-ink-900">{d.full_name}</span>
                  <span className="text-sm text-ink-500">{mine.length} open</span>
                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    {breakdown.map(([status, n]) => (
                      <span
                        key={status}
                        className="chip bg-ink-100 text-ink-700"
                        title={`${n} ${TASK_STATUS_LABEL[status]}`}
                      >
                        {TASK_STATUS_LABEL[status]} · {n}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ----- Overdue ----- */}
      <Section
        title="Overdue"
        hint="Active tasks whose due date has already passed. Oldest first."
      >
        {overdueTasks.length === 0 ? (
          <EmptyState title="Nothing overdue" hint="Nice." />
        ) : (
          <ul className="space-y-1.5">
            {overdueTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.project_id ? projectById.get(t.project_id) : undefined}
                assignee={t.assignee_id ? profileById.get(t.assignee_id) ?? null : null}
                trailing={t.due_date ? formatDate(t.due_date) : null}
                emphasizeTrailing="rose"
              />
            ))}
          </ul>
        )}
      </Section>

      {/* ----- Due this week ----- */}
      <Section
        title="Due this week"
        hint="Active tasks with a due date in the next 7 days."
      >
        {dueThisWeek.length === 0 ? (
          <EmptyState title="Nothing due in the next 7 days" />
        ) : (
          <ul className="space-y-1.5">
            {dueThisWeek.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.project_id ? projectById.get(t.project_id) : undefined}
                assignee={t.assignee_id ? profileById.get(t.assignee_id) ?? null : null}
                trailing={t.due_date ? formatDate(t.due_date) : null}
              />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// Status breakdown for the In flight chip row. Folds on_hold into
// backlog to match the Dashboard's grouping. Returned in a stable
// order so the chips don't dance around between renders.
function countByStatus(tasks: Task[]): [Task["status"], number][] {
  const counts = new Map<Task["status"], number>();
  for (const t of tasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);
  const backlogish = (counts.get("backlog") ?? 0) + (counts.get("on_hold") ?? 0);
  const out: [Task["status"], number][] = [];
  if (backlogish > 0) out.push(["backlog", backlogish]);
  if ((counts.get("on_deck") ?? 0) > 0) out.push(["on_deck", counts.get("on_deck")!]);
  if ((counts.get("in_progress") ?? 0) > 0)
    out.push(["in_progress", counts.get("in_progress")!]);
  return out;
}

// Person-grouped task list. Used by the "Shipped" section to show who
// shipped what, with their avatar as a section anchor.
function PersonGroup({
  profile,
  count,
  children,
}: {
  profile: Profile | null;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <Avatar profile={profile} size={24} />
        <span className="text-sm font-medium text-ink-900">
          {profile?.full_name ?? "Unassigned"}
        </span>
        <span className="text-xs text-ink-500">{count} shipped</span>
      </div>
      <ul className="space-y-0.5 pl-8">{children}</ul>
    </div>
  );
}

