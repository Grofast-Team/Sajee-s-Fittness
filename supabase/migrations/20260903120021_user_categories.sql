-- 20260903120021_user_categories.sql
--
-- Per-user category activation state.
--
-- What categories *exist* is a TypeScript registry
-- (src/lib/engines/categories.ts), not a database table - a category only
-- exists once its pages ship, and a table of definitions would just be a
-- join for something the code already knows. This table holds the one
-- thing that genuinely is per-user data: whether a given category is
-- switched on.
--
-- category_key deliberately carries no `check` constraint, matching
-- notifications.kind rather than coach_threads.kind elsewhere in this
-- schema. The category set is expected to grow, and a check constraint
-- would demand a migration for every category the application code adds.
--
-- enabled=false must never be read as "delete this user's domain data" -
-- disabling a category is a visibility change, not a data-deletion
-- operation. Nothing in this migration, or in any code that reads this
-- table, touches plans, commitments, or any other domain table.

create table public.user_categories (
  user_id       uuid not null references auth.users (id) on delete cascade,
  category_key  text not null,
  enabled       boolean not null default false,
  enabled_at    timestamptz,
  disabled_at   timestamptz,
  primary key (user_id, category_key)
);

comment on table public.user_categories is
  'Per-user category activation state. The registry of what categories '
  'exist lives in code (src/lib/engines/categories.ts), not here.';
comment on column public.user_categories.category_key is
  'Unconstrained on purpose - see the migration header. Validated by the '
  'application against the registry, not by the database.';

-- ---------------------------------------------------------------------------
-- Row Level Security. Same four-policy shape as fitness_assessments,
-- session_feedback and skill_unlocks in 20260903120001_video_system.sql.
-- ---------------------------------------------------------------------------
alter table public.user_categories enable row level security;

create policy user_categories_select_own on public.user_categories
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy user_categories_insert_own on public.user_categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy user_categories_update_own on public.user_categories
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy user_categories_delete_own on public.user_categories
  for delete to authenticated
  using ((select auth.uid()) = user_id);
