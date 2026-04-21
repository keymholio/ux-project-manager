import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import CommentThread from "../components/CommentThread";
import {
  Avatar,
  Button,
  CategoryBadge,
  PriorityBadge,
  ProjectStatusBadge,
  Spinner,
  TaskStatusBadge,
  ToolLinks,
  formatDate,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  CATEGORY_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  type Priority,
  type Profile,
  type Project,
  type ProjectCategory,
  type ProjectStatus,
  type Task,
} from "../lib/types";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { isManager } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [assignees, setAssignees] = useState<Profile[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [err, setErr] = useState<string | null>(null);

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
    const assigneeIds = (aRes.data ?? []).map((r) => r.user_id);
    setProfiles(profRes.data ?? []);
    setAssignees(
      (profRes.data ?? []).filter((p) => assigneeIds.includes(p.id)),
    );
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

  const updateField = async <K extends keyof Project>(field: K, value: Project[K]) => {
    if (!project) return;
    const { error } = await supabase
      .from("projects")
      .update({ [field]: value })
      .eq("id", project.id);
    if (error) setErr(error.message);
  };

  const toggleAssignee = async (userId: string, on: boolean) => {
    if (!project) return;
    if (on) {
      await supabase
        .from("project_assignees")
        .insert({ project_id: project.id, user_id: userId });
    } else {
      await supabase
        .from("project_assignees")
        .delete()
        .eq("project_id", project.id)
        .eq("user_id", userId);
    }
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
  if (err) return <div className="p-6 text-rose-700">Error: {err}</div>;
  if (!project) return <div className="p-6">Project not found.</div>;

  const designers = profiles.filter((p) => p.role === "designer");

  return (
    <div className="p-6 max-w-5xl space-y-5">
      <div>
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Projects
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <CategoryBadge category={project.category} />
            <PriorityBadge priority={project.priority} />
          </div>
          {isManager ? (
            <input
              className="mt-2 w-full bg-transparent text-2xl font-semibold text-ink-900 focus:outline-none focus:bg-white rounded px-1 -mx-1"
              value={project.name}
              onChange={(e) =>
                setProject({ ...project, name: e.target.value })
              }
              onBlur={(e) => updateField("name", e.target.value)}
            />
          ) : (
            <h1 className="mt-2 text-2xl font-semibold text-ink-900">
              {project.name}
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
              value={project.status}
              onChange={(e) => updateField("status", e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          ) : (
            <ProjectStatusBadge status={project.status} />
          )}
        </Meta>
        <Meta label="Category">
          {isManager ? (
            <select
              className="input"
              value={project.category}
              onChange={(e) =>
                updateField("category", e.target.value as ProjectCategory)
              }
            >
              {(Object.keys(CATEGORY_LABEL) as ProjectCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          ) : (
            <CategoryBadge category={project.category} />
          )}
        </Meta>
        <Meta label="Priority">
          {isManager ? (
            <select
              className="input"
              value={project.priority}
              onChange={(e) => updateField("priority", e.target.value as Priority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          ) : (
            <PriorityBadge priority={project.priority} />
          )}
        </Meta>
        <Meta label="Due date">
          {isManager ? (
            <input
              className="input"
              type="date"
              value={project.due_date ?? ""}
              onChange={(e) => updateField("due_date", e.target.value || null)}
            />
          ) : (
            <span className="text-sm text-ink-900">
              {formatDate(project.due_date)}
            </span>
          )}
        </Meta>
      </section>

      {/* Description */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Description</h2>
        {isManager ? (
          <textarea
            className="input"
            rows={3}
            value={project.description ?? ""}
            onChange={(e) =>
              setProject({ ...project, description: e.target.value })
            }
            onBlur={(e) => updateField("description", e.target.value || null)}
            placeholder="Add a brief description or notes."
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm text-ink-700">
            {project.description ?? "—"}
          </p>
        )}
      </section>

      {/* Links */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Links</h2>
        {isManager ? (
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
                    value={project[f] ?? ""}
                    onChange={(e) =>
                      setProject({ ...project, [f]: e.target.value })
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
            figma={project.figma_url}
            workfront={project.workfront_url}
            jira={project.jira_url}
            figjam={project.figjam_url}
          />
        )}
      </section>

      {/* Assignees */}
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Team</h2>
        <div className="flex flex-wrap gap-2">
          {designers.map((d) => {
            const on = assignees.some((a) => a.id === d.id);
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
                onClick={() => toggleAssignee(d.id, !on)}
                className={`chip flex items-center gap-1 ${
                  on ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-700"
                }`}
              >
                <Avatar profile={d} size={16} />
                {d.full_name}
              </button>
            );
          })}
          {!isManager && assignees.length === 0 && (
            <p className="text-sm text-ink-500">No designers assigned yet.</p>
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
