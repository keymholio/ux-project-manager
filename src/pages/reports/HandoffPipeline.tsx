import {
  AlertTriangle,
  Hammer,
  HandHelping,
  RefreshCw,
  ShieldCheck,
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
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  TASK_TYPE_LABEL,
  isTaskActive,
  type Profile,
  type Project,
  type StatusEvent,
  type Task,
  type TaskType,
} from "../../lib/types";
import type { ReportDef } from "../../lib/reports";
import {
  ProjectRow,
  ReportHeader,
  Section,
  Stat,
  TaskRow,
  daysBetween,
  groupBy,
  todayLocalMidnight,
} from "./_shared";

// Handoff & VDQA pipeline — focused view on the design → dev → QA flow.
//
// Same data-shape caveat as the Cycle Time report: "time in stage" is
// approximated by days-since-last-edit. A stage transition resets the
// clock, but so does any other field change. The numbers still surface
// stalled handoffs reliably — just don't read them as a precise SLA.

// Narrow tuple types here (rather than ProjectStatus[] / TaskType[]) so
// `PIPELINE_STAGES[number]` resolves to the three-stage union — that's
// what makes the STAGE_ICONS record's keys check out, and what makes
// the stageHint switch statement exhaustive.
const PIPELINE_STAGES = ["hand_off", "in_development", "vdqa"] as const;
type PipelineStage = (typeof PIPELINE_STAGES)[number];
const VDQA_TASK_TYPES: TaskType[] = ["handoff", "vdqa", "vdqa_r1", "vdqa_r2", "vdqa_int"];
const STALE_DAYS = 7;

interface PipeData {
  projects: Project[];
  tasks: Task[];
  profiles: Profile[];
  events: StatusEvent[];
}

const STAGE_ICONS: Record<PipelineStage, typeof HandHelping> = {
  hand_off: HandHelping,
  in_development: Hammer,
  vdqa: ShieldCheck,
};

