-- 20260903120015_savings_goals.sql
--
-- Saving towards something: an emergency fund, a deposit, a trip.
--
-- ## A goal is a plan; putting money in is a spend
--
-- The same split as commitments. `savings_goals` holds the plan — what, how
-- much, by when, and anything saved before the app existed. Money added to a
-- goal is an ordinary `spends` row filed as savings and carrying
-- `savings_goal_id`, so "where did my salary go" already counts it as set
-- aside, and there is no second balance to drift out of step with the ledger.
--
-- Taking money back out is not modelled yet. A withdrawal is neither income
-- nor spending in the salary breakdown, and deciding how it should show there
-- is its own piece of work. Until then a goal shows what was put in.

create table public.savings_goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,

  label          text not null check (char_length(label) between 1 and 60),
  target_paise   bigint not null check (target_paise > 0 and target_paise <= 100000000000),

  -- Saved before the goal was recorded here. Kept apart from contributions so
  -- it never counts towards the monthly pace: it was not saved this month.
  opening_paise  bigint not null default 0
                   check (opening_paise >= 0 and opening_paise <= 100000000000),

  started_on     date not null default current_date,
  -- Null for a goal with no deadline.
  target_date    date,
  -- Closed rather than deleted, so contributions keep the goal they were for.
  closed_on      date,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint savings_goals_target_after_start check (target_date is null or target_date >= started_on),
  constraint savings_goals_closed_after_start check (closed_on is null or closed_on >= started_on)
);

create index savings_goals_user_idx on public.savings_goals (user_id) where closed_on is null;

create trigger savings_goals_touch before update on public.savings_goals
  for each row execute function private.touch_updated_at();

comment on table public.savings_goals is
  'What someone is saving towards. A plan, not a balance: what has been saved is '
  'opening_paise plus the spends carrying savings_goal_id.';

-- ---------------------------------------------------------------------------
-- The link from the ledger
-- ---------------------------------------------------------------------------
alter table public.spends
  add column if not exists savings_goal_id uuid
    references public.savings_goals (id) on delete set null;

create index if not exists spends_savings_goal_idx
  on public.spends (savings_goal_id) where savings_goal_id is not null;

comment on column public.spends.savings_goal_id is
  'Set when this spend was money added to a savings goal. Always filed as savings.';

-- A contribution is savings. A constraint rather than a trigger: it covers
-- inserts and edits alike, so a recategorised contribution is refused the same
-- way a mistyped one is.
alter table public.spends
  add constraint spends_goal_contribution_is_savings
    check (savings_goal_id is null or category = 'savings');

-- Foreign-key checks run with the table owner's rights and ignore RLS; see
-- 20260903120014 for the same guard on commitment_id.
create or replace function private.check_spend_savings_goal_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.savings_goal_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.savings_goals g
    where g.id = new.savings_goal_id
      and g.user_id = new.user_id
  ) then
    raise exception 'a spend cannot be added to a savings goal belonging to another user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger spends_savings_goal_owner
  before insert or update of savings_goal_id, user_id on public.spends
  for each row execute function private.check_spend_savings_goal_owner();

-- ---------------------------------------------------------------------------
-- History: the revision trigger learns the new link.
--
-- Identical to 20260903120014 apart from the savings_goal_id line, and it keeps
-- the account-deletion guard, which matters more now: deleting a user sets
-- savings_goal_id to null on their spends before those spends are deleted.
-- ---------------------------------------------------------------------------
create or replace function private.record_spend_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed text[] := array[]::text[];
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.spend_revisions (user_id, spend_id, action, before)
    values (old.user_id, old.id, 'delete', to_jsonb(old));
    return null;
  end if;

  if new.amount_paise    is distinct from old.amount_paise    then changed := changed || 'amount_paise'::text;    end if;
  if new.category        is distinct from old.category        then changed := changed || 'category'::text;        end if;
  if new.note            is distinct from old.note            then changed := changed || 'note'::text;            end if;
  if new.spent_on        is distinct from old.spent_on        then changed := changed || 'spent_on'::text;        end if;
  if new.intent          is distinct from old.intent          then changed := changed || 'intent'::text;          end if;
  if new.commitment_id   is distinct from old.commitment_id   then changed := changed || 'commitment_id'::text;   end if;
  if new.savings_goal_id is distinct from old.savings_goal_id then changed := changed || 'savings_goal_id'::text; end if;

  if cardinality(changed) = 0 then
    return null;
  end if;

  insert into public.spend_revisions (user_id, spend_id, action, before, changed_fields)
  values (old.user_id, old.id, 'update', to_jsonb(old), changed);

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Owner-only, per command, auth.uid() hoisted into a subselect.
-- ---------------------------------------------------------------------------
alter table public.savings_goals enable row level security;

create policy savings_goals_select on public.savings_goals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy savings_goals_insert on public.savings_goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy savings_goals_update on public.savings_goals
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy savings_goals_delete on public.savings_goals
  for delete to authenticated using ((select auth.uid()) = user_id);
