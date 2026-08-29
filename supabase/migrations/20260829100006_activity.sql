-- 0006_activity.sql
-- Exercise library, workout templates, scheduled sessions, activity logging.

create table public.exercises (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  category       text not null check (category in ('lower','upper_push','upper_pull','core','full_body','mobility','cardio')),
  equipment      equipment_access not null default 'none',
  difficulty     text not null default 'beginner' check (difficulty in ('beginner','intermediate','advanced')),
  target_muscles text[] not null default array[]::text[],
  met_value      numeric(4,2) check (met_value > 0),
  is_unilateral  boolean not null default false,
  instructions   jsonb not null default '[]'::jsonb,
  common_mistakes jsonb not null default '[]'::jsonb,
  easier_variant uuid references public.exercises (id) on delete set null,
  harder_variant uuid references public.exercises (id) on delete set null,
  contraindications text[] not null default array[]::text[],
  media_url      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index exercises_category_idx on public.exercises (category, difficulty);
create index exercises_equipment_idx on public.exercises (equipment);
create index exercises_easier_idx on public.exercises (easier_variant) where easier_variant is not null;
create index exercises_harder_idx on public.exercises (harder_variant) where harder_variant is not null;
create trigger exercises_touch before update on public.exercises
  for each row execute function private.touch_updated_at();

comment on column public.exercises.contraindications is
  'Matched against lifestyle.injuries so an unsafe movement is never prescribed.';

-- ---------------------------------------------------------------------------
-- workouts: reusable templates
-- ---------------------------------------------------------------------------
create table public.workouts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  focus        text not null,
  equipment    equipment_access not null default 'none',
  difficulty   text not null default 'beginner' check (difficulty in ('beginner','intermediate','advanced')),
  minutes      smallint not null check (minutes between 5 and 180),
  description  text,
  warmup       jsonb not null default '[]'::jsonb,
  cooldown     jsonb not null default '[]'::jsonb,
  is_public    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index workouts_equipment_idx on public.workouts (equipment, difficulty);
create index workouts_minutes_idx on public.workouts (minutes);

create table public.workout_exercises (
  id          uuid primary key default gen_random_uuid(),
  workout_id  uuid not null references public.workouts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete restrict,
  sort_order  smallint not null default 0,
  sets        smallint not null default 3 check (sets between 1 and 10),
  rep_low     smallint check (rep_low > 0),
  rep_high    smallint check (rep_high > 0),
  hold_seconds smallint,
  rest_seconds smallint not null default 60,
  note        text,
  check (rep_low is null or rep_high is null or rep_low <= rep_high)
);
create index workout_exercises_workout_idx on public.workout_exercises (workout_id, sort_order);
create index workout_exercises_exercise_idx on public.workout_exercises (exercise_id);

-- ---------------------------------------------------------------------------
-- workout_plans: what this user is scheduled to do, and what happened
-- ---------------------------------------------------------------------------
create table public.workout_plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  plan_date     date not null,
  workout_id    uuid references public.workouts (id) on delete set null,
  activity_kind text not null default 'strength'
                check (activity_kind in ('strength','walk','run','cycle','swim','sport','yoga','mobility','rest','other')),
  label         text,
  planned_minutes smallint check (planned_minutes between 0 and 300),
  status        text not null default 'planned'
                check (status in ('planned','completed','partial','skipped','moved','rest')),
  actual_minutes smallint check (actual_minutes between 0 and 300),
  moved_to      date,
  rpe           smallint check (rpe between 1 and 10),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index workout_plans_user_date_idx on public.workout_plans (user_id, plan_date);
create index workout_plans_workout_idx on public.workout_plans (workout_id) where workout_id is not null;
create trigger workout_plans_touch before update on public.workout_plans
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- exercise_sets: per-set performance, for progressive overload
-- ---------------------------------------------------------------------------
create table public.exercise_sets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  workout_plan_id uuid references public.workout_plans (id) on delete cascade,
  exercise_id     uuid not null references public.exercises (id) on delete restrict,
  performed_on    date not null default current_date,
  set_number      smallint not null check (set_number > 0),
  reps            smallint check (reps >= 0),
  weight_kg       numeric(6,2) check (weight_kg >= 0),
  hold_seconds    smallint,
  rpe             smallint check (rpe between 1 and 10),
  created_at      timestamptz not null default now()
);
create index exercise_sets_user_idx on public.exercise_sets (user_id, performed_on desc);
create index exercise_sets_exercise_idx on public.exercise_sets (user_id, exercise_id, performed_on desc);
create index exercise_sets_plan_idx on public.exercise_sets (workout_plan_id) where workout_plan_id is not null;

-- ---------------------------------------------------------------------------
-- activity_sessions: non-strength activity (walks, sport, cycling)
-- ---------------------------------------------------------------------------
create table public.activity_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  log_date     date not null default current_date,
  kind         text not null,
  minutes      smallint not null check (minutes between 1 and 600),
  intensity    text not null default 'moderate' check (intensity in ('light','moderate','vigorous')),
  met_value    numeric(4,2),
  est_kcal     integer,
  distance_km  numeric(6,2),
  source       text not null default 'manual',
  notes        text,
  created_at   timestamptz not null default now()
);
create index activity_sessions_user_date_idx on public.activity_sessions (user_id, log_date desc);

comment on column public.activity_sessions.est_kcal is
  'Net of resting expenditure. Displayed but not added to the eating target by default.';
