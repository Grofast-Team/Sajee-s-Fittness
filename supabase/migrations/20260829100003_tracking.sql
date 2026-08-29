-- 0003_tracking.sql
-- Body measurements, daily rollups, steps, sleep, water, cycle.

-- ---------------------------------------------------------------------------
-- measurements: one optional row per day. Every field nullable except date.
-- ---------------------------------------------------------------------------
create table public.measurements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  measured_on    date not null default current_date,
  weight_kg      numeric(5,2) check (weight_kg between 25 and 400),
  waist_cm       numeric(5,1) check (waist_cm between 30 and 250),
  hip_cm         numeric(5,1) check (hip_cm between 30 and 250),
  chest_cm       numeric(5,1) check (chest_cm between 30 and 250),
  neck_cm        numeric(4,1) check (neck_cm between 15 and 90),
  arm_cm         numeric(4,1) check (arm_cm between 10 and 90),
  thigh_cm       numeric(5,1) check (thigh_cm between 20 and 150),
  body_fat_pct   numeric(4,1) check (body_fat_pct between 3 and 70),
  body_fat_method text check (body_fat_method in ('dexa','bodpod','bia_clinical','bia_consumer','calipers','navy_tape','visual_estimate')),
  custom         jsonb not null default '{}'::jsonb,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (user_id, measured_on)
);
create index measurements_user_date_idx on public.measurements (user_id, measured_on desc);

comment on column public.measurements.body_fat_method is
  'Drives whether Katch-McArdle is eligible. Only dexa/bodpod/bia_clinical count as reliable.';

-- ---------------------------------------------------------------------------
-- daily_logs: denormalised per-day rollup. Written by trigger from food_logs
-- and by direct upsert for steps/water/sleep. Read path for the dashboard.
-- ---------------------------------------------------------------------------
create table public.daily_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  log_date          date not null default current_date,
  kcal              numeric(8,1) not null default 0,
  protein_g         numeric(7,1) not null default 0,
  carb_g            numeric(7,1) not null default 0,
  fat_g             numeric(7,1) not null default 0,
  fibre_g           numeric(7,1) not null default 0,
  water_ml          integer not null default 0 check (water_ml between 0 and 15000),
  steps             integer check (steps between 0 and 100000),
  sleep_minutes     integer check (sleep_minutes between 0 and 1200),
  meals_logged      smallint not null default 0,
  workout_done      boolean not null default false,
  logging_complete  boolean not null default false,
  adherence_score   numeric(4,1) check (adherence_score between 0 and 100),
  mood              smallint check (mood between 1 and 5),
  hunger            smallint check (hunger between 1 and 5),
  energy            smallint check (energy between 1 and 5),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, log_date)
);
create index daily_logs_user_date_idx on public.daily_logs (user_id, log_date desc);
create trigger daily_logs_touch before update on public.daily_logs
  for each row execute function private.touch_updated_at();

comment on column public.daily_logs.logging_complete is
  'User-asserted "I logged everything today". Gates adaptive calorie changes.';

-- ---------------------------------------------------------------------------
-- step_logs: separate from daily_logs so provenance survives
-- ---------------------------------------------------------------------------
create table public.step_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  log_date   date not null default current_date,
  steps      integer not null check (steps between 0 and 100000),
  active_minutes integer check (active_minutes between 0 and 1440),
  source     text not null default 'manual' check (source in ('manual','apple_health','health_connect','fitbit','garmin','other')),
  created_at timestamptz not null default now(),
  unique (user_id, log_date, source)
);
create index step_logs_user_date_idx on public.step_logs (user_id, log_date desc);

-- ---------------------------------------------------------------------------
-- sleep_logs
-- ---------------------------------------------------------------------------
create table public.sleep_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  log_date    date not null default current_date,
  bedtime     time,
  wake_time   time,
  minutes     integer not null check (minutes between 0 and 1200),
  quality     smallint check (quality between 1 and 5),
  source      text not null default 'manual',
  created_at  timestamptz not null default now(),
  unique (user_id, log_date)
);
create index sleep_logs_user_date_idx on public.sleep_logs (user_id, log_date desc);

-- ---------------------------------------------------------------------------
-- water_logs: append-only so the dashboard can show "when"
-- ---------------------------------------------------------------------------
create table public.water_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  log_date   date not null default current_date,
  ml         integer not null check (ml > 0 and ml <= 3000),
  logged_at  timestamptz not null default now()
);
create index water_logs_user_date_idx on public.water_logs (user_id, log_date desc);

-- ---------------------------------------------------------------------------
-- cycle_logs: strictly opt-in. Used only to contextualise weight fluctuation.
-- ---------------------------------------------------------------------------
create table public.cycle_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  started_on  date not null,
  ended_on    date,
  symptoms    text[] not null default array[]::text[],
  created_at  timestamptz not null default now(),
  unique (user_id, started_on)
);
create index cycle_logs_user_idx on public.cycle_logs (user_id, started_on desc);

comment on table public.cycle_logs is
  'Opt-in only. Never used to diagnose; only to explain expected water-weight shifts.';
