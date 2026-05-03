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
  type Label,
  type Priority,
  type Profile,
  type Project,
  type ProjectAssignee,
  type ProjectCategory,
  type ProjectLabel,
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

// Group-by axis. "none" shows the flat sorted list; everything else breaks
// the list into sections with a header per group. Designer grouping uses
// project assignees as the grouping key — a project with multiple designers
// shows up under each of them so you can read either lens ("what does Alice
// own?" and "how many eyes are on project X?") without switching pages.
type GroupBy = "none" | "designer" | "category" | "status";
const VALID_GROUP_BY = new Set<string>(["none", "designer", "category", "status"]);
const GROUP_BY_LABEL: Record<GroupBy, string> = {
  none: "No grouping",
  designer: "Designer",
  category: "Category",
  status: "Status",
};

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
  // "all" | "<label-id>" — matches one specific label. Kept as a single
  // value rather than a multi-select: 99% of the time the team is
  // filtering on a single initiative (e.g. "nuvance") and a dropdown is
  // simpler than a multi-chip control.
  label?: string;
  groupBy?: GroupBy;
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
  const toast = useToast();
  const { canWrite } = useAuth();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignees, setAssignees] = useState<ProjectAssignee[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [projectLabels, setProjectLabels] = useState<ProjectLabel[]>([]);
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
  const labelFilter: string = params.get("label") ?? "all";
  // Default to grouping by designer — that's the lens the team reaches for
  // most often ("what's on Alice's plate?"). An explicit ?group=none in the
  // URL or a stored preference still wins.
  const groupBy: GroupBy = (() => {
    const g = params.get("group");
    return g && VALID_GROUP_BY.has(g) ? (g as GroupBy) : "designer";
  })();
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
  const setLabelFilter = (l: string) => {
    const next = new URLSearchParams(params);
    if (l === "all") next.delete("label");
    else next.set("label", l);
    setParams(next, { replace: true });
  };
  const setGroupBy = (g: GroupBy) => {
    const next = new URLSearchParams(params);
    // "designer" is the default; strip the param so clean URLs stay clean.
    if (g === "designer") next.delete("group");
    else next.set("group", g);
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
    if (
      !params.has("label") &&
      stored.label &&
      stored.label !== "all"
    ) {
      next.set("label", stored.label);
      changed = true;
    }
    if (
      !params.has("group") &&
      stored.groupBy &&
      stored.groupBy !== "designer" &&
      VALID_GROUP_BY.has(stored.groupBy)
    ) {
      next.set("group", stored.groupBy);
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
      label: labelFilter,
      groupBy,
      sort,
    });
  }, [statusFilter, categoryFilter, designerFilter, labelFilter, groupBy, sort]);

  const refresh = async () => {
    const [pRes, aRes, profRes, lRes, plRes] = await Promise.all([
      supabase.from("projects").select("*").order("updated_at", { ascending: false }),
      supabase.from("project_assignees").select("*"),
      supabase.from("profiles").select("*"),
      supabase.from("labels").select("*").order("name"),
      supabase.from("project_labels").select("*"),
    ]);
    const error =
      pRes.error?.message ??
      aRes.error?.message ??
      profRes.error?.message ??
      lRes.error?.message ??
      plRes.error?.message ??
      null;
    if (error) setErr(error);
    setProjects(pRes.data ?? []);
    setAssignees(aRes.data ?? []);
    setProfiles(profRes.data ?? []);
    setLabels(lRes.data ?? []);
    setProjectLabels(plRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("projects-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_assignees" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "labels" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "project_labels" }, refresh)
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

  // Project-id → Set of label ids. Mirrors assigneesByProject so the row
  // renderer and the filter both do O(1) lookups instead of scanning the
  // join array each time.
  const labelsByProject = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const pl of projectLabels) {
      const set = map.get(pl.project_id) ?? new Set<string>();
      set.add(pl.label_id);
      map.set(pl.project_id, set);
    }
    return map;
  }, [projectLabels]);

  const labelById = useMemo(
    () => new Map(labels.map((l) => [l.id, l] as const)),
    [labels],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter === "active") {
        // "Active" is the default view: everything except parked statuses.
        // Backlog is still being scoped, Done is shipped, On hold is
        // explicitly paused — none belong in "what we're moving on now".
        if (
          p.status === "backlog" ||
          p.status === "done" ||
          p.status === "on_hold"
        )
          return false;
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
      if (labelFilter !== "all") {
        const projectLabelSet = labelsByProject.get(p.id);
        if (!projectLabelSet || !projectLabelSet.has(labelFilter)) return false;
      }
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [
    projects,
    query,
    statusFilter,
    categoryFilter,
    designerFilter,
    labelFilter,
    assigneesByProject,
    labelsByProject,
  ]);

  // Reference count used for the header total. "Active" here means the
  // same thing as the Active status filter — anything that's not parked
  // in Backlog or shipped as Done. This is the number the team actually
  // cares about as "how much is on our plate right now".
  const activeCount = useMemo(
    () =>
      projects.filter(
        (p) =>
          p.status !== "backlog" &&
          p.status !== "done" &&
          p.status !== "on_hold",
      ).length,
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

  // Break the sorted list into sections for the current group axis. When
  // groupBy === "none" we still return one section so the renderer has a
  // single code path. A project with multiple designers appears under each
  // of them when grouping by designer — we surface that lens instead of
  // picking a "primary" assignee. Within each section rows keep whatever
  // order `sortedFiltered` gave them.
  const grouped = useMemo(() => {
    type Group = {
      key: string;
      label: string | null;
      // Small visual affordance to the left of the label (category dot,
      // designer avatar). Undefined when the axis doesn't have one.
      leading?: React.ReactNode;
      projects: Project[];
    };

    if (groupBy === "none") {
      return [{ key: "all", label: null, projects: sortedFiltered } as Group];
    }

    if (groupBy === "category") {
      const by = new Map<ProjectCategory, Project[]>();
      for (const p of sortedFiltered) {
        const list = by.get(p.category) ?? [];
        list.push(p);
        by.set(p.category, list);
      }
      return (Object.keys(CATEGORY_LABEL) as ProjectCategory[])
        .filter((c) => by.has(c))
        .map<Group>((c) => ({
          key: `cat-${c}`,
          label: CATEGORY_LABEL[c],
          leading: (
            <span
              className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ background: CATEGORY_COLOR[c] }}
            />
          ),
          projects: by.get(c)!,
        }));
    }

    if (groupBy === "status") {
      const by = new Map<ProjectStatus, Project[]>();
      for (const p of sortedFiltered) {
        const list = by.get(p.status) ?? [];
        list.push(p);
        by.set(p.status, list);
      }
      return PROJECT_STATUS_ORDER.filter((s) => by.has(s)).map<Group>((s) => ({
        key: `status-${s}`,
        label: PROJECT_STATUS_LABEL[s],
        projects: by.get(s)!,
      }));
    }

    // groupBy === "designer"
    const byDesigner = new Map<string, Project[]>();
    const unassigned: Project[] = [];
    for (const p of sortedFiltered) {
      const team = assigneesByProject.get(p.id);
      if (!team || team.size === 0) {
        unassigned.push(p);
        continue;
      }
      for (const uid of team) {
        const list = byDesigner.get(uid) ?? [];
        list.push(p);
        byDesigner.set(uid, list);
      }
    }
    const designerGroups = [...profiles]
      .filter((pr) => byDesigner.has(pr.id))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
      .map<Group>((pr) => ({
        key: `designer-${pr.id}`,
        label: pr.full_name,
        leading: <Avatar profile={pr} size={18} />,
        projects: byDesigner.get(pr.id)!,
      }));
    if (unassigned.length > 0) {
      designerGroups.push({
        key: "designer-unassigned",
        label: "Unassigned",
        projects: unassigned,
      });
    }
    return designerGroups;
  }, [sortedFiltered, groupBy, assigneesByProject, profiles]);

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (err) return <div className="p-6 text-rose-700">Error: {err}</div>;

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">Projects</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Group-by axis. On md+ it sits next to the New project button —
              changing the grouping lens is closer in spirit to a view
              action than a filter, so it earns the header slot. On mobile
              the header gets crowded, so we hide this copy and render an
              identical select inside the filter row below. */}
          <select
            className="input w-auto hidden md:block"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group by"
          >
            {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((g) => (
              <option key={g} value={g}>
                {g === "none"
                  ? GROUP_BY_LABEL[g]
                  : `Group by ${GROUP_BY_LABEL[g].toLowerCase()}`}
              </option>
            ))}
          </select>
          {/* Creating projects is open to managers and designers
              (migration 008 loosened the insert policy). Hidden for
              viewers, who are read-only — RLS would reject the insert
              anyway, but the button shouldn't tease them. */}
          {canWrite && (
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => setCreating(true)}
            >
              New project
            </Button>
          )}
        </div>
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
        {/* Label filter. Only shown when the library has at least one
            label — no point in showing a dropdown with nothing to pick. */}
        {labels.length > 0 && (
          <select
            className="input w-auto"
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
          >
            <option value="all">All labels</option>
            {labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="input w-auto"
          value={designerFilter}
          onChange={(e) => setDesignerFilter(e.target.value)}
        >
          <option value="all">All designers</option>
          <option value="unassigned">Unassigned</option>
          {[...profiles]
            // Hide deactivated teammates from the filter dropdown so the
            // list isn't cluttered with people who shouldn't be picking
            // up new work. The selected value survives even if the user
            // gets deactivated mid-session — the option below keeps it in
            // the DOM so the <select> doesn't silently drop the filter.
            .filter(
              (p) => (p.is_active ?? true) || p.id === designerFilter,
            )
            .sort((a, b) => a.full_name.localeCompare(b.full_name))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
                {p.is_active === false ? " (inactive)" : ""}
              </option>
            ))}
        </select>
        {/* Mobile-only copy of the Group by select. Hidden at md+ where
            the header version is visible — keeps the header uncluttered
            on small screens while still putting the control within easy
            reach next to the rest of the filter chrome. */}
        <select
          className="input w-auto md:hidden"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          aria-label="Group by"
        >
          {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((g) => (
            <option key={g} value={g}>
              {g === "none"
                ? GROUP_BY_LABEL[g]
                : `Group by ${GROUP_BY_LABEL[g].toLowerCase()}`}
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
          hint="Clear filters or create a new project."
        />
      ) : (
        <div className="card overflow-x-auto">
          {/* min-w on the inner wrapper keeps the column layout from
              squishing on narrow viewports — instead the whole grid
              scrolls horizontally as a unit so header and rows stay
              aligned. Below the md breakpoint the user can swipe to see
              the right-hand columns.
              The 1000px floor is calibrated to give the flex-1 Project
              column a comfortable share: fixed columns (ID 56 + Category
              176 + Status 128 + Assigned 160 + Links 160) plus 5 gap-3
              spacers (~60) leave roughly 260px for the project name,
              which is enough to fit most names without truncation. */}
          <div className="min-w-[1000px]">
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
              <div className="w-44">
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
          <div>
            {grouped.map((group, gi) => (
              <div key={group.key}>
                {group.label !== null && (
                  /* Section header when grouping is active. Sticky so the
                     group label stays visible as you scan down a long
                     section. Different background from the main column
                     header above so they don't visually blur together. */
                  <div
                    className={`flex items-center gap-2 border-ink-200 bg-ink-100/70 px-4 py-1.5 text-xs font-semibold text-ink-700 ${
                      gi === 0 ? "border-t-0" : "border-t"
                    }`}
                  >
                    {group.leading}
                    <span>{group.label}</span>
                    <span className="font-normal text-ink-500 tabular-nums">
                      · {group.projects.length}
                    </span>
                  </div>
                )}
                <div className="divide-y divide-ink-100">
                  {group.projects.map((p) => {
                    const team = assignees
                      .filter((a) => a.project_id === p.id)
                      .map((a) => profiles.find((pr) => pr.id === a.user_id))
                      .filter((x): x is Profile => !!x);
                    return (
                      <Link
                        key={`${group.key}-${p.id}`}
                        to={`/projects/${p.id}`}
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-ink-100 transition ${
                          // On-hold rows render at reduced opacity so the
                          // eye skips past them when scanning the list —
                          // they're parked, not active work. Hover lifts
                          // back to full opacity so the row reads clearly
                          // when the user actually targets it.
                          p.status === "on_hold"
                            ? "opacity-50 hover:opacity-100"
                            : ""
                        }`}
                      >
                        {/* Short ID — fixed-width so rows align. Same Jira-style
                            identifier surfaced in the breadcrumb on the detail
                            page, so users can match what they see in the list
                            against what they've shared in Slack etc. */}
                        <div className="w-14 flex-shrink-0 font-mono text-xs tabular-nums text-ink-500">
                          {fmtProjectId(p.short_id)}
                        </div>
                        {/* Name + description — takes whatever space is left.
                            Label chips render to the right of the name on one
                            line; flex-shrink-0 on the chip container keeps them
                            from collapsing, and truncate on the name column
                            handles the overflow. */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-medium text-ink-900">
                              {p.name}
                            </div>
                            {(() => {
                              const ids = labelsByProject.get(p.id);
                              if (!ids || ids.size === 0) return null;
                              const chips: Label[] = [];
                              for (const id of ids) {
                                const l = labelById.get(id);
                                if (l) chips.push(l);
                              }
                              if (chips.length === 0) return null;
                              return (
                                <div className="flex flex-shrink-0 items-center gap-1">
                                  {chips.map((l) => (
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
                          <div className="flex w-44 items-center gap-2">
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
            ))}
          </div>
          </div>
        </div>
      )}

      {creating && (
        <NewProjectModal
          profiles={profiles}
          labels={labels}
          onLabelCreated={(l) =>
            setLabels((prev) =>
              prev.some((x) => x.id === l.id)
                ? prev
                : [...prev, l].sort((a, b) => a.name.localeCompare(b.name)),
            )
          }
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            // If the current filter would hide the fresh project (e.g. default
            // "Active projects" view hides Backlog), bump the filter to "all"
            // so the user actually sees what they just made.
            const hidden =
              (statusFilter === "active" &&
                (created.status === "backlog" ||
                  created.status === "done" ||
                  created.status === "on_hold")) ||
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
  labels,
  onLabelCreated,
  onClose,
  onCreated,
}: {
  profiles: Profile[];
  labels: Label[];
  onLabelCreated: (label: Label) => void;
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
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Include managers — they may contribute to the project themselves.
  const team = [...profiles].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  );

  // Create + auto-apply a new label. Dedupes against existing names so a
  // user hammering "create" with the same string doesn't hit the UNIQUE
  // constraint on labels.name.
  const handleCreateLabel = async () => {
    const canonical = newLabelName.trim().toLowerCase();
    if (!canonical) return;
    const existing = labels.find((l) => l.name.toLowerCase() === canonical);
    if (existing) {
      if (!selectedLabels.includes(existing.id))
        setSelectedLabels((prev) => [...prev, existing.id]);
      setNewLabelName("");
      return;
    }
    const { data, error } = await supabase
      .from("labels")
      .insert({ name: canonical })
      .select()
      .single();
    if (error || !data) {
      setErr(error?.message ?? "Failed to create label");
      return;
    }
    onLabelCreated(data as Label);
    setSelectedLabels((prev) => [...prev, data.id]);
    setNewLabelName("");
  };

  const submit = async () => {
    if (!name.trim() || !profile) return;
    setBusy(true);
    setErr(null);
    const cleanedLinks = links
      .map((l) => {
        const title = l.title?.trim();
        const cleaned: ProjectLink = { type: l.type, url: l.url.trim() };
        if (title) cleaned.title = title;
        return cleaned;
      })
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
    if (selectedLabels.length > 0) {
      const { error: lErr } = await supabase
        .from("project_labels")
        .insert(
          selectedLabels.map((lid) => ({
            project_id: data.id,
            label_id: lid,
          })),
        );
      if (lErr) {
        setErr(lErr.message);
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
        <Field label="Labels">
          {/* Toggle chips across the entire library. Colored-in when
              applied, neutral when off. New labels can be created inline
              without leaving the modal. */}
          <div className="flex flex-wrap items-center gap-1">
            {labels.map((l) => {
              const selected = selectedLabels.includes(l.id);
              return (
                <button
                  type="button"
                  key={l.id}
                  onClick={() =>
                    setSelectedLabels((prev) =>
                      selected ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                    )
                  }
                  className="chip"
                  style={
                    selected
                      ? { background: l.color, color: "white" }
                      : {
                          background: "#f1f5f9",
                          color: "#334155",
                          border: `1px solid ${l.color}`,
                        }
                  }
                >
                  {l.name}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              className="input h-8 w-48 text-xs"
              placeholder="New label…"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateLabel();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void handleCreateLabel()}
              className="btn btn-secondary"
              disabled={!newLabelName.trim()}
            >
              <Plus size={14} />
              Add label
            </button>
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
                  className="input sm:w-32"
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
                {/* Optional title. Blank = fall back to the type name. */}
                <input
                  className="input sm:w-40"
                  value={link.title ?? ""}
                  onChange={(e) =>
                    setLinks((prev) => {
                      const next = [...prev];
                      next[i] = { ...next[i], title: e.target.value };
                      return next;
                    })
                  }
                  placeholder="Title (optional)"
                />
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
                // Default to "figma" — that's the overwhelming majority of
                // what the team pastes in; type can always be changed.
                setLinks((prev) => [...prev, { type: "figma", url: "" }])
              }
              className="btn btn-secondary"
            >
              <Plus size={14} />
              Add link
            </button>
          </div>
        </Field>
        {err && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
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
