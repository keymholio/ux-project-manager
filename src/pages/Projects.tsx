import { ArrowDown, ArrowUp, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Avatar,
  AvatarStack,
  Button,
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
  CATEGORY_COLOR,
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

// Sort config. Team/Tools are intentionally not sortable — an avatar stack
// or a set of tool chips has no natural ordering users would expect.
type SortColumn = "name" | "priority" | "status" | "due_date";
type SortDir = "asc" | "desc";
const PRIORITY_RANK: Record<Priority, number> = { low: 1, medium: 2, high: 3 };
const STATUS_RANK: Record<ProjectStatus, number> = PROJECT_STATUS_ORDER.reduce(
  (acc, s, i) => ({ ...acc, [s]: i }),
  {} as Record<ProjectStatus, number>,
);

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
  // null = no explicit sort; fall back to the query's updated_at desc order.
  const [sort, setSort] = useState<{ col: SortColumn; dir: SortDir } | null>(
    null,
  );

  // Three-click cycle on a header: asc → desc → off. Clicking a different
  // column starts fresh at asc.
  const toggleSort = (col: SortColumn) => {
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });
  };

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

  const sortedFiltered = useMemo(() => {
    if (!sort) return filtered;
    // Copy before sorting — useMemo results are cached and downstream code
    // assumes the input array isn't mutated in place.
    const list = [...filtered];
    const mul = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (sort.col) {
        case "name":
          return a.name.localeCompare(b.name) * mul;
        case "priority":
          return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * mul;
        case "status":
          return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * mul;
        case "due_date": {
          // Projects with no due date always sort to the end, regardless of
          // direction — otherwise an asc sort would bury all the dated rows
          // below a pile of empties.
          if (!a.due_date && !b.due_date) return 0;
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return (
            (new Date(a.due_date).getTime() - new Date(b.due_date).getTime()) *
            mul
          );
        }
      }
    });
    return list;
  }, [filtered, sort]);

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
        {/* Live total. Shows "X projects" when unfiltered, "X of Y" when
            the user is narrowing the list. */}
        <div className="ml-auto text-sm tabular-nums text-ink-500">
          {filtered.length === projects.length
            ? `${projects.length} project${projects.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${projects.length} projects`}
        </div>
      </div>

      {sortedFiltered.length === 0 ? (
        <EmptyState
          title="No projects match your filters"
          hint={isManager ? "Clear filters or create a new project." : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          {/* Header row. Widths here must match the data rows below so the
              columns line up. The leading 2.5-wide span stands in for the
              category dot column. */}
          <div className="flex items-center gap-3 border-b border-ink-200 bg-ink-50/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-500">
            <span className="h-2.5 w-2.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <SortableHeader
                label="Project"
                col="name"
                sort={sort}
                onToggle={toggleSort}
              />
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              <div className="w-14">
                <SortableHeader
                  label="Priority"
                  col="priority"
                  sort={sort}
                  onToggle={toggleSort}
                />
              </div>
              <div className="w-32">
                <SortableHeader
                  label="Status"
                  col="status"
                  sort={sort}
                  onToggle={toggleSort}
                />
              </div>
              <div className="w-24">Team</div>
              <div className="w-40">Tools</div>
              <div className="w-20 text-right">
                <SortableHeader
                  label="Due"
                  col="due_date"
                  sort={sort}
                  onToggle={toggleSort}
                  align="right"
                />
              </div>
            </div>
          </div>
          <div className="divide-y divide-ink-100">
            {sortedFiltered.map((p) => {
              const team = assignees
                .filter((a) => a.project_id === p.id)
                .map((a) => profiles.find((pr) => pr.id === a.user_id))
                .filter((x): x is Profile => !!x);
              return (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50 transition"
                >
                  {/* Category indicator — tiny colored dot instead of a full
                      chip to save horizontal space. Hover for the name. */}
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: CATEGORY_COLOR[p.category] }}
                    title={CATEGORY_LABEL[p.category]}
                    aria-label={CATEGORY_LABEL[p.category]}
                  />
                  {/* Name + description — takes whatever space is left. */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-900">
                      {p.name}
                    </div>
                    {p.description && (
                      <div className="truncate text-xs text-ink-500">
                        {p.description}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-3">
                    <div className="w-14">
                      <PriorityBadge priority={p.priority} />
                    </div>
                    <div className="w-32">
                      <ProjectStatusBadge status={p.status} />
                    </div>
                    <div className="w-24">
                      <AvatarStack profiles={team} size={22} />
                    </div>
                    <div className="w-40">
                      <ToolLinks
                        figma={p.figma_url}
                        workfront={p.workfront_url}
                        jira={p.jira_url}
                        figjam={p.figjam_url}
                      />
                    </div>
                    {/* Fixed-width date column keeps trailing dates aligned
                        across rows, even when some projects have no due date. */}
                    <div className="w-20 text-right text-xs tabular-nums text-ink-500">
                      {p.due_date ? formatDate(p.due_date) : ""}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
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

// Clickable column header. Renders a direction arrow only when this column
// is the active sort, so inactive headers stay visually quiet.
function SortableHeader({
  label,
  col,
  sort,
  onToggle,
  align = "left",
}: {
  label: string;
  col: SortColumn;
  sort: { col: SortColumn; dir: SortDir } | null;
  onToggle: (col: SortColumn) => void;
  align?: "left" | "right";
}) {
  const active = sort?.col === col;
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink-900 ${
        active ? "text-ink-900" : ""
      } ${align === "right" ? "justify-end" : ""}`}
    >
      {label}
      {active &&
        (sort!.dir === "asc" ? (
          <ArrowUp size={10} />
        ) : (
          <ArrowDown size={10} />
        ))}
    </button>
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
