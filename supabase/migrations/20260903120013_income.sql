-- 20260903120013_income.sql
--
-- Money coming in, so the money screen can answer "where did my salary go?".
--
-- Until now the screen knew what went out and a monthly limit the user typed
-- in. It had no idea what arrived, so it could not say what share of a salary
-- went on rent, how much was saved, or how much simply cannot be accounted for.
--
-- ## A source and a ledger, never one overwritten number
--
-- The same split as commitments and spends. `income_sources` is the plan —
-- "salary from my employer, around ₹50,000, on the 1st". `incomes` is the
-- ledger — what actually arrived and when. Salary history is therefore just the
-- ledger read back over time, and a pay rise in April does not rewrite what
-- January was.
--
-- A single `monthly_salary` column on the profile would have been simpler and
-- would have destroyed exactly the history that makes growth visible.

create table public.income_sources (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  label         text not null check (char_length(label) between 1 and 60),
  kind          text not null default 'salary'
                  check (kind in ('salary','freelance','business','bonus','interest','rental','other')),

  -- What is usually expected. Null for genuinely variable income, where any
  -- figure would be a guess presented as a plan.
  expected_paise bigint check (expected_paise is null or expected_paise > 0),

  -- 1-28, capped for the same February reason as commitments.due_day. Null for
  -- income that does not arrive on a fixed day.
  pay_day       smallint check (pay_day is null or pay_day between 1 and 28),

  started_on    date not null default current_date,
  ended_on      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint income_sources_ends_after_start check (ended_on is null or ended_on >= started_on)
);

create index income_sources_user_idx on public.income_sources (user_id) where ended_on is null;

create trigger income_sources_touch before update on public.income_sources
  for each row execute function private.touch_updated_at();

create table public.incomes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- Nullable: a one-off gift or refund has no recurring source.
  source_id     uuid references public.income_sources (id) on delete set null,

  amount_paise  bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  received_on   date not null default current_date,
  note          text check (note is null or char_length(note) <= 200),
  created_at    timestamptz not null default now()
);

create index incomes_user_date_idx on public.incomes (user_id, received_on desc);
create index incomes_source_idx on public.incomes (source_id) where source_id is not null;

comment on table public.incomes is
  'Money that actually arrived. Salary history is this table read over time; '
  'nothing here is overwritten when pay changes.';

-- ---------------------------------------------------------------------------
-- What a spend was *for*, beyond its category.
--
-- Null means "use the default for the category". Most categories have an
-- obvious answer — rent is an obligation, eating out is a want — but some do
-- not: clothes, gifts and education can be either, and silently guessing would
-- distort the one figure this exists to produce. Those stay unclassified until
-- the user says, and the wants total is reported as a floor rather than a fact.
-- ---------------------------------------------------------------------------
alter table public.spends
  add column if not exists intent text
    check (intent is null or intent in ('need','want','obligation','savings'));

-- ---------------------------------------------------------------------------
-- RLS. Owner-only, per command, auth.uid() hoisted into a subselect.
-- ---------------------------------------------------------------------------
alter table public.income_sources enable row level security;
alter table public.incomes enable row level security;

create policy income_sources_select on public.income_sources
  for select to authenticated using ((select auth.uid()) = user_id);
create policy income_sources_insert on public.income_sources
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy income_sources_update on public.income_sources
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy income_sources_delete on public.income_sources
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy incomes_select on public.incomes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy incomes_insert on public.incomes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy incomes_update on public.incomes
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy incomes_delete on public.incomes
  for delete to authenticated using ((select auth.uid()) = user_id);
