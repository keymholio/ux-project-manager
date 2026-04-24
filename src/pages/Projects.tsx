import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Avatar,
  AvatarStack,
  Button,
  EmptyState,
  LinkList,
  Modal,
  ProjectStatusBadge,
  Spinner,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  LINK_TYPES,
  LINK_TYPE_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_ORDER,
  fmtProjectId,
  type Priority,
  type Profile,
  type Project,
  type ProjectAssignee,
  type ProjectCategory,
  type ProjectLink,
  type ProjectStatus,
} from "../lib/types";

// Set of all valid project statuses, used to validate URL params. Includes
// "active" (a synthetic value meaning "everything except Backlog and Done")
// and "all" alongside the real status keys.
const VALID_STATUS = new Set<string>([...PROJECT_STATUS_ORDER, "active", "all"]);
const VALID_CATEGORY = new Set<string>(Object.keys(CATEGORY_LABEL));

// Status filter has two synthetic options on top of the real statuses.
type StatusFilter = ProjectStatus | "active" | "all";

// Sort config. Assigned-to and Links are intentionally not sortable — an
// avatar stack or a set of link chips has no natural ordering users would
// expect. ID sorts numerically by short_id, which matches how the IDs were
// handed out (oldest → newest), useful when you want to see the backlog in
// the order it was created.
type SortColumn = "id" | "name" | "category" | "status";
type SortDir = "asc" | "desc";
const STATUS_RANK: Record<ProjectStatus, number> = PROJECT_STATUS_ORDER.reduce(
  (acc, s, i) => ({ ...acc, [s]: i }),
  {} as Record<ProjectStatus, number>,
);

// Filters persist in sessionStorage so navigating away and back (e.g. clicking
// into a project detail and hitting the nav link) restores the view you had.
// URL params still take precedence — a deep link like /projects?status=backlog
// from the dashboard funnel is always respected.
const FILTERS_KEY = "ui:projects:filters";
interface StoredProjectFilters {
  status?: StatusFilter;
  category?: ProjectCategory | "all";
  // "all" | "unassigned" | "<user-id>" — matches the values in the select.
  designer?: string;
  sort?: { col: SortColumn; dir: SortDir } | null;
}
const readStoredFilters = (): StoredProjectFilters => {
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    return raw ? (JSON.parse(raw) as StoredProjectFilters) : {};
  } catch {
    return {};
  }
};
const writeStoredFilters = (f: StoredProjectFilters) => {
  try {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(f));
  } catch {
    // ignore quota / disabled storage
  }
};

