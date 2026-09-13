-- 20260903120018_bank_import.sql
--
-- Importing a bank statement, without ever writing a statement row straight
-- into the ledger.
--
--   CSV → validation → column mapping → import_rows (raw + normalised)
--       → duplicates → merchant → suggestion → preview → confirmation
--       → spends / incomes, through the same checks as a typed entry
--
-- import_rows keeps every line as it was read, including the ones that could
-- not be read, so a batch can be reviewed later and a question like "where did
-- this spend come from" has an answer. A future Account Aggregator source feeds
-- these same tables rather than becoming a second ingestion path.
--
-- merchant_rules is what the person has taught it: "sharma kirana" is
-- groceries. Suggestions come from here first. Nothing here is written by a
-- model.

create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  source        text not null default 'csv' check (source in ('csv')),
  file_name     text check (file_name is null or char_length(file_name) <= 200),
  row_count     integer not null check (row_count between 0 and 5000),
  created_at    timestamptz not null default now(),
  -- Set when the person confirms; rows stay reviewable afterwards.
  confirmed_at  timestamptz
);

create index import_batches_user_idx on public.import_batches (user_id, created_at desc);

create table public.import_rows (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  batch_id            uuid not null references public.import_batches (id) on delete cascade,

  -- Line in the file, so a person can find it.
  row_number          integer not null check (row_number > 0),
  -- The cells exactly as read.
  raw                 jsonb not null,

  -- Normalised. Null where the line could not be read, with the reason.
  occurred_on         date,
  description         text check (description is null or char_length(description) <= 500),
  amount_paise        bigint check (amount_paise is null or (amount_paise > 0 and amount_paise <= 100000000000)),
  direction           text check (direction is null or direction in ('in', 'out')),
  problem             text check (problem is null or char_length(problem) <= 200),

  merchant_key        text check (merchant_key is null or char_length(merchant_key) <= 80),
  -- What it will be, or was, filed as. Same vocabulary as spends.
  category            text check (category in (
    'groceries','eating_out','transport','rent','bills','phone_internet',
    'medical','education','family','clothes','household','entertainment',
    'personal_care','gifts','savings','other'
  )),
  category_source     text check (category_source is null or category_source in ('rule', 'keyword', 'none', 'person')),

  duplicate_of_spend  uuid references public.spends (id) on delete set null,
  duplicate_of_row    integer,

  status              text not null default 'pending'
                        check (status in ('pending', 'imported', 'skipped', 'unreadable')),
  spend_id            uuid references public.spends (id) on delete set null,
  income_id           uuid references public.incomes (id) on delete set null,
  created_at          timestamptz not null default now(),

  unique (batch_id, row_number),
  constraint import_rows_readable check (
    status = 'unreadable' or (occurred_on is not null and amount_paise is not null and direction is not null)
  )
);

create index import_rows_batch_idx on public.import_rows (batch_id, row_number);
create index import_rows_user_idx on public.import_rows (user_id);
create index import_rows_spend_idx on public.import_rows (spend_id) where spend_id is not null;
create index import_rows_income_idx on public.import_rows (income_id) where income_id is not null;
create index import_rows_duplicate_idx on public.import_rows (duplicate_of_spend) where duplicate_of_spend is not null;

comment on table public.import_rows is
  'Every line of an imported statement, as read and as normalised. Becomes a '
  'spend or income only on confirmation, through the ordinary validated path.';

create table public.merchant_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  merchant_key  text not null check (char_length(merchant_key) between 1 and 80),
  category      text not null check (category in (
    'groceries','eating_out','transport','rent','bills','phone_internet',
    'medical','education','family','clothes','household','entertainment',
    'personal_care','gifts','savings','other'
  )),
  -- How many confirmed rows taught it; a rule used once is weaker than one used twenty times.
  taught        integer not null default 1 check (taught > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, merchant_key)
);

create trigger merchant_rules_touch before update on public.merchant_rules
  for each row execute function private.touch_updated_at();

comment on table public.merchant_rules is
  'Categories a person chose for a merchant while importing. Suggestions come '
  'from here before the built-in merchant list.';

-- ---------------------------------------------------------------------------
-- Ownership of references (FK checks ignore RLS; see 20260903120014).
-- Unlinking — a spend removed, an account deleted — is always allowed.
-- ---------------------------------------------------------------------------
create or replace function private.check_import_row_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.batch_id = old.batch_id
     and new.user_id = old.user_id
     and (new.spend_id is null or new.spend_id is not distinct from old.spend_id)
     and (new.income_id is null or new.income_id is not distinct from old.income_id)
     and (new.duplicate_of_spend is null or new.duplicate_of_spend is not distinct from old.duplicate_of_spend) then
    return new;
  end if;

  if not exists (
    select 1 from public.import_batches b where b.id = new.batch_id and b.user_id = new.user_id
  ) then
    raise exception 'an import row cannot belong to another user''s batch' using errcode = '42501';
  end if;

  if new.spend_id is not null and not exists (
    select 1 from public.spends s where s.id = new.spend_id and s.user_id = new.user_id
  ) then
    raise exception 'an import row cannot point at another user''s spend' using errcode = '42501';
  end if;

  if new.duplicate_of_spend is not null and not exists (
    select 1 from public.spends s where s.id = new.duplicate_of_spend and s.user_id = new.user_id
  ) then
    raise exception 'an import row cannot point at another user''s spend' using errcode = '42501';
  end if;

  if new.income_id is not null and not exists (
    select 1 from public.incomes i where i.id = new.income_id and i.user_id = new.user_id
  ) then
    raise exception 'an import row cannot point at another user''s income' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger import_rows_refs
  before insert or update of batch_id, user_id, spend_id, income_id, duplicate_of_spend on public.import_rows
  for each row execute function private.check_import_row_refs();

-- ---------------------------------------------------------------------------
-- RLS. Owner-only throughout.
-- ---------------------------------------------------------------------------
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.merchant_rules enable row level security;

create policy import_batches_select on public.import_batches
  for select to authenticated using ((select auth.uid()) = user_id);
create policy import_batches_insert on public.import_batches
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy import_batches_update on public.import_batches
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy import_batches_delete on public.import_batches
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy import_rows_select on public.import_rows
  for select to authenticated using ((select auth.uid()) = user_id);
create policy import_rows_insert on public.import_rows
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy import_rows_update on public.import_rows
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy import_rows_delete on public.import_rows
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy merchant_rules_select on public.merchant_rules
  for select to authenticated using ((select auth.uid()) = user_id);
create policy merchant_rules_insert on public.merchant_rules
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy merchant_rules_update on public.merchant_rules
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy merchant_rules_delete on public.merchant_rules
  for delete to authenticated using ((select auth.uid()) = user_id);
