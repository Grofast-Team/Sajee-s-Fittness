-- 20260903120006_step_segments.sql
--
-- Per-segment step records from Health Connect / HealthKit, and the validated
-- daily figure derived from them.
--
-- Two principles shape this table.
--
-- **The device's own numbers are never overwritten.** `step_logs` keeps
-- reporting what the phone said. This table holds the segments behind it and
-- our assessment of them, so the two can always be reconciled and a user who
-- notices our total differs from Google Fit's can be shown exactly where the
-- difference came from. Silently replacing the number someone's phone shows
-- them is how an app loses trust in both figures at once.
--
-- **Raw sensor data is not stored.** Only the aggregated segments the platform
-- already exposes — a time range, a count, and which app recorded it. Keeping
-- high-frequency accelerometer traces would be a serious privacy liability for
-- no analytical gain, and it is not ours to keep.

create table public.step_segments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  log_date      date not null,

  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  steps         integer not null check (steps between 0 and 100000),

  -- The app that recorded it: 'Google Fit', 'Samsung Health', 'Fitbit'.
  -- Free text because it comes from the platform and we do not control the set.
  source_name   text,
  -- Platform record id, so a re-sync updates rather than duplicates.
  platform_id   text,

  -- Our verdict. Null reason means it was counted.
  counted       boolean not null default true,
  exclusion_reason text
                  check (exclusion_reason in (
                    'duplicate_source','impossible_cadence','wheel_based_workout'
                  )),
  cadence       integer check (cadence between 0 and 2000),

  created_at    timestamptz not null default now(),

  constraint step_segments_ordered check (ended_at >= started_at),
  -- A re-sync of the same platform record must land on the same row.
  unique (user_id, platform_id)
);

create index step_segments_user_date_idx
  on public.step_segments (user_id, log_date desc);

comment on table public.step_segments is
  'Time-segmented step records from the platform health store, with our '
  'assessment of each. The device total in step_logs is never overwritten.';
comment on column public.step_segments.counted is
  'Whether this segment contributed to the validated total. Excluded segments '
  'are kept, not deleted — a user is owed an explanation of the difference.';

-- ---------------------------------------------------------------------------
-- The validated daily figure.
-- ---------------------------------------------------------------------------
create table public.step_validations (
  user_id       uuid not null references auth.users (id) on delete cascade,
  log_date      date not null,

  raw_steps     integer not null check (raw_steps >= 0),
  validated_steps integer not null check (validated_steps >= 0),
  excluded_steps  integer not null check (excluded_steps >= 0),

  confidence    text not null check (confidence in ('high','medium','low')),
  -- Plain-language reasons, shown verbatim. Never a bare percentage.
  reasons       jsonb not null default '[]'::jsonb,
  sources       text[] not null default array[]::text[],

  synced_at     timestamptz not null default now(),

  primary key (user_id, log_date),
  -- Validated steps can never exceed what the device reported. If this ever
  -- fails, the engine has invented steps, which is worse than any undercount.
  constraint step_validations_within_raw check (validated_steps <= raw_steps)
);

comment on constraint step_validations_within_raw on public.step_validations is
  'The engine may discount steps; it may never manufacture them.';

-- ---------------------------------------------------------------------------
-- RLS. Same shape as every other user table: owner-only, per command,
-- with the auth.uid() call wrapped in a subselect so the planner hoists it.
-- ---------------------------------------------------------------------------
alter table public.step_segments enable row level security;
alter table public.step_validations enable row level security;

create policy step_segments_select on public.step_segments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy step_segments_insert on public.step_segments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy step_segments_update on public.step_segments
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy step_segments_delete on public.step_segments
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy step_validations_select on public.step_validations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy step_validations_insert on public.step_validations
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy step_validations_update on public.step_validations
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy step_validations_delete on public.step_validations
  for delete to authenticated using ((select auth.uid()) = user_id);
