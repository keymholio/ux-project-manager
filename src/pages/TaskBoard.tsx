import { Plus, Search } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Avatar,
  Button,
  EmptyState,
  Modal,
  PriorityBadge,
  Spinner,
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

export default function TaskBoard() {
  const { profile, isManager } = useAuth();
  const [params, setParams] = useSearchParams();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Filters — defaults are sensible for each role.
  const [assigneeFilter, setAssigneeFilter] = useState<string>(
    () => params.get("assignee") ?? (isManager ? "all" : profile?.id ?? "all"),
  );
  const [projectFilter, setProjectFilter] = useState<string>(
    () => params.get("project") ?? "all",
  );
  const [query, setQuery] = useState("");

  const refresh = async () => {
    const [tRes, pRes, profRes] = await Promise.all([
      supabase.from("tasks").select("*").order("position", { ascending: true }),
      supabase.from("projects").select("*").order("name"),
      supabase.from("profiles").select("*"),
    ]);
    setTasks(tRes.data ?? []);
    setProjects(pRes.data ?? []);
    setProfiles(profRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const ch = supabase
      .channel("tasks-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    const next = new URLSearchParams(params);
    assigneeFilter === "all" ? next.delete("assignee") : next.set("assignee", assigneeFilter);
    projectFilter === "all" ? next.delete("project") : next.set("project", projectFilter);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigneeFilter, projectFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (assigneeFilter === "mine") {
        if (t.assignee_id !== profile?.id) return false;
      } else if (assigneeFilter === "unassigned") {
        if (t.assignee_id !== null) return false;
      } else if (assigneeFilter !== "all") {
        if (t.assignee_id !== assigneeFilter) return false;
      }
      if (projectFilter !== "all") {
        if (projectFilter === "none") {
          if (t.project_id !== null) return false;
        } else if (t.project_id !== projectFilter) return false;
      }
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, assigneeFilter, projectFilter, query, profile?.id]);

  const onDrop = async (taskId: string, status: TaskStatus) => {
    // Optimistically move the card so the UI feels responsive — the realtime
    // subscription will confirm (or correct) shortly.
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t)),
    );
    const { error, data } = await supabase
      .from("tasks")
      .update({ status })
      .eq("id", taskId)
      .select();
    if (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to move task:", error.message);
      refresh();
      return;
    }
    // If RLS silently blocked the update (designer dragging someone else's
    // task), the response will be an empty array — roll back the optimistic
    // change.
    if (!data || data.length === 0) {
      refresh();
    }
  };

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Tasks</h1>
          <p className="text-sm text-ink-500">
            Drag a card between columns to update its status.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => setCreating(true)}
        >
          New task
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-ink-400" />
          <input
            className="input pl-8 w-64"
            placeholder="Search tasks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="all">All designers</option>
          <option value="mine">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {profiles
            .filter((p) => p.role === "designer")
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
        </select>
        <select
          className="input w-auto"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="all">All projects</option>
          <option value="none">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No tasks here yet"
          hint={
            isManager
              ? "Create a task to get started, or clear your filters."
              : "Ask your manager to assign tasks, or create one yourself."
          }
        />
      ) : (
        <div className="flex-1 overflow-x-auto">
          <div className="grid grid-cols-5 gap-3 min-w-[1100px] h-full">
            {TASK_STATUS_ORDER.map((s) => (
              <Column
                key={s}
                status={s}
                tasks={filtered.filter((t) => t.status === s)}
                profiles={profiles}
                projects={projects}
                onDrop={onDrop}
              />
            ))}
          </div>
        </div>
      )}

      {creating && (
        <NewTaskModal
          projects={projects}
          profiles={profiles}
          defaultProjectId={projectFilter !== "all" && projectFilter !== "none" ? projectFilter : null}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Column
// -----------------------------------------------------------------------------
function Column({
  status,
  tasks,
  profiles,
  projects,
  onDrop,
}: {
  status: TaskStatus;
  tasks: Task[];
  profiles: Profile[];
  projects: Project[];
  onDrop: (taskId: string, status: TaskStatus) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData("text/taskId");
    if (id) onDrop(id, status);
  };

  return (
    <div
      className={`flex flex-col rounded-lg border ${
        dragOver ? "border-brand-500 bg-brand-50/50" : "border-ink-200 bg-white/60"
      } min-w-[200px]`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-600">
          {TASK_STATUS_LABEL[status]}
        </div>
        <span className="text-xs font-medium text-ink-500">{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 overflow-y-auto">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            profiles={profiles}
            projects={projects}
          />
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// TaskCard
// -----------------------------------------------------------------------------
function TaskCard({
  task,
  profiles,
  projects,
}: {
  task: Task;
  profiles: Profile[];
  projects: Project[];
}) {
  const navigate = useNavigate();
  // We track whether a drag just occurred so the mouseup-triggered click
  // doesn't accidentally navigate to the task detail page after a drop.
  const draggingRef = useRef(false);

  const assignee = profiles.find((p) => p.id === task.assignee_id) ?? null;
  const project = projects.find((p) => p.id === task.project_id) ?? null;
  const overdue =
    task.due_date &&
    task.status !== "done" &&
    new Date(task.due_date) < new Date();

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        draggingRef.current = true;
        e.dataTransfer.setData("text/taskId", task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        // Defer so the trailing click fires *after* we read this flag.
        setTimeout(() => {
          draggingRef.current = false;
        }, 0);
      }}
      onClick={() => {
        if (draggingRef.current) return;
        navigate(`/tasks/${task.id}`);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/tasks/${task.id}`);
        }
      }}
      className="card p-3 hover:border-brand-500 cursor-grab active:cursor-grabbing block select-none"
    >
      <div className="flex items-start justify-between gap-2">
        <TaskTypeBadge type={task.task_type} />
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="mt-1.5 text-sm font-medium text-ink-900 line-clamp-3">
        {task.title}
      </div>
      {project && (
        <div className="mt-1 truncate text-xs text-ink-500">
          {project.name}
        </div>
      )}
      <div className="mt-2">
        <ToolLinks
          figma={task.figma_url}
          workfront={task.workfront_url}
          jira={task.jira_url}
          figjam={task.figjam_url}
        />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Avatar profile={assignee} size={22} />
        <div
          className={`text-xs tabular-nums ${overdue ? "text-rose-700 font-medium" : "text-ink-500"}`}
        >
          {formatDate(task.due_date)}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// NewTaskModal
// -----------------------------------------------------------------------------
function NewTaskModal({
  projects,
  profiles,
  defaultProjectId,
  onClose,
  onCreated,
}: {
  projects: Project[];
  profiles: Profile[];
  defaultProjectId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { profile, isManager } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("design");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  // Designers can only assign themselves (DB RLS enforces too).
  const [assigneeId, setAssigneeId] = useState<string>(
    isManager ? "" : profile?.id ?? "",
  );
  const [figmaUrl, setFigmaUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !profile) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("tasks").insert({
      title: title.trim(),
      description: description.trim() || null,
      task_type: taskType,
      status,
      priority,
      due_date: dueDate || null,
      project_id: projectId || null,
      assignee_id: assigneeId || null,
      figma_url: figmaUrl.trim() || null,
      created_by: profile.id,
    });
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }
    onCreated();
  };

  const designers = profiles.filter((p) => p.role === "designer");

  return (
    <Modal open title="New task" onClose={onClose} wide>
      <div className="space-y-3">
        <Field label="Title">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. [DESIGN] Nuvance Norwalk PCI"
          />
        </Field>
        <Field label="Description">
          <textarea
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select
              className="input"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as TaskType)}
            >
              {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {TASK_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <Field label="Project">
            <select
              className="input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">— No project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assignee">
            {isManager ? (
              <select
                className="input"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">— Unassigned —</option>
                {designers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="input bg-ink-50 text-ink-600">
                {profile?.full_name} (you)
              </div>
            )}
          </Field>
        </div>
        <Field label="Figma URL">
          <input
            className="input"
            value={figmaUrl}
            onChange={(e) => setFigmaUrl(e.target.value)}
            placeholder="https://figma.com/…"
          />
        </Field>
        {err && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !title.trim()}>
            {busy ? <Spinner /> : "Create task"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </span>
      {children}
    </label>
  );
}
