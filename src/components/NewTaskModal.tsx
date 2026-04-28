import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import {
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_ORDER,
  type Priority,
  type Profile,
  type Project,
  type Task,
  type TaskStatus,
} from "../lib/types";
import { Button, Modal, Spinner } from "./ui";

// Shared "create a new task" modal. Used from the TaskBoard's "+ New task"
// button (no project pre-selected) and from the ProjectDetail "Add task"
// button (project pre-filled and locked to the current project so the
// task lands inside the section the user is looking at). Pulled out into
// its own component because both call sites would otherwise duplicate the
// same insert / RLS / position-bumping logic.
//
// `defaultProjectId` seeds the project picker. `lockProject` hides the
// project field entirely — useful when the modal is invoked from a
// project's own page, where the project is implied and changing it would
// be confusing.
export interface NewTaskModalProps {
  projects: Project[];
  profiles: Profile[];
  defaultProjectId: string | null;
  lockProject?: boolean;
  onClose: () => void;
  onCreated: (task: Task) => void;
}

export default function NewTaskModal({
  projects,
  profiles,
  defaultProjectId,
  lockProject = false,
  onClose,
  onCreated,
}: NewTaskModalProps) {
  const { profile, isManager } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? "");
  // Designers can self-assign; managers can assign anyone (DB RLS
  // enforces this on the write side too).
  const [assigneeId, setAssigneeId] = useState<string>(
    isManager ? "" : profile?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || !profile) return;
    setBusy(true);
    setErr(null);
    // New tasks land at the top of their column. The board sorts by
    // `position` ascending, so we pick one less than the current minimum
    // for this status. Default position is 0, so the first card we create
    // this way will get -1, the next -2, and so on — leaving room to
    // manually reorder without collisions.
    const { data: topRow } = await supabase
      .from("tasks")
      .select("position")
      .eq("status", status)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    const nextPosition = ((topRow?.position as number | undefined) ?? 0) - 1;

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        due_date: dueDate || null,
        project_id: projectId || null,
        assignee_id: assigneeId || null,
        created_by: profile.id,
        position: nextPosition,
      })
      .select()
      .single();
    if (error || !data) {
      setErr(error?.message ?? "Failed to create task");
      setBusy(false);
      return;
    }
    onCreated(data);
  };

  // Anyone on the team can be assigned — managers often self-assign work too.
  // New tasks never carry a pre-assigned inactive user, so it's safe to
  // filter the picker down to active teammates here. Existing assignments
  // on already-created tasks are handled separately in TaskDetail.
  const team = [...profiles]
    .filter((p) => p.is_active ?? true)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <Modal open title="New task" onClose={onClose} wide>
      <div className="space-y-3">
        <Field label="Title">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. [DESIGN] Nuvance Norwalk PCI"
            autoFocus
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
          <Field label="Status">
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {TASK_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
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
              {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
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
          {!lockProject && (
            <Field label="Project">
              <select
                className="input"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">— No project —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Assignee">
            {isManager ? (
              <select
                className="input"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
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
              <div className="input bg-ink-50 text-ink-600">
                {profile?.full_name} (you)
              </div>
            )}
          </Field>
        </div>
        {err && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || !title.trim()}
          >
            {busy ? <Spinner /> : "Create task"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </span>
      {children}
    </label>
  );
}
