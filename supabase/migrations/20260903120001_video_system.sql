-- 20260903120001_video_system.sql
--
-- Adaptive video guidance.
--
-- The loop this schema exists to support:
--   assess -> recommend -> watch -> perform -> rate -> analyse -> progress or
--   regress -> recommend again.
--
-- Two things are deliberate:
--
-- 1. Videos carry a `review_status`. Nothing is recommended until a human has
--    checked it. A fitness app that auto-embeds whatever a search returns will
--    eventually tell a beginner with a bad back to do jumping burpees, and the
--    metadata that would have prevented that is exactly the metadata nobody
--    fills in. Unreviewed rows are inert.
--
-- 2. Difficulty is a number on a chain, not a label. "Beginner" is three very
--    different things depending on whether someone can hold a plank, so the
--    chain (chair squat -> bodyweight -> tempo -> goblet -> weighted) is what
--    the engine actually walks.

-- ---------------------------------------------------------------------------
-- Fitness level. 1-4, assessed rather than self-declared.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists fitness_level smallint
    check (fitness_level between 1 and 4);

comment on column public.profiles.fitness_level is
  '1 absolute beginner, 2 beginner, 3 intermediate, 4 advanced. Derived from '
  'fitness_assessments, never asked directly — people answer that question with '
  'their aspirations.';

