// Confirmation modal for deleting a project. The DB foreign key on
// tasks.project_id is ON DELETE RESTRICT (migration 023), so the DB
// will refuse to delete a project that still has tasks — the modal
// is the only legitimate path. It forces an explicit choice:
//
//   * 0 tasks  → simple confirm, single primary button.
//   * N tasks  → pick one of:
//       - move all tasks to another project, or
//       - delete every task along with the project (type-to-confirm).
//
// All "deletes" are soft (deleted_at = now()), gated by RLS so the
// rows disappear from the UI. The actual writes go through the
// delete_project_with_tasks / restore_project_with_tasks RPCs
// (migration 025) — those run SECURITY DEFINER so they can flip the
// flags past the SELECT policy that would otherwise reject the UPDATE
// (the post-update row would be invisible to SELECT, which Postgres
// treats as an RLS violation). The RPCs still enforce can_write() for
// authorization. They also bundle the task disposition and the project
// delete into one transaction, so a half-applied state is impossible.
//
// On success we snapshot the affected task IDs returned by the RPC and
// surface an "Undo" toast that calls restore_project_with_tasks for
// ~10 seconds. After the toast expires the rows linger in the DB
// (invisible to SELECT) until a future cleanup job hard-deletes them.
// Type-to-confirm is kept as friction even with undo — it's a backstop,
// not a replacement.
//
// We deliberately fetch the list of "other projects" inside the modal
// (lazy, on open) instead of pushing that responsibility onto every
// caller — ProjectDetail only loads its own project today.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Project } from "../lib/types";
import { ProjectCombobox } from "./ProjectCombobox";
import { useToast } from "./Toast";
import { Button, Modal, Spinner } from "./ui";

type Disposition = "reassign" | "deleteTasks";