export default function HandoffPipeline({ report }: { report: ReportDef }) {
  const [data, setData] = useState<PipeData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [projectsRes, tasksRes, profilesRes, eventsRes] = await Promise.all([
      supabase.from("projects").select("*"),
      supabase.from("tasks").select("*"),
      supabase.from("profiles").select("*"),
      // For the pipeline view we only need the *latest* event per
      // subject (to compute time-in-current-stage). Fetching the full
      // history is fine at this scale; the groupBy below picks the
      // last event for each subject.
      supabase
        .from("status_history")
        .select("*")
        .order("changed_at", { ascending: true }),
    ]);
    const error =
      projectsRes.error?.message ??
      tasksRes.error?.message ??
      profilesRes.error?.message ??
      eventsRes.error?.message ??
      null;
    if (error) setErr(error);
    setData({
      projects: projectsRes.data ?? [],
      tasks: tasksRes.data ?? [],
      profiles: profilesRes.data ?? [],
      events: eventsRes.data ?? [],
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
  const profileById = new Map(data.profiles.map((p) => [p.id, p]));
  const projectById = new Map(data.projects.map((p) => [p.id, p]));

  // Build a "latest event per subject" lookup. Events are sorted
  // ascending by changed_at on the way in, so the last value written
  // to each map key is the latest event for that subject. For projects
  // / tasks that only have a backfilled event (no transition yet) the
  // "latest event" is the synthetic created_at one, which is what we
  // want — time-in-current-stage equals time-since-creation for them.
  const latestProjectEvent = new Map<string, StatusEvent>();
  const latestTaskEvent = new Map<string, StatusEvent>();
  for (const e of data.events) {
    if (e.project_id) latestProjectEvent.set(e.project_id, e);
    else if (e.task_id) latestTaskEvent.set(e.task_id, e);
  }

  // Time in current stage = now - latest event's changed_at. Falls
  // back to updated_at if no event row exists (shouldn't happen after
  // migration 021 backfills, but defensive).
  const daysInStageForProject = (p: Project) => {
    const e = latestProjectEvent.get(p.id);
    return daysBetween(e?.changed_at ?? p.updated_at, today);
  };
  const daysInStageForTask = (t: Task) => {
    const e = latestTaskEvent.get(t.id);
    return daysBetween(e?.changed_at ?? t.updated_at, today);
  };

  // Projects currently in any pipeline stage. Sort each bucket by age
  // (oldest update first) so the items most worth a nudge surface to
  // the top. The cast on `includes` is needed because PIPELINE_STAGES
  // is a readonly tuple of literal stages; `p.status` is the wider
  // ProjectStatus union, so TS won't accept it directly.
  const pipelineProjects = data.projects.filter((p) =>
    (PIPELINE_STAGES as readonly string[]).includes(p.status),
  );
  const projectsByStage = groupBy(pipelineProjects, (p) => p.status as PipelineStage);

  // VDQA-typed tasks. We include handoff alongside the four VDQA types
  // because they're the same workflow from the team's perspective — the
  // designer "hands off", QA "reviews".
  const pipelineTasks = data.tasks.filter(
    (t) => VDQA_TASK_TYPES.includes(t.task_type) && isTaskActive(t.status),
  );

  // "Stalled" = sitting in the current stage for ≥ STALE_DAYS.
  // Uses the status_history-derived in-stage time (not updated_at), so
  // unrelated field edits don't reset the counter.
  const stalledProjects = pipelineProjects.filter(
    (p) => daysInStageForProject(p) >= STALE_DAYS,
  );
  const stalledTasks = pipelineTasks.filter(
    (t) => daysInStageForTask(t) >= STALE_DAYS,
  );

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-6">
      <ReportHeader
        report={report}
        subtitle="Design → development → QA. What's sitting where, and for how long."
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
        {PIPELINE_STAGES.map((stage) => {
          const Icon = STAGE_ICONS[stage];
          return (
            <Stat
              key={stage}
              icon={<Icon size={18} />}
              label={PROJECT_STATUS_LABEL[stage]}
              value={(projectsByStage.get(stage) ?? []).length}
            />
          );
        })}
        <Stat
          icon={<AlertTriangle size={18} />}
          label={`Stalled (${STALE_DAYS}d+)`}
          value={stalledProjects.length + stalledTasks.length}
          tone={stalledProjects.length + stalledTasks.length > 0 ? "rose" : undefined}
        />
      </div>

      <p className="text-xs text-ink-500">
        Time in stage is measured from the last status change (via the
        status_history ledger, migration 021). Items created before that
        migration ran show time-in-stage based on their backfill event,
        which equals their creation date — accurate for anything created
        in its current stage, an overestimate for items that moved
        before history was being captured.
      </p>

      {PIPELINE_STAGES.map((stage) => {
        // Sort within each bucket by "longest in stage first" — the
        // items most worth a nudge sit at the top. Uses the
        // status_history-derived time, not updated_at.
        const items = (projectsByStage.get(stage) ?? [])
          .slice()
          .sort((a, b) => daysInStageForProject(b) - daysInStageForProject(a));
        const Icon = STAGE_ICONS[stage];
        return (
          <Section
            key={stage}
            title={`${PROJECT_STATUS_LABEL[stage]} (${items.length})`}
            hint={stageHint(stage)}
          >
            {items.length === 0 ? (
              <EmptyState
                title={`Nothing in ${PROJECT_STATUS_LABEL[stage].toLowerCase()}`}
              />
            ) : (
              <ul className="space-y-1.5">
                {items.map((p) => {
                  const days = daysInStageForProject(p);
                  const owner = profileById.get(p.owner_id) ?? null;
                  return (
                    <ProjectRow
                      key={p.id}
                      project={p}
                      trailing={
                        <span className="flex items-center gap-2">
                          {owner && <Avatar profile={owner} size={16} />}
                          <span>
                            <Icon
                              size={11}
                              className="mr-1 inline align-[-1px] text-ink-400"
                            />
                            {days}d in stage
                          </span>
                        </span>
                      }
                      emphasizeTrailing={days >= STALE_DAYS ? "rose" : undefined}
                    />
                  );
                })}
              </ul>
            )}
          </Section>
        );
      })}

      <Section
        title={`VDQA-type tasks (${pipelineTasks.length})`}
        hint="Active tasks tagged Hand-off, VDQA, R1, R2, or Internal review."
      >
        {pipelineTasks.length === 0 ? (
          <EmptyState title="No active VDQA-typed tasks" />
        ) : (
          <ul className="space-y-1.5">
            {pipelineTasks
              .slice()
              .sort((a, b) => daysInStageForTask(b) - daysInStageForTask(a))
              .map((t) => {
                const days = daysInStageForTask(t);
                return (
                  <TaskRow
                    key={t.id}
                    task={t}
                    project={t.project_id ? projectById.get(t.project_id) : undefined}
                    assignee={
                      t.assignee_id ? profileById.get(t.assignee_id) ?? null : null
                    }
                    trailing={
                      <span>
                        {TASK_TYPE_LABEL[t.task_type]} ·{" "}
                        {TASK_STATUS_LABEL[t.status]} · {days}d
                      </span>
                    }
                    emphasizeTrailing={days >= STALE_DAYS ? "rose" : undefined}
                  />
                );
              })}
          </ul>
        )}
      </Section>

      <Section
        title="When did this last move?"
        hint="A timeline of when each pipeline project last changed status. Same item at the top two weeks running = that's the conversation to have."
      >
        <ul className="space-y-1.5">
          {[...pipelineProjects]
            .sort(
              (a, b) =>
                daysInStageForProject(b) - daysInStageForProject(a),
            )
            .slice(0, 8)
            .map((p) => {
              const e = latestProjectEvent.get(p.id);
              const lastMoved = e?.changed_at ?? p.updated_at;
              return (
                <ProjectRow
                  key={p.id}
                  project={p}
                  trailing={
                    <span>
                      {PROJECT_STATUS_LABEL[p.status]} ·{" "}
                      {formatDate(lastMoved)}
                    </span>
                  }
                />
              );
            })}
        </ul>
      </Section>
    </div>
  );
}

// Plain-language note for each stage's section. Worth saying explicitly
// so a manager scanning the page knows what a high count in each row
// actually implies.
function stageHint(stage: PipelineStage): string {
  switch (stage) {
    case "hand_off":
      return "Design is done, waiting on the dev team to pick it up. Long stays here usually mean a kickoff conversation is overdue.";
    case "in_development":
      return "Dev is building. We expect these to sit a while — only the very stale ones need a follow-up.";
    case "vdqa":
      return "Visual / design QA. Long stays here are usually a designer queue issue, not a dev one.";
  }
}
