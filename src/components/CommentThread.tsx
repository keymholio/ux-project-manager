import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import type { Comment, Profile } from "../lib/types";
import { Avatar, Button, Spinner, formatRelative } from "./ui";

// One thread, targeted at either a project or a task. Exactly one of
// `projectId` / `taskId` is expected.
export default function CommentThread({
  projectId,
  taskId,
}: {
  projectId?: string;
  taskId?: string;
}) {
  const { profile, isManager } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const filterColumn = taskId ? "task_id" : "project_id";
  const filterValue = taskId ?? projectId;

  useEffect(() => {
    if (!filterValue) return;
    let active = true;
    (async () => {
      const [cRes, pRes] = await Promise.all([
        supabase
          .from("comments")
          .select("*")
          .eq(filterColumn, filterValue)
          .order("created_at", { ascending: true }),
        supabase.from("profiles").select("*"),
      ]);
      if (!active) return;
      setComments(cRes.data ?? []);
      setProfiles(pRes.data ?? []);
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
    const { error } = await supabase.from("comments").insert({
      body: body.trim(),
      author_id: profile.id,
      task_id: taskId ?? null,
      project_id: projectId ?? null,
    });
    if (error) {
      alert(error.message);
    } else {
      setBody("");
    }
    setBusy(false);
  };

  const deleteComment = async (id: string) => {
    if (!confirm("Delete this comment?")) return;
    await supabase.from("comments").delete().eq("id", id);
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
            const canDelete = c.author_id === profile?.id || isManager;
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
                    {canDelete && (
                      <button
                        onClick={() => deleteComment(c.id)}
                        className="ml-auto rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-rose-600"
                        aria-label="Delete comment"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap text-sm text-ink-800">
                    {c.body}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex gap-2">
        <Avatar profile={profile} size={28} />
        <div className="flex-1">
          <textarea
            className="input"
            rows={2}
            placeholder="Add a comment, feedback, or handoff note"
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
    </section>
  );
}
