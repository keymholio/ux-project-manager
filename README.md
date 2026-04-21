# UX Project Tracker

A dynamic project + task manager built for a small UX design team (1 manager, 3 designers). React + Vite + Supabase, deployed free to GitHub Pages.

Built to replace tracking projects and tasks in Figma. Stages, categories, and task types match the boards you already use today.

## What it does

**Manager (you)**
- Create and assign projects to designers
- Set status, priority, category, due dates, Figma / Workfront / Jira / FigJam links
- See team workload, upcoming deadlines, and project funnel on the Dashboard
- Comment on any project or task; delete any comment

**Designers**
- See tasks assigned to them on a Kanban board (Backlog → On deck → In progress → In review → Done)
- Drag cards between columns to update status
- Create tasks for themselves, edit due dates, add links
- Comment on projects and tasks for handoff notes and feedback

**Stages baked in from your existing boards**
- Project stages: Backlog, Discovery, In progress, Needs review, Hand-off, In development, VDQA, Done
- Task stages: Backlog, On deck, In progress, In review, Done
- Task types: Design, Discovery, Handoff, VDQA (and R1 / R2 / Internal), Review, Revisions
- Categories: Marketing, Campaigns, Design system, A/B testing, Research & development, Lit, Comm & Pop

## Setup (15 minutes)

### 1. Create a Supabase project (2 min)

1. Go to https://supabase.com → "New project".
2. Pick a name and a strong database password. Free tier is plenty.
3. Once the project provisions, copy these from **Project Settings → API**:
   - Project URL
   - `anon` `public` key

### 2. Run the schema (1 min)

1. In Supabase, open **SQL Editor → New query**.
2. Paste the entire contents of `supabase/migrations/001_init.sql`.
3. Click **Run**. You should see "Success. No rows returned."

### 3. Create users (3 min)

1. In Supabase, open **Authentication → Users → Add user → Create new user**.
2. Create four users with email + password: you (Andrew), Val, Lisa, Stef.
3. Copy each user's UUID.
4. Back in **SQL Editor**, run:

   ```sql
   update public.profiles set
     full_name = 'Andrew', role = 'manager', avatar_color = '#4f46e5'
     where id = '<ANDREW_UUID>';

   update public.profiles set
     full_name = 'Val', role = 'designer', avatar_color = '#ec4899'
     where id = '<VAL_UUID>';

   update public.profiles set
     full_name = 'Lisa', role = 'designer', avatar_color = '#14b8a6'
     where id = '<LISA_UUID>';

   update public.profiles set
     full_name = 'Stef', role = 'designer', avatar_color = '#f59e0b'
     where id = '<STEF_UUID>';
   ```

### 4. Run it locally (2 min)

```bash
npm install
cp .env.example .env.local     # then edit with your Supabase URL + anon key
npm run dev
```

Open http://localhost:5173 and sign in with one of the users you created.

### 5. Deploy to GitHub Pages (5 min)

1. Push the repo to GitHub (e.g. `github.com/<you>/ux-project-tracker`).
2. In **Settings → Pages → Build and deployment**, set **Source** to "GitHub Actions".
3. In **Settings → Secrets and variables → Actions**, add two repository secrets:
   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase anon key
4. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes automatically.
5. Your app will live at `https://<you>.github.io/<repo-name>/`.

## Security notes

- Anyone authenticated can **read** all data (small, trusted team — change this if that's not true).
- Only a **manager** (role on `profiles`) can create/update/delete projects, manage team assignments, delete tasks, or delete other people's comments.
- Designers can only update tasks assigned to them. See `001_init.sql` for the exact Postgres RLS policies.
- The `anon` key in the bundled JS is safe to ship publicly — RLS is what enforces access.

## How the code is laid out

```
src/
  main.tsx                       # React entry, wraps with HashRouter + AuthProvider
  App.tsx                        # Routes, handles unauthenticated redirect
  index.css                      # Tailwind + small component classes
  lib/
    supabase.ts                  # Supabase client
    types.ts                     # TypeScript types + labels (single source of truth)
  context/
    AuthContext.tsx              # Session, profile, signIn/signOut, isManager
  components/
    Layout.tsx                   # Sidebar nav + top bar
    CommentThread.tsx            # Realtime comment thread (project or task)
    ui.tsx                       # Avatar, Badges, Button, Modal, ToolLinks, helpers
  pages/
    Login.tsx
    Dashboard.tsx                # Manager view + designer view
    Projects.tsx + ProjectDetail.tsx
    TaskBoard.tsx + TaskDetail.tsx

supabase/migrations/001_init.sql # Schema, triggers, RLS policies, (commented) seeds
.github/workflows/deploy.yml     # GitHub Pages deploy
```

## Extending it

- **More fields?** Add a column to the SQL, add to `types.ts`, surface it in the detail / create pages.
- **More team members?** Create them in Supabase Auth and update their `profiles` row.
- **Drag-to-reorder within a column?** `tasks.position` is already in the schema — you'd just wire it up in `TaskBoard.tsx`.
- **Notifications?** Add a Supabase Edge Function that watches the `comments` and `tasks` tables and sends Slack or email.

## Where to get help

- Supabase docs: https://supabase.com/docs
- Vite + GitHub Pages: https://vitejs.dev/guide/static-deploy.html#github-pages
