import { useEffect, useState, type FormEvent } from "react";
import { Avatar, Button, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

// Curated palette of avatar colors. Users can also type a custom hex.
const COLOR_PRESETS = [
  "#6366f1", // indigo
  "#3b82f6", // blue
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#64748b", // slate
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default function Settings() {
  const { profile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Hydrate the form from the current profile when it loads / changes.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name);
    setColor(profile.avatar_color);
  }, [profile?.id]);

  if (!profile) {
    return (
      <div className="p-8 text-ink-500">
        <Spinner />
      </div>
    );
  }

  const dirty =
    fullName.trim() !== profile.full_name || color !== profile.avatar_color;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const trimmed = fullName.trim();
    if (trimmed.length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    if (!HEX_RE.test(color)) {
      setError("Color must be a hex like #6366f1.");
      return;
    }

    setBusy(true);
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: trimmed, avatar_color: color })
      .eq("id", profile.id);
    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await refreshProfile();
    setInfo("Saved.");
  };

  // Preview uses the live form values so the user sees what they'll get.
  const previewProfile = {
    full_name: fullName || profile.full_name,
    avatar_color: HEX_RE.test(color) ? color : profile.avatar_color,
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-900">Your profile</h1>
        <p className="mt-1 text-sm text-ink-500">
          Update your display name and avatar color. Changes are visible to the
          rest of the designers.
        </p>
      </div>

      <form onSubmit={onSubmit} className="card p-5 space-y-5">
        {/* Avatar preview */}
        <div className="flex items-center gap-4">
          <Avatar profile={previewProfile} size={64} />
          <div className="text-sm text-ink-600">
            <div className="font-medium text-ink-900">Preview</div>
            <div className="text-xs text-ink-500">
              Initials are taken from your name.
            </div>
          </div>
        </div>

        {/* Full name */}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-600">
            Full name
          </label>
          <input
            className="input"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>

        {/* Avatar color */}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-600">
            Avatar color
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {COLOR_PRESETS.map((c) => {
              const selected = c.toLowerCase() === color.toLowerCase();
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition ${
                    selected
                      ? "border-ink-900 scale-110"
                      : "border-white hover:scale-105"
                  }`}
                  style={{ background: c }}
                  title={c}
                  aria-label={`Pick color ${c}`}
                  aria-pressed={selected}
                />
              );
            })}
            <div className="ml-2 flex items-center gap-2">
              <input
                type="color"
                value={HEX_RE.test(color) ? color : "#6366f1"}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-8 cursor-pointer rounded border border-ink-200 bg-white p-0"
                aria-label="Custom color picker"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="input w-28 font-mono text-sm"
                placeholder="#6366f1"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        {/* Read-only fields */}
        <div className="grid grid-cols-2 gap-3 rounded-md bg-ink-50 p-3 text-sm">
          <div>
            <div className="text-xs font-medium text-ink-500">Email</div>
            <div className="text-ink-900">{profile.email}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-ink-500">Role</div>
            <div className="text-ink-900 capitalize">{profile.role}</div>
          </div>
          <div className="col-span-2 text-xs text-ink-500">
            Email and role are managed by your admin.
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {info}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !dirty}
          >
            {busy ? <Spinner /> : "Save changes"}
          </Button>
          {dirty && !busy && (
            <button
              type="button"
              onClick={() => {
                setFullName(profile.full_name);
                setColor(profile.avatar_color);
                setError(null);
                setInfo(null);
              }}
              className="text-xs text-ink-500 hover:text-ink-900"
            >
              Discard changes
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
