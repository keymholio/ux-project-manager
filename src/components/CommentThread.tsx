import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import type { Comment, Profile } from "../lib/types";
import {
  Avatar,
  Button,
  Linkify,
  Spinner,
  formatRelative,
  type Mention,
  type UserMentions,
} from "./ui";

// One thread, targeted at either a project or a task. Exactly one of
// `projectId` / `taskId` is expected.
export default function CommentThread({
  projectId,
  taskId,
}: {
  projectId?: string;
  taskId?: string;
}) {
  const { profile, isManager, canWrite } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // Map of `P-12` / `T-45` → href + name, used by Linkify to turn
  // `@P-12` mentions in a comment body into clickable links. Built once
  // on mount from `projects` and `tasks` so the lookup is O(1) per
  // mention. Unknown IDs (deleted, typo, etc.) fall back to plain text
  // inside Linkify.
  const [mentions, setMentions] = useState<Record<string, Mention>>({});
  // Map of lowercase first-name → full display name for user @mentions.
  // Built alongside `profiles` so Linkify can render @FirstName chips and
  // the submit handler can resolve mentioned users for notifications.
  const [userMentions, setUserMentions] = useState<UserMentions>({});
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Inline edit state. Only one comment can be in edit mode at a time —
  // `editingId` doubles as the open/closed flag. `editBody` is the
  // working copy of the textarea; on save we diff against the server
  // row and skip the round trip if nothing actually changed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const filterColumn = taskId ? "task_id" : "project_id";
  const filterValue = taskId ?? projectId;

  // Note: we optimistically update `comments` after insert/delete below
  // instead of relying solely on realtime — realtime needs the `comments`
  // table enabled on Supabase → Database → Replication, and if it isn't
  // the thread would appear frozen until a reload. The realtime channel
  // below is still subscribed and will dedupe/catch up other clients.

  useEffect(() => {
    if (!filterValue) return;
    let active = true;
    (async () => {
      // Pull projects + tasks in the same round trip so `@P-NN` /
      // `@T-NN` mentions can be resolved without a second pass. We only
      // need id, short_id, and name/title — keep the payload small.
      const [cRes, pRes, projRes, taskRes] = await Promise.all([
        supabase
          .from("comments")
          .select("*")
          .eq(filterColumn, filterValue)
          .order("created_at", { ascending: true }),
        supabase.from("profiles").select("*"),
        supabase.from("projects").select("id,short_id,name"),
        supabase.from("tasks").select("id,short_id,title"),
      ]);
      if (!active) return;
      setComments(cRes.data ?? []);
      const profs = (pRes.data ?? []) as Profile[];
      setProfiles(profs);
      // Build the user-mention lookup: first name (lowercase) → full name.
      // If two people share the same first name, last one in wins — both
      // get a chip rendered; the notification logic below handles them the
      // same way (all matches get notified).
      const uMap: UserMentions = {};
      for (const p of profs) {
        const firstName = p.full_name.split(/\s+/)[0].toLowerCase();
        uMap[firstName] = p.full_name;
      }
      setUserMentions(uMap);
      const map: Record<string, Mention> = {};
      for (const p of (projRes.data ?? []) as {
        id: string;
        short_id: number;
        name: string;
      }[]) {
        map[`P-${p.short_id}`] = {
          href: `/projects/${p.id}`,
          name: p.name,
        };
      }
      for (const t of (taskRes.data ?? []) as {
        id: string;
        short_id: number;
        title: string;
      }[]) {
        map[`T-${t.short_id}`] = {
          href: `/tasks/${t.id}`,
          name: t.title,
        };
      }
      setMentions(map);
      setLoading(false);
    })();
    const channel = supabase
      .channel(`comments-${filterValue}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "comments",
          filter: `${filterColumn}=eq.${filterValue}`,
        },
        async () => {
          const { data } = await supabase
            .from("comments")
            .select("*")
            .eq(filterColumn, filterValue)
            .order("created_at", { ascending: true });
          if (active) setComments(data ?? []);
        },
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [filterColumn, filterValue]);

  const submit = async () => {
    if (!body.trim() || !profile) return;
    setBusy(true);
    // Grab the inserted row back so we can optimistically append it.
    // Feels instant even if realtime is disabled or slow.
    const { data, error } = await supabase
      .from("comments")
      .insert({
        body: body.trim(),
        author_id: profile.id,
        task_id: taskId ?? null,
        project_id: projectId ?? null,
      })
      .select()
      .single();
    if (error) {
      alert(error.message);
    } else {
      setBody("");
      if (data) {
        // Dedupe in case realtime races us and fires first.
        setComments((prev) =>
          prev.some((c) => c.id === data.id) ? prev : [...prev, data],
        );

        // Fire notifications for any @FirstName mentions in the comment.
        // We extract lowercase first-name tokens, look them up against the
        // profiles list, and skip the author (you don't get notified for
        // mentioning yourself).
        const USER_MENTION_RE = /(?<!\w)@([A-Za-z]+)\b/g;
        // Skip tokens that look like item mentions (@P-… / @T-…) — those
        // are project/task references, not user mentions.
        const ITEM_MENTION_RE = /^[PT]-?\d+$/i;
        const mentionedNames = new Set<string>();
        let m: RegExpExecArray | null;
        USER_MENTION_RE.lastIndex = 0;
        while ((m = USER_MENTION_RE.exec(body.trim())) !== null) {
          if (!ITEM_MENTION_RE.test(m[1])) {
            mentionedNames.add(m[1].toLowerCase());
          }
        }
        if (mentionedNames.size > 0) {
          const notifyUsers = profiles.filter(
            (p) =>
              p.id !== profile.id &&
              mentionedNames.has(p.full_name.split(/\s+/)[0].toLowerCase()),
          );
          if (notifyUsers.length > 0) {
            await supabase.from("notifications").insert(
              notifyUsers.map((p) => ({
                user_id: p.id,
                type: "mention",
                actor_id: profile.id,
                task_id: taskId ?? null,
                project_id: projectId ?? null,
                comment_id: data.id,
              })),
            );
          }
        }
      }
    }
    setBusy(false);
  };

  const startEdit = (c: Comment) => {
    setEditingId(c.id);
    setEditBody(c.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditBody("");
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const trimmed = editBody.trim();
    if (!trimmed) return;
    // Skip the round trip if the user hit Save without actually changing
    // anything — keeps the timestamp untouched and avoids a spurious
    // "(edited)" indicator.
    const original = comments.find((c) => c.id === editingId);
    if (original && original.body === trimmed) {
      cancelEdit();
      return;
    }
    setEditBusy(true);
    const { data, error } = await supabase
      .from("comments")
      .update({ body: trimmed })
      .eq("id", editingId)
      .select()
      .single();
    if (error) {
      alert(error.message);
      setEditBusy(false);
      return;
    }
    if (data) {
      // Optimistically merge — realtime will fire too but we don't want
      // a flash of stale text in the meantime.
      setComments((prev) => prev.map((c) => (c.id === data.id ? data : c)));
    }
    setEditBusy(false);
    cancelEdit();
  };

  const deleteComment = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    const { error } = await supabase.from("comments").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    // Optimistic remove; realtime would do this eventually but we don't
    // want to wait.
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <section className="card p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-900">
        Discussion ({comments.length})
      </h2>

      {loading ? (
        <Spinner />
      ) : comments.length === 0 ? (
        <p className="text-sm text-ink-500">
          No comments yet. Start the thread.
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const author = profiles.find((p) => p.id === c.author_id) ?? null;
            const isOwn = c.author_id === profile?.id;
            // Edit is author-only (managers don't get to rewrite other
            // people's words — see migration 019 for the matching RLS
            // policy). Delete keeps the broader "author or manager" rule
            // from migration 001.
            const canEdit = isOwn && canWrite;
            const canDelete = isOwn || isManager;
            const isEditing = editingId === c.id;
            // Comments get equal created_at and updated_at on insert
            // (both default to now() in the same transaction), so a
            // strict inequality is enough to detect an edit.
            const wasEdited = c.updated_at !== c.created_at;
            return (
              <li key={c.id} className="flex gap-3">
                <Avatar profile={author} size={28} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-ink-500">
                    <span className="font-medium text-ink-900">
                      {author?.full_name ?? "Unknown"}
                    </span>
                    <span>·</span>
                    <span>{formatRelative(c.created_at)}</span>
                    {wasEdited && (
                      <span
                        className="text-ink-400"
                        title={`Edited ${formatRelative(c.updated_at)}`}
                      >
                        (edited)
                      </span>
                    )}
                    {!isEditing && (canEdit || canDelete) && (
                      <span className="ml-auto flex items-center gap-1">
                        {canEdit && (
                          <button
                            onClick={() => startEdit(c)}
                            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                            aria-label="Edit comment"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => deleteComment(c.id)}
                            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-rose-600"
                            aria-label="Delete comment"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="mt-1">
                      <textarea
                        className="input"
                        rows={2}
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            saveEdit();
                          } else if (e.key === "Escape") {
                            cancelEdit();
                          }
                        }}
                        autoFocus
                      />
                      <div className="mt-1 flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          onClick={cancelEdit}
                          disabled={editBusy}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          onClick={saveEdit}
                          disabled={editBusy || !editBody.trim()}
                        >
                          {editBusy ? <Spinner /> : "Save"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink-800">
                      <Linkify text={c.body} mentions={mentions} userMentions={userMentions} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Composer is hidden for viewers — they can read existing
          discussion but can't post new comments. RLS in migration 016
          also blocks the insert at the DB layer. */}
      {canWrite && (
        <div className="mt-4 flex gap-2">
          <Avatar profile={profile} size={28} />
          <div className="flex-1">
            <textarea
              className="input"
              rows={2}
              placeholder="Add a comment. @FirstName to mention a teammate, @P-12 or @T-45 to link a project/task."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs text-ink-400">⌘/Ctrl + Enter to send</span>
              <Button
                variant="primary"
                onClick={submit}
                disabled={busy || !body.trim()}
              >
                {busy ? <Spinner /> : "Comment"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
