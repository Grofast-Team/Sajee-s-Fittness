-- 20260903120010_commitments.sql
--
-- Money someone has already promised: rent, electricity, phone, EMI,
-- subscriptions.
--
-- The money screen could only answer "what has gone out". For a person living
-- alone the question that actually decides a Tuesday is different: *what is
-- left after what I still owe this month*. Someone eleven days in with ₹8,000
-- spent and ₹12,000 of rent still due does not have ₹12,000 of freedom, and a
-- screen that implies otherwise is worse than no screen.
--
-- ## Marking one paid records a real spend
--
-- There is no second ledger. `spends` remains the only record of money going
-- out; a commitment is a *plan*, and paying it writes an ordinary spend row
-- carrying `commitment_id`. The same reasoning as the food estimate: two
-- places recording the same money is how a total silently doubles.
--
-- So "is the rent paid this month" is answered by looking for a spend in the
-- current window that points at the rent commitment, not by a paid flag that
-- can drift out of step with the ledger.

create table public.commitments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  label         text not null check (char_length(label) between 1 and 60),
  -- Paise, as everywhere in this app. Money never touches a float.
  amount_paise  bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),

  -- Same vocabulary as `spends`, so a paid commitment lands in the right slice
  -- of "where it went" without translation.
  category      text not null check (category in (
    'groceries','eating_out','transport','rent','bills','phone_internet',
    'medical','education','family','clothes','household','entertainment',
    'personal_care','gifts','savings','other'
  )),

  cadence       text not null default 'monthly'
                  check (cadence in ('weekly','monthly','quarterly','yearly')),

  /*
   * Which day of the month it falls due.
   *
   * Capped at 28 for the same reason `money_settings.month_start_day` is: a
   * bill set for the 31st would silently skip February. Anyone whose rent is
   * due on the 30th is better served by the 28th and two days of warning than
   * by a reminder that does not appear at all.
   */
  due_day       smallint not null default 1 check (due_day between 1 and 28),

  -- Null means it runs indefinitely. An ended commitment is kept, not deleted,
  -- so past months still explain themselves.
  started_on    date not null default current_date,
  ended_on      date,

  note          text check (note is null or char_length(note) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint commitments_ends_after_start check (ended_on is null or ended_on >= started_on)
);

create index commitments_user_idx on public.commitments (user_id) where ended_on is null;

comment on table public.commitments is
  'Recurring money already promised. A plan, not a ledger: paying one writes a '
  'row in spends carrying commitment_id.';

-- The link back to the ledger.
alter table public.spends
  add column if not exists commitment_id uuid references public.commitments (id) on delete set null;

create index if not exists spends_commitment_idx
  on public.spends (commitment_id) where commitment_id is not null;

comment on column public.spends.commitment_id is
  'Set when this spend settled a recurring commitment. How "is the rent paid '
  'this month" is answered — from the ledger itself rather than a flag that '
  'can drift out of step with it.';

create trigger commitments_touch before update on public.commitments
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Owner-only, per command, with auth.uid() in a subselect so the planner
-- hoists it out of the row loop — the same shape as every other user table.
-- ---------------------------------------------------------------------------
alter table public.commitments enable row level security;

create policy commitments_select on public.commitments
  for select to authenticated using ((select auth.uid()) = user_id);
create policy commitments_insert on public.commitments
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy commitments_update on public.commitments
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy commitments_delete on public.commitments
  for delete to authenticated using ((select auth.uid()) = user_id);
