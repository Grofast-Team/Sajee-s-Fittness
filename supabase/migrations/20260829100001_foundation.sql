-- 0001_foundation.sql
-- Extensions, private helper schema, shared enums and triggers.

create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "pg_trgm";       -- fuzzy food search
create extension if not exists "unaccent";      -- transliteration-tolerant search

-- Private schema: never exposed through PostgREST. Holds security-definer helpers.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------
create type sex_at_birth       as enum ('male', 'female', 'intersex', 'prefer_not_to_say');
create type unit_system        as enum ('metric', 'imperial');
create type goal_type          as enum ('fat_loss','weight_loss','recomposition','waist_reduction',
                                        'fitness','strength','appearance','health_habits','stamina','event','other');
create type goal_status        as enum ('active','achieved','paused','abandoned','superseded');
create type loss_pace          as enum ('gentle','steady','firm');
create type activity_level     as enum ('sedentary','light','moderate','active','very_active');
create type diet_pattern       as enum ('vegetarian','vegan','eggetarian','non_vegetarian','pescatarian','jain','other');
create type meal_slot          as enum ('breakfast','morning_snack','lunch','afternoon_snack','dinner','evening_snack','other');
create type confidence_level   as enum ('high','medium','low');
create type log_source         as enum ('search','quick_add','voice','photo','barcode','recipe','manual','import');
create type safety_severity    as enum ('info','caution','restrict','refer');
create type budget_period      as enum ('daily','weekly','monthly');
create type equipment_access   as enum ('none','bands','dumbbells','home_basic','machines','full_gym');
create type experience_level   as enum ('none','beginner','returning','intermediate','advanced');
create type difficulty_rating  as enum ('very_easy','easy','manageable','difficult','impossible');

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin check. SECURITY DEFINER so it can read a table that end users cannot,
-- with the caller's identity checked explicitly inside the body.
-- ---------------------------------------------------------------------------
create table if not exists private.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'admin' check (role in ('admin','support','content')),
  created_at timestamptz not null default now()
);
alter table private.admins enable row level security;  -- no policies: unreachable via API

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.admins a
    where a.user_id = (select auth.uid())
  );
$$;

revoke execute on function private.is_admin() from public, anon;
grant  execute on function private.is_admin() to authenticated;