create table public.fitness_assessments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- The raw answers, kept so a level can be re-derived if the rubric changes.
  answers           jsonb not null default '{}'::jsonb,
  assessed_level    smallint not null check (assessed_level between 1 and 4),
  score             numeric(5,2),
  reasons           text[] not null default array[]::text[],
  created_at        timestamptz not null default now()
);
create index fitness_assessments_user_idx
  on public.fitness_assessments (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Exercise difficulty tree.
--
-- `easier_variant` / `harder_variant` already existed; `level` makes the chain
-- addressable so the engine can ask "give me the level-2 squat" instead of
-- walking pointers one at a time.
-- ---------------------------------------------------------------------------
alter table public.exercises
  add column if not exists level smallint not null default 2
    check (level between 1 and 5),
  add column if not exists movement_pattern text,
  add column if not exists impact_level text not null default 'low'
    check (impact_level in ('none', 'low', 'moderate', 'high')),
  add column if not exists space_required text not null default 'minimal'
    check (space_required in ('minimal', 'moderate', 'large')),
  add column if not exists apartment_friendly boolean not null default true;

comment on column public.exercises.impact_level is
  'Jumping and landing. High impact rules an exercise out for a shared floor, a '
  'knee complaint, or a first-floor flat — which is most of this audience.';
comment on column public.exercises.apartment_friendly is
  'No jumping, no dropping weight, no run-up. Assuming everyone has a garden is '
  'how a home workout becomes unusable.';

create index exercises_level_idx on public.exercises (level, category);
create index exercises_impact_idx on public.exercises (impact_level);

-- ---------------------------------------------------------------------------
-- The curated video library.
-- ---------------------------------------------------------------------------
create table public.videos (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null,
  -- Plain descriptive titles only. "20-Minute Beginner Full Body", never
  -- "INSANE FAT MELTER". The title is a specification, not a promise.
  summary           text,
  duration_minutes  smallint not null check (duration_minutes between 1 and 180),

  track             text not null check (track in (
                      'strength','mobility','walking','low_impact_cardio',
                      'yoga','dance','sport','stretching','recovery')),
  goal_fit          text[] not null default array[]::text[],

  level_min         smallint not null default 1 check (level_min between 1 and 4),
  level_max         smallint not null default 4 check (level_max between 1 and 4),
  equipment         equipment_access not null default 'none',
  extra_equipment   text[] not null default array[]::text[],

  impact_level      text not null default 'low'
                      check (impact_level in ('none','low','moderate','high')),
  space_required    text not null default 'minimal'
                      check (space_required in ('minimal','moderate','large')),
  apartment_friendly boolean not null default true,
  joint_notes       text[] not null default array[]::text[],
  contraindications text[] not null default array[]::text[],

  muscle_groups     text[] not null default array[]::text[],
  language          text not null default 'en',
  trainer           text,

  -- Provenance. A third-party video keeps its source and creator so it can be
  -- re-checked, credited, or pulled.
  source            text not null default 'third_party'
                      check (source in ('third_party','original','partner')),
  source_url        text,
  video_url         text,
  thumbnail_url     text,

  -- Nothing reaches a user until someone has watched it.
  review_status     text not null default 'pending'
                      check (review_status in ('pending','approved','rejected','retired')),
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewed_on       date,
  review_notes      text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  check (level_max >= level_min)
);

create index videos_pick_idx
  on public.videos (track, level_min, level_max, duration_minutes)
  where review_status = 'approved';
create index videos_equipment_idx on public.videos (equipment) where review_status = 'approved';
create index videos_review_idx on public.videos (review_status);
create index videos_reviewed_by_idx on public.videos (reviewed_by) where reviewed_by is not null;

create trigger videos_touch before update on public.videos
  for each row execute function private.touch_updated_at();

comment on table public.videos is
  'Curated library. Only review_status = approved is ever recommended; an '
  'unreviewed row is inert by design.';

-- Which exercises a video actually contains, so a session can be tracked
-- around the video rather than the video just being played at someone.
create table public.video_exercises (
  id            uuid primary key default gen_random_uuid(),
  video_id      uuid not null references public.videos (id) on delete cascade,
  exercise_id   uuid not null references public.exercises (id) on delete restrict,
  sort_order    smallint not null default 0,
  -- Where in the video this exercise starts, for "watch this bit again".
  starts_at_sec integer check (starts_at_sec >= 0),
  duration_sec  integer check (duration_sec > 0),
  unique (video_id, exercise_id, sort_order)
);
create index video_exercises_video_idx on public.video_exercises (video_id, sort_order);
create index video_exercises_exercise_idx on public.video_exercises (exercise_id);

-- ---------------------------------------------------------------------------
-- Post-session feedback: the signal the progression engine runs on.
-- ---------------------------------------------------------------------------
create table public.session_feedback (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  workout_plan_id uuid references public.workout_plans (id) on delete set null,
  video_id        uuid references public.videos (id) on delete set null,
  performed_on    date not null default current_date,

  -- 1 easy -> 5 too difficult.
  difficulty      smallint not null check (difficulty between 1 and 5),
  -- Pain is kept separate from difficulty on purpose. "Hard" is progress;
  -- "hurts" is a stop signal, and collapsing them loses the distinction.
  pain            text not null default 'none'
                    check (pain in ('none','mild_discomfort','pain')),
  pain_location   text,

  completed       boolean not null default true,
  completed_ratio numeric(4,3) check (completed_ratio between 0 and 1),
  actual_minutes  smallint check (actual_minutes between 0 and 300),
  notes           text,
  created_at      timestamptz not null default now()
);
create index session_feedback_user_idx on public.session_feedback (user_id, performed_on desc);
create index session_feedback_video_idx on public.session_feedback (video_id) where video_id is not null;
create index session_feedback_plan_idx on public.session_feedback (workout_plan_id) where workout_plan_id is not null;

-- ---------------------------------------------------------------------------
-- Skill unlocks. Progression made visible without turning it into a game.
-- ---------------------------------------------------------------------------
create table public.skill_unlocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  exercise_id   uuid not null references public.exercises (id) on delete cascade,
  unlocked_on   date not null default current_date,
  -- Why it unlocked, shown to the user so it reads as earned rather than random.
  reason        text not null,
  unique (user_id, exercise_id)
);
create index skill_unlocks_user_idx on public.skill_unlocks (user_id, unlocked_on desc);
create index skill_unlocks_exercise_idx on public.skill_unlocks (exercise_id);

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fitness_assessments','session_feedback','skill_unlocks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$
      create policy %I on public.%I for select to authenticated
        using ((select auth.uid()) = user_id)
    $p$, t || '_select_own', t);
    execute format($p$
      create policy %I on public.%I for insert to authenticated
        with check ((select auth.uid()) = user_id)
    $p$, t || '_insert_own', t);
    execute format($p$
      create policy %I on public.%I for update to authenticated
        using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)
    $p$, t || '_update_own', t);
    execute format($p$
      create policy %I on public.%I for delete to authenticated
        using ((select auth.uid()) = user_id)
    $p$, t || '_delete_own', t);
  end loop;
end;
$$;

-- Videos are shared reference data: readable when approved, writable by admins.
alter table public.videos enable row level security;

create policy videos_select_approved on public.videos
  for select to authenticated
  using (review_status = 'approved');

create policy videos_admin_all on public.videos
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.video_exercises enable row level security;

create policy video_exercises_select on public.video_exercises
  for select to authenticated
  using (exists (
    select 1 from public.videos v
    where v.id = video_id and v.review_status = 'approved'
  ));

create policy video_exercises_admin on public.video_exercises
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
