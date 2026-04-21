-- =============================================================================
-- UX Project Tracker — initial schema
-- =============================================================================
-- Run this in the Supabase SQL editor (SQL → New query) or via
-- `supabase db push` if you use the CLI.
--
-- What this creates:
--   * profiles: one row per team member (manager + designers)
--   * projects: the work YOU (manager) plan and assign
--   * project_assignees: join table for multiple designers per project
--   * tasks: day-to-day work designers manage on their own board
--   * comments: discussion threads on projects and tasks
--
-- Row-level security:
--   * Everyone authenticated can READ everything (small trusted team).
--   * Only managers can create/update/delete projects and project_assignees.
--   * Designers can only update tasks assigned to them.
--   * Anyone can comment; only the author (or a manager) can delete a comment.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ENUMS — exactly the stages you use today on your Figma boards
-- -----------------------------------------------------------------------------
create type user_role as enum ('manager', 'designer');

create type project_category as enum (
  'marketing',
  'campaigns',
  'design_system',
  'ab_testing',
  'research_dev',
  'lit',
  'comm_pop'
);

create type project_status as enum (
  'backlog',
  'discovery',
  'in_progress',
  'needs_review',
  'hand_off',
  'in_development',
  'vdqa',
  'done'
);

create type task_status as enum (
  'backlog',
  'on_deck',
  'in_progress',
  'in_review',
  'done'
);

create type task_type as enum (
  'design',
  'discovery',
  'handoff',
  'vdqa',
  'vdqa_r1',
  'vdqa_r2',
  'vdqa_int',
  'review',
  'revisions',
  'other'
);

create type priority_level as enum ('low', 'medium', 'high');

-- -----------------------------------------------------------------------------
-- profiles — mirrors auth.users, adds role and display metadata
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text unique not null,
  full_name   text not null,
  role        user_role not null default 'designer',
  avatar_color text not null default '#6366f1',
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'designer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  category      project_category not null default 'marketing',
  status        project_status not null default 'backlog',
  priority      priority_level not null default 'medium',
  due_date      date,
  figma_url     text,
  workfront_url text,
  jira_url      text,
  figjam_url    text,
  owner_id      uuid not null references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index projects_status_idx on public.projects(status);
create index projects_owner_idx on public.projects(owner_id);

-- -----------------------------------------------------------------------------
-- project_assignees — many designers can be on one project
-- -----------------------------------------------------------------------------
create table public.project_assignees (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  primary key (project_id, user_id)
);

create index project_assignees_user_idx on public.project_assignees(user_id);

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  task_type     task_type not null default 'design',
  status        task_status not null default 'backlog',
  priority      priority_level not null default 'medium',
  due_date      date,
  figma_url     text,
  workfront_url text,
  jira_url      text,
  figjam_url    text,
  project_id    uuid references public.projects(id) on delete set null,
  assignee_id   uuid references public.profiles(id) on delete set null,
  created_by    uuid not null references public.profiles(id) on delete restrict,
  position      integer not null default 0,  -- for manual ordering within a column
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index tasks_assignee_idx on public.tasks(assignee_id);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_status_idx on public.tasks(status);

-- -----------------------------------------------------------------------------
-- comments (polymorphic on task OR project — exactly one set)
-- -----------------------------------------------------------------------------
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  body       text not null,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  task_id    uuid references public.tasks(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Comment must belong to exactly one of: task or project.
  constraint comments_target_chk check (
    (task_id is not null)::int + (project_id is not null)::int = 1
  )
);

