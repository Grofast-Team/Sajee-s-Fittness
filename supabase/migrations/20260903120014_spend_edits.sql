-- 20260903120014_spend_edits.sql
--
-- What an edit to a spend is allowed to do, and a record of every edit made.
--
-- Spends could be added and nothing else. Correcting one needs three things
-- the schema did not have:
--
-- 1. **Rules an edit cannot break**, enforced where no application bug can
--    skip them. A spend that settled a bill keeps the bill's category, and no
--    spend or income can point at another user's commitment or income source.
-- 2. **A history.** Every change and every removal writes the row as it was.
-- 3. **`updated_at`**, so "when was this last touched" has an answer.

-- ---------------------------------------------------------------------------
-- 1. updated_at
-- ---------------------------------------------------------------------------
alter table public.spends
  add column if not exists updated_at timestamptz not null default now();

comment on column public.spends.updated_at is
  'Set by trigger on every update. Rows that existed before this migration '
  'carry the time the migration ran, not their true last edit.';

create trigger spends_touch before update on public.spends
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Ownership of references
--
-- Foreign-key checks run with the table owner's rights and ignore RLS. Proven
-- on 2026-09-13: a user who could not read another user's commitment could
-- still insert a spend with commitment_id set to it. The ids are random and
-- unreadable to them, so the practical risk is low — but the data model's
-- ownership rule was not actually being enforced.
-- ---------------------------------------------------------------------------
create or replace function private.check_spend_commitment_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.commitment_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.commitments c
    where c.id = new.commitment_id
      and c.user_id = new.user_id
  ) then
    raise exception 'a spend cannot settle a commitment belonging to another user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger spends_commitment_owner
  before insert or update of commitment_id, user_id on public.spends
  for each row execute function private.check_spend_commitment_owner();

create or replace function private.check_income_source_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.income_sources s
    where s.id = new.source_id
      and s.user_id = new.user_id
  ) then
    raise exception 'income cannot belong to an income source owned by another user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger incomes_source_owner
  before insert or update of source_id, user_id on public.incomes
  for each row execute function private.check_income_source_owner();

-- ---------------------------------------------------------------------------
-- 3. A bill payment keeps the bill's category
--
-- A spend carrying commitment_id is what marks that commitment paid. Letting
-- its category change would file a rent payment under groceries while it still
-- counted towards rent. To file it differently, remove it and record it again.
-- ---------------------------------------------------------------------------
create or replace function private.lock_settled_spend_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.commitment_id is not null
     and new.commitment_id is not distinct from old.commitment_id
     and new.category is distinct from old.category then
    raise exception 'the category of a spend that settled a commitment follows that commitment'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger spends_lock_settled_category
  before update of category on public.spends
  for each row execute function private.lock_settled_spend_category();

-- ---------------------------------------------------------------------------
-- 4. History
--
-- Append-only from the user's side: they can read their own revisions and
-- nothing else. Only the trigger writes, as security definer.
--
-- spend_id has no foreign key on purpose. A removed spend's history has to
-- outlive the spend, or "what did I delete" has no answer.
-- ---------------------------------------------------------------------------
create table public.spend_revisions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  spend_id       uuid not null,
  action         text not null check (action in ('update', 'delete')),
  -- The whole row as it was before the change.
  before         jsonb not null,
  changed_fields text[] not null default array[]::text[],
  changed_at     timestamptz not null default now()
);

create index spend_revisions_spend_idx on public.spend_revisions (spend_id, changed_at desc);
create index spend_revisions_user_idx on public.spend_revisions (user_id, changed_at desc);

comment on table public.spend_revisions is
  'Every edit and removal of a spend, as the row was before it. Written only by '
  'trigger; readable only by its owner; not editable by anyone through the API.';

alter table public.spend_revisions enable row level security;

create policy spend_revisions_select on public.spend_revisions
  for select to authenticated using ((select auth.uid()) = user_id);
-- No insert, update or delete policy: history is not something a client writes.

create or replace function private.record_spend_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed text[] := array[]::text[];
begin
  -- The account-deletion trap (see 20260829100014). Deleting a user cascades to
  -- their spends and fires this trigger for each one; writing a revision for a
  -- user who no longer exists fails the foreign key and aborts the deletion.
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.spend_revisions (user_id, spend_id, action, before)
    values (old.user_id, old.id, 'delete', to_jsonb(old));
    return null;
  end if;

  if new.amount_paise  is distinct from old.amount_paise  then changed := changed || 'amount_paise'::text;  end if;
  if new.category      is distinct from old.category      then changed := changed || 'category'::text;      end if;
  if new.note          is distinct from old.note          then changed := changed || 'note'::text;          end if;
  if new.spent_on      is distinct from old.spent_on      then changed := changed || 'spent_on'::text;      end if;
  if new.intent        is distinct from old.intent        then changed := changed || 'intent'::text;        end if;
  if new.commitment_id is distinct from old.commitment_id then changed := changed || 'commitment_id'::text; end if;

  -- An update that changed nothing a person would recognise is not history.
  -- updated_at is ignored here for the same reason.
  if cardinality(changed) = 0 then
    return null;
  end if;

  insert into public.spend_revisions (user_id, spend_id, action, before, changed_fields)
  values (old.user_id, old.id, 'update', to_jsonb(old), changed);

  return null;
end;
$$;

create trigger spends_revision
  after update or delete on public.spends
  for each row execute function private.record_spend_revision();