export function DeleteProjectModal({
  open,
  onClose,
  project,
  taskCount,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  taskCount: number;
  /** Called after the project (and any chosen task disposition) is deleted. */
  onDeleted: () => void;
}) {
  const toast = useToast();
  const hasTasks = taskCount > 0;

  const [disposition, setDisposition] = useState<Disposition>("reassign");
  const [targetProjectId, setTargetProjectId] = useState<string>("");
  const [confirmText, setConfirmText] = useState("");
  const [otherProjects, setOtherProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset every time the modal is opened so a previous attempt's state
  // doesn't bleed into the next one (e.g. typed confirm text lingering).
  useEffect(() => {
    if (!open) return;
    setDisposition("reassign");
    setTargetProjectId("");
    setConfirmText("");
    setErr(null);
    setSubmitting(false);
  }, [open]);

  // Lazy-load the picker list — only when the modal is actually open and
  // there are tasks to move. No need to fetch when the user is just
  // confirming an empty project.
  useEffect(() => {
    if (!open || !hasTasks) return;
    let cancelled = false;
    (async () => {
      setLoadingProjects(true);
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .neq("id", project.id)
        .order("name");
      if (cancelled) return;
      if (error) {
        setErr(error.message);
        setOtherProjects([]);
      } else {
        setOtherProjects((data ?? []) as Project[]);
      }
      setLoadingProjects(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hasTasks, project.id]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!hasTasks) return true;
    if (disposition === "reassign") return !!targetProjectId;
    // deleteTasks — require the user to type the project name verbatim.
    // Trim trailing whitespace but keep case sensitivity so this stays a
    // deliberate action and not a muscle-memory autocomplete.
    return confirmText.trim() === project.name;
  }, [submitting, hasTasks, disposition, targetProjectId, confirmText, project.name]);

  const submit = async () => {
    setErr(null);
    setSubmitting(true);

    // All of the soft-delete work goes through a SECURITY DEFINER RPC
    // (migration 025). It runs as the table owner so it can write
    // deleted_at past the SELECT RLS filter that would otherwise reject
    // the UPDATE — the function still enforces can_write() for caller
    // authorization. As a bonus, the whole thing runs atomically: task
    // disposition + project delete either both succeed or both fail.
    const dispositionKey: "noop" | "reassign" | "deleteTasks" = !hasTasks
      ? "noop"
      : disposition;

    const { data: affectedIds, error } = await supabase.rpc(
      "delete_project_with_tasks",
      {
        p_project_id: project.id,
        p_disposition: dispositionKey,
        p_target_project_id:
          dispositionKey === "reassign" ? targetProjectId : null,
      },
    );
    if (error) {
      setSubmitting(false);
      setErr(error.message);
      toast(`Couldn't delete project: ${error.message}`, "error");
      return;
    }

    const affectedTaskIds: string[] = Array.isArray(affectedIds)
      ? (affectedIds as string[])
      : [];

    const msg = !hasTasks
      ? `Project "${project.name}" deleted`
      : disposition === "reassign"
        ? `Moved ${taskCount} ${taskCount === 1 ? "task" : "tasks"} and deleted project`
        : `Deleted project and ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;

    // Capture everything the undo handler needs in a closure. We do
    // NOT depend on component state here — the modal will be unmounted
    // by the time the user clicks Undo, but the toast (rendered at app
    // root) persists across that unmount and keeps this closure alive.
    const undoProjectId = project.id;
    const undoDispositionKey = dispositionKey;
    const undoTaskIds = affectedTaskIds;
    toast(msg, {
      action: {
        label: "Undo",
        onClick: async () => {
          // Symmetrically routed through an RPC for the same RLS
          // reasons (see migration 025). If another user moved one of
          // the reassigned tasks elsewhere in the undo window, the
          // restore will clobber that — acceptable trade-off for a
          // ~10-second window.
          const { error: rErr } = await supabase.rpc(
            "restore_project_with_tasks",
            {
              p_project_id: undoProjectId,
              p_disposition: undoDispositionKey,
              p_task_ids: undoTaskIds.length > 0 ? undoTaskIds : null,
            },
          );
          if (rErr) {
            toast(`Undo failed: ${rErr.message}`, "error");
            return;
          }
          toast("Project restored");
        },
      },
    });
    onDeleted();
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Delete project"
      dismissOnBackdropClick={!submitting}
    >
      <div className="space-y-4 text-sm text-ink-900">
        <p>
          Delete <span className="font-semibold">{project.name}</span>?
        </p>

        {hasTasks ? (
          <>
            <p className="text-ink-700">
              This project has{" "}
              <span className="font-semibold">
                {taskCount} {taskCount === 1 ? "task" : "tasks"}
              </span>
              . What should happen to{" "}
              {taskCount === 1 ? "it" : "them"}?
            </p>

            <div className="space-y-2">
              <label className="flex items-start gap-2 rounded-md border border-ink-200 p-3 hover:bg-ink-50">
                <input
                  type="radio"
                  name="task-disposition"
                  className="mt-0.5"
                  checked={disposition === "reassign"}
                  onChange={() => setDisposition("reassign")}
                />
                <div className="flex-1">
                  <div className="font-medium">Move tasks to another project</div>
                  <div className="text-xs text-ink-500">
                    {taskCount === 1 ? "The task keeps" : "Tasks keep"} all comments,
                    assignees, and history.
                  </div>
                  {disposition === "reassign" && (
                    <div className="mt-2">
                      {loadingProjects ? (
                        <div className="flex items-center gap-2 text-ink-500">
                          <Spinner /> <span>Loading projects…</span>
                        </div>
                      ) : otherProjects.length === 0 ? (
                        <p className="text-xs text-rose-700">
                          No other projects exist. Create one first, or choose
                          to delete the {taskCount === 1 ? "task" : "tasks"} instead.
                        </p>
                      ) : (
                        <ProjectCombobox
                          value={targetProjectId}
                          onChange={setTargetProjectId}
                          projects={otherProjects}
                          placeholder="Pick a destination project"
                          className="w-full"
                        />
                      )}
                    </div>
                  )}
                </div>
              </label>

              <label className="flex items-start gap-2 rounded-md border border-ink-200 p-3 hover:bg-ink-50">
                <input
                  type="radio"
                  name="task-disposition"
                  className="mt-0.5"
                  checked={disposition === "deleteTasks"}
                  onChange={() => setDisposition("deleteTasks")}
                />
                <div className="flex-1">
                  <div className="font-medium">
                    Delete {taskCount === 1 ? "the task" : `all ${taskCount} tasks`} too
                  </div>
                  <div className="text-xs text-ink-500">
                    Comments and history go with them. You can undo from
                    the toast for a few seconds; after that it&rsquo;s gone.
                  </div>
                  {disposition === "deleteTasks" && (
                    <div className="mt-2">
                      <label className="block text-xs text-ink-700">
                        Type{" "}
                        <span className="font-mono font-semibold">{project.name}</span>{" "}
                        to confirm
                      </label>
                      <input
                        className="input mt-1 w-full"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        placeholder={project.name}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  )}
                </div>
              </label>
            </div>
          </>
        ) : (
          <p className="text-ink-700">
            This project has no tasks. You can undo from the toast for a
            few seconds.
          </p>
        )}

        {err && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} disabled={submitting} autoFocus>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit}
            className="bg-rose-600 hover:bg-rose-700"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Spinner /> Deleting…
              </span>
            ) : (
              "Delete project"
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
