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
    // Done column only shows tasks completed during the current work week
    // (Monday 00:00 → now, local time). Older completed tasks remain in the
    // DB but are hidden from the board so the column doesn't grow forever.
    // A null completed_at on a 'done' row (optimistic drop not yet confirmed
    // by realtime) is treated as "just finished" so cards don't flash out
    // mid-drag.
    const startOfWeekMs = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      // getDay(): Sunday=0, Monday=1, ... Saturday=6. Back up to Monday —
      // Sunday wraps to 6 days back so Sun work still lands in "this week"
      // rather than snapping forward to the next Monday.
      const dow = d.getDay();
      d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
      return d.getTime();
    })();
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
        if (new Date(t.completed_at).getTime() < startOfWeekMs) return false;
      }
      return true;
    });
  }, [tasks, assigneeFilter, projectFilter, query, profile?.id]);

  // Drag-and-drop handler. `beforeTaskId` is the card the dropped task
  // should be inserted above — null means "append to the end of the
  // column". Position is recalculated so a drag can both change status
  // (cross-column move) and reorder within a column; the board sorts by
  // position ascending, so a smaller number lands earlier in the column.
  //
  // We try a fast single-row UPDATE first (midpoint between neighbors).
  // If that would collide with a neighbor — because neighbors share a
  // position (pre-DnD seed data where every row sat at the integer
  // default of 0) or because many insertions have exhausted floating
  // point precision at the same slot — we fall back to renumbering the
  // whole column with a wide stride so future drops land on the fast
  // path again. Requires migration 011 (tasks.position → double
  // precision); integer columns would truncate midpoints.
  const onDrop = async (
    taskId: string,
    status: TaskStatus,
    beforeTaskId: string | null,
  ) => {
    if (taskId === beforeTaskId) return; // dropped on self — no-op
    // Target column without the dragged card, sorted ascending so
    // neighbor lookups by index line up with visual order.
    const colTasks = tasks
      .filter((t) => t.status === status && t.id !== taskId)
      .sort((a, b) => a.position - b.position);
    // Where in the target column the dragged card should land. A missing
    // beforeTaskId (or one that vanished mid-drag) falls back to
    // appending at the end.
    let insertionIdx: number;
    if (beforeTaskId === null) {
      insertionIdx = colTasks.length;
    } else {
      const found = colTasks.findIndex((t) => t.id === beforeTaskId);
      insertionIdx = found === -1 ? colTasks.length : found;
    }
    const above = colTasks[insertionIdx - 1];
    const below = colTasks[insertionIdx];

    // Fast path: compute a position that slots strictly between neighbors.
    // `null` here means "couldn't find a clean spot — need to renumber".
    let fastPosition: number | null = null;
    if (!above && !below) {
      fastPosition = 0; // empty column
    } else if (!above && below) {
      fastPosition = below.position - 1; // insert at top
    } else if (above && !below) {
      fastPosition = above.position + 1; // append at bottom
    } else if (above && below) {
      const mid = (above.position + below.position) / 2;
      // Strictly between — if the neighbors are tied (both 0, say) or
      // precision has collapsed the midpoint onto one of them, skip the
      // fast path and renumber.
      if (mid > above.position && mid < below.position) {
        fastPosition = mid;
      }
    }

    if (fastPosition !== null) {
      const newPosition = fastPosition;
      setTasks((prev) =>
        [...prev]
          .map((t) =>
            t.id === taskId ? { ...t, status, position: newPosition } : t,
          )
          .sort((a, b) => a.position - b.position),
      );
      const { error, data } = await supabase
        .from("tasks")
        .update({ status, position: newPosition })
        .eq("id", taskId)
        .select();
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to move task:", error.message);
        refresh();
        return;
      }
      // Empty data means RLS silently blocked the update (designer
      // dragging someone else's task) — roll back the optimistic change.
      if (!data || data.length === 0) refresh();
      return;
    }

    // Slow path: renumber the column with a wide stride. This happens
    // rarely — typically once per column the first time a user reorders
    // into a group of tied seed-data positions. After renumbering, every
    // card has a unique position with 1000-unit gaps between neighbors,
    // so ~50 subsequent midpoint insertions fit before we'd need to
    // renumber again.
    //
    // RLS note: designers can only update tasks they own, so if the
    // column contains teammate cards tied at the same seed position, the
    // renumber will succeed only for the designer's own rows. The
    // dragged card's final resting spot can drift as a result — we'll
    // refresh from the server and let realtime reconcile. In practice
    // managers are the ones triggering this path, and for them all
    // UPDATEs succeed.
    const draggedTask = tasks.find((t) => t.id === taskId);
    if (!draggedTask) return;
    const ordered = [...colTasks];
    ordered.splice(insertionIdx, 0, draggedTask);
    const STEP = 1000;
    const renumbered = ordered.map((t, i) => ({
      id: t.id,
      position: (i + 1) * STEP,
    }));
    const newPositionById = new Map(renumbered.map((r) => [r.id, r.position]));

    setTasks((prev) =>
      [...prev]
        .map((t) => {
          const p = newPositionById.get(t.id);
          if (p === undefined) return t;
          return {
            ...t,
            position: p,
            status: t.id === taskId ? status : t.status,
          };
        })
        .sort((a, b) => a.position - b.position),
    );

    const results = await Promise.all(
      renumbered.map((r) => {
        const payload: { position: number; status?: TaskStatus } = {
          position: r.position,
        };
        if (r.id === taskId) payload.status = status;
        return supabase.from("tasks").update(payload).eq("id", r.id).select();
      }),
    );
    const anyBlocked = results.some(
      (r) => r.error || !r.data || r.data.length === 0,
    );
    if (anyBlocked) {
      // eslint-disable-next-line no-console
      console.warn(
        "Some rows could not be renumbered (likely RLS). Refreshing.",
      );
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
  onDrop: (
    taskId: string,
    status: TaskStatus,
    beforeTaskId: string | null,
  ) => void;
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
    // Dropping on the column background (not on a card) appends to the
    // end — cards handle their own drops and stop propagation, so this
    // path only fires for empty space / below the last card.
    if (id) onDrop(id, status, null);
  };

  return (
    <div
      className={`flex flex-col rounded-lg border ${
        dragOver
          ? "border-brand-500 bg-brand-50/50 dark:bg-brand-500/10"
          : "border-ink-200 bg-surface/60"
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
              ? "Showing tasks completed this week (since Monday)."
              : undefined
          }
        >
          {TASK_STATUS_LABEL[status]}
          {status === "done" && (
            <span className="ml-1 font-normal normal-case tracking-normal text-ink-400">
              · this week
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-ink-500">{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2 p-2 overflow-y-auto">
        {tasks.map((t, i) => (
          <TaskCard
            key={t.id}
            task={t}
            profiles={profiles}
            projects={projects}
            onCardDrop={(draggedId, placement) => {
              // 'before' keeps this card as the anchor; 'after' anchors
              // on the next sibling (or null for the last card, meaning
              // "append to the end of the column").
              const beforeTaskId =
                placement === "before" ? t.id : (tasks[i + 1]?.id ?? null);
              onDrop(draggedId, status, beforeTaskId);
            }}
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
  onCardDrop,
}: {
  task: Task;
  profiles: Profile[];
  projects: Project[];
  onCardDrop: (draggedId: string, placement: "before" | "after") => void;
}) {
  const navigate = useNavigate();
  // We track whether a drag just occurred so the mouseup-triggered click
  // doesn't accidentally navigate to the task detail page after a drop.
  const draggingRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Visual-only state: shows a brand-colored line above or below the card
  // while another card is being dragged over it. Placement is recomputed
  // from clientY at drop time so we don't rely on this state being fresh.
  const [dropIndicator, setDropIndicator] = useState<
    "before" | "after" | null
  >(null);

  const assignee = profiles.find((p) => p.id === task.assignee_id) ?? null;
  const project = projects.find((p) => p.id === task.project_id) ?? null;
  const overdue =
    task.due_date &&
    task.status !== "done" &&
    new Date(task.due_date) < new Date();

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    // Preventing default marks this as a valid drop target; stopping
    // propagation keeps the column's "empty-space append" handler from
    // firing in parallel — otherwise the drop would both insert here AND
    // append at the end of the column.
    e.preventDefault();
    e.stopPropagation();
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const midpoint = rect.top + rect.height / 2;
    const next: "before" | "after" = e.clientY < midpoint ? "before" : "after";
    if (next !== dropIndicator) setDropIndicator(next);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // onDragLeave also fires when the cursor enters a descendant element
    // (because the underlying dragleave targets the direct hit element
    // and bubbles). Guard against that by checking whether the
    // relatedTarget is still inside this card — if so, we're not really
    // leaving, we're just over a child like the priority badge.
    const related = e.relatedTarget as Node | null;
    if (related && cardRef.current?.contains(related)) return;
    setDropIndicator(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDropIndicator(null);
    const draggedId = e.dataTransfer.getData("text/taskId");
    if (!draggedId) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Re-derive placement from clientY rather than trusting the state —
    // React may not have flushed the last onDragOver's setState by the
    // time the drop lands, especially on a fast swipe.
    const placement: "before" | "after" =
      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    onCardDrop(draggedId, placement);
  };

  return (
    <div className="relative">
      {/* Drop indicators live in the 8px gap between cards (gap-2 on the
          column). `-top-1` / `-bottom-1` centers the 2px line in that gap.
          pointer-events-none keeps them from stealing drop events from
          the card beneath. */}
      {dropIndicator === "before" && (
        <div className="pointer-events-none absolute inset-x-0 -top-1 h-0.5 rounded bg-brand-500" />
      )}
      {dropIndicator === "after" && (
        <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-0.5 rounded bg-brand-500" />
      )}
      <div
        ref={cardRef}
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
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
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
          <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
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
