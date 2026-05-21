import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FolderKanban,
  RefreshCw,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  Button,
  EmptyState,
  Spinner,
  formatDate,
} from "../../components/ui";
import { supabase } from "../../lib/supabase";
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  type ProjectCategory,
  type Profile,
  type Project,
  type Task,
} from "../../lib/types";
import type { ReportDef } from "../../lib/reports";
import {
  BarRow,
  ProjectRow,
  ReportHeader,
  Section,
  Stat,
  groupBy,
  todayLocalMidnight,
} from "./_shared";

// Quarterly recap — 90-day rollup, with the prior 90 days shown as a
// comparison baseline. Designed for performance-review prep and for
// telling the team's story upward.
//
// Sections:
//   * Stats (this period totals, vs prior period as delta arrows)
//   * Throughput per designer
//   * Projects shipped by category
//   * Highlights — biggest projects we delivered

const PERIOD_DAYS = 90;

interface RecapData {
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
}

export default function QuarterlyRecap({ report }: { report: ReportDef }) {
  const [data, setData] = useState<RecapData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [projectsRes, tasksRes, profilesRes] = await Promise.all([
      supabase.from("projects").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("*"),
    ]);
    const error =
      projectsRes.error?.message ??
      tasksRes.error?.message ??
      profilesRes.error?.message ??
      null;
    if (error) setErr(error);
    setData({
      projects: projectsRes.data ?? [],
      tasks: tasksRes.data ?? [],
      profiles: profilesRes.data ?? [],
    });
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (err) {
    return (
      <div className="p-4 sm:p-6 pb-20 space-y-6">
        <ReportHeader report={report} />
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          Couldn't load the report: {err}
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const today = todayLocalMidnight();
  const periodStart = new Date(today.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const priorStart = new Date(today.getTime() - 2 * PERIOD_DAYS * 24 * 60 * 60 * 1000);

  const team = [...data.profiles]
    .filter((p) => (p.is_active ?? true) && p.role !== "viewer")
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  // ---------- Period buckets ----------
  // "This period" = the most recent 90 days.
  // "Prior period" = the 90 days before that.
  // Both windows are half-open at the start, closed at the end — a
  // task completed exactly on `periodStart` falls in This Period.
  const thisTasks = data.tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completed_at &&
      new Date(t.completed_at) >= periodStart,
  );
  const priorTasks = data.tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completed_at &&
      new Date(t.completed_at) >= priorStart &&
      new Date(t.completed_at) < periodStart,
  );
  const thisProjects = data.projects.filter(
    (p) =>
      p.status === "done" &&
      p.completed_at &&
      new Date(p.completed_at) >= periodStart,
  );
  const priorProjects = data.projects.filter(
    (p) =>
      p.status === "done" &&
      p.completed_at &&
      new Date(p.completed_at) >= priorStart &&
      new Date(p.completed_at) < periodStart,
  );

  // ---------- Per-designer throughput ----------
  const thisByDesigner = groupBy(thisTasks, (t) => t.assignee_id ?? "unassigned");
  const priorByDesigner = groupBy(priorTasks, (t) => t.assignee_id ?? "unassigned");
  const designerRows = team
    .map((d) => ({
      designer: d,
      count: (thisByDesigner.get(d.id) ?? []).length,
      prior: (priorByDesigner.get(d.id) ?? []).length,
    }))
    .sort((a, b) => b.count - a.count);
  const maxDesignerCount = Math.max(1, ...designerRows.map((r) => r.count));

  // ---------- Projects by category ----------
  const thisProjectsByCategory = groupBy(thisProjects, (p) => p.category);
  const categoryRows = (Object.keys(CATEGORY_LABEL) as ProjectCategory[])
    .map((cat) => ({
      category: cat,
      count: (thisProjectsByCategory.get(cat) ?? []).length,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxCategoryCount = Math.max(1, ...categoryRows.map((r) => r.count));

  // Active teammate count vs prior — useful narrative context for the
  // throughput numbers (gaining or losing capacity changes everything).
  const activeTeamSize = team.length;

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-6">
      <ReportHeader
        report={report}
        subtitle={`${formatDate(periodStart.toISOString())} → ${formatDate(today.toISOString())}  (vs. prior ${PERIOD_DAYS} days)`}
        trailing={
          <Button
            variant="ghost"
            icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />}
            onClick={() => void load()}
            disabled={refreshing}
          >
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DeltaStat
          icon={<CheckCircle2 size={18} />}
          label="Tasks shipped"
          value={thisTasks.length}
          prior={priorTasks.length}
          tone="emerald"
        />
        <DeltaStat
          icon={<FolderKanban size={18} />}
          label="Projects shipped"
          value={thisProjects.length}
          prior={priorProjects.length}
          tone="emerald"
        />
        <Stat
          icon={<Users size={18} />}
          label="Active teammates"
          value={activeTeamSize}
        />
        <Stat
          icon={<CheckCircle2 size={18} />}
          label="Tasks/person this period"
          // Per-head throughput. Floor to one decimal so a team of 3
          // averaging 17.6 tasks/person doesn't display as a confusing
          // long float.
          value={
            activeTeamSize > 0
              ? (thisTasks.length / activeTeamSize).toFixed(1)
              : "—"
          }
        />
      </div>

      <Section
        title="Throughput per designer"
        hint={`Tasks completed in the last ${PERIOD_DAYS} days. Δ compares to the prior ${PERIOD_DAYS}-day window.`}
      >
        {designerRows.every((r) => r.count === 0) ? (
          <EmptyState
            title="No tasks completed in this period"
            hint="If that's a surprise, it's worth a look — either work isn't being marked done, or the team had a quiet quarter."
          />
        ) : (
          <div className="space-y-3">
            {designerRows.map((r) => (
              <BarRow
                key={r.designer.id}
                label={
                  <span className="flex items-center gap-2">
                    <span>{r.designer.full_name}</span>
                    <DeltaPill curr={r.count} prior={r.prior} />
                  </span>
                }
                count={r.count}
                percent={(r.count / maxDesignerCount) * 100}
                color="bg-brand-500"
                icon={<Avatar profile={r.designer} size={28} />}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Projects shipped by category"
        hint={`Categories with no shipped work in the last ${PERIOD_DAYS} days are hidden.`}
      >
        {categoryRows.length === 0 ? (
          <EmptyState title="No projects shipped in this period" />
        ) : (
          <div className="space-y-3">
            {categoryRows.map((r) => (
              <BarRow
                key={r.category}
                label={
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: CATEGORY_COLOR[r.category] }}
                    />
                    <span>{CATEGORY_LABEL[r.category]}</span>
                  </span>
                }
                count={r.count}
                percent={(r.count / maxCategoryCount) * 100}
                color="bg-brand-500"
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Highlights — projects we shipped"
        hint="Most-recently completed first. Useful raw material when writing up the quarter."
      >
        {thisProjects.length === 0 ? (
          <EmptyState title="No projects shipped in this period" />
        ) : (
          <ul className="space-y-1.5">
            {[...thisProjects]
              .sort(
                (a, b) =>
                  new Date(b.completed_at!).getTime() -
                  new Date(a.completed_at!).getTime(),
              )
              .map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  trailing={<span>{CATEGORY_LABEL[p.category]}</span>}
                />
              ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ---------- Local sub-components ----------

// Stat with a small delta vs a prior-period value rendered underneath
// the headline number. Up arrows in emerald, down in rose, flat in
// muted ink. We don't render a percentage — the absolute delta reads
// fine at these volumes and percentages on small denominators are
// noisy (going from 1 task to 2 isn't really "+100%").
function DeltaStat({
  icon,
  label,
  value,
  prior,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  prior: number;
  tone?: "rose" | "emerald";
}) {
  const delta = value - prior;
  const toneCls =
    tone === "rose"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
      : tone === "emerald"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
        : "bg-ink-100 text-ink-700";
  return (
    <div className="card flex items-center gap-3 p-4">
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${toneCls}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-semibold text-ink-900">{value}</div>
        <div className="flex items-center gap-1 text-xs text-ink-500">
          <span>{label}</span>
          <DeltaBadge delta={delta} prior={prior} />
        </div>
      </div>
    </div>
  );
}

function DeltaBadge({ delta, prior }: { delta: number; prior: number }) {
  if (delta === 0) {
    return (
      <span className="inline-flex items-center text-ink-400">
        <ArrowRight size={11} className="mr-0.5" />
        flat
      </span>
    );
  }
  const positive = delta > 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  const cls = positive
    ? "text-emerald-600 dark:text-emerald-300"
    : "text-rose-600 dark:text-rose-300";
  return (
    <span className={`inline-flex items-center ${cls}`} title={`Prior period: ${prior}`}>
      <Icon size={11} className="mr-0.5" />
      {positive ? "+" : ""}
      {delta}
    </span>
  );
}

// Inline delta pill used next to each designer's name. Compact enough
// to sit on the same line as the bar label without crowding the count.
function DeltaPill({ curr, prior }: { curr: number; prior: number }) {
  const delta = curr - prior;
  if (delta === 0)
    return <span className="text-xs text-ink-400">±0 vs prior</span>;
  const positive = delta > 0;
  return (
    <span
      className={`text-xs ${positive ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}
      title={`Prior period: ${prior}`}
    >
      {positive ? "+" : ""}
      {delta} vs prior
    </span>
  );
}