create index comments_task_idx on public.comments(task_id);
create index comments_project_idx on public.comments(project_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch before update on public.projects
  for each row execute procedure public.touch_updated_at();

create trigger tasks_touch before update on public.tasks
  for each row execute procedure public.touch_updated_at();

-- Auto-set completed_at when a task moves to done.
create or replace function public.touch_completed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'done' and (old.status is distinct from 'done') then
    new.completed_at = now();
  elsif new.status <> 'done' then
    new.completed_at = null;
  end if;
  return new;
end;
$$;

create trigger tasks_complete before update on public.tasks
  for each row execute procedure public.touch_completed_at();

-- -----------------------------------------------------------------------------
-- Helper: is the caller a manager?
-- -----------------------------------------------------------------------------
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

-- =============================================================================
-- Row-Level Security
-- =============================================================================
alter table public.profiles          enable row level security;
alter table public.projects          enable row level security;
alter table public.project_assignees enable row level security;
alter table public.tasks             enable row level security;
alter table public.comments          enable row level security;

-- profiles --------------------------------------------------------------------
create policy "profiles: authenticated can read"
  on public.profiles for select
  to authenticated using (true);

create policy "profiles: self update"
  on public.profiles for update
  to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles: manager update all"
  on public.profiles for update
  to authenticated using (public.is_manager()) with check (public.is_manager());

-- projects --------------------------------------------------------------------
create policy "projects: authenticated can read"
  on public.projects for select
  to authenticated using (true);

create policy "projects: manager insert"
  on public.projects for insert
  to authenticated with check (public.is_manager());

create policy "projects: manager update"
  on public.projects for update
  to authenticated using (public.is_manager()) with check (public.is_manager());

create policy "projects: manager delete"
  on public.projects for delete
  to authenticated using (public.is_manager());

-- project_assignees -----------------------------------------------------------
create policy "assignees: authenticated can read"
  on public.project_assignees for select
  to authenticated using (true);

create policy "assignees: manager insert"
  on public.project_assignees for insert
  to authenticated with check (public.is_manager());

create policy "assignees: manager delete"
  on public.project_assignees for delete
  to authenticated using (public.is_manager());

-- tasks -----------------------------------------------------------------------
create policy "tasks: authenticated can read"
  on public.tasks for select
  to authenticated using (true);

-- Manager can create any task. Designers can create tasks for themselves.
create policy "tasks: insert"
  on public.tasks for insert
  to authenticated with check (
    public.is_manager() or assignee_id = auth.uid() or assignee_id is null
  );

-- Manager can update anything. Designer can update tasks assigned to them.
create policy "tasks: update"
  on public.tasks for update
  to authenticated
  using (public.is_manager() or assignee_id = auth.uid())
  with check (public.is_manager() or assignee_id = auth.uid());

create policy "tasks: manager delete"
  on public.tasks for delete
  to authenticated using (public.is_manager());

-- comments --------------------------------------------------------------------
create policy "comments: authenticated can read"
  on public.comments for select
  to authenticated using (true);

create policy "comments: author insert"
  on public.comments for insert
  to authenticated with check (author_id = auth.uid());

create policy "comments: author or manager delete"
  on public.comments for delete
  to authenticated using (author_id = auth.uid() or public.is_manager());

-- =============================================================================
-- Seed data — optional starter (DELETE this block if you don't want seeds)
-- =============================================================================
-- IMPORTANT: Seeds require you to have first created 4 auth users (Andrew,
-- Val, Lisa, Stef) in Supabase Auth → Users. After creation, copy each user's
-- UUID from the auth dashboard and paste below in place of the placeholders.
-- Then uncomment this block and run it separately.
--
-- insert into public.profiles (id, email, full_name, role, avatar_color) values
--   ('<ANDREW_UUID>', 'andrew@example.com', 'Andrew', 'manager',  '#4f46e5'),
--   ('<VAL_UUID>',    'val@example.com',    'Val',    'designer', '#ec4899'),
--   ('<LISA_UUID>',   'lisa@example.com',   'Lisa',   'designer', '#14b8a6'),
--   ('<STEF_UUID>',   'stef@example.com',   'Stef',   'designer', '#f59e0b')
-- on conflict (id) do update
--   set full_name = excluded.full_name,
--       role = excluded.role,
--       avatar_color = excluded.avatar_color;
