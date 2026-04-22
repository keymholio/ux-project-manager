import { AlertCircle, CheckCircle2, Clock, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  PriorityBadge,
  Spinner,
  TaskStatusBadge,
  ToolLinks,
  formatDate,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  PROJECT_STATUS_ORDER,
  PROJECT_STATUS_LABEL,
  type Profile,
  type Project,
  type Task,
} from "../lib/types";

interface DashboardData {
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
}

export default function Dashboard() {
  const { profile, isManager } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [projectsRes, tasksRes, profilesRes] = await Promise.all([
        supabase.from("projects").select("*").order("updated_at", { ascending: false }),
        supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }),
        supabase.from("profiles").select("*"),
      ]);
      if (!active) return;
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
    })();
    return () => {
      active = false;
    };
  }, []);

  // Live updates: refetch when tasks/projects tables change.
  useEffect(() => {
    const channel = supabase
      .channel("dashboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    const [projectsRes, tasksRes] = await Promise.all([
      supabase.from("projects").select("*").order("updated_at", { ascending: false }),
      supabase.from("tasks").select("*").order("due_date", { ascending: true, nullsFirst: false }),
    ]);
    setData((d) =>
      d
        ? {
            ...d,
            projects: projectsRes.data ?? d.projects,
            tasks: tasksRes.data ?? d.tasks,
          }
        : d,
    );
  };

  if (err) return <div className="p-6 text-rose-700">Error: {err}</div>;
  if (!data)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  return isManager ? (
    <ManagerDashboard {...data} />
  ) : (
    <DesignerDashboard {...data} currentUserId={profile?.id ?? ""} />
  );
}

