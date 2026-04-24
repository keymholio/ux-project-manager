import { Plus, Search } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Avatar,
  Button,
  EmptyState,
  LinkList,
  Modal,
  PriorityBadge,
  Spinner,
} from "../components/ui";
import { ProjectCombobox } from "../components/ProjectCombobox";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  fmtTaskId,
  type Priority,
  type Profile,
  type Project,
  type Task,
  type TaskStatus,
} from "../lib/types";

// Same sessionStorage pattern as Projects.tsx — remember the last view so
// sidebar-nav round-trips preserve the user's filters. The key is scoped
// by user id so signing out and signing back in as someone else (same
// tab) doesn't inherit the previous user's filter — otherwise a manager
// signing in after a designer would stick on "Assigned to me" instead of
// getting the role-appropriate "All designers" default.
const filtersKey = (userId?: string) =>
  userId ? `ui:tasks:filters:${userId}` : "ui:tasks:filters:anon";
interface StoredTaskFilters {
  assignee?: string;
  project?: string;
}
const readStoredTaskFilters = (userId?: string): StoredTaskFilters => {
  try {
    const raw = sessionStorage.getItem(filtersKey(userId));
    return raw ? (JSON.parse(raw) as StoredTaskFilters) : {};
  } catch {
    return {};
  }
};
const writeStoredTaskFilters = (f: StoredTaskFilters, userId?: string) => {
  try {
    sessionStorage.setItem(filtersKey(userId), JSON.stringify(f));
  } catch {
    // ignore
  }
};

