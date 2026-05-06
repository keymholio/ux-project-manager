import { Check, Mail, Plus, Power, PowerOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Avatar, Breadcrumbs, Button, Modal, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import type { Profile, UserRole } from "../lib/types";

// Manager-only page for editing teammates' profiles. Writes go straight
// to public.profiles; RLS policy "profiles: manager update all" is what
// actually enforces the permission — hiding the nav entry + bouncing
// non-managers off this route is UX polish, not security.
//
// What a manager can change here (per row):
//   * full_name
//   * email  (the display email on the profile row; the auth email is a
//             separate concern and can only be changed from the Supabase
//             dashboard — left alone intentionally)
//   * role   (manager ↔ designer)
//   * avatar_color
//   * is_active  (toggle — inactive users drop out of counts & pickers)

// Same preset palette Settings.tsx uses so every color picker in the app
// offers the same first-class options.
const COLOR_PRESETS = [
  "#6366f1",
  "#3b82f6",
  "#0ea5e9",
  "#14b8a6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

// Fields we actually allow managers to edit on a profile. Anything else
// on the row (id, created_at) is server-managed.
type EditableField = "full_name" | "email" | "role" | "avatar_color" | "is_active";

// Row-level diff so the Save button only lights up when the draft for
// THIS user differs from the server snapshot. Order-independent field
// list; a single mismatch flips the bit.
function isRowDirty(draft: Profile, original: Profile): boolean {
  const fields: EditableField[] = [
    "full_name",
    "email",
    "role",
    "avatar_color",
    "is_active",
  ];
  return fields.some((f) => draft[f] !== original[f]);
}

export default function UserAdmin() {
  const { isManager, loading, profile: me } = useAuth();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Profile>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("full_name");
    if (error) {
      setErr(error.message);
      return;
    }
    // Defensive default for is_active — pre-migration rows won't have
    // the column populated client-side until the page reloads after 008.
    const rows = (data ?? []).map((p) => ({
      ...p,
      is_active: p.is_active ?? true,
    }) as Profile);
    setProfiles(rows);
    // Seed any drafts that haven't been touched yet. Touched drafts are
    // left alone so an in-flight edit isn't clobbered by a realtime echo.
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        if (!next[r.id]) next[r.id] = r;
      }
      // Drop drafts for rows that no longer exist (rare, but keeps state tidy).
      for (const id of Object.keys(next)) {
        if (!rows.find((r) => r.id === id)) delete next[id];
      }
      return next;
    });
  };

  useEffect(() => {
    if (!isManager) return;
    load();
    const channel = supabase
      .channel("admin-profiles")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager]);

  // Auto-clear the green "Saved" pill after a beat so the table isn't
  // decorated with stale confirmations from ten minutes ago.
  useEffect(() => {
    if (!savedId) return;
    const t = setTimeout(() => setSavedId(null), 2500);
    return () => clearTimeout(t);
  }, [savedId]);

  // Sort: managers first, then designers; within each group alphabetize.
  // Inactive users sink to the bottom of each group so the list leads
  // with the team that's actually working today.
  const rows = useMemo(() => {
    return [...profiles].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      if (a.role !== b.role) return a.role === "manager" ? -1 : 1;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [profiles]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  // Route is also declared under manager-only in the nav; the redirect
  // here is the safety net for anyone typing the URL directly.
  if (!isManager) return <Navigate to="/" replace />;

  const setField = <K extends EditableField>(
    id: string,
    field: K,
    value: Profile[K],
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
    setErr(null);
    setSavedId(null);
  };

  const save = async (id: string) => {
    const draft = drafts[id];
    const original = profiles.find((p) => p.id === id);
    if (!draft || !original) return;

    // Client-side validation — fast feedback before the server round trip.
    const trimmedName = draft.full_name.trim();
    const trimmedEmail = draft.email.trim();
    if (trimmedName.length < 2) {
      setErr("Name must be at least 2 characters.");
      return;
    }
    if (!trimmedEmail.includes("@")) {
      setErr("Email doesn't look right.");
      return;
    }
    if (!HEX_RE.test(draft.avatar_color)) {
      setErr("Avatar color must be a hex like #6366f1.");
      return;
    }
    // Guardrail: don't let the acting manager demote themselves — if
    // they really need to, they can ask another manager to do it.
    if (
      me &&
      id === me.id &&
      original.role === "manager" &&
      draft.role !== "manager"
    ) {
      setErr(
        "You can't demote yourself. Ask another manager to change your role.",
      );
      return;
    }
    // Same protection for self-deactivation — losing manager access mid-edit
    // would strand the user on a route they can no longer load.
    if (me && id === me.id && original.is_active && !draft.is_active) {
      setErr("You can't deactivate your own account.");
      return;
    }

    setBusyId(id);
    setErr(null);
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: trimmedName,
        email: trimmedEmail,
        role: draft.role,
        avatar_color: draft.avatar_color,
        is_active: draft.is_active,
      })
      .eq("id", id);
    setBusyId(null);

    if (error) {
      setErr(error.message);
      return;
    }

    // Adopt the draft into the snapshot so the dirty indicator flips off
    // immediately without waiting for the realtime echo.
    setProfiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...draft } : p)),
    );
    setSavedId(id);
  };

  const discard = (id: string) => {
    const original = profiles.find((p) => p.id === id);
    if (!original) return;
    setDrafts((prev) => ({ ...prev, [id]: original }));
    setErr(null);
  };

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-5">
      <Breadcrumbs items={[{ label: "Users", current: true }]} />

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">
            User administration
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Update teammates' profile details or deactivate someone who's no
            longer on the team. Inactive users drop out of dashboard counts
            and assignee pickers but keep their history.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus size={14} />}
          onClick={() => setAdding(true)}
        >
          Add user
        </Button>
      </header>

      {err && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {err}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">User</th>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Color</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-ink-500">
                  <Spinner />
                </td>
              </tr>
            )}
            {rows.map((original) => {
              const draft = drafts[original.id] ?? original;
              const dirty = isRowDirty(draft, original);
              const busy = busyId === original.id;
              const justSaved = savedId === original.id;
              const isSelf = me?.id === original.id;
              return (
                <tr
                  key={original.id}
                  className={draft.is_active ? "" : "bg-ink-50/60"}
                >
                  {/* Full name + live avatar preview */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar
                        profile={{
                          full_name: draft.full_name || original.full_name,
                          avatar_color: HEX_RE.test(draft.avatar_color)
                            ? draft.avatar_color
                            : original.avatar_color,
                        }}
                        size={28}
                      />
                      <input
                        className="input"
                        value={draft.full_name}
                        onChange={(e) =>
                          setField(original.id, "full_name", e.target.value)
                        }
                      />
                    </div>
                  </td>

                  {/* Email — note in page intro explains this is the profile
                      email, not the auth email. */}
                  <td className="px-3 py-2">
                    <input
                      className="input"
                      type="email"
                      value={draft.email}
                      onChange={(e) =>
                        setField(original.id, "email", e.target.value)
                      }
                    />
                  </td>

                  {/* Role */}
                  <td className="px-3 py-2">
                    <select
                      className="input"
                      value={draft.role}
                      onChange={(e) =>
                        setField(
                          original.id,
                          "role",
                          e.target.value as UserRole,
                        )
                      }
                      disabled={isSelf && original.role === "manager"}
                      title={
                        isSelf && original.role === "manager"
                          ? "Ask another manager to change your role"
                          : undefined
                      }
                    >
                      <option value="designer">Designer</option>
                      <option value="manager">Manager</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </td>

                  {/* Color — compact swatch grid + hex input. Keeps parity
                      with Settings but fits in a table cell. */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <div className="grid grid-cols-5 gap-1">
                        {COLOR_PRESETS.map((c) => {
                          const selected =
                            c.toLowerCase() ===
                            draft.avatar_color.toLowerCase();
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() =>
                                setField(original.id, "avatar_color", c)
                              }
                              className={`h-5 w-5 rounded-full border-2 transition ${
                                selected
                                  ? "border-ink-900"
                                  : "border-surface hover:scale-110"
                              }`}
                              style={{ background: c }}
                              title={c}
                              aria-label={`Pick ${c}`}
                              aria-pressed={selected}
                            />
                          );
                        })}
                      </div>
                      <input
                        className="input ml-2 w-24 font-mono text-xs"
                        value={draft.avatar_color}
                        onChange={(e) =>
                          setField(
                            original.id,
                            "avatar_color",
                            e.target.value,
                          )
                        }
                        spellCheck={false}
                      />
                    </div>
                  </td>

                  {/* Active toggle */}
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setField(original.id, "is_active", !draft.is_active)
                      }
                      disabled={isSelf && draft.is_active}
                      title={
                        isSelf && draft.is_active
                          ? "You can't deactivate your own account"
                          : draft.is_active
                            ? "Deactivate user"
                            : "Reactivate user"
                      }
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
                        draft.is_active
                          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                          : "bg-ink-200 text-ink-700 hover:bg-ink-300"
                      } ${isSelf && draft.is_active ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {draft.is_active ? (
                        <>
                          <Power size={12} /> Active
                        </>
                      ) : (
                        <>
                          <PowerOff size={12} /> Inactive
                        </>
                      )}
                    </button>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-2 text-right">
                    {justSaved && !dirty ? (
                      <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                        <Check size={14} /> Saved
                      </span>
                    ) : dirty ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => discard(original.id)}
                          disabled={busy}
                          className="text-xs text-ink-500 hover:text-ink-900"
                        >
                          Discard
                        </button>
                        <Button
                          variant="primary"
                          onClick={() => save(original.id)}
                          disabled={busy}
                        >
                          {busy ? <Spinner /> : "Save"}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-500">
        New users are created from Supabase Auth. When they sign in for the
        first time a profile row is auto-generated and will appear here.
      </p>

      <AddUserModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

// =============================================================================
// Add User modal — sends a magic-link invite via Supabase Auth.
// The new user receives an email; when they click the link and sign in,
// their profile row is auto-generated by the handle_new_user trigger.
// The manager can then set their role and color from the table above.
// =============================================================================
function AddUserModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset form state whenever the modal opens.
  useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setBusy(false);
      setSent(false);
      setErr(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    if (!trimmedEmail.includes("@")) {
      setErr("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: window.location.origin,
        // full_name is picked up by the handle_new_user trigger so the
        // profile row starts with a real name instead of the email prefix.
        data: trimmedName ? { full_name: trimmedName } : undefined,
      },
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSent(true);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite new user"
      dismissOnBackdropClick={false}
    >
      {sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg bg-emerald-50 p-4 dark:bg-emerald-500/10">
            <Mail size={18} className="mt-0.5 flex-shrink-0 text-emerald-600" />
            <div>
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                Invite sent to {email}
              </p>
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                They'll receive a magic link to sign in. Once they log in for
                the first time, their profile will appear here and you can set
                their role and avatar color.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">
              Email <span className="text-rose-500">*</span>
            </label>
            <input
              className="input w-full"
              type="email"
              placeholder="teammate@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErr(null);
              }}
              autoFocus
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-700">
              Full name{" "}
              <span className="text-xs font-normal text-ink-400">
                (optional)
              </span>
            </label>
            <input
              className="input w-full"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-400">
              Pre-fills their display name when they first sign in.
            </p>
          </div>

          {err && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              {err}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              onClick={onClose}
              type="button"
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? <Spinner /> : "Send invite"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
