-- 20260903120016_savings_withdrawals.sql
--
-- Taking money back out of a savings goal.
--
-- ## Why this is not a spend
--
-- Putting money into a goal is a spend filed as savings: it leaves the account
-- the money screen watches. Taking it back out is the reverse, and it is
-- neither of the things the ledger already records. It is not spending — it
-- buys nothing — and it is not income, because counting it as income would
-- move the salary trend and inflate the savings rate with money that was
-- already saved once. So it gets its own small ledger, and "where did my
-- salary go" places it beside income as money that arrived to be spent.
--
-- What a goal holds is therefore:
--
--   opening_paise + spends carrying savings_goal_id − withdrawals carrying it
--
-- and still never a stored balance.

create table public.savings_withdrawals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  -- Set null rather than cascade, like spends.savings_goal_id: the money really
  -- came out, and removing the goal does not undo that.
  savings_goal_id  uuid references public.savings_goals (id) on delete set null,

  amount_paise     bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  withdrawn_on     date not null default current_date,
  note             text check (note is null or char_length(note) <= 200),
  created_at       timestamptz not null default now()
);

create index savings_withdrawals_user_date_idx
  on public.savings_withdrawals (user_id, withdrawn_on desc);
create index savings_withdrawals_goal_idx
  on public.savings_withdrawals (savings_goal_id) where savings_goal_id is not null;

comment on table public.savings_withdrawals is
  'Money taken back out of a savings goal. Neither spending nor income. A goal '
  'holds opening_paise plus its contributions (spends) minus these.';

-- ---------------------------------------------------------------------------
-- Guards: the goal belongs to the same user, and holds enough.
--
-- One function rather than two triggers, so the ownership check is guaranteed
-- to run before the balance is read — trigger order is alphabetical, and a
-- balance check that ran first would be summing another user's goal.
--
-- The goal row is locked for the rest of the transaction. Two withdrawals
-- submitted at once (a double tap) would otherwise each see the full balance
-- and both succeed.
-- ---------------------------------------------------------------------------
create or replace function private.check_savings_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  held bigint;
begin
  -- Unlinking (the goal was deleted and on delete set null fired) is always
  -- allowed, including during account deletion.
  if new.savings_goal_id is null then
    return new;
  end if;

  perform 1
  from public.savings_goals g
  where g.id = new.savings_goal_id
    and g.user_id = new.user_id
  for update;

  if not found then
    raise exception 'money cannot be taken out of a savings goal belonging to another user'
      using errcode = '42501';
  end if;

  select
      g.opening_paise
    + coalesce((select sum(s.amount_paise) from public.spends s
                where s.savings_goal_id = g.id and s.user_id = new.user_id), 0)
    - coalesce((select sum(w.amount_paise) from public.savings_withdrawals w
                where w.savings_goal_id = g.id and w.user_id = new.user_id
                  and w.id is distinct from new.id), 0)
  into held
  from public.savings_goals g
  where g.id = new.savings_goal_id;

  if new.amount_paise > held then
    raise exception 'that is more than this savings goal holds'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger savings_withdrawals_guard
  before insert or update of savings_goal_id, user_id, amount_paise on public.savings_withdrawals
  for each row execute function private.check_savings_withdrawal();

-- ---------------------------------------------------------------------------
-- RLS. Owner-only. No update policy: a mistyped withdrawal is removed and
-- recorded again, which keeps the balance check above the only way in.
-- ---------------------------------------------------------------------------
alter table public.savings_withdrawals enable row level security;

create policy savings_withdrawals_select on public.savings_withdrawals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy savings_withdrawals_insert on public.savings_withdrawals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy savings_withdrawals_delete on public.savings_withdrawals
  for delete to authenticated using ((select auth.uid()) = user_id);
