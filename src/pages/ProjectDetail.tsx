import {
  Check,
  ExternalLink,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CommentThread from "../components/CommentThread";
import NewTaskModal from "../components/NewTaskModal";
import { useToast } from "../components/Toast";
import {
  Avatar,
  AvatarStack,
  Breadcrumbs,
  Button,
  CategoryBadge,
  LinkList,
  PriorityBadge,
  ProjectStatusBadge,
  Spinner,
  TaskStatusBadge,
  formatDate,
} from "../components/ui";
import { supabase } from "../lib/supabase";
import {
  CATEGORY_LABEL,
  LINK_TYPES,
  LINK_TYPE_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  fmtProjectId,
  fmtTaskId,
  type Label,
  type Priority,
  type Profile,
  type Project,
  type ProjectCategory,
  type ProjectLink,
  type ProjectStatus,
  type Task,
} from "../lib/types";

// Project editing is open to the whole team — the RLS policies were
// loosened in migration 008 so any authenticated user can update any
// project, including reassigning designers. User admin (creating,
// deactivating, role-changing other users) is still manager-only and
// lives on the /admin/users page.

// Fields the user can edit. Used both for diffing draft ↔ server and for
// building the UPDATE payload when saving. Everything else (id, owner_id,
// created_at, updated_at) is server-managed and should never be sent back.
// NB: `links` is an array so referential-equality diffing doesn't work —
// we handle it separately in isDirty/save below. The legacy figma_url /
// workfront_url / jira_url / figjam_url columns still exist on the row
// but are no longer exposed as editable fields; their values were folded
// into `links` by migration 004.
const EDITABLE_FIELDS = [
  "name",
  "description",
  "status",
  "category",
  "priority",
  "due_date",
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

// Quick sanity check before wiring a URL up as a clickable link. We only
// need to keep people from accidentally navigating to a relative path or
// something like "javascript:alert(1)" — full validation would be a
// rabbit hole and the editor already shows the raw string in the input
// so typos are visible. Accepts http/https and leading "//" protocol-
// relative URLs; anything else stays un-clickable until it looks right.
const isLikelyUrl = (s: string): boolean => {
  const t = s.trim();
  return /^(https?:\/\/|\/\/)/i.test(t);
};

// A blank row for the links editor. Defaults to "figma" because that's
// the overwhelming majority of what the team pastes in; the type
// dropdown still lets them pick something else before adding the URL.
// Rows with an empty URL get dropped on save.
const emptyLink = (): ProjectLink => ({ type: "figma", url: "" });

// Strip empty rows and trim whitespace before persisting. We compare the
// cleaned result against the server snapshot so "picked a type then cleared
// the URL" doesn't count as dirty. A trimmed title is kept if non-empty,
// and the `title` key is omitted entirely when blank — that way the diff
// against the server snapshot (which won't have the key at all for older
// rows) doesn't flip to "dirty" just because the user opened the row.
const cleanLinks = (links: ProjectLink[]): ProjectLink[] =>
  links
    .map((l) => {
      const title = l.title?.trim();
      const cleaned: ProjectLink = { type: l.type, url: l.url.trim() };
      if (title) cleaned.title = title;
      return cleaned;
    })
    .filter((l) => l.url);

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const toast = useToast();

  // Server snapshots — what the DB last told us.
  const [project, setProject] = useState<Project | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  // All labels in the system (for the picker) + which ones this project
  // has. Labels live in a separate table (migration 009) so they load
  // independently. Edits are staged into draftLabelIds and persisted on
  // save via an add/remove diff, same pattern as assignees.
  const [labels, setLabels] = useState<Label[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Working copy — what the UI is editing. Diverges from the server
  // snapshot as the user makes changes, then snaps back on save or discard.
  const [draft, setDraft] = useState<Project | null>(null);
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>([]);
  const [draftLabelIds, setDraftLabelIds] = useState<string[]>([]);

  // Save state for the sticky bar at the bottom of the page.
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Toggle for the inline "Add task" modal in the Tasks section. The
  // modal is the same NewTaskModal used on the TaskBoard, opened with
  // the current project pre-selected and locked so the user can't
  // accidentally create the task against a different project from this
  // page. The realtime subscription already attached to `tasks` (filtered
  // by project_id) refreshes the list the moment the insert lands, so we
  // don't need to thread an onCreated handler back into the local state.
  const [creatingTask, setCreatingTask] = useState(false);

  // Drag-to-reorder state for the Links editor. `dragIdx` is the row the
  // user grabbed; `overIdx` is the row we'd drop onto if they released
  // now, used to draw the insertion indicator. Both clear on drop/cancel.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  // Remembers which project id we've already seeded the draft from, so
  // realtime updates don't clobber in-progress edits by resetting the draft.
  const initedForIdRef = useRef<string | null>(null);

  const load = async () => {
    if (!id) return;
    const [pRes, aRes, profRes, tRes, lRes, plRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      supabase.from("project_assignees").select("user_id").eq("project_id", id),
      supabase.from("profiles").select("*"),
      supabase.from("tasks").select("*").eq("project_id", id).order("status"),
      supabase.from("labels").select("*").order("name"),
      supabase.from("project_labels").select("label_id").eq("project_id", id),
    ]);
    if (pRes.error) setErr(pRes.error.message);
    setProject(pRes.data ?? null);
    setAssigneeIds((aRes.data ?? []).map((r) => r.user_id));
    setProfiles(profRes.data ?? []);
    setTasks(tRes.data ?? []);
    setLabels(lRes.data ?? []);
    setLabelIds((plRes.data ?? []).map((r) => r.label_id));
  };

  useEffect(() => {
    load();
    if (!id) return;
    const channel = supabase
      .channel(`project-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_assignees", filter: `project_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${id}` }, load)
      // Two separate subscriptions for labels: the library of available
      // labels (table-wide) and the join rows for THIS project. Someone
      // creating a label elsewhere should make it appear in this picker
      // without a refresh.
      .on("postgres_changes", { event: "*", schema: "public", table: "labels" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_labels", filter: `project_id=eq.${id}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Seed the draft once per project id. Project + assigneeIds are set in
  // the same `load()` call, so by the time `project` is non-null the
  // assignee IDs are ready too.
  useEffect(() => {
    if (!project) return;
    if (initedForIdRef.current === project.id) return;
    initedForIdRef.current = project.id;
    setDraft(project);
    setDraftAssigneeIds(assigneeIds);
    setDraftLabelIds(labelIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // View vs edit mode. Default to view so the page reads as a record on
  // first paint instead of a wall of form fields, which is especially
  // helpful on mobile. Entering edit mode re-seeds the draft from the
  // current server snapshot so any realtime updates that arrived while
  // the user was in view mode aren't shadowed by a stale draft.
  const [mode, setMode] = useState<"view" | "edit">("view");
  const isEditing = mode === "edit";

  const enterEditMode = () => {
    if (!project) return;
    setDraft(project);
    setDraftAssigneeIds(assigneeIds);
    setDraftLabelIds(labelIds);
    setErr(null);
    setSavedAt(null);
    setMode("edit");
  };

  const exitEditMode = () => {
    // isDirty is computed below — the closure resolves it at call time.
    if (isDirty && !confirm("Discard unsaved changes?")) return;
    if (project) {
      setDraft(project);
      setDraftAssigneeIds(assigneeIds);
      setDraftLabelIds(labelIds);
    }
    setErr(null);
    setSavedAt(null);
    setMode("view");
  };

  const isDirty = useMemo(() => {
    if (!draft || !project) return false;
    for (const key of EDITABLE_FIELDS) {
      if (draft[key] !== project[key]) return true;
    }
    // Order-dependent JSON comparison for the links array — the order
    // the user arranges them in is meaningful, so we shouldn't sort.
    // Run BOTH sides through cleanLinks so the diff isn't driven by
    // server-side artifacts: stale `title: ""` / `title: null` from
    // older rows, or differing key insertion order from PostgREST. Without
    // this normalization, pristine projects load as already-dirty.
    if (
      JSON.stringify(cleanLinks(draft.links)) !==
      JSON.stringify(cleanLinks(project.links))
    )
      return true;
    // Order-independent assignee comparison.
    if (draftAssigneeIds.length !== assigneeIds.length) return true;
    const a = [...draftAssigneeIds].sort();
    const b = [...assigneeIds].sort();
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return true;
    }
    // Same order-independent comparison for labels.
    if (draftLabelIds.length !== labelIds.length) return true;
    const la = [...draftLabelIds].sort();
    const lb = [...labelIds].sort();
    for (let i = 0; i < la.length; i++) {
      if (la[i] !== lb[i]) return true;
    }
    return false;
  }, [draft, project, draftAssigneeIds, assigneeIds, draftLabelIds, labelIds]);

  // Warn on tab close / reload if there are unsaved edits. Doesn't catch
  // in-app navigation — that's a bigger lift (react-router v6 useBlocker).
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Auto-hide the "Saved" confirmation after a short beat.
  useEffect(() => {
    if (savedAt === null) return;
    const t = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(t);
  }, [savedAt]);

  const setField = <K extends EditableField>(field: K, value: Project[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
    // Any new edit should clear the saved indicator.
    setSavedAt(null);
  };

  const toggleAssignee = (userId: string) => {
    setDraftAssigneeIds((prev) =>
      prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId],
    );
    setSavedAt(null);
  };

  const toggleLabel = (labelId: string) => {
    setDraftLabelIds((prev) =>
      prev.includes(labelId) ? prev.filter((x) => x !== labelId) : [...prev, labelId],
    );
    setSavedAt(null);
  };

  // Inline "create new label" — keeps the user on the project page instead
  // of making them go to a separate admin page for something they'll reach
  // for constantly. Dedupes case-insensitively on name (the DB has a UNIQUE
  // constraint on name, so a race would only surface as a unique-violation,
  // but we'd rather not throw for the common case of re-typing an existing
  // label). Brand new labels are auto-applied to the project.
  const createLabel = async (rawName: string) => {
    const name = rawName.trim().toLowerCase();
    if (!name) return;
    const existing = labels.find((l) => l.name.toLowerCase() === name);
    if (existing) {
      // Already in the library — just apply it if it isn't already on.
      if (!draftLabelIds.includes(existing.id)) toggleLabel(existing.id);
      return;
    }
    const { data, error } = await supabase
      .from("labels")
      .insert({ name })
      .select()
      .single();
    if (error || !data) {
      setErr(error?.message ?? "Failed to create label");
      return;
    }
    // Realtime will echo this into `labels`, but apply it locally too so
    // the picker updates without waiting for the round-trip.
    setLabels((prev) =>
      prev.some((l) => l.id === data.id)
        ? prev
        : [...prev, data as Label].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setDraftLabelIds((prev) =>
      prev.includes(data.id) ? prev : [...prev, data.id],
    );
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
  // Reorder using "insert before target" semantics — dropping row A on
  // row B places A where B was and pushes B (and everything after)
  // down by one. If `from < to` we decrement `to` by 1 to account for
  // the dragged row having been spliced out first.
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
    if (!draft || !project || !isDirty) return;
    setSaving(true);
    setErr(null);

    // Build an UPDATE payload of only the fields that actually changed.
    const fieldDiff: Partial<Project> = {};
    for (const key of EDITABLE_FIELDS) {
      if (draft[key] !== project[key]) {
        (fieldDiff as Record<string, unknown>)[key] = draft[key];
      }
    }
    const cleanedLinks = cleanLinks(draft.links);
    if (JSON.stringify(cleanedLinks) !== JSON.stringify(project.links)) {
      (fieldDiff as Record<string, unknown>).links = cleanedLinks;
    }
    if (Object.keys(fieldDiff).length > 0) {
      const { error } = await supabase
        .from("projects")
        .update(fieldDiff)
        .eq("id", project.id);
      if (error) {
        setErr(error.message);
        setSaving(false);
        return;
      }
    }

    // Assignee set diff — inserts for anyone newly added, deletes for
    // anyone removed. Bail out on the first error so partial saves don't
    // leave the UI reporting success.
    const toAdd = draftAssigneeIds.filter((x) => !assigneeIds.includes(x));
    if (toAdd.length > 0) {
      const { error } = await supabase
        .from("project_assignees")
        .insert(toAdd.map((uid) => ({ project_id: project.id, user_id: uid })));
      if (error) {
        setErr(error.message);
        setSaving(false);
        return;
      }
    }
    const toRemove = assigneeIds.filter((x) => !draftAssigneeIds.includes(x));
    for (const uid of toRemove) {
      const { error } = await supabase
        .from("project_assignees")
        .delete()
        .eq("project_id", project.id)
        .eq("user_id", uid);
      if (error) {
        setErr(error.message);
        setSaving(false);
        return;
      }
    }

    // Label set diff — same pattern as assignees. Inserts are batched;
    // deletes go one-by-one because the join table's composite PK means
    // we'd otherwise have to build an OR filter for a bulk delete.
    const labelsToAdd = draftLabelIds.filter((x) => !labelIds.includes(x));
    if (labelsToAdd.length > 0) {
      const { error } = await supabase
        .from("project_labels")
        .insert(
          labelsToAdd.map((lid) => ({ project_id: project.id, label_id: lid })),
        );
      if (error) {
        setErr(error.message);
        setSaving(false);
        return;
      }
    }
    const labelsToRemove = labelIds.filter((x) => !draftLabelIds.includes(x));
    for (const lid of labelsToRemove) {
      const { error } = await supabase
        .from("project_labels")
        .delete()
        .eq("project_id", project.id)
        .eq("label_id", lid);
      if (error) {
        setErr(error.message);
        setSaving(false);
        return;
      }
    }

    // Adopt the draft into the server snapshot immediately so isDirty
    // flips to false without waiting for the realtime echo to come back.
    setProject({ ...project, ...fieldDiff } as Project);
    setAssigneeIds(draftAssigneeIds);
    setLabelIds(draftLabelIds);
    setSaving(false);
    setSavedAt(Date.now());
    // Successful save returns to view mode — the user has committed,
    // further edits require explicitly re-entering edit mode.
    setMode("view");
  };

  const discard = () => {
    if (!project || !isDirty) return;
    if (!confirm("Discard unsaved changes?")) return;
    setDraft(project);
    setDraftAssigneeIds(assigneeIds);
    setDraftLabelIds(labelIds);
    setErr(null);
    setSavedAt(null);
    setMode("view");
  };

  const deleteProject = async () => {
    if (!project) return;
    if (!confirm(`Delete "${project.name}"? This can't be undone.`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", project.id);
    if (error) {
      alert(error.message);
      return;
    }
    nav("/projects");
  };

  if (!project && !err)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (err && !project) return <div className="p-6 text-rose-700">Error: {err}</div>;
  if (!project || !draft) return <div className="p-6">Project not found.</div>;

  // Team section covers everyone (managers included) — a manager can put
  // themselves on a project they're actively contributing to. Inactive
  // users are hidden from the picker but remain listed if they're already
  // assigned, so historical assignments don't silently disappear when a
  // manager deactivates someone mid-project.
  const team = [...profiles]
    .filter(
      (p) =>
        (p.is_active ?? true) || draftAssigneeIds.includes(p.id),
    )
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-5">
      <Breadcrumbs
        items={[
          { label: "Projects", to: "/projects" },
          { label: fmtProjectId(project.short_id), current: true },
        ]}
      />

      <header className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <CategoryBadge category={draft.category} />
            <PriorityBadge priority={draft.priority} />
          </div>
          {isEditing ? (
            <input
              className="mt-2 w-full bg-transparent text-2xl font-semibold text-ink-900 focus:outline-none focus:bg-surface rounded px-1 -mx-1"
              value={draft.name}
              onChange={(e) => setField("name", e.target.value)}
            />
          ) : (
            <h1 className="mt-2 text-2xl font-semibold text-ink-900">
              {draft.name}
            </h1>
          )}
        </div>
        {/* Header-level action cluster:
            - View mode: Edit button (primary entry into edit mode) +
              Delete (always available since project delete is open to
              the team per migration 008).
            - Edit mode: Cancel + Save (HeaderSaveControls renders Save
              when there are changes) + Delete.
            Same physical slot in both modes; only the contents swap. */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {mode === "view" && (
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
          {mode === "view" && savedAt && (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <Check size={14} />
              Saved
            </span>
          )}
          <Button
            onClick={deleteProject}
            icon={<Trash2 size={14} />}
            className="text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
          >
            Delete
          </Button>
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
              onChange={(e) =>
                setField("status", e.target.value as ProjectStatus)
              }
            >
              {PROJECT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            <ProjectStatusBadge status={draft.status} />
          )}
        </Meta>
        <Meta label="Category">
          {isEditing ? (
            <select
              className="input"
              value={draft.category}
              onChange={(e) =>
                setField("category", e.target.value as ProjectCategory)
              }
            >
              {(Object.keys(CATEGORY_LABEL) as ProjectCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          ) : (
            <CategoryBadge category={draft.category} />
          )}
        </Meta>
        <Meta label="Priority">
          {isEditing ? (
            <select
              className="input"
              value={draft.priority}
              onChange={(e) => setField("priority", e.target.value as Priority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          ) : draft.priority === "high" ? (
            <PriorityBadge priority={draft.priority} />
          ) : (
            // PriorityBadge intentionally renders nothing for low/medium —
            // keep that quiet behavior in view mode by showing the label
            // as plain text instead of an empty cell.
            <span className="text-sm capitalize text-ink-900">
              {draft.priority}
            </span>
          )}
        </Meta>
        <Meta label="Due date">
          {isEditing ? (
            <input
              className="input"
              type="date"
              value={draft.due_date ?? ""}
              onChange={(e) => setField("due_date", e.target.value || null)}
            />
          ) : (
            <span className="text-sm text-ink-900">
              {formatDate(draft.due_date)}
            </span>
          )}
        </Meta>
        {/* Only surfaces once the server has stamped completed_at (either via
            the projects_complete trigger or on insert). Read from `project`
            rather than `draft` so unsaved edits don't spoof a date. */}
        {project.status === "done" && project.completed_at && (
          <Meta label="Completed">
            <span className="text-sm text-ink-900">
              {formatDate(project.completed_at)}
            </span>
          </Meta>
        )}
      </section>

      {/* Description */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Description</h2>
        {isEditing ? (
          <textarea
            className="input"
            rows={3}
            value={draft.description ?? ""}
            onChange={(e) => setField("description", e.target.value || null)}
            placeholder="Add a brief description or notes."
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-ink-700">
            {draft.description?.trim() || "—"}
          </p>
        )}
      </section>

      {/* Labels */}
      {isEditing ? (
        <LabelsEditor
          labels={labels}
          selectedIds={draftLabelIds}
          onToggle={toggleLabel}
          onCreate={createLabel}
        />
      ) : (
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-ink-900">Labels</h2>
          {(() => {
            // View mode renders the same chips the editor uses for selected
            // labels, but without the × remove buttons. Reading from the
            // server snapshot (labelIds) rather than the draft so a user
            // who half-edited and then clicked Cancel sees the canonical
            // state — though in practice the two are equal in view mode.
            const applied = labelIds
              .map((id) => labels.find((l) => l.id === id))
              .filter((x): x is Label => !!x);
            if (applied.length === 0) {
              return <p className="text-xs text-ink-500">No labels.</p>;
            }
            return (
              <div className="flex flex-wrap gap-2">
                {applied.map((l) => (
                  <span
                    key={l.id}
                    className="chip text-white"
                    style={{ background: l.color }}
                  >
                    {l.name}
                  </span>
                ))}
              </div>
            );
          })()}
        </section>
      )}

      {/* Links */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Links</h2>
        {!isEditing ? (
          draft.links.length === 0 ? (
            <p className="text-xs text-ink-500">No links.</p>
          ) : (
            <LinkList links={draft.links} />
          )
        ) : (
        <div className="space-y-2">
          {draft.links.length === 0 && (
            <p className="text-xs text-ink-500">
              No links yet. Add Figma, Workfront, docs, anything relevant.
            </p>
          )}
          {draft.links.map((link, i) => (
            <div
              key={i}
              // Whole row is draggable. Browsers let <input>/<select>
              // swallow their own drag events (text selection, native
              // dropdown open), so grabbing inside a field won't start
              // a reorder drag — only the grip handle or the blank
              // edges of the row will. That's what we want.
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
                // Safari needs *some* data to actually initiate the drag.
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                if (dragIdx === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                // Top half of the row → insert before (position i).
                // Bottom half → insert after (position i+1). This lets
                // the user target any slot, including "after the last
                // row", which a row-only drop target couldn't reach.
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
                // Draw an insertion cursor above this row when the hover
                // position maps to "before i" and the drop wouldn't be a
                // no-op (source row itself, or the row directly above).
                overIdx === i &&
                dragIdx !== null &&
                dragIdx !== i &&
                dragIdx + 1 !== i
                  ? "border-t-2 border-brand-500"
                  : ""
              } ${
                // For the last row only, a bottom-border shows when the
                // drop would land after it — no next row exists to host
                // the top-border cursor.
                i === draft.links.length - 1 &&
                overIdx === draft.links.length &&
                dragIdx !== null &&
                dragIdx !== i
                  ? "border-b-2 border-brand-500"
                  : ""
              }`}
            >
              {/* Grip handle — visual cue that the row is draggable.
                  The drag itself is wired on the whole row so users
                  can grab from empty space too, but the grip is the
                  obvious affordance and gets the "grab" cursor. */}
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
              {/* Optional title. Narrower than the URL field — the URL is
                  the primary input and titles tend to be short ("Mobile
                  v3", "Hospital map"). When left blank, the list chip
                  falls back to the type name. */}
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
              {/* Open link in a new tab. Only shown when the URL field
                  has something in it — for an empty row the button would
                  have nothing to open. Rendered as an <a> rather than a
                  button so middle-click, cmd-click, and right-click →
                  "open in new window" all work the way users expect. */}
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
                // Placeholder keeps the delete button aligned across rows
                // even when the open button isn't shown yet.
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
        )}
      </section>

      {/* Assignees */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Designers</h2>
        {isEditing ? (
        <div className="flex flex-wrap gap-2">
          {team.map((d) => {
            const on = draftAssigneeIds.includes(d.id);
            return (
              <button
                key={d.id}
                onClick={() => toggleAssignee(d.id)}
                className={`chip flex items-center gap-1 ${
                  on ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700"
                }`}
              >
                <Avatar profile={d} size={16} />
                {d.full_name}
              </button>
            );
          })}
        </div>
        ) : (() => {
          // View mode renders the assigned designers as an avatar stack
          // with names. Reads from the server snapshot (assigneeIds) so
          // it always reflects the persisted state, not a half-edited
          // draft. Falls back to a "no designers assigned" hint when the
          // project hasn't been staffed yet.
          const assigned = assigneeIds
            .map((id) => team.find((p) => p.id === id))
            .filter((x): x is Profile => !!x);
          if (assigned.length === 0) {
            return (
              <p className="text-xs text-ink-500">No designers assigned.</p>
            );
          }
          return (
            <div className="flex items-center gap-3">
              <AvatarStack profiles={assigned} size={28} />
              <span className="text-sm text-ink-700">
                {assigned.map((p) => p.full_name).join(", ")}
              </span>
            </div>
          );
        })()}
      </section>

      {/* Tasks on this project */}
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">
            Tasks ({tasks.length})
          </h2>
          {/* "Add task" opens the shared NewTaskModal here on the project
              page itself rather than bouncing the user to the TaskBoard.
              The project is pre-selected and locked, so the new task
              automatically lands inside this section. */}
          <Button
            icon={<Plus size={14} />}
            onClick={() => setCreatingTask(true)}
          >
            Add task
          </Button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-500">
            No tasks yet. Click "Add task" to create one.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {tasks.map((t) => {
              const a = profiles.find((p) => p.id === t.assignee_id) ?? null;
              return (
                <li key={t.id} className="py-2">
                  <Link
                    to={`/tasks/${t.id}`}
                    className="flex items-center gap-3 rounded hover:bg-ink-100 -mx-1 px-1"
                  >
                    <span className="w-12 flex-shrink-0 font-mono text-xs tabular-nums text-ink-400">
                      {fmtTaskId(t.short_id)}
                    </span>
                    {/* Assignee avatar + name. Spelling the name out (rather
                        than just showing the avatar) makes the row scannable
                        without relying on color/initials recognition,
                        especially on mobile where the avatars are small. */}
                    <div className="flex w-32 flex-shrink-0 items-center gap-1.5">
                      <Avatar profile={a} size={22} />
                      <span className="truncate text-xs text-ink-700">
                        {a?.full_name ?? "Unassigned"}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-ink-900">
                        {t.title}
                      </div>
                    </div>
                    <TaskStatusBadge status={t.status} />
                    <span className="w-24 text-right text-xs text-ink-500">
                      {formatDate(t.due_date)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Comments */}
      <CommentThread projectId={project.id} />

      {creatingTask && (
        <NewTaskModal
          projects={[]}
          profiles={profiles}
          defaultProjectId={project.id}
          lockProject
          onClose={() => setCreatingTask(false)}
          onCreated={(created) => {
            // Optimistic insert: add the new task to the local list
            // immediately so the user sees their task appear without
            // waiting on realtime. The realtime subscription on
            // `tasks` will echo this same row back shortly; the dedupe
            // guard (`some` check on id) keeps it from being added a
            // second time when the echo arrives. Without this, brand
            // new tasks felt like nothing happened — there was a
            // ~1-second silent delay before realtime caught up.
            setTasks((prev) =>
              prev.some((t) => t.id === created.id) ? prev : [...prev, created],
            );
            setCreatingTask(false);
            toast(`Task "${created.title}" added`);
          }}
        />
      )}
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
// have already flipped back. onDiscard / savedAt are accepted but not
// used here today; left in the signature so the call sites in
// ProjectDetail and TaskDetail can keep parity.
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

// -----------------------------------------------------------------------------
// Labels editor — selected labels inline as chips (click × to remove), plus
// an "add label" affordance that expands into a combobox-style picker over
// the full library. Typing a name that doesn't match creates a new label on
// the fly. Labels are global (not per-project) so the library grows as the
// team invents new tags to track initiatives.
// -----------------------------------------------------------------------------
function LabelsEditor({
  labels,
  selectedIds,
  onToggle,
  onCreate,
}: {
  labels: Label[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onCreate: (name: string) => Promise<void> | void;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => labels.find((l) => l.id === id))
        .filter((x): x is Label => !!x),
    [selectedIds, labels],
  );

  // Everything that's not already applied. We filter by the query in a
  // case-insensitive substring match — good enough for a team with dozens
  // of labels, not thousands.
  const q = query.trim().toLowerCase();
  const suggestions = useMemo(
    () =>
      labels
        .filter((l) => !selectedIds.includes(l.id))
        .filter((l) => !q || l.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [labels, selectedIds, q],
  );

  // Flag the "nothing matches — hit enter to create" case. Matches ignore
  // case because label names are canonicalised lowercase at insert time.
  const canCreate =
    q.length > 0 && !labels.some((l) => l.name.toLowerCase() === q);

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (canCreate) {
        await onCreate(q);
        setQuery("");
      } else if (suggestions.length === 1) {
        // Single match + enter = quick-apply, like tag autocomplete.
        onToggle(suggestions[0].id);
        setQuery("");
      }
    } else if (e.key === "Escape") {
      setQuery("");
      setPicking(false);
    }
  };

  return (
    <section className="card p-4">
      <h2 className="mb-2 text-sm font-semibold text-ink-900">Labels</h2>
      <div className="flex flex-wrap items-center gap-2">
        {selected.length === 0 && !picking && (
          <span className="text-xs text-ink-500">
            No labels yet. Use labels to tag initiatives or cross-cutting
            work that doesn't fit a single category.
          </span>
        )}
        {selected.map((l) => (
          <span
            key={l.id}
            className="chip flex items-center gap-1 text-white"
            style={{ background: l.color }}
          >
            {l.name}
            <button
              type="button"
              onClick={() => onToggle(l.id)}
              className="rounded-full hover:bg-surface/20"
              aria-label={`Remove label ${l.name}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        {!picking ? (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="chip bg-ink-100 text-ink-700 hover:bg-ink-200 inline-flex items-center gap-1"
          >
            <Plus size={12} />
            Add label
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="input h-7 w-48 text-xs"
              placeholder="Search or create…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                // Small delay so a click on a suggestion fires before the
                // picker closes. Without this, the mousedown → blur → unmount
                // sequence eats the click.
                setTimeout(() => setPicking(false), 150);
              }}
            />
            <button
              type="button"
              onClick={() => {
                setPicking(false);
                setQuery("");
              }}
              className="text-xs text-ink-500 hover:text-ink-900"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {picking && (suggestions.length > 0 || canCreate) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {suggestions.map((l) => (
            <button
              key={l.id}
              type="button"
              onMouseDown={(e) => {
                // mousedown fires before input blur, so the toggle lands
                // before the picker collapses.
                e.preventDefault();
                onToggle(l.id);
                setQuery("");
              }}
              className="chip text-white"
              style={{ background: l.color }}
            >
              {l.name}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={async (e) => {
                e.preventDefault();
                await onCreate(q);
                setQuery("");
              }}
              className="chip bg-brand-600 text-white inline-flex items-center gap-1"
            >
              <Plus size={12} />
              Create "{q}"
            </button>
          )}
        </div>
      )}
    </section>
  );
}
