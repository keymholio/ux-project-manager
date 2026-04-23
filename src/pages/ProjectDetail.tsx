import { Check, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CommentThread from "../components/CommentThread";
import {
  Avatar,
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
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  CATEGORY_LABEL,
  LINK_TYPES,
  LINK_TYPE_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  fmtProjectId,
  fmtTaskId,
  type Priority,
  type Profile,
  type Project,
  type ProjectCategory,
  type ProjectLink,
  type ProjectStatus,
  type Task,
} from "../lib/types";

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

// A blank row for the links editor. Defaults to "other" so the dropdown
// has a concrete selection; the user picks the real type and pastes a URL.
// Rows with an empty URL get dropped on save.
const emptyLink = (): ProjectLink => ({ type: "other", url: "" });

// Strip empty rows and trim whitespace before persisting. We compare the
// cleaned result against the server snapshot so "picked a type then cleared
// the URL" doesn't count as dirty.
const cleanLinks = (links: ProjectLink[]): ProjectLink[] =>
  links
    .map((l) => ({ type: l.type, url: l.url.trim() }))
    .filter((l) => l.url);

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { isManager } = useAuth();

  // Server snapshots — what the DB last told us.
  const [project, setProject] = useState<Project | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Working copy — what the UI is editing. Diverges from the server
  // snapshot as the user makes changes, then snaps back on save or discard.
  const [draft, setDraft] = useState<Project | null>(null);
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>([]);

  // Save state for the sticky bar at the bottom of the page.
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Remembers which project id we've already seeded the draft from, so
  // realtime updates don't clobber in-progress edits by resetting the draft.
  const initedForIdRef = useRef<string | null>(null);

  const load = async () => {
    if (!id) return;
    const [pRes, aRes, profRes, tRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id).maybeSingle(),
      supabase.from("project_assignees").select("user_id").eq("project_id", id),
      supabase.from("profiles").select("*"),
      supabase.from("tasks").select("*").eq("project_id", id).order("status"),
    ]);
    if (pRes.error) setErr(pRes.error.message);
    setProject(pRes.data ?? null);
    setAssigneeIds((aRes.data ?? []).map((r) => r.user_id));
    setProfiles(profRes.data ?? []);
    setTasks(tRes.data ?? []);
  };

  useEffect(() => {
    load();
    if (!id) return;
    const channel = supabase
      .channel(`project-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_assignees", filter: `project_id=eq.${id}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `project_id=eq.${id}` }, load)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const isDirty = useMemo(() => {
    if (!draft || !project) return false;
    for (const key of EDITABLE_FIELDS) {
      if (draft[key] !== project[key]) return true;
    }
    // Order-dependent JSON comparison for the links array — the order
    // the user arranges them in is meaningful, so we shouldn't sort.
    if (JSON.stringify(cleanLinks(draft.links)) !== JSON.stringify(project.links))
      return true;
    // Order-independent assignee comparison.
    if (draftAssigneeIds.length !== assigneeIds.length) return true;
    const a = [...draftAssigneeIds].sort();
    const b = [...assigneeIds].sort();
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return true;
    }
    return false;
  }, [draft, project, draftAssigneeIds, assigneeIds]);

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

    // Adopt the draft into the server snapshot immediately so isDirty
    // flips to false without waiting for the realtime echo to come back.
    setProject({ ...project, ...fieldDiff } as Project);
    setAssigneeIds(draftAssigneeIds);
    setSaving(false);
    setSavedAt(Date.now());
  };

  const discard = () => {
    if (!project || !isDirty) return;
    if (!confirm("Discard unsaved changes?")) return;
    setDraft(project);
    setDraftAssigneeIds(assigneeIds);
    setErr(null);
    setSavedAt(null);
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
  // themselves on a project they're actively contributing to.
  const team = [...profiles].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  );

  return (
    // Extra bottom padding so the sticky save bar never covers content.
    <div className="p-6 max-w-5xl space-y-5 pb-24">
      <Breadcrumbs
        items={[
          { label: "Projects", to: "/projects" },
          { label: fmtProjectId(project.short_id), current: true },
        ]}
      />

      <header className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <CategoryBadge category={draft.category} />
            <PriorityBadge priority={draft.priority} />
          </div>
          {isManager ? (
            <input
              className="mt-2 w-full bg-transparent text-2xl font-semibold text-ink-900 focus:outline-none focus:bg-white rounded px-1 -mx-1"
              value={draft.name}
              onChange={(e) => setField("name", e.target.value)}
            />
          ) : (
            <h1 className="mt-2 text-2xl font-semibold text-ink-900">
              {draft.name}
            </h1>
          )}
        </div>
        {isManager && (
          <Button
            onClick={deleteProject}
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
          {isManager ? (
            <select
              className="input"
              value={draft.status}
              onChange={(e) => setField("status", e.target.value as ProjectStatus)}
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
          {isManager ? (
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
          {isManager ? (
            <select
              className="input"
              value={draft.priority}
              onChange={(e) => setField("priority", e.target.value as Priority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          ) : (
            <PriorityBadge priority={draft.priority} />
          )}
        </Meta>
        <Meta label="Due date">
          {isManager ? (
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
        {isManager ? (
          <textarea
            className="input"
            rows={3}
            value={draft.description ?? ""}
            onChange={(e) => setField("description", e.target.value || null)}
            placeholder="Add a brief description or notes."
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-ink-700">
            {draft.description ?? "—"}
          </p>
        )}
      </section>

      {/* Links */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Links</h2>
        {isManager ? (
          <div className="space-y-2">
            {draft.links.length === 0 && (
              <p className="text-xs text-ink-500">
                No links yet. Add Figma, Workfront, docs, anything relevant.
              </p>
            )}
            {draft.links.map((link, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <select
                  className="input sm:w-40"
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
                <input
                  className="input flex-1"
                  value={link.url}
                  onChange={(e) => updateLink(i, { url: e.target.value })}
                  placeholder="https://…"
                />
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

      {/* Assignees */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Designers</h2>
        <div className="flex flex-wrap gap-2">
          {team.map((d) => {
            const on = draftAssigneeIds.includes(d.id);
            if (!isManager) {
              return on ? (
                <span
                  key={d.id}
                  className="chip bg-ink-100 text-ink-700 flex items-center gap-1"
                >
                  <Avatar profile={d} size={16} />
                  {d.full_name}
                </span>
              ) : null;
            }
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
          {!isManager && draftAssigneeIds.length === 0 && (
            <p className="text-sm text-ink-500">No one assigned yet.</p>
          )}
        </div>
      </section>

      {/* Tasks on this project */}
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">
            Tasks ({tasks.length})
          </h2>
          <Link
            to={`/tasks?project=${project.id}`}
            className="text-xs text-brand-700 hover:underline inline-flex items-center gap-1"
          >
            <Plus size={12} />
            New task on board
          </Link>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-ink-500">
            No tasks yet. Open the Tasks board to add one.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {tasks.map((t) => {
              const a = profiles.find((p) => p.id === t.assignee_id) ?? null;
              return (
                <li key={t.id} className="py-2">
                  <Link
                    to={`/tasks/${t.id}`}
                    className="flex items-center gap-3 rounded hover:bg-ink-50 -mx-1 px-1"
                  >
                    <span className="w-12 flex-shrink-0 font-mono text-xs tabular-nums text-ink-400">
                      {fmtTaskId(t.short_id)}
                    </span>
                    <Avatar profile={a} size={22} />
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

      <SaveBar
        isDirty={isDirty}
        saving={saving}
        savedAt={savedAt}
        error={err}
        onSave={save}
        onDiscard={discard}
      />
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

// Sticky save bar — appears at the bottom of the scroll container when
// there are unsaved changes, flashes a confirmation after a successful
// save, and surfaces server errors inline so the user doesn't have to
// hunt for them. Shared between ProjectDetail and TaskDetail conceptually;
// kept inline for now because it's small and the two pages diverge a bit.
function SaveBar({
  isDirty,
  saving,
  savedAt,
  error,
  onSave,
  onDiscard,
}: {
  isDirty: boolean;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const visible = isDirty || !!savedAt || !!error;
  if (!visible) return null;
  return (
    <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-end gap-3 rounded-lg border border-ink-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
      {error && (
        <span className="mr-auto text-sm text-rose-700">{error}</span>
      )}
      {isDirty ? (
        <>
          <span className="text-sm text-ink-500">Unsaved changes</span>
          <Button onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            {saving ? <Spinner /> : "Save changes"}
          </Button>
        </>
      ) : savedAt ? (
        <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
          <Check size={14} />
          Saved
        </span>
      ) : null}
    </div>
  );
}