export default function TaskBoard() {
  const { profile, isManager } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Filters — URL param > sessionStorage > role-aware default.
  // Designers default to "Assigned to me" so the board lands on their own
  // work out of the box. Managers default to "all" since they need the
  // team-wide view. The stored value wins over the default so a designer
  // who explicitly switched to "all" in a previous session keeps that.
  const [assigneeFilter, setAssigneeFilter] = useState<string>(() => {
    const p = params.get("assignee");
    if (p) return p;
    const stored = readStoredTaskFilters(profile?.id).assignee;
    if (stored) return stored;
    return isManager ? "all" : "mine";
  });
  const [projectFilter, setProjectFilter] = useState<string>(() => {
    const p = params.get("project");
    if (p) return p;
    return readStoredTaskFilters(profile?.id).project ?? "all";
  });
  const [query, setQuery] = useState("");

  const refresh = async () => {
    const [tRes, pRes, profRes] = await Promise.all([
      supabase.from("tasks").select("*").order("position", { ascending: true }),
      supabase.from("projects").select("*").order("name"),
      supabase.from("profiles").select("*"),
    ]);
    // Defensive: if migration 007 hasn't been applied yet, `links` is
    // missing from the row. Default to [] so card rendering stays safe.
    setTasks(
      (tRes.data ?? []).map((t) => ({ ...t, links: t.links ?? [] }) as Task),
    );
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

  // Persist filters so they survive navigation (not just back/forward).
  useEffect(() => {
    writeStoredTaskFilters(
      {
        assignee: assigneeFilter,
        project: projectFilter,
      },
      profile?.id,
    );
  }, [assigneeFilter, projectFilter, profile?.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Age-out: once a task has been 'done' for more than 15 days it falls off
    // the board. It's still in the database — just hidden here so the Done
    // column stops growing forever. A null completed_at (optimistic drop not
    // yet confirmed by realtime) is treated as "just finished" so cards don't
    // flash out mid-drag.
    const DONE_TTL_MS = 15 * 24 * 60 * 60 * 1000;
    const now = Date.now();
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
      if (t.status === "done" && t.completed_at) {
        if (now - new Date(t.completed_at).getTime() > DONE_TTL_MS) return false;
      }
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
          {[...profiles]
            .filter((p) => p.id !== profile?.id)
            // Hide deactivated users from the filter dropdown, unless
            // the current selection points at one (so the filter stays
            // valid until the user manually changes it).
            .filter(
              (p) => (p.is_active ?? true) || p.id === assigneeFilter,
            )
            .sort((a, b) => a.full_name.localeCompare(b.full_name))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
                {p.is_active === false ? " (inactive)" : ""}
              </option>
            ))}
        </select>
        <ProjectCombobox
          value={projectFilter}
          onChange={setProjectFilter}
          projects={projects}
          extraOptions={[
            { id: "all", label: "All projects" },
            { id: "none", label: "No project" },
          ]}
          placeholder="All projects"
        />
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
          {/* Column count is derived from TASK_STATUS_ORDER so dropping
              a status (migration 010 removed In review) automatically
              rebalances the grid to fill the viewport instead of leaving
              a gap where the old column used to be. min-w floor ensures
              columns stay usable if the viewport is very narrow. */}
          <div
            className="grid gap-3 h-full min-w-[880px]"
            style={{
              gridTemplateColumns: `repeat(${TASK_STATUS_ORDER.length}, minmax(0, 1fr))`,
            }}
          >
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
          onCreated={(created) => {
            setCreating(false);
            refresh();
            toast(`Task "${created.title}" created`);
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
        <div
          className="text-xs font-semibold uppercase tracking-wide text-ink-600"
          title={
            status === "done"
              ? "Showing tasks completed in the last 15 days."
              : undefined
          }
        >
          {TASK_STATUS_LABEL[status]}
          {status === "done" && (
            <span className="ml-1 font-normal normal-case tracking-normal text-ink-400">
              · last 15 days
            </span>
          )}
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
      {/* Top row: project name (left) + priority (right). Project name
          takes the ID's old slot; the per-tool badges it used to carry
          are gone in favor of a unified links row below. */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-ink-500">
          {project ? project.name : "No project"}
        </span>
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="mt-1.5 text-sm font-medium text-ink-900 line-clamp-3">
        {task.title}
      </div>
      <div className="mt-2">
        <LinkList links={task.links} max={3} />
      </div>
      {/* Bottom row: assignee avatar + first name on the left, task ID
          on the right. Due date used to live here — it's still editable
          in the detail view but we're keeping the card itself lean. */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Avatar profile={assignee} size={22} />
          {assignee && (
            <span className="truncate text-xs text-ink-700">
              {assignee.full_name.split(" ")[0]}
            </span>
          )}
        </div>
        <span
          className={`font-mono text-[10px] tabular-nums ${overdue ? "text-rose-700 font-medium" : "text-ink-400"}`}
          title={overdue ? "Overdue" : undefined}
        >
          {fmtTaskId(task.short_id)}
        </span>
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
  onCreated: (task: Task) => void;
}) {
  const { profile, isManager } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  // Designers can only assign themselves (DB RLS enforces too).
  const [assigneeId, setAssigneeId] = useState<string>(
    isManager ? "" : profile?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !profile) return;
    setBusy(true);
    setErr(null);
    // New tasks land at the top of their column. The board sorts by
    // `position` ascending, so we pick one less than the current minimum
    // for this status. Default position is 0, so the first card we create
    // this way will get -1, the next -2, and so on — leaving room to
    // manually reorder without collisions.
    const { data: topRow } = await supabase
      .from("tasks")
      .select("position")
      .eq("status", status)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    const nextPosition = ((topRow?.position as number | undefined) ?? 0) - 1;

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_date: dueDate || null,
        project_id: projectId || null,
        assignee_id: assigneeId || null,
        created_by: profile.id,
        position: nextPosition,
      })
      .select()
      .single();
    if (error || !data) {
      setErr(error?.message ?? "Failed to create task");
      setBusy(false);
      return;
    }
    onCreated(data);
  };

  // Anyone on the team can be assigned — managers often self-assign work too.
  // New tasks never carry a pre-assigned inactive user, so it's safe to
  // filter the picker down to active teammates here. Existing assignments
  // on already-created tasks are handled separately in TaskDetail.
  const team = [...profiles]
    .filter((p) => p.is_active ?? true)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

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
                {team.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                    {d.role === "manager" ? " (manager)" : ""}
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
