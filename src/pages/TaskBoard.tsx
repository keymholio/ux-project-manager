import { Plus, Search } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Avatar,
  Button,
  EmptyState,
  LinkList,
  PriorityBadge,
  Spinner,
  TaskStatusBadge,
  parseDateLocal,
} from "../components/ui";
import NewTaskModal from "../components/NewTaskModal";
import { ProjectCombobox } from "../components/ProjectCombobox";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  CATEGORY_COLOR,
  TASK_BOARD_COLUMNS,
  TASK_STATUS_LABEL,
  fmtTaskId,
  tasksInColumn,
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
  const { profile, isManager, canWrite } = useAuth();
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
      // The Done column shows both done AND canceled tasks (canceled
      // sits inside the Done column on the board). Both age out on the
      // same weekly cadence, anchored on completed_at — the trigger in
      // migration 014 stamps that field for canceled too.
      if (
        (t.status === "done" || t.status === "canceled") &&
        t.completed_at
      ) {
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
    column: TaskStatus,
    beforeTaskId: string | null,
  ) => {
    if (taskId === beforeTaskId) return; // dropped on self — no-op
    // What status the dropped task should end up with: if it's already
    // in a status that lives inside the target column (e.g. on_hold
    // dragged inside Backlog, or canceled dragged inside Done) we keep
    // its current status — the drag was just a reorder, not a status
    // change. Otherwise the column's primary status wins, which matches
    // the visual: dropping into "In progress" means "set this to
    // in_progress", regardless of where it came from.
    const draggedTask = tasks.find((t) => t.id === taskId);
    const effectiveStatus: TaskStatus =
      draggedTask && tasksInColumn(column, draggedTask.status)
        ? draggedTask.status
        : column;
    // Target column without the dragged card, sorted ascending so
    // neighbor lookups by index line up with visual order. Filter by
    // column membership (tasksInColumn) rather than direct status
    // equality, otherwise on_hold/canceled siblings wouldn't be
    // considered for the midpoint calculation.
    const colTasks = tasks
      .filter((t) => tasksInColumn(column, t.status) && t.id !== taskId)
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
            t.id === taskId
              ? { ...t, status: effectiveStatus, position: newPosition }
              : t,
          )
          .sort((a, b) => a.position - b.position),
      );
      const { error, data } = await supabase
        .from("tasks")
        .update({ status: effectiveStatus, position: newPosition })
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
            // Only the dragged card may flip status here; on_hold /
            // canceled siblings in the same column keep their status
            // because effectiveStatus equals their existing status when
            // they're already in the target column.
            status: t.id === taskId ? effectiveStatus : t.status,
          };
        })
        .sort((a, b) => a.position - b.position),
    );

    const results = await Promise.all(
      renumbered.map((r) => {
        const payload: { position: number; status?: TaskStatus } = {
          position: r.position,
        };
        if (r.id === taskId) payload.status = effectiveStatus;
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
    <div className="p-4 sm:p-6 space-y-4 sm:h-full sm:flex sm:flex-col">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Tasks</h1>
        </div>
        {/* Hidden for viewers — they're read-only. RLS would reject the
            insert anyway, but the affordance shouldn't tease. */}
        {canWrite && (
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setCreating(true)}
          >
            New task
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-ink-400" />
          <input
            className="input pl-8 w-full sm:w-64"
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
            // Hide deactivated users and viewers (read-only role — they
            // can't own tasks) from the filter dropdown, unless the
            // current selection points at one (so the filter stays
            // valid until the user manually changes it).
            .filter(
              (p) =>
                ((p.is_active ?? true) && p.role !== "viewer") ||
                p.id === assigneeFilter,
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
        <div className="overflow-x-auto sm:flex-1">
          {/* Column count comes from TASK_BOARD_COLUMNS — a deliberate
              subset of TASK_STATUS_ORDER. on_hold and canceled aren't
              their own columns; they share Backlog and Done respectively
              (see tasksInColumn helper). Adding/removing column statuses
              there auto-rebalances this grid. min-w floor keeps columns
              usable when the viewport is very narrow. */}
          <div
            className="grid gap-3 sm:h-full min-w-[880px]"
            style={{
              gridTemplateColumns: `repeat(${TASK_BOARD_COLUMNS.length}, minmax(0, 1fr))`,
              // Single row that claims the full grid height. Without an
              // explicit row template, the row sizes to its tallest item
              // (the column with the most cards), the page scrolls
              // instead of the columns, and the column headers scroll
              // out of view with everything else. minmax(0, 1fr) gives
              // each column a definite height to fill, which is what
              // lets the cards container inside scroll independently
              // and keeps the column header locked at the top.
              gridTemplateRows: "minmax(0, 1fr)",
            }}
          >
            {TASK_BOARD_COLUMNS.map((s) => (
              <Column
                key={s}
                status={s}
                tasks={filtered.filter((t) => tasksInColumn(s, t.status))}
                profiles={profiles}
                projects={projects}
                onDrop={onDrop}
                draggable={canWrite}
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
  draggable,
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
  // False for viewers — cards render non-draggable and the column drop
  // handler short-circuits, so the drag affordance never engages.
  draggable: boolean;
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
      } min-w-[200px] min-h-0`}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Column header. flex-shrink-0 keeps it from being squeezed when
          the cards container below grows into available space, so the
          header reads as a fixed strip at the top of the column even as
          the cards scroll independently underneath. */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-200 px-3 py-2">
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
      {/* Scrollable cards container. flex-1 takes the remaining height
          inside the column; min-h-0 is the flex idiom that lets a
          flex item shrink below its content size — without it the
          overflow-y-auto can't kick in because the container would
          rather expand than scroll. */}
      <div className="flex flex-1 flex-col gap-2 p-2 overflow-y-auto min-h-0">
        {tasks.map((t, i) => (
          <TaskCard
            key={t.id}
            task={t}
            profiles={profiles}
            projects={projects}
            draggable={draggable}
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
  draggable,
  onCardDrop,
}: {
  task: Task;
  profiles: Profile[];
  projects: Project[];
  // When false (viewer role), the card renders non-draggable and skips
  // the drop-target wiring. Click-to-navigate still works.
  draggable: boolean;
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
  // True whenever ANY card on the board is being dragged. Used to suppress
  // the per-card hover styling — without this, every card the cursor
  // crosses during a drag flashes a hover border, which reads as "those
  // cards are being highlighted" even though nothing's happening to them.
  const [dragInProgress, setDragInProgress] = useState(false);

  // Document-level drag listeners. Each TaskCard subscribes — when any
  // card starts/ends a drag, every card flips its dragInProgress flag.
  // dragend AND drop both clear local dropIndicator state as a safety net:
  // the dragleave-based clear in handleDragLeave depends on the browser
  // firing dragleave reliably, which it doesn't always do (especially on
  // fast swipes or when the cursor exits the column boundary). Listening
  // to the global drag terminus guarantees nothing stays stuck.
  useEffect(() => {
    const onDragStartAny = () => setDragInProgress(true);
    const onDragEndOrDrop = () => {
      setDragInProgress(false);
      setDropIndicator(null);
    };
    document.addEventListener("dragstart", onDragStartAny);
    document.addEventListener("dragend", onDragEndOrDrop);
    document.addEventListener("drop", onDragEndOrDrop);
    return () => {
      document.removeEventListener("dragstart", onDragStartAny);
      document.removeEventListener("dragend", onDragEndOrDrop);
      document.removeEventListener("drop", onDragEndOrDrop);
    };
  }, []);

  const assignee = profiles.find((p) => p.id === task.assignee_id) ?? null;
  const project = projects.find((p) => p.id === task.project_id) ?? null;
  // "Parked" = a status that shares a column with a different primary
  // (on_hold inside Backlog, canceled inside Done). These cards render
  // dimmed and carry an explicit status chip so they're distinguishable
  // from the column's primary tasks at a glance.
  const isParked = task.status === "on_hold" || task.status === "canceled";
  const overdue =
    task.due_date &&
    task.status !== "done" &&
    task.status !== "canceled" &&
    // parseDateLocal so a "YYYY-MM-DD" string isn't misread as UTC
    // midnight (which would read as the previous day's date in any
    // timezone west of UTC).
    parseDateLocal(task.due_date) < new Date();

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
        draggable={draggable}
        onDragStart={
          draggable
            ? (e) => {
                draggingRef.current = true;
                e.dataTransfer.setData("text/taskId", task.id);
                e.dataTransfer.effectAllowed = "move";
              }
            : undefined
        }
        onDragEnd={
          draggable
            ? () => {
                // Defer so the trailing click fires *after* we read this flag.
                setTimeout(() => {
                  draggingRef.current = false;
                }, 0);
                // Restore focus to the dragged card. HTML5 DnD has inconsistent
                // focus behavior across browsers — Chrome blurs the source at
                // some point during the gesture and post-drop focus typically
                // lands on whatever element the pointer happens to be over
                // (often a neighboring card), not the one we just moved. The
                // node is still mounted and now lives at its new position, so
                // focusing it directly puts the visible focus ring on the
                // card the user actually dropped.
                cardRef.current?.focus({ preventScroll: true });
              }
            : undefined
        }
        onDragOver={draggable ? handleDragOver : undefined}
        onDragLeave={draggable ? handleDragLeave : undefined}
        onDrop={draggable ? handleDrop : undefined}
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
        className={`card p-3 ${
          draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        } block select-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-50 ${
          dragInProgress ? "" : "hover:border-ink-400"
        } ${
          // Parked cards (on_hold / canceled) dim so the eye skips past
          // them when scanning a busy column. Hover lifts back to full
          // opacity so the card reads clearly when the user actually
          // points at it.
          isParked ? "opacity-60 hover:opacity-100" : ""
        }`}
      >
        {/* Top row: status chip for parked tasks + category dot + project
            name (left) + priority (right). Parked statuses (on_hold /
            canceled) get an explicit chip because the column header
            alone doesn't disambiguate them. The category dot mirrors
            the bullet used on the Projects list — same color per
            category — so cards from the same project family read as
            visually grouped at a glance. flex-shrink-0 on the dot keeps
            it round when the project name is long enough to truncate. */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {isParked && <TaskStatusBadge status={task.status} />}
            {project && (
              <span
                className="h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: CATEGORY_COLOR[project.category] }}
                title={project.category.replace(/_/g, " ")}
                aria-hidden
              />
            )}
            <span className="truncate text-xs text-ink-500">
              {project ? project.name : "No project"}
            </span>
          </div>
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