// =============================================================================
// Manager view — team workload + deadlines + funnel
// =============================================================================
function ManagerDashboard({ projects, tasks, profiles }: DashboardData) {
  // Everyone (managers included) can own tasks & projects, so the workload
  // chart covers the whole team — sorted alphabetically for consistency.
  const team = [...profiles].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  );

  const tasksByAssignee = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.status === "done") continue;
      const key = t.assignee_id ?? "unassigned";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return m;
  }, [tasks]);

  const projectsByStatus = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of PROJECT_STATUS_ORDER) m.set(s, 0);
    for (const p of projects) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return m;
  }, [projects]);

  const upcoming = tasks
    .filter((t) => t.status !== "done" && t.due_date)
    .slice(0, 8);

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Dashboard</h1>
        <p className="text-sm text-ink-500">
          Team workload, deadlines, and funnel health.
        </p>
      </header>

      {/* Top stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<Users size={18} />}
          label="Team members"
          value={team.length}
        />
        <Stat
          icon={<Clock size={18} />}
          label="Open tasks"
          value={tasks.filter((t) => t.status !== "done").length}
        />
        <Stat
          icon={<AlertCircle size={18} />}
          label="Overdue"
          value={
            tasks.filter(
              (t) =>
                t.status !== "done" &&
                t.due_date &&
                new Date(t.due_date) < new Date(),
            ).length
          }
          tone="rose"
        />
        <Stat
          icon={<CheckCircle2 size={18} />}
          label="Projects in flight"
          value={
            projects.filter(
              (p) => p.status !== "done" && p.status !== "backlog",
            ).length
          }
          tone="emerald"
        />
      </div>

      {/* Workload by team member */}
      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Workload by team
        </h2>
        <div className="space-y-3">
          {team.map((d) => {
            const mine = tasksByAssignee.get(d.id) ?? [];
            const byStatus: Record<string, number> = {};
            for (const t of mine) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
            return (
              <div key={d.id} className="flex items-center gap-3">
                <Avatar profile={d} size={32} />
                <div className="flex-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink-900">
                      {d.full_name}
                    </span>
                    <span className="text-ink-500">{mine.length} open</span>
                  </div>
                  <div className="mt-1 flex gap-1 overflow-hidden rounded-full bg-ink-100">
                    {mine.length === 0 ? (
                      <div className="h-2 flex-1" />
                    ) : (
                      <>
                        {byStatus.in_progress ? (
                          <div
                            className="h-2 bg-amber-400"
                            style={{
                              flexBasis: `${(byStatus.in_progress / mine.length) * 100}%`,
                            }}
                            title={`${byStatus.in_progress} in progress`}
                          />
                        ) : null}
                        {byStatus.in_review ? (
                          <div
                            className="h-2 bg-purple-400"
                            style={{
                              flexBasis: `${(byStatus.in_review / mine.length) * 100}%`,
                            }}
                            title={`${byStatus.in_review} in review`}
                          />
                        ) : null}
                        {byStatus.on_deck ? (
                          <div
                            className="h-2 bg-sky-400"
                            style={{
                              flexBasis: `${(byStatus.on_deck / mine.length) * 100}%`,
                            }}
                            title={`${byStatus.on_deck} on deck`}
                          />
                        ) : null}
                        {byStatus.backlog ? (
                          <div
                            className="h-2 bg-ink-300"
                            style={{
                              flexBasis: `${(byStatus.backlog / mine.length) * 100}%`,
                            }}
                            title={`${byStatus.backlog} backlog`}
                          />
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {team.length === 0 && (
            <p className="text-sm text-ink-500">
              No team members yet. Add people in Supabase Auth, then set their
              role (<code>manager</code> or <code>designer</code>) in the
              profiles table.
            </p>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Project funnel */}
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            Project funnel
          </h2>
          <div className="space-y-1.5">
            {PROJECT_STATUS_ORDER.map((s) => {
              const count = projectsByStatus.get(s) ?? 0;
              const max = Math.max(...Array.from(projectsByStatus.values()), 1);
              return (
                <div key={s} className="flex items-center gap-3 text-sm">
                  <div className="w-32 text-ink-600">
                    {PROJECT_STATUS_LABEL[s]}
                  </div>
                  <div className="flex-1 h-2 rounded-full bg-ink-100 overflow-hidden">
                    <div
                      className="h-full bg-brand-500"
                      style={{ width: `${(count / max) * 100}%` }}
                    />
                  </div>
                  <div className="w-8 text-right tabular-nums text-ink-900">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Upcoming deadlines */}
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            Upcoming deadlines
          </h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-ink-500">
              No upcoming due dates. Nice.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {upcoming.map((t) => {
                const a = profiles.find((p) => p.id === t.assignee_id) ?? null;
                const overdue =
                  t.due_date && new Date(t.due_date) < new Date();
                return (
                  <li key={t.id} className="py-2">
                    <Link
                      to={`/tasks/${t.id}`}
                      className="flex items-center gap-3 rounded hover:bg-ink-50 -mx-1 px-1"
                    >
                      <Avatar profile={a} size={24} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm font-medium text-ink-900">
                          {t.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs">
                          <TaskStatusBadge status={t.status} />
                          <PriorityBadge priority={t.priority} />
                          <ToolLinks
                            figma={t.figma_url}
                            workfront={t.workfront_url}
                            jira={t.jira_url}
                            figjam={t.figjam_url}
                          />
                        </div>
                      </div>
                      <div
                        className={`text-xs tabular-nums ${overdue ? "text-rose-700 font-medium" : "text-ink-500"}`}
                      >
                        {formatDate(t.due_date)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// Designer view — my today + my week
// =============================================================================
function DesignerDashboard({
  tasks,
  profiles,
  projects,
  currentUserId,
}: DashboardData & { currentUserId: string }) {
  const mine = tasks.filter(
    (t) => t.assignee_id === currentUserId && t.status !== "done",
  );
  const overdue = mine.filter(
    (t) => t.due_date && new Date(t.due_date) < new Date(),
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const today = mine.filter((t) => t.due_date === todayIso);
  const rest = mine.filter((t) => !today.includes(t) && !overdue.includes(t));

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-900">Hi there.</h1>
        <p className="text-sm text-ink-500">
          Your work across all projects. Click a task to open details or move
          it on the board.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          icon={<AlertCircle size={18} />}
          label="Overdue"
          value={overdue.length}
          tone="rose"
        />
        <Stat
          icon={<Clock size={18} />}
          label="Due today"
          value={today.length}
          tone="amber"
        />
        <Stat
          icon={<CheckCircle2 size={18} />}
          label="Other open"
          value={rest.length}
        />
      </div>

      <TaskList title="Overdue" items={overdue} projects={projects} profiles={profiles} emptyNote="Nothing overdue." />
      <TaskList title="Due today" items={today} projects={projects} profiles={profiles} emptyNote="No tasks due today." />
      <TaskList title="Rest of your open work" items={rest} projects={projects} profiles={profiles} emptyNote="Inbox zero." />
    </div>
  );
}

function TaskList({
  title,
  items,
  projects,
  profiles,
  emptyNote,
}: {
  title: string;
  items: Task[];
  projects: Project[];
  profiles: Profile[];
  emptyNote: string;
}) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-ink-900">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-500">{emptyNote}</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {items.map((t) => {
            const parent = projects.find((p) => p.id === t.project_id);
            const a = profiles.find((p) => p.id === t.assignee_id) ?? null;
            const overdue =
              t.due_date && new Date(t.due_date) < new Date() && t.status !== "done";
            return (
              <li key={t.id} className="py-2">
                <Link
                  to={`/tasks/${t.id}`}
                  className="flex items-center gap-3 rounded hover:bg-ink-50 -mx-1 px-1"
                >
                  <Avatar profile={a} size={24} />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium text-ink-900">
                      {t.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
                      {parent && <span className="truncate">{parent.name}</span>}
                      <TaskStatusBadge status={t.status} />
                      <PriorityBadge priority={t.priority} />
                    </div>
                  </div>
                  <div
                    className={`text-xs tabular-nums ${overdue ? "text-rose-700 font-medium" : "text-ink-500"}`}
                  >
                    {formatDate(t.due_date)}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone?: "rose" | "amber" | "emerald";
}) {
  const toneClass =
    tone === "rose"
      ? "text-rose-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "emerald"
          ? "text-emerald-700"
          : "text-ink-900";
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-100 text-ink-700">
        {icon}
      </div>
      <div>
        <div className="text-xs text-ink-500">{label}</div>
        <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
      </div>
    </div>
  );
}
