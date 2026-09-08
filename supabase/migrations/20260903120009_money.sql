-- 20260903120009_money.sql
--
-- The money side of the app: what was spent, and the limits it is measured
-- against.
--
-- ## Amounts are integers, in paise
--
-- Never floating point. 0.1 + 0.2 is not 0.3 in binary floating point, and a
-- spending total is summed hundreds of times a month — the error compounds and
-- the number stops matching what the user added up on paper. Once that happens
-- they stop trusting the app, and rightly so. Whole paise in an integer is
-- exact, and the display layer divides by 100.
--
-- ## No bank connection
--
-- Every row here is typed in by a person. There is no automatic import: doing
-- that in India needs a licensed account-aggregator integration, and inventing
-- transactions the user did not enter would be the money equivalent of
-- inventing calorie counts.

create table public.spends (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  spent_on    date not null default current_date,

  -- Paise. 10 crore rupees is a generous ceiling for a personal spend and
  -- still catches a mis-typed amount with too many zeros.
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),

  category    text not null check (category in (
    'groceries','eating_out','transport','rent','bills','phone_internet',
    'medical','education','family','clothes','household','entertainment',
    'personal_care','gifts','savings','other'
  )),
  note        text check (note is null or char_length(note) <= 200),

  created_at  timestamptz not null default now()
);

create index spends_user_date_idx on public.spends (user_id, spent_on desc);
create index spends_user_category_idx on public.spends (user_id, category);

comment on column public.spends.amount_paise is
  'Whole paise as an integer. Floating point loses money when summed.';

-- ---------------------------------------------------------------------------
-- Per-user money settings.
-- ---------------------------------------------------------------------------
create table public.money_settings (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  -- Null means "no limit set yet", which is different from a limit of zero.
  monthly_limit_paise bigint check (monthly_limit_paise is null or monthly_limit_paise >= 0),
  -- Which day the user's money month begins. 1 is the calendar month.
  month_start_day    smallint not null default 1 check (month_start_day between 1 and 28),
  currency_code      text not null default 'INR' check (char_length(currency_code) = 3),
  updated_at         timestamptz not null default now()
);

create trigger money_settings_touch before update on public.money_settings
  for each row execute function private.touch_updated_at();

comment on column public.money_settings.month_start_day is
  'Capped at 28 so every month has the day. A 31st start would silently skip '
  'February.';

-- ---------------------------------------------------------------------------
-- RLS: owner-only, per command, auth.uid() wrapped so the planner hoists it.
-- ---------------------------------------------------------------------------
alter table public.spends enable row level security;
alter table public.money_settings enable row level security;

create policy spends_select on public.spends
  for select to authenticated using ((select auth.uid()) = user_id);
create policy spends_insert on public.spends
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy spends_update on public.spends
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy spends_delete on public.spends
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy money_settings_select on public.money_settings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy money_settings_insert on public.money_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy money_settings_update on public.money_settings
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy money_settings_delete on public.money_settings
  for delete to authenticated using ((select auth.uid()) = user_id);
