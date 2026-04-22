import { ArrowLeft, Check, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

// Fields the user can edit on a task. Used for draft ↔ server diffing and
// for building the UPDATE payload on save. Server-managed fields (id,
// created_at, updated_at, created_by) are intentionally excluded.
const EDITABLE_FIELDS = [
  "title",
  "description",
  "status",
  "assignee_id",
  "due_date",
  "priority",
  "task_type",
  "project_id",
  "figma_url",
  "workfront_url",
  "jira_url",
  "figjam_url",
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile, isManager } = useAuth();

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

  // Tracks which task id the draft was seeded from so realtime updates
  // don't overwrite in-progress edits on their way in.
  const initedForIdRef = useRef<string | null>(null);

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

  // Seed the draft once per task id.
  useEffect(() => {
    if (!task) return;
    if (initedForIdRef.current === task.id) return;
    initedForIdRef.current = task.id;
    setDraft(task);
  }, [task]);

  const canEdit = isManager || task?.assignee_id === profile?.id;

  const isDirty = useMemo(() => {
    if (!draft || !task) return false;
    for (const key of EDITABLE_FIELDS) {
      if (draft[key] !== task[key]) return true;
    }
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
    if (!draft || !canEdit) return;
    setDraft({ ...draft, [field]: value });
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
    setSaving(false);
    setSavedAt(Date.now());
  };

  const discard = () => {
    if (!task || !isDirty) return;
    if (!confirm("Discard unsaved changes?")) return;
    setDraft(task);
    setErr(null);
    setSavedAt(null);
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
  const team = [...profiles].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  );

  return (
    <div className="p-6 max-w-4xl space-y-5 pb-24">
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
            <TaskTypeBadge type={draft.task_type} />
            <PriorityBadge priority={draft.priority} />
            <TaskStatusBadge status={draft.status} />
          </div>
          {canEdit ? (
            <input
              className="mt-2 w-full bg-transparent text-2xl font-semibold text-ink-900 focus:outline-none focus:bg-white rounded px-1 -mx-1"
              value={draft.title}
              onChange={(e) => setField("title", e.target.value)}
            />
          ) : (
            <h1 className="mt-2 text-2xl font-semibold text-ink-900">{draft.title}</h1>
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
          {isManager ? (
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
        <Meta label="Due date">
          {canEdit ? (
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
          {canEdit ? (
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
        <Meta label="Type">
          {canEdit ? (
            <select
              className="input"
              value={draft.task_type}
              onChange={(e) => setField("task_type", e.target.value as TaskType)}
            >
              {(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          ) : (
            <TaskTypeBadge type={draft.task_type} />
          )}
        </Meta>
        <Meta label="Project">
          {isManager ? (
            <select
              className="input"
              value={draft.project_id ?? ""}
              onChange={(e) => setField("project_id", e.target.value || null)}
            >
              <option value="">— No project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : draft.project_id ? (
            <Link
              to={`/projects/${draft.project_id}`}
              className="text-sm text-brand-700 hover:underline"
            >
              {projects.find((p) => p.id === draft.project_id)?.name ?? "—"}
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
                    value={draft[f] ?? ""}
                    onChange={(e) => setField(f, e.target.value || null)}
                    placeholder="https://…"
                  />
                </label>
              ),
            )}
          </div>
        ) : (
          <ToolLinks
            figma={draft.figma_url}
            workfront={draft.workfront_url}
            jira={draft.jira_url}
            figjam={draft.figjam_url}
          />
        )}
      </section>

      <CommentThread taskId={task.id} />

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

// Sticky save bar. Duplicated in ProjectDetail for now — the two pages
// share the save-draft pattern but not much else, and abstracting this
// out before we have a third caller would be premature.
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
