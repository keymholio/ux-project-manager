import {
  Check,
  ExternalLink,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CommentThread from "../components/CommentThread";
import { ProjectCombobox } from "../components/ProjectCombobox";
import {
  Avatar,
  Breadcrumbs,
  Button,
  LinkList,
  PriorityBadge,
  Spinner,
  TaskStatusBadge,
  formatDate,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  LINK_TYPES,
  LINK_TYPE_LABEL,
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  fmtProjectId,
  fmtTaskId,
  type Priority,
  type Profile,
  type Project,
  type ProjectLink,
  type Task,
  type TaskStatus,
} from "../lib/types";

// Quick sanity check before rendering a URL as a clickable link —
// same helper as on ProjectDetail. Keeps relative paths and javascript:
// URLs from masquerading as external links.
const isLikelyUrl = (s: string): boolean => {
  const t = s.trim();
  return /^(https?:\/\/|\/\/)/i.test(t);
};

// A blank row for the links editor. Defaults to "figma" because that's
// the overwhelming majority of what the team pastes in; the type
// dropdown still lets them pick something else before adding the URL.
const emptyLink = (): ProjectLink => ({ type: "figma", url: "" });

// Strip empty rows and trim whitespace before persisting. The cleaned
// result is what we compare against the server snapshot for isDirty.
// Tolerant of null/undefined so pre-migration rows don't crash here.
// `title` is optional — when blank we omit the key entirely so the diff
// doesn't flip to dirty just because the row rendered once.
const cleanLinks = (links: ProjectLink[] | null | undefined): ProjectLink[] =>
  (links ?? [])
    .map((l) => {
      const title = l.title?.trim();
      const cleaned: ProjectLink = { type: l.type, url: l.url.trim() };
      if (title) cleaned.title = title;
      return cleaned;
    })
    .filter((l) => l.url);

// Fields the user can edit on a task. Used for draft ↔ server diffing and
// for building the UPDATE payload on save. Server-managed fields (id,
// created_at, updated_at, created_by) are intentionally excluded.
// `links` is an array so referential-equality diffing doesn't work — we
// handle it separately in isDirty/save below. The legacy figma_url /
// workfront_url / jira_url / figjam_url columns still exist on the row
// but are no longer exposed as editable fields; their values were folded
// into `links` by migration 007. `task_type` is likewise still on the
// row (the DB column has a default), but no longer edited from the UI.
const EDITABLE_FIELDS = [
  "title",
  "description",
  "status",
  "assignee_id",
  "due_date",
  "priority",
  "project_id",
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  // canWrite gates the Edit / Delete affordances. RLS (migration 016)
  // also enforces the same rule, but the UI shouldn't tease viewers
  // with buttons that would silently fail.
  const { canWrite } = useAuth();

  // Server snapshot — what the DB last told us.
  const [task, setTask] = useState<Task | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Working copy for the user's edits. Bound to every editable input so
  // controlled selects stay on the value the user just picked, instead of
  // snapping back to the server state on re-render.
  const [draft, setDraft] = useState<Task | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Drag-to-reorder state for the Links editor. Same pattern used in
  // ProjectDetail: dragIdx is the row the user grabbed, overIdx is the
  // slot an insert cursor would target if they released right now.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Tracks which task id the draft was seeded from so realtime updates
  // don't overwrite in-progress edits on their way in.
  const initedForIdRef = useRef<string | null>(null);
  // Anchored to the Project Meta below so the "Add project" breadcrumb
  // has a target to scroll into view.
  const projectFieldRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    if (!id) return;
    const [tRes, pRes, projRes] = await Promise.all([
      supabase.from("tasks").select("*").eq("id", id).maybeSingle(),
      supabase.from("profiles").select("*"),
      supabase.from("projects").select("*").order("name"),
    ]);
    if (tRes.error) setErr(tRes.error.message);
    // Defensive: if migration 007 hasn't been applied yet, `links` will be
    // missing from the row. Normalize to an empty array so the editor
    // doesn't blow up on `.map`.
    const normalized = tRes.data
      ? ({ ...tRes.data, links: tRes.data.links ?? [] } as Task)
      : null;
    setTask(normalized);
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

  // Seed the draft once per task id.
  useEffect(() => {
    if (!task) return;
    if (initedForIdRef.current === task.id) return;
    initedForIdRef.current = task.id;
    setDraft(task);
  }, [task]);

  // Edit gating used to be `isManager || assignee_id === profile.id`,
  // then "true for any signed-in user" after migration 012. Migration
  // 016 introduced the read-only viewer role, so it's now gated on
  // canWrite — managers and designers edit; viewers don't.
  const canEdit = canWrite;

  // View vs edit mode. Default to view so the page reads as a record on
  // first paint instead of a form, especially on mobile. Toggling to
  // edit re-seeds the draft from the latest server snapshot so realtime
  // updates that arrived while in view mode aren't shadowed by a stale
  // draft.
  const [mode, setMode] = useState<"view" | "edit">("view");
  const isEditing = canEdit && mode === "edit";

  const enterEditMode = () => {
    if (!task) return;
    setDraft(task);
    setErr(null);
    setSavedAt(null);
    setMode("edit");
  };

  const exitEditMode = () => {
    // isDirty is defined below in this component — the forward reference
    // is fine because exitEditMode is a closure that resolves bindings at
    // call time. Prompts only when the user has actual changes to lose.
    if (isDirty && !confirm("Discard unsaved changes?")) return;
    if (task) setDraft(task);
    setErr(null);
    setSavedAt(null);
    setMode("view");
  };

  const isDirty = useMemo(() => {
    if (!draft || !task) return false;
    for (const key of EDITABLE_FIELDS) {
      if (draft[key] !== task[key]) return true;
    }
    // Order-dependent JSON comparison — reordering counts as a change.
    // Run BOTH sides through cleanLinks so the diff isn't driven by
    // server-side artifacts (stale `title: ""` / `title: null` from older
    // rows, or differing key insertion order from PostgREST). Without
    // this normalization, pristine tasks load as already-dirty.
    if (
      JSON.stringify(cleanLinks(draft.links)) !==
      JSON.stringify(cleanLinks(task.links))
    )
      return true;
    return false;
  }, [draft, task]);

  // Warn on tab close / reload if there are unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(t);
  }, [savedAt]);

  const setField = <K extends EditableField>(field: K, value: Task[K]) => {
    if (!draft || !isEditing) return;
    setDraft({ ...draft, [field]: value });
    setSavedAt(null);
  };

  // --- Links editor helpers --------------------------------------------------
  const updateLink = (i: number, patch: Partial<ProjectLink>) => {
    if (!draft) return;
    const next = [...draft.links];
    next[i] = { ...next[i], ...patch };
    setDraft({ ...draft, links: next });
    setSavedAt(null);
  };
  const addLink = () => {
    if (!draft) return;
    setDraft({ ...draft, links: [...draft.links, emptyLink()] });
    setSavedAt(null);
  };
  const removeLink = (i: number) => {
    if (!draft) return;
    const next = draft.links.filter((_, idx) => idx !== i);
    setDraft({ ...draft, links: next });
    setSavedAt(null);
  };
  // Reorder using "insert-before-target" semantics. See the same helper
  // on ProjectDetail for the derivation.
  const moveLink = (from: number, to: number) => {
    if (!draft) return;
    if (from === to || from + 1 === to) return;
    const next = [...draft.links];
    const [moved] = next.splice(from, 1);
    const target = from < to ? to - 1 : to;
    next.splice(target, 0, moved);
    setDraft({ ...draft, links: next });
    setSavedAt(null);
  };

  const save = async () => {
    if (!draft || !task || !isDirty) return;
    setSaving(true);
    setErr(null);
    const diff: Partial<Task> = {};
    for (const key of EDITABLE_FIELDS) {
      if (draft[key] !== task[key]) {
        (diff as Record<string, unknown>)[key] = draft[key];
      }
    }
    const cleanedLinks = cleanLinks(draft.links);
    if (JSON.stringify(cleanedLinks) !== JSON.stringify(task.links)) {
      diff.links = cleanedLinks;
    }
    const { error } = await supabase
      .from("tasks")
      .update(diff)
      .eq("id", task.id);
    if (error) {
      setErr(error.message);
      setSaving(false);
      return;
    }
    // Adopt the draft as the new server snapshot so isDirty flips off
    // without waiting for the realtime echo.
    setTask({ ...task, ...diff } as Task);
    // Fold the cleaned links back into the draft so empty rows the user
    // left behind get swept out on save.
    setDraft({ ...draft, ...diff, links: cleanedLinks } as Task);
    setSaving(false);
    setSavedAt(Date.now());
    // A successful save returns the page to view mode — the user has
    // committed; further edits require explicitly entering edit mode
    // again. Keeps the post-save state matching what the rest of the
    // team will see.
    setMode("view");
  };

  const discard = () => {
    if (!task || !isDirty) return;
    if (!confirm("Discard unsaved changes?")) return;
    setDraft(task);
    setErr(null);
    setSavedAt(null);
    setMode("view");
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
  if (err && !task) return <div className="p-6 text-rose-700">Error: {err}</div>;
  if (!task || !draft) return <div className="p-6">Task not found.</div>;

  const assignee = profiles.find((p) => p.id === draft.assignee_id) ?? null;
  // Managers can also own tasks, so the assignee picker includes everyone.
  // Inactive teammates drop out of the picker unless they're currently the
  // assignee — keep the existing assignment visible so a manager can see
  // (and reassign) it, but don't let anyone be freshly assigned to someone
  // who's been deactivated.
  const team = [...profiles]
    .filter(
      (p) =>
        // Viewers (read-only role) can't own tasks. Keep an existing
        // viewer assignee visible if the row somehow already references
        // one (defensive: shouldn't happen via the UI), so a manager
        // can see and reassign it. Same exception applied to
        // deactivated users.
        ((p.is_active ?? true) && p.role !== "viewer") ||
        p.id === draft.assignee_id,
    )
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  // Scroll the Project field into view and try to focus the combobox input.
  // Used when a task has no project and the user clicks the "Add project"
  // crumb in the breadcrumb — it gives them a direct path from that pointer
  // down to the field they need to fill in. Enters edit mode first if
  // we're in view mode, since the combobox only renders while editing;
  // the setTimeout(0) defers the focus call until after React commits the
  // edit-mode JSX so the input element actually exists when we look it up.
  const focusProjectField = () => {
    if (mode !== "edit") enterEditMode();
    setTimeout(() => {
      const el = projectFieldRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = el.querySelector<HTMLInputElement>(
        'input[role="combobox"], input',
      );
      input?.focus();
    }, 0);
  };

  const projectForTask = draft.project_id
    ? projects.find((p) => p.id === draft.project_id) ?? null
    : null;

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-5">
      <Breadcrumbs
        items={[
          { label: "Tasks", to: "/tasks" },
          projectForTask
            ? {
                label: fmtProjectId(projectForTask.short_id),
                to: `/projects/${projectForTask.id}`,
              }
            : canEdit
              ? {
                  label: "Add project",
                  onClick: focusProjectField,
                  accent: true,
                }
              : { label: "No project" },
          { label: fmtTaskId(task.short_id), current: true },
        ]}
      />

      <header className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <PriorityBadge priority={draft.priority} />
            <TaskStatusBadge status={draft.status} />
          </div>
          {isEditing ? (
            <input
              className="mt-2 w-full bg-transparent text-2xl font-semibold text-ink-900 focus:outline-none focus:bg-surface rounded px-1 -mx-1"
              value={draft.title}
              onChange={(e) => setField("title", e.target.value)}
            />
          ) : (
            <h1 className="mt-2 text-2xl font-semibold text-ink-900">{draft.title}</h1>
          )}
        </div>
        {/* Header-level action cluster:
            - View mode: Edit button (primary entry into edit mode) +
              Delete (manager-only).
            - Edit mode: Cancel + Save (via HeaderSaveControls) + Delete.
            Keeping the same physical slot avoids layout shift between
            modes; just the contents swap. */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {mode === "view" && canEdit && (
            <Button
              variant="primary"
              icon={<Pencil size={14} />}
              onClick={enterEditMode}
            >
              Edit
            </Button>
          )}
          {mode === "edit" && (
            <>
              <Button onClick={exitEditMode} disabled={saving}>
                Cancel
              </Button>
              <HeaderSaveControls
                isDirty={isDirty}
                saving={saving}
                savedAt={savedAt}
                onSave={save}
                onDiscard={discard}
              />
            </>
          )}
          {/* "Saved" confirmation surfaces in view mode too — the user
              just got bounced back here from a successful save and we
              want them to see the green tick before it fades. */}
          {mode === "view" && savedAt && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <Check size={14} />
              Saved
            </span>
          )}
          {/* Delete is open to anyone authenticated since migration 015
              — designers can clean up tasks too, not just managers. RLS
              still enforces this on the write side, and viewers (read-
              only role) don't see the button at all. */}
          {canWrite && (
            <Button
              onClick={deleteTask}
              icon={<Trash2 size={14} />}
              className="text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
            >
              Delete
            </Button>
          )}
        </div>
      </header>
      {err && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {err}
        </div>
      )}

      {/* Meta strip */}
      <section className="card p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Meta label="Status">
          {isEditing ? (
            <select
              className="input"
              value={draft.status}
              onChange={(e) => setField("status", e.target.value as TaskStatus)}
            >
              {TASK_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            <TaskStatusBadge status={draft.status} />
          )}
        </Meta>
        <Meta label="Assignee">
          {isEditing ? (
            <select
              className="input"
              value={draft.assignee_id ?? ""}
              onChange={(e) => setField("assignee_id", e.target.value || null)}
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
        <Meta label="Due date (optional)">
          {isEditing ? (
            <input
              className="input"
              type="date"
              value={draft.due_date ?? ""}
              onChange={(e) => setField("due_date", e.target.value || null)}
            />
          ) : (
            <span className="text-sm text-ink-900">{formatDate(draft.due_date)}</span>
          )}
        </Meta>
        <Meta label="Priority">
          {isEditing ? (
            <select
              className="input"
              value={draft.priority}
              onChange={(e) => setField("priority", e.target.value as Priority)}
            >
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          ) : (
            <PriorityBadge priority={draft.priority} />
          )}
        </Meta>
        <div ref={projectFieldRef}>
          <Meta label="Project">
            {isEditing ? (
              // "" is our null sentinel — the DB stores null when no project is
              // assigned, and the combobox only deals in string values.
              <ProjectCombobox
                value={draft.project_id ?? ""}
                onChange={(v) => setField("project_id", v || null)}
                projects={projects}
                extraOptions={[{ id: "", label: "— No project —" }]}
                placeholder="— No project —"
                className="w-full"
              />
            ) : draft.project_id ? (
              <Link
                to={`/projects/${draft.project_id}`}
                className="text-sm text-brand-700 hover:underline dark:text-brand-100"
              >
                {projects.find((p) => p.id === draft.project_id)?.name ?? "—"}
              </Link>
            ) : (
              <span className="text-sm text-ink-500">—</span>
            )}
          </Meta>
        </div>
      </section>

      {/* Description */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Description</h2>
        {isEditing ? (
          <textarea
            className="input"
            rows={4}
            value={draft.description ?? ""}
            onChange={(e) => setField("description", e.target.value || null)}
            placeholder="Context, acceptance criteria, links"
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-ink-700">
            {draft.description ?? "—"}
          </p>
        )}
      </section>

      {/* Links — same editor as ProjectDetail: dynamic rows with a fixed
          set of types, drag-to-reorder, click-through on saved URLs. */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Links</h2>
        {isEditing ? (
          <div className="space-y-2">
            {draft.links.length === 0 && (
              <p className="text-xs text-ink-500">
                No links yet. Add Figma, Workfront, docs, anything relevant.
              </p>
            )}
            {draft.links.map((link, i) => (
              <div
                key={i}
                draggable
                onDragStart={(e) => {
                  setDragIdx(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => {
                  if (dragIdx === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pos =
                    e.clientY - rect.top < rect.height / 2 ? i : i + 1;
                  if (overIdx !== pos) setOverIdx(pos);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdx !== null && overIdx !== null)
                    moveLink(dragIdx, overIdx);
                  setDragIdx(null);
                  setOverIdx(null);
                }}
                onDragEnd={() => {
                  setDragIdx(null);
                  setOverIdx(null);
                }}
                className={`flex flex-col gap-2 rounded-md sm:flex-row sm:items-center ${
                  dragIdx === i ? "opacity-40" : ""
                } ${
                  overIdx === i &&
                  dragIdx !== null &&
                  dragIdx !== i &&
                  dragIdx + 1 !== i
                    ? "border-t-2 border-brand-500"
                    : ""
                } ${
                  i === draft.links.length - 1 &&
                  overIdx === draft.links.length &&
                  dragIdx !== null &&
                  dragIdx !== i
                    ? "border-b-2 border-brand-500"
                    : ""
                }`}
              >
                <span
                  className="hidden sm:flex h-8 w-4 items-center justify-center text-ink-400 cursor-grab active:cursor-grabbing"
                  aria-hidden
                  title="Drag to reorder"
                >
                  <GripVertical size={14} />
                </span>
                <select
                  className="input sm:w-32"
                  value={link.type}
                  onChange={(e) =>
                    updateLink(i, {
                      type: e.target.value as ProjectLink["type"],
                    })
                  }
                >
                  {LINK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {LINK_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                {/* Optional title. Narrower than the URL field; blank
                    titles fall back to the type name in the chip. */}
                <input
                  className="input sm:w-40"
                  value={link.title ?? ""}
                  onChange={(e) => updateLink(i, { title: e.target.value })}
                  placeholder="Title (optional)"
                />
                <input
                  className="input flex-1"
                  value={link.url}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                  placeholder="https://…"
                />
                {link.url.trim() && isLikelyUrl(link.url) ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md p-2 text-ink-400 hover:bg-ink-100 hover:text-brand-700"
                    aria-label="Open link in new tab"
                    title="Open link in new tab"
                  >
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <span className="w-[30px]" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  className="rounded-md p-2 text-ink-400 hover:bg-ink-100 hover:text-rose-600"
                  aria-label="Remove link"
                  title="Remove link"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addLink}
              className="btn btn-secondary"
            >
              <Plus size={14} />
              Add link
            </button>
          </div>
        ) : (
          <LinkList links={draft.links} />
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

// Save button rendered in the detail header during edit mode. Cancel
// lives outside this component (always visible in edit mode), and the
// post-save "Saved" tick is rendered alongside in view mode — by then we
// have already flipped back. Kept as its own component because the
// matching ProjectDetail header reuses the same shape.
//
// onDiscard / savedAt are accepted but not used here today — left in the
// signature so the call sites in ProjectDetail and TaskDetail stay
// identical and refactors don't need to track props in two places.
function HeaderSaveControls({
  isDirty,
  saving,
  onSave,
}: {
  isDirty: boolean;
  saving: boolean;
  savedAt: number | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (!isDirty) return null;
  return (
    <Button variant="primary" onClick={onSave} disabled={saving}>
      {saving ? <Spinner /> : "Save"}
    </Button>
  );
}
