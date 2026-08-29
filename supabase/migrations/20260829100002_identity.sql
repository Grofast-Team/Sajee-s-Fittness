-- 0002_identity.sql
-- Profile, lifestyle interview, goals, preferences, safety screening, plans.

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  display_name       text not null default '',
  date_of_birth      date,
  age_years          smallint check (age_years between 13 and 100),
  sex                sex_at_birth,
  height_cm          numeric(5,1) check (height_cm between 90 and 250),
  units              unit_system not null default 'metric',
  country_code       text check (char_length(country_code) = 2),
  region             text,
  city               text,
  locale             text not null default 'en-IN',
  currency_code      text not null default 'INR' check (char_length(currency_code) = 3),
  timezone           text not null default 'Asia/Kolkata',
  onboarding_step    smallint not null default 0,
  onboarding_done_at timestamptz,
  experience         experience_level not null default 'none',
  beginner_mode      boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

comment on column public.profiles.beginner_mode is
  'Progressive disclosure: hides macro and analytics surfaces until the user opts in.';

-- ---------------------------------------------------------------------------
-- lifestyle: interview answers that drive personalisation
-- ---------------------------------------------------------------------------
create table public.lifestyle (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  occupation          text,
  work_pattern        text check (work_pattern in ('desk','mixed','standing','physical','shift','unemployed','student','home')),
  sitting_hours       numeric(3,1) check (sitting_hours between 0 and 24),
  work_start          time,
  work_end            time,
  night_shift         boolean not null default false,
  commute_minutes     smallint check (commute_minutes between 0 and 480),
  commute_mode        text,
  wake_time           time,
  sleep_time          time,
  typical_sleep_hours numeric(3,1) check (typical_sleep_hours between 0 and 16),
  sleep_quality       smallint check (sleep_quality between 1 and 5),
  stress_level        smallint check (stress_level between 1 and 5),
  emotional_eating    boolean,
  eating_triggers     text[] not null default array[]::text[],
  baseline_steps      integer check (baseline_steps between 0 and 60000),
  training_days_per_week smallint check (training_days_per_week between 0 and 7),
  equipment           equipment_access not null default 'none',
  workout_time_pref   text,
  session_minutes_available smallint check (session_minutes_available between 0 and 240),
  injuries            text[] not null default array[]::text[],
  mobility_limits     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger lifestyle_touch before update on public.lifestyle
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- food_profile: diet, culture, cooking capability
-- ---------------------------------------------------------------------------
create table public.food_profile (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  diet                 diet_pattern not null default 'non_vegetarian',
  eats_eggs            boolean not null default true,
  eats_dairy           boolean not null default true,
  cuisines             text[] not null default array[]::text[],
  allergies            text[] not null default array[]::text[],
  intolerances         text[] not null default array[]::text[],
  religious_limits     text[] not null default array[]::text[],
  disliked_foods       text[] not null default array[]::text[],
  favourite_foods      text[] not null default array[]::text[],
  cooks_own_food       boolean not null default true,
  cook_identity        text,
  cook_minutes_weekday smallint check (cook_minutes_weekday between 0 and 240),
  cook_minutes_weekend smallint check (cook_minutes_weekend between 0 and 240),
  kitchen_equipment    text[] not null default array[]::text[],
  has_refrigerator     boolean not null default true,
  can_meal_prep        boolean not null default false,
  meals_per_day        smallint not null default 3 check (meals_per_day between 1 and 8),
  eats_out_per_week    smallint check (eats_out_per_week between 0 and 30),
  household_size       smallint check (household_size between 1 and 30),
  shared_household_food boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger food_profile_touch before update on public.food_profile
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------
create table public.budgets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  period           budget_period not null default 'daily',
  amount           numeric(10,2) not null check (amount >= 0),
  currency_code    text not null default 'INR',
  covers_household boolean not null default false,
  effective_from   date not null default current_date,
  created_at       timestamptz not null default now()
);
create index budgets_user_idx on public.budgets (user_id, effective_from desc);

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
create table public.goals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  goal               goal_type not null default 'fat_loss',
  priorities         text[] not null default array[]::text[],
  starting_weight_kg numeric(5,2) check (starting_weight_kg between 25 and 400),
  target_weight_kg   numeric(5,2) check (target_weight_kg between 25 and 400),
  target_waist_cm    numeric(5,1),
  requested_date     date,
  agreed_date        date,
  pace               loss_pace not null default 'steady',
  status             goal_status not null default 'active',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index goals_user_idx on public.goals (user_id, status);
create trigger goals_touch before update on public.goals
  for each row execute function private.touch_updated_at();

comment on column public.goals.requested_date is 'What the user asked for.';
comment on column public.goals.agreed_date is 'What the expectation engine judged safely achievable.';

-- ---------------------------------------------------------------------------
-- safety_flags: raised by screening, cleared by the user or a reviewer
-- ---------------------------------------------------------------------------
create table public.safety_flags (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  code            text not null,
  severity        safety_severity not null,
  reason          text not null,
  guidance        text not null,
  restricts       text[] not null default array[]::text[],
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index safety_flags_active_idx on public.safety_flags (user_id) where resolved_at is null;
create unique index safety_flags_open_unique_idx on public.safety_flags (user_id, code) where resolved_at is null;

comment on table public.safety_flags is
  'Screening outcomes. restricts names capabilities the app must withhold, e.g. aggressive_deficit.';

-- ---------------------------------------------------------------------------
-- plans: the generated, versioned prescription
-- ---------------------------------------------------------------------------
create table public.plans (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  version            integer not null default 1,
  is_active          boolean not null default true,
  bmr_kcal           integer not null,
  tdee_kcal          integer not null,
  activity           activity_level not null,
  energy_target_kcal integer not null check (energy_target_kcal between 800 and 6000),
  energy_floor_kcal  integer not null,
  protein_g          integer not null check (protein_g >= 0),
  fat_g              integer not null check (fat_g >= 0),
  carb_g             integer not null check (carb_g >= 0),
  fibre_g            integer not null check (fibre_g >= 0),
  water_ml           integer not null default 2000,
  step_target        integer not null check (step_target between 0 and 40000),
  training_days      smallint not null default 0,
  sleep_target_hours numeric(3,1) not null default 7.5,
  binding_constraint text,
  rationale          jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create unique index plans_one_active_idx on public.plans (user_id) where is_active;
create index plans_user_idx on public.plans (user_id, created_at desc);

comment on column public.plans.binding_constraint is
  'Which safety limit set the target, so the Why panel is never empty.';
comment on column public.plans.rationale is
  'Structured explanation payload rendered by the explainability UI.';

-- ---------------------------------------------------------------------------
-- plan_adjustments: audit trail of every adaptive change
-- ---------------------------------------------------------------------------
create table public.plan_adjustments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  plan_id     uuid references public.plans (id) on delete set null,
  decision    text not null,
  lever       text,
  delta_kcal  integer,
  delta_steps integer,
  evidence    jsonb not null default '{}'::jsonb,
  applied     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index plan_adjustments_user_idx on public.plan_adjustments (user_id, created_at desc);
create index plan_adjustments_plan_idx on public.plan_adjustments (plan_id);

-- ---------------------------------------------------------------------------
-- user_memory: durable coach memory the user can inspect and edit
-- ---------------------------------------------------------------------------
create table public.user_memory (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('preference','constraint','pattern','correction','context')),
  key        text not null,
  value      text not null,
  source     text not null default 'inferred' check (source in ('stated','inferred','corrected')),
  confidence confidence_level not null default 'medium',
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, key)
);
create index user_memory_user_idx on public.user_memory (user_id) where active;
create trigger user_memory_touch before update on public.user_memory
  for each row execute function private.touch_updated_at();
