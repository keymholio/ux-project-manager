import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  TASK_STATUS_LABEL,
  USER_ROLE_LABEL,
  isTaskActive,
  type Profile,
  type Project,
  type Task,
} from "../../lib/types";
import type { ReportDef } from "../../lib/reports";
import {
  ReportHeader,
  Section,
  Stat,
  TaskRow,
  todayLocalMidnight,
} from "./_shared";

// 1:1 prep — per-teammate roll-up designed to be skimmed before a
// check-in. The whole team renders on one scrollable page, with anchor
// links at the top to jump straight to a person.
//
// Sections per person:
//   * Stats (shipped 30d, open, overdue, due in 14d)
//   * Recently shipped (last 5)
//   * Open / in progress (sorted by priority then due date)
//   * Overdue
//   * Upcoming (next 14 days)

interface PrepData {
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
}

const SHIPPED_WINDOW_DAYS = 30;
const UPCOMING_WINDOW_DAYS = 14;
const RECENT_SHIP_LIMIT = 5;

export default function OneOnOne({ report }: { report: ReportDef }) {
  const [data, setData] = useState<PrepData | null>(null);
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
  const projectById = new Map(data.projects.map((p) => [p.id, p]));

  // Eligible teammates — same definition as the Dashboard. Viewers and
  // deactivated accounts drop out. Includes managers (a manager who's
  // also doing design work shouldn't disappear from their own 1:1 prep).
  const team = [...data.profiles]
    .filter((p) => (p.is_active ?? true) && p.role !== "viewer")
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-6">
      <ReportHeader
        report={report}
        subtitle={`Per-teammate roll-up. Shipped window: last ${SHIPPED_WINDOW_DAYS} days. Upcoming window: next ${UPCOMING_WINDOW_DAYS} days.`}
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

      {/* Quick anchor list — jump to a person. Cheaper than building a
          full segmented control; works fine for a team of 4 and scales
          naturally as the roster grows. */}
      {team.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-500">Jump to:</span>
          {team.map((p) => (
            <a
              key={p.id}
              href={`#person-${p.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1 text-ink-700 hover:bg-ink-200"
            >
              <Avatar profile={p} size={18} />
              {p.full_name}
            </a>
          ))}
        </div>
      )}

      {team.length === 0 ? (
        <EmptyState
          title="No active teammates"
          hint="Activate someone from the Users page to populate this report."
        />
      ) : (
        team.map((p) => (
          <PersonCard
            key={p.id}
            person={p}
            today={today}
            allTasks={data.tasks}
            projectById={projectById}
          />
        ))
      )}
    </div>
  );
}

// ---------- Per-person card ----------

function PersonCard({
  person,
  today,
  allTasks,
  projectById,
}: {
  person: Profile;
  today: Date;
  allTasks: Task[];
  projectById: Map<string, Project>;
}) {
  // All tasks assigned to this person, regardless of state.
  const mine = allTasks.filter((t) => t.assignee_id === person.id);

  const shippedSince = new Date(
    today.getTime() - SHIPPED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const upcomingUntil = new Date(
    today.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const shipped = mine
    .filter(
      (t) =>
        t.status === "done" &&
        t.completed_at &&
        new Date(t.completed_at) >= shippedSince,
    )
    .sort(
      (a, b) =>
        new Date(b.completed_at!).getTime() -
        new Date(a.completed_at!).getTime(),
    );

  const open = mine.filter((t) => isTaskActive(t.status));

  const overdue = open
    .filter((t) => t.due_date && parseDateLocal(t.due_date) < today)
    .sort(
      (a, b) =>
        parseDateLocal(a.due_date!).getTime() -
        parseDateLocal(b.due_date!).getTime(),
    );

  const upcoming = open
    .filter(
      (t) =>
        t.due_date &&
        parseDateLocal(t.due_date) >= today &&
        parseDateLocal(t.due_date) < upcomingUntil,
    )
    .sort(
      (a, b) =>
        parseDateLocal(a.due_date!).getTime() -
        parseDateLocal(b.due_date!).getTime(),
    );

  // Status breakdown chip row for the "Open work" header.
  const statusCounts = new Map<Task["status"], number>();
  for (const t of open) statusCounts.set(t.status, (statusCounts.get(t.status) ?? 0) + 1);
  // Folding on_hold into backlog matches the Dashboard / Weekly digest.
  const backlogish =
    (statusCounts.get("backlog") ?? 0) + (statusCounts.get("on_hold") ?? 0);
  const breakdown: [Task["status"], number][] = [];
  if (backlogish > 0) breakdown.push(["backlog", backlogish]);
  if ((statusCounts.get("on_deck") ?? 0) > 0) breakdown.push(["on_deck", statusCounts.get("on_deck")!]);
  if ((statusCounts.get("in_progress") ?? 0) > 0)
    breakdown.push(["in_progress", statusCounts.get("in_progress")!]);

  return (
    <section
      id={`person-${person.id}`}
      // scroll-mt-20 so anchor jumps don't tuck the header under the
      // mobile top bar / desktop content padding.
      className="card scroll-mt-20 p-5 space-y-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-3">
        <div className="flex items-center gap-3">
          <Avatar profile={person} size={40} />
          <div>
            <h2 className="text-base font-semibold text-ink-900">
              {person.full_name}
            </h2>
            <div className="text-xs text-ink-500">{USER_ROLE_LABEL[person.role]}</div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          icon={<CheckCircle2 size={18} />}
          label={`Shipped (${SHIPPED_WINDOW_DAYS}d)`}
          value={shipped.length}
          tone="emerald"
        />
        <Stat
          icon={<Clock size={18} />}
          label="Open"
          value={open.length}
        />
        <Stat
          icon={<AlertCircle size={18} />}
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? "rose" : undefined}
        />
        <Stat
          icon={<CalendarClock size={18} />}
          label={`Due in ${UPCOMING_WINDOW_DAYS}d`}
          value={upcoming.length}
        />
      </div>

      <Section title={`Recently shipped — last ${SHIPPED_WINDOW_DAYS} days`}>
        {shipped.length === 0 ? (
          <EmptyState
            title="Nothing shipped in this window"
            hint="Worth asking why — is the work bigger than expected, blocked, or just longer-tail?"
          />
        ) : (
          <ul className="space-y-1.5">
            {shipped.slice(0, RECENT_SHIP_LIMIT).map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.project_id ? projectById.get(t.project_id) : undefined}
                trailing={t.completed_at ? formatDate(t.completed_at) : null}
              />
            ))}
            {shipped.length > RECENT_SHIP_LIMIT && (
              <li className="px-2 text-xs text-ink-500">
                + {shipped.length - RECENT_SHIP_LIMIT} more in window
              </li>
            )}
          </ul>
        )}
      </Section>

      <Section
        title="Open work"
        hint={
          breakdown.length > 0
            ? breakdown
                .map(([s, n]) => `${TASK_STATUS_LABEL[s]} · ${n}`)
                .join("  •  ")
            : undefined
        }
      >
        {open.length === 0 ? (
          <EmptyState title="No open work" hint="Empty queue — time to plan ahead?" />
        ) : (
          <ul className="space-y-1.5">
            {open.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.project_id ? projectById.get(t.project_id) : undefined}
                trailing={
                  t.due_date ? (
                    <span
                      className={
                        parseDateLocal(t.due_date) < today
                          ? "text-rose-600 dark:text-rose-300"
                          : ""
                      }
                    >
                      {formatDate(t.due_date)}
                    </span>
                  ) : (
                    TASK_STATUS_LABEL[t.status]
                  )
                }
              />
            ))}
          </ul>
        )}
      </Section>

      {overdue.length > 0 && (
        <Section title={`Overdue (${overdue.length})`}>
          <ul className="space-y-1.5">
            {overdue.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.project_id ? projectById.get(t.project_id) : undefined}
                trailing={t.due_date ? formatDate(t.due_date) : null}
                emphasizeTrailing="rose"
              />
            ))}
          </ul>
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title={`Upcoming — next ${UPCOMING_WINDOW_DAYS} days`}>
          <ul className="space-y-1.5">
            {upcoming.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                project={t.project_id ? projectById.get(t.project_id) : undefined}
                trailing={t.due_date ? formatDate(t.due_date) : null}
              />
            ))}
          </ul>
        </Section>
      )}
    </section>
  );
}
