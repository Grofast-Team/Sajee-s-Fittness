-- 20260903120019_import_classification.sql
--
-- What each imported line is: spending, saving, a transfer, income, or a refund.
--
-- Until now a line was only money out (a spend) or money in (income). That
-- counts a credit card bill as spending when the spending is already on the
-- card statement, counts money moved to your own account as gone, and loses
-- the link between a SIP debit and the goal it is for.
--
-- ## What each kind writes
--
--   expense   money out  → a spend, with its category
--   saving    money out  → a spend filed as savings, optionally to a goal
--             money in   → a withdrawal from a goal
--   transfer  either     → nothing: it is neither spending nor income. The line
--                          is kept, with the other leg when one was found.
--   income    money in   → income, optionally from a source
--   refund    money in   → nothing yet; refunds against the spend they reverse
--                          are not modelled, and a refund is not income
--
-- There is no accounts table, so a transfer is recognised and kept out of the
-- totals rather than attached to "Bank B".

alter table public.import_rows
  add column kind text
    check (kind is null or kind in ('expense', 'income', 'transfer', 'saving', 'refund')),
  add column kind_source text
    check (kind_source is null or kind_source in ('rule', 'keyword', 'pair', 'none', 'person')),
  add column kind_reason text check (kind_reason is null or char_length(kind_reason) <= 200),
  add column savings_goal_id uuid references public.savings_goals (id) on delete set null,
  add column income_source_id uuid references public.income_sources (id) on delete set null,
  add column withdrawal_id uuid references public.savings_withdrawals (id) on delete set null,
  add column duplicate_of_income uuid references public.incomes (id) on delete set null,
  -- The other leg of a transfer: a line of this file, or of an earlier import.
  add column pair_row_id uuid references public.import_rows (id) on delete set null,
  add column pair_row_number integer;

alter table public.import_rows
  add constraint import_rows_kind_fits_direction check (
    kind is null
    or (direction = 'out' and kind in ('expense', 'saving', 'transfer'))
    or (direction = 'in' and kind in ('income', 'saving', 'transfer', 'refund'))
  );

create index import_rows_goal_idx on public.import_rows (savings_goal_id) where savings_goal_id is not null;
create index import_rows_source_idx on public.import_rows (income_source_id) where income_source_id is not null;
create index import_rows_withdrawal_idx on public.import_rows (withdrawal_id) where withdrawal_id is not null;
create index import_rows_dup_income_idx on public.import_rows (duplicate_of_income) where duplicate_of_income is not null;
create index import_rows_pair_idx on public.import_rows (pair_row_id) where pair_row_id is not null;
-- Finding the other leg of a transfer in earlier imports.
create index import_rows_pairing_idx on public.import_rows (user_id, amount_paise, occurred_on)
  where amount_paise is not null;

-- ---------------------------------------------------------------------------
-- Merchant rules learn the kind, and the goal or source, per direction
-- ---------------------------------------------------------------------------
alter table public.merchant_rules
  add column direction text not null default 'out' check (direction in ('in', 'out')),
  add column kind text not null default 'expense'
    check (kind in ('expense', 'income', 'transfer', 'saving', 'refund')),
  add column savings_goal_id uuid references public.savings_goals (id) on delete set null,
  add column income_source_id uuid references public.income_sources (id) on delete set null,
  alter column category drop not null;

alter table public.merchant_rules
  add constraint merchant_rules_expense_has_category check (kind <> 'expense' or category is not null),
  add constraint merchant_rules_kind_fits_direction check (
    (direction = 'out' and kind in ('expense', 'saving', 'transfer'))
    or (direction = 'in' and kind in ('income', 'saving', 'transfer', 'refund'))
  ),
  drop constraint merchant_rules_user_id_merchant_key_key,
  add constraint merchant_rules_one_per_direction unique (user_id, merchant_key, direction);

create index merchant_rules_goal_idx on public.merchant_rules (savings_goal_id) where savings_goal_id is not null;
create index merchant_rules_source_idx on public.merchant_rules (income_source_id) where income_source_id is not null;

