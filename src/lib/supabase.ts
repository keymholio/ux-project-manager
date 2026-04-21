import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Helpful error at runtime for first-time setup — don't ship without envs.
  // eslint-disable-next-line no-console
  console.error(
    "Missing Supabase env vars. Copy .env.example → .env.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
  );
}

// Untyped client — we cast query results at the call sites using the
// interfaces in ./types.ts. Keeps the build simple; swap in a generated
// Database type later with `supabase gen types typescript`.
export const supabase = createClient(url ?? "", anonKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