export default function Projects() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignees, setAssignees] = useState<ProjectAssignee[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // URL is the single source of truth for statusFilter and categoryFilter —
  // they're derived from `params` on every render instead of living in their
  // own useState. An earlier attempt kept them in state and used two effects
  // to sync URL ↔ state, which created an infinite ping-pong when the user
  // came back to /projects via a bare nav link while sessionStorage had a
  // non-default value: effect A pushed storage → URL, effect B pushed empty
  // URL → "active" state, round and round until React's max-update-depth
  // tripped and the page blanked out.
  const [query, setQuery] = useState("");
  const statusFilter: StatusFilter = (() => {
    const s = params.get("status");
    return s && VALID_STATUS.has(s) ? (s as StatusFilter) : "active";
  })();
  const categoryFilter: ProjectCategory | "all" = (() => {
    const c = params.get("category");
    return c && VALID_CATEGORY.has(c) ? (c as ProjectCategory) : "all";
  })();
  // Designer filter: "all" | "unassigned" | "<user-id>". We don't validate the
  // id against the profile list on read — if a stale id slips in, the filter
  // will simply match nothing, which is the right degenerate behaviour.
  const designerFilter: string = params.get("designer") ?? "all";
  const setStatusFilter = (s: StatusFilter) => {
    const next = new URLSearchParams(params);
    if (s === "active") next.delete("status");
    else next.set("status", s);
    setParams(next, { replace: true });
  };
  const setCategoryFilter = (c: ProjectCategory | "all") => {
    const next = new URLSearchParams(params);
    if (c === "all") next.delete("category");
    else next.set("category", c);
    setParams(next, { replace: true });
  };
  const setDesignerFilter = (d: string) => {
    const next = new URLSearchParams(params);
    if (d === "all") next.delete("designer");
    else next.set("designer", d);
    setParams(next, { replace: true });
  };

  const [creating, setCreating] = useState(false);
  // null = no explicit sort; fall back to the query's updated_at desc order.
  // Sort only lives in component state (not URL) — noisy to URL-encode.
  const [sort, setSort] = useState<{ col: SortColumn; dir: SortDir } | null>(
    () => readStoredFilters().sort ?? null,
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

  // On mount, if the URL has no filter params but sessionStorage has some,
  // push the stored values into the URL. Ref-guarded so this runs exactly
  // once even in StrictMode's double-invoke dev mode.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const stored = readStoredFilters();
    const next = new URLSearchParams(params);
    let changed = false;
    if (
      !params.has("status") &&
      stored.status &&
      stored.status !== "active" &&
      VALID_STATUS.has(stored.status)
    ) {
      next.set("status", stored.status);
      changed = true;
    }
    if (
      !params.has("category") &&
      stored.category &&
      stored.category !== "all" &&
      VALID_CATEGORY.has(stored.category)
    ) {
      next.set("category", stored.category);
      changed = true;
    }
    if (
      !params.has("designer") &&
      stored.designer &&
      stored.designer !== "all"
    ) {
      next.set("designer", stored.designer);
      changed = true;
    }
    if (changed) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist current filters (plus sort) so next mount can restore them.
  useEffect(() => {
    writeStoredFilters({
      status: statusFilter,
      category: categoryFilter,
      designer: designerFilter,
      sort,
    });
  }, [statusFilter, categoryFilter, designerFilter, sort]);

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

  // Project-id → Set of assigned user ids. Built once per assignees change so
  // the filter doesn't scan the full project_assignees array per row.
  const assigneesByProject = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of assignees) {
      const set = map.get(a.project_id) ?? new Set<string>();
      set.add(a.user_id);
      map.set(a.project_id, set);
    }
    return map;
  }, [assignees]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter === "active") {
        // "Active" is the default view: everything except the parked ends
        // of the funnel. Backlog is still being scoped, Done is shipped.
        if (p.status === "backlog" || p.status === "done") return false;
      } else if (statusFilter !== "all" && p.status !== statusFilter) {
        return false;
      }
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (designerFilter !== "all") {
        const team = assigneesByProject.get(p.id);
        if (designerFilter === "unassigned") {
          if (team && team.size > 0) return false;
        } else {
          if (!team || !team.has(designerFilter)) return false;
        }
      }
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, query, statusFilter, categoryFilter, designerFilter, assigneesByProject]);

  // Reference count used for the header total. "Active" here means the
  // same thing as the Active status filter — anything that's not parked
  // in Backlog or shipped as Done. This is the number the team actually
  // cares about as "how much is on our plate right now".
  const activeCount = useMemo(
    () =>
      projects.filter((p) => p.status !== "backlog" && p.status !== "done")
        .length,
    [projects],
  );

  const sortedFiltered = useMemo(() => {
    if (!sort) return filtered;
    // Copy before sorting — useMemo results are cached and downstream code
    // assumes the input array isn't mutated in place.
    const list = [...filtered];
    const mul = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      switch (sort.col) {
        case "id":
          return (a.short_id - b.short_id) * mul;
        case "name":
          return a.name.localeCompare(b.name) * mul;
        case "category":
          return (
            CATEGORY_LABEL[a.category].localeCompare(CATEGORY_LABEL[b.category]) *
            mul
          );
        case "status":
          return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * mul;
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
              ? "Create, assign, and track projects across your designers."
              : "Projects assigned to or tracked by the designers."}
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
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="active">Active projects</option>
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
        {/* Designer filter mirrors the one on the Tasks board — lets managers
            slice the list to one person's workload. "Unassigned" surfaces
            projects that need a designer picked. */}
        <select
          className="input w-auto"
          value={designerFilter}
          onChange={(e) => setDesignerFilter(e.target.value)}
        >
          <option value="all">All designers</option>
          <option value="unassigned">Unassigned</option>
          {[...profiles]
            .sort((a, b) => a.full_name.localeCompare(b.full_name))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
        </select>
        {/* Live total. The reference number ("Y") depends on the status
            filter: on "All statuses" we show the grand total, otherwise we
            anchor on active projects (everything except Backlog and Done)
            so the headline reflects current workload rather than being
            skewed by the parked ends of the funnel. When the visible list
            exactly matches the reference set we drop the "X of" prefix. */}
        <div className="ml-auto text-sm tabular-nums text-ink-500">
          {(() => {
            const useAll = statusFilter === "all";
            const baseCount = useAll ? projects.length : activeCount;
            const noun = useAll ? "project" : "active project";
            const plural = baseCount === 1 ? "" : "s";
            return filtered.length === baseCount
              ? `${baseCount} ${noun}${plural}`
              : `${filtered.length} of ${baseCount} ${noun}s`;
          })()}
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
              columns line up. Order: ID → Project → Category → Status →
              Assigned to → Links. Due and Priority used to live here — they're
              still editable on the detail page, but they were noise on the
              list where status and assignment do most of the scan-work. */}
          <div className="flex items-center gap-3 border-b border-ink-200 bg-ink-50/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-500">
            <div className="w-14 flex-shrink-0">
              <SortableHeader
                label="ID"
                col="id"
                sort={sort}
                onToggle={toggleSort}
              />
            </div>
            <div className="min-w-0 flex-1">
              <SortableHeader
                label="Project"
                col="name"
                sort={sort}
                onToggle={toggleSort}
              />
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              <div className="w-32">
                <SortableHeader
                  label="Category"
                  col="category"
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
              <div className="w-40">Assigned to</div>
              <div className="w-40">Links</div>
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
                  {/* Short ID — fixed-width so rows align. Same Jira-style
                      identifier surfaced in the breadcrumb on the detail
                      page, so users can match what they see in the list
                      against what they've shared in Slack etc. */}
                  <div className="w-14 flex-shrink-0 font-mono text-xs tabular-nums text-ink-500">
                    {fmtProjectId(p.short_id)}
                  </div>
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
                    {/* Category — colored dot preserves the visual cue from
                        the old design; the label makes it scannable without
                        a hover. */}
                    <div className="flex w-32 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ background: CATEGORY_COLOR[p.category] }}
                      />
                      <span className="truncate text-xs text-ink-700">
                        {CATEGORY_LABEL[p.category]}
                      </span>
                    </div>
                    <div className="w-32">
                      <ProjectStatusBadge status={p.status} />
                    </div>
                    {/* Assigned-to column. One person: avatar + full name.
                        Multiple: stack + first name + "+N" so the row stays
                        within its fixed width. Zero: a dash. */}
                    <div className="flex w-40 min-w-0 items-center gap-2">
                      {team.length === 0 ? (
                        <span className="text-sm text-ink-500">—</span>
                      ) : team.length === 1 ? (
                        <>
                          <Avatar profile={team[0]} size={22} />
                          <span className="truncate text-sm text-ink-900">
                            {team[0].full_name}
                          </span>
                        </>
                      ) : (
                        <>
                          <AvatarStack profiles={team} size={22} />
                          <span className="truncate text-sm text-ink-900">
                            {team[0].full_name.split(" ")[0]} +
                            {team.length - 1}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="w-40 overflow-hidden">
                      {/* Cap to 2 visible chips so long link lists don't
                          blow out the row. Anything beyond renders as a
                          "+N" pill with the full list in the tooltip. */}
                      <LinkList links={p.links} max={2} />
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
          onCreated={(created) => {
            setCreating(false);
            // If the current filter would hide the fresh project (e.g. default
            // "Active projects" view hides Backlog), bump the filter to "all"
            // so the user actually sees what they just made.
            const hidden =
              (statusFilter === "active" &&
                (created.status === "backlog" || created.status === "done")) ||
              (statusFilter !== "active" &&
                statusFilter !== "all" &&
                statusFilter !== created.status);
            if (hidden) setStatusFilter("all");
            refresh();
            toast(`Project "${created.name}" created`);
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
  onCreated: (project: Project) => void;
}) {
  const { profile } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ProjectCategory>("marketing");
  const [status, setStatus] = useState<ProjectStatus>("backlog");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  // Links are freeform now. Empty rows get dropped before insert.
  const [links, setLinks] = useState<ProjectLink[]>([]);
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
    const cleanedLinks = links
      .map((l) => ({ type: l.type, url: l.url.trim() }))
      .filter((l) => l.url);
    const { data, error } = await supabase
      .from("projects")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        category,
        status,
        priority,
        due_date: dueDate || null,
        links: cleanedLinks,
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
    onCreated(data);
  };

  return (
    <Modal
      open
      title="New project"
      onClose={onClose}
      wide
      dismissOnBackdropClick={false}
    >
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
        <Field label="Assign designers">
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
        <Field label="Links">
          <div className="space-y-2">
            {links.length === 0 && (
              <p className="text-xs text-ink-500">
                Optional — add any links you'd like to associate with the
                project (Figma, Workfront, docs, etc.).
              </p>
            )}
            {links.map((link, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <select
                  className="input sm:w-40"
                  value={link.type}
                  onChange={(e) =>
                    setLinks((prev) => {
                      const next = [...prev];
                      next[i] = {
                        ...next[i],
                        type: e.target.value as ProjectLink["type"],
                      };
                      return next;
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
                  onChange={(e) =>
                    setLinks((prev) => {
                      const next = [...prev];
                      next[i] = { ...next[i], url: e.target.value };
                      return next;
                    })
                  }
                  placeholder="https://…"
                />
                <button
                  type="button"
                  onClick={() =>
                    setLinks((prev) => prev.filter((_, idx) => idx !== i))
                  }
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
              onClick={() =>
                setLinks((prev) => [...prev, { type: "other", url: "" }])
              }
              className="btn btn-secondary"
            >
              <Plus size={14} />
              Add link
            </button>
          </div>
        </Field>
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