-- ---------------------------------------------------------------------------
-- Ownership of every new reference (FK checks ignore RLS; see 20260903120014)
-- ---------------------------------------------------------------------------
create or replace function private.check_import_row_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Unlinking is always allowed: a spend removed, a goal deleted, an account
  -- being deleted.
  if tg_op = 'UPDATE'
     and new.batch_id = old.batch_id
     and new.user_id = old.user_id
     and (new.spend_id is null or new.spend_id is not distinct from old.spend_id)
     and (new.income_id is null or new.income_id is not distinct from old.income_id)
     and (new.duplicate_of_spend is null or new.duplicate_of_spend is not distinct from old.duplicate_of_spend)
     and (new.duplicate_of_income is null or new.duplicate_of_income is not distinct from old.duplicate_of_income)
     and (new.savings_goal_id is null or new.savings_goal_id is not distinct from old.savings_goal_id)
     and (new.income_source_id is null or new.income_source_id is not distinct from old.income_source_id)
     and (new.withdrawal_id is null or new.withdrawal_id is not distinct from old.withdrawal_id)
     and (new.pair_row_id is null or new.pair_row_id is not distinct from old.pair_row_id) then
    return new;
  end if;

  if not exists (
    select 1 from public.import_batches b where b.id = new.batch_id and b.user_id = new.user_id
  ) then
    raise exception 'an import row cannot belong to another user''s batch' using errcode = '42501';
  end if;

  if (new.spend_id is not null and not exists (
        select 1 from public.spends s where s.id = new.spend_id and s.user_id = new.user_id))
     or (new.duplicate_of_spend is not null and not exists (
        select 1 from public.spends s where s.id = new.duplicate_of_spend and s.user_id = new.user_id)) then
    raise exception 'an import row cannot point at another user''s spend' using errcode = '42501';
  end if;

  if (new.income_id is not null and not exists (
        select 1 from public.incomes i where i.id = new.income_id and i.user_id = new.user_id))
     or (new.duplicate_of_income is not null and not exists (
        select 1 from public.incomes i where i.id = new.duplicate_of_income and i.user_id = new.user_id)) then
    raise exception 'an import row cannot point at another user''s income' using errcode = '42501';
  end if;

  if new.savings_goal_id is not null and not exists (
    select 1 from public.savings_goals g where g.id = new.savings_goal_id and g.user_id = new.user_id
  ) then
    raise exception 'an import row cannot point at another user''s savings goal' using errcode = '42501';
  end if;

  if new.income_source_id is not null and not exists (
    select 1 from public.income_sources s where s.id = new.income_source_id and s.user_id = new.user_id
  ) then
    raise exception 'an import row cannot point at another user''s income source' using errcode = '42501';
  end if;

  if new.withdrawal_id is not null and not exists (
    select 1 from public.savings_withdrawals w where w.id = new.withdrawal_id and w.user_id = new.user_id
  ) then
    raise exception 'an import row cannot point at another user''s withdrawal' using errcode = '42501';
  end if;

  if new.pair_row_id is not null and not exists (
    select 1 from public.import_rows r where r.id = new.pair_row_id and r.user_id = new.user_id
  ) then
    raise exception 'an import row cannot be paired with another user''s line' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger import_rows_refs on public.import_rows;
create trigger import_rows_refs
  before insert or update of batch_id, user_id, spend_id, income_id, duplicate_of_spend, duplicate_of_income,
    savings_goal_id, income_source_id, withdrawal_id, pair_row_id
  on public.import_rows
  for each row execute function private.check_import_row_refs();

create or replace function private.check_merchant_rule_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.user_id = old.user_id
     and (new.savings_goal_id is null or new.savings_goal_id is not distinct from old.savings_goal_id)
     and (new.income_source_id is null or new.income_source_id is not distinct from old.income_source_id) then
    return new;
  end if;

  if new.savings_goal_id is not null and not exists (
    select 1 from public.savings_goals g where g.id = new.savings_goal_id and g.user_id = new.user_id
  ) then
    raise exception 'a merchant rule cannot point at another user''s savings goal' using errcode = '42501';
  end if;

  if new.income_source_id is not null and not exists (
    select 1 from public.income_sources s where s.id = new.income_source_id and s.user_id = new.user_id
  ) then
    raise exception 'a merchant rule cannot point at another user''s income source' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger merchant_rules_refs
  before insert or update of user_id, savings_goal_id, income_source_id on public.merchant_rules
  for each row execute function private.check_merchant_rule_refs();
