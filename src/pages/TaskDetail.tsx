import { ArrowLeft, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CommentThread from "../components/CommentThread";
import {
  Avatar,
  Button,
  PriorityBadge,
  Spinner,
  TaskStatusBadge,
  TaskTypeBadge,
  ToolLinks,
  formatDate,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  TASK_TYPE_LABEL,
  type Priority,
  type Profile,
  type Project,
  type Task,
  type TaskStatus,
  type TaskType,
} from "../lib/types";

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile, isManager } = useAuth();

  const [task, setTask] = useState<Task | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    const [tRes, pRes, projRes] = await Promise.all([
      supabase.from("tasks").select("*").eq("id", id).maybeSingle(),
      supabase.from("profiles").select("*"),
      supabase.from("projects").select("*").order("name"),
    ]);
    if (tRes.error) setErr(tRes.error.message);
    setTask(tRes.data ?? null);
    setProfiles(pRes.data ?? []);
    setProjects(projRes.data ?? []);
  };

  useEffect(() => {
    load();
    if (!id) return;
    const channel = supabase
      .channel(`task-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canEdit = isManager || task?.assignee_id === profile?.id;

  const updateField = async <K extends keyof Task>(field: K, value: Task[K]) => {
    if (!task || !canEdit) return;
    // Apply the change locally right away so controlled inputs stay in sync
    // with the user's choice. Without this, React re-renders the <select>
    // with the old state value and it appears to snap back — the realtime
    // subscription would eventually correct it, but only if realtime is on
    // for the tasks table and only after a round-trip.
    const prev = task;
    setTask({ ...task, [field]: value });
    const { error } = await supabase
      .from("tasks")
      .update({ [field]: value })
      .eq("id", task.id);
    if (error) {
      // Roll back the optimistic change and show the error.
      setTask(prev);
      setErr(error.message);
    }
  };

  const deleteTask = async () => {
    if (!task) return;
    if (!confirm(`Delete "${task.title}"?`)) return;
    const { error } = await supabase.from("tasks").delete().eq("id", task.id);
    if (error) {
      alert(error.message);
      return;
    }
    nav("/tasks");
  };

  if (!task && !err)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (err) return <div className="p-6 text-rose-700">Error: {err}</div>;
  if (!task) return <div className="p-6">Task not found.</div>;

  const assignee = profiles.find((p) => p.id === task.assignee_id) ?? null;
  // Managers can also own tasks, so the assignee picker includes everyone.
  const team = [...profiles].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  );

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <Link
          to="/tasks"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Back to board
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <TaskTypeBadge type={task.task_type} />
            <PriorityBadge priority={task.priority} />
            <TaskStatusBadge status={task.status} />
          </div>
          {canEdit ? (
            <input
              className="mt-2 w-full bg-transparent text-2xl font-semibold text-ink-900 focus:outline-none focus:bg-white rounded px-1 -mx-1"
              value={task.title}
              onChange={(e) => setTask({ ...task, title: e.target.value })}
              onBlur={(e) => updateField("title", e.target.value)}
            />
          ) : (
            <h1 className="mt-2 text-2xl font-semibold text-ink-900">{task.title}</h1>
          )}
        </div>
        {isManager && (
          <Button
            onClick={deleteTask}
            icon={<Trash2 size={14} />}
            className="text-rose-700 hover:bg-rose-50"
          >
            Delete
          </Button>
        )}
      </header>

      {/* Meta strip */}
      <section className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Meta label="Status">
          {canEdit ? (
            <select
              className="input"
              value={task.status}
              onChange={(e) => updateField("status", e.target.value as TaskStatus)}
            >
              {TASK_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            <TaskStatusBadge status={task.status} />
          )}
        </Meta>
        <Meta label="Assignee">
          {isManager ? (
            <select
              className="input"
              value={task.assignee_id ?? ""}
              onChange={(e) => updateField("assignee_id", e.target.value || null)}
            >
              <option value="">— Unassigned —</option>
              {team.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                  {d.role === "manager" ? " (manager)" : ""}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <Avatar profile={assignee} size={22} />
              <span className="text-sm text-ink-900">
                {assignee?.full_name ?? "Unassigned"}
              </span>
            </div>
          )}
        </Meta>
        <Meta label="Due date">
          {canEdit ? (
            <input
              className="input"
              type="date"
              value={task.due_date ?? ""}
              onChange={(e) => updateField("due_date", e.target.value || null)}
            />
          ) : (
            <span className="text-sm text-ink-900">{formatDate(task.due_date)}</span>
          )}
        </Meta>
        <Meta label="Priority">
          {canEdit ? (
            <select
              className="input"
              value={task.priority}
              onChange={(e) => updateField("priority", e.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          ) : (
            <PriorityBadge priority={task.priority} />
          )}
        </Meta>
        <Meta label="Type">
          {canEdit ? (
            <select
              className="input"
              value={task.task_type}
              onChange={(e) => updateField("task_type", e.target.value as TaskType)}
            >
              {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          ) : (
            <TaskTypeBadge type={task.task_type} />
          )}
        </Meta>
        <Meta label="Project">
          {isManager ? (
            <select
              className="input"
              value={task.project_id ?? ""}
              onChange={(e) => updateField("project_id", e.target.value || null)}
            >
              <option value="">— No project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : task.project_id ? (
            <Link
              to={`/projects/${task.project_id}`}
              className="text-sm text-brand-700 hover:underline"
            >
              {projects.find((p) => p.id === task.project_id)?.name ?? "—"}
            </Link>
          ) : (
            <span className="text-sm text-ink-500">—</span>
          )}
        </Meta>
      </section>

      {/* Description */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Description</h2>
        {canEdit ? (
          <textarea
            className="input"
            rows={4}
            value={task.description ?? ""}
            onChange={(e) => setTask({ ...task, description: e.target.value })}
            onBlur={(e) => updateField("description", e.target.value || null)}
            placeholder="Context, acceptance criteria, links"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-ink-700">
            {task.description ?? "—"}
          </p>
        )}
      </section>

      {/* Links */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Links</h2>
        {canEdit ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(["figma_url", "workfront_url", "jira_url", "figjam_url"] as const).map(
              (f) => (
                <label key={f} className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-600">
                    {
                      { figma_url: "Figma", workfront_url: "Workfront", jira_url: "Jira", figjam_url: "FigJam" }[f]
                    }
                  </span>
                  <input
                    className="input"
                    value={task[f] ?? ""}
                    onChange={(e) =>
                      setTask({ ...task, [f]: e.target.value })
                    }
                    onBlur={(e) => updateField(f, e.target.value || null)}
                    placeholder="https://…"
                  />
                </label>
              ),
            )}
          </div>
        ) : (
          <ToolLinks
            figma={task.figma_url}
            workfront={task.workfront_url}
            jira={task.jira_url}
            figjam={task.figjam_url}
          />
        )}
      </section>

      <CommentThread taskId={task.id} />
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-500">{label}</div>
      {children}
    </div>
  );
}
