import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AvatarStack,
  Button,
  CategoryBadge,
  EmptyState,
  Modal,
  PriorityBadge,
  ProjectStatusBadge,
  Spinner,
  ToolLinks,
  formatDate,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  CATEGORY_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  type Profile,
  type Project,
  type ProjectAssignee,
  type ProjectCategory,
  type ProjectStatus,
  type Priority,
} from "../lib/types";

// Set of all valid project statuses, used to validate URL params.
const VALID_STATUS = new Set<string>(PROJECT_STATUS_ORDER);
const VALID_CATEGORY = new Set<string>(Object.keys(CATEGORY_LABEL));

export default function Projects() {
  const { isManager } = useAuth();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignees, setAssignees] = useState<ProjectAssignee[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filters are initialized from URL params so deep-links like
  // /projects?status=backlog from the dashboard funnel work out of the box.
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">(() => {
    const s = params.get("status");
    return s && VALID_STATUS.has(s) ? (s as ProjectStatus) : "all";
  });
  const [categoryFilter, setCategoryFilter] = useState<ProjectCategory | "all">(
    () => {
      const c = params.get("category");
      return c && VALID_CATEGORY.has(c) ? (c as ProjectCategory) : "all";
    },
  );
  const [creating, setCreating] = useState(false);

  // Keep the URL in sync when the user changes filters from the page itself.
  useEffect(() => {
    const next = new URLSearchParams(params);
    statusFilter === "all"
      ? next.delete("status")
      : next.set("status", statusFilter);
    categoryFilter === "all"
      ? next.delete("category")
      : next.set("category", categoryFilter);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter]);

  // If the user navigates (browser back/forward, or a new dashboard link),
  // re-read the URL into state so the dropdowns reflect reality.
  useEffect(() => {
    const s = params.get("status");
    setStatusFilter(s && VALID_STATUS.has(s) ? (s as ProjectStatus) : "all");
    const c = params.get("category");
    setCategoryFilter(
      c && VALID_CATEGORY.has(c) ? (c as ProjectCategory) : "all",
    );
  }, [params]);

  const refresh = async () => {
    const [pRes, aRes, profRes] = await Promise.all([
      supabase.from("projects").select("*").order("updated_at", { ascending: false }),
      supabase.from("project_assignees").select("*"),
      supabase.from("profiles").select("*"),
    ]);
    const error = pRes.error?.message ?? aRes.error?.message ?? profRes.error?.message ?? null;
    if (error) setErr(error);
    setProjects(pRes.data ?? []);
    setAssignees(aRes.data ?? []);
    setProfiles(profRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("projects-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_assignees" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, query, statusFilter, categoryFilter]);

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (err) return <div className="p-6 text-rose-700">Error: {err}</div>;

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Projects</h1>
          <p className="text-sm text-ink-500">
            {isManager
              ? "Create, assign, and track projects across your team."
              : "Projects assigned to or tracked by the team."}
          </p>
        </div>
        {isManager && (
          <Button
            variant="primary"
            icon={<Plus size={14} />}
            onClick={() => setCreating(true)}
          >
            New project
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2.5 top-2.5 text-ink-400"
          />
          <input
            className="input pl-8 w-64"
            placeholder="Search projects"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ProjectStatus | "all")}
        >
          <option value="all">All statuses</option>
          {PROJECT_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as ProjectCategory | "all")
          }
        >
          <option value="all">All categories</option>
          {(Object.keys(CATEGORY_LABEL) as ProjectCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No projects match your filters"
          hint={isManager ? "Clear filters or create a new project." : undefined}
        />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const team = assignees
              .filter((a) => a.project_id === p.id)
              .map((a) => profiles.find((pr) => pr.id === a.user_id))
              .filter((x): x is Profile => !!x);
            return (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="card p-4 hover:border-brand-500 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <CategoryBadge category={p.category} />
                  <ProjectStatusBadge status={p.status} />
                </div>
                <h3 className="mt-2 font-semibold text-ink-900 line-clamp-2">
                  {p.name}
                </h3>
                {p.description && (
                  <p className="mt-1 text-sm text-ink-500 line-clamp-2">
                    {p.description}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <AvatarStack profiles={team} />
                  <PriorityBadge priority={p.priority} />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <ToolLinks
                    figma={p.figma_url}
                    workfront={p.workfront_url}
                    jira={p.jira_url}
                    figjam={p.figjam_url}
                  />
                  <div className="text-xs text-ink-500">
                    Due {formatDate(p.due_date)}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {creating && (
        <NewProjectModal
          profiles={profiles}
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
// New project modal
// -----------------------------------------------------------------------------
function NewProjectModal({
  profiles,
  onClose,
  onCreated,
}: {
  profiles: Profile[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { profile } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ProjectCategory>("marketing");
  const [status, setStatus] = useState<ProjectStatus>("backlog");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [figmaUrl, setFigmaUrl] = useState("");
  const [workfrontUrl, setWorkfrontUrl] = useState("");
  const [jiraUrl, setJiraUrl] = useState("");
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Include managers — they may contribute to the project themselves.
  const team = [...profiles].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  );

  const submit = async () => {
    if (!name.trim() || !profile) return;
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        category,
        status,
        priority,
        due_date: dueDate || null,
        figma_url: figmaUrl.trim() || null,
        workfront_url: workfrontUrl.trim() || null,
        jira_url: jiraUrl.trim() || null,
        owner_id: profile.id,
      })
      .select()
      .single();
    if (error || !data) {
      setErr(error?.message ?? "Failed to create project");
      setBusy(false);
      return;
    }
    if (selectedAssignees.length > 0) {
      const { error: aErr } = await supabase
        .from("project_assignees")
        .insert(
          selectedAssignees.map((uid) => ({
            project_id: data.id,
            user_id: uid,
          })),
        );
      if (aErr) {
        setErr(aErr.message);
        setBusy(false);
        return;
      }
    }
    onCreated();
  };

  return (
    <Modal open title="New project" onClose={onClose} wide>
      <div className="space-y-3">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nuvance hospital migration — Sharon"
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
          <Field label="Category">
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as ProjectCategory)}
            >
              {(Object.keys(CATEGORY_LABEL) as ProjectCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
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
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
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
        </div>
        <Field label="Assign team">
          <div className="flex flex-wrap gap-1">
            {team.map((d) => {
              const selected = selectedAssignees.includes(d.id);
              return (
                <button
                  type="button"
                  key={d.id}
                  onClick={() =>
                    setSelectedAssignees((prev) =>
                      selected
                        ? prev.filter((x) => x !== d.id)
                        : [...prev, d.id],
                    )
                  }
                  className={`chip ${
                    selected
                      ? "bg-brand-600 text-white"
                      : "bg-ink-100 text-ink-700"
                  }`}
                >
                  {d.full_name}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Figma URL">
            <input
              className="input"
              value={figmaUrl}
              onChange={(e) => setFigmaUrl(e.target.value)}
              placeholder="https://figma.com/…"
            />
          </Field>
          <Field label="Workfront URL">
            <input
              className="input"
              value={workfrontUrl}
              onChange={(e) => setWorkfrontUrl(e.target.value)}
            />
          </Field>
          <Field label="Jira URL">
            <input
              className="input"
              value={jiraUrl}
              onChange={(e) => setJiraUrl(e.target.value)}
            />
          </Field>
        </div>
        {err && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : "Create project"}
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
