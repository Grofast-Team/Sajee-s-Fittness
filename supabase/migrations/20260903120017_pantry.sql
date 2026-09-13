-- 20260903120017_pantry.sql
--
-- What is in the kitchen, and how long it lasts.
--
-- ## Why not grocery_items
--
-- grocery_lists and grocery_items model a *planned shopping list*: an estimated
-- cost, a purchased flag, how many meals an item covers. Nothing reads them.
-- Stock on hand is a different thing — it changes every time something is
-- bought, eaten or thrown out — and bending a list row into a running balance
-- would give a number that cannot explain itself. So stock gets its own two
-- tables, beside the list ones, which are left untouched.
--
-- ## A ledger, like money
--
-- pantry_items is the plan (eggs, counted in pieces). pantry_movements is what
-- happened: bought, used, discarded, counted, or a food log marked as not from
-- home. What is on hand is the sum of movements, never a stored figure.
--
-- A food log reaches stock only when the person confirms it came from home —
-- food_logs does not record where a meal was eaten, and food eaten out must
-- never empty the kitchen.

create table public.pantry_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,

  label           text not null check (char_length(label) between 1 and 60),
  -- The food this is, so a log of it can be taken from stock. Null for things
  -- never logged as themselves (rice bought raw, oil).
  food_id         uuid references public.foods (id) on delete set null,
  unit            text not null check (unit in ('piece', 'g', 'ml')),
  -- Weight of one piece, to turn a weighed log into pieces. Only for pieces.
  grams_per_unit  numeric(8, 2) check (grams_per_unit is null or grams_per_unit > 0),

  -- Stopped keeping rather than deleted, so its history stays readable.
  archived_on     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint pantry_items_grams_only_for_pieces check (grams_per_unit is null or unit = 'piece')
);

create index pantry_items_user_idx on public.pantry_items (user_id) where archived_on is null;
create index pantry_items_food_idx on public.pantry_items (food_id) where food_id is not null;

-- One live item per food, or a logged egg would not know which eggs it came from.
create unique index pantry_items_one_per_food
  on public.pantry_items (user_id, food_id)
  where food_id is not null and archived_on is null;

create trigger pantry_items_touch before update on public.pantry_items
  for each row execute function private.touch_updated_at();

comment on table public.pantry_items is
  'Something kept at home. A plan, not a balance: what is on hand is the sum of '
  'its pantry_movements.';

create table public.pantry_movements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  item_id      uuid not null references public.pantry_items (id) on delete cascade,

  kind         text not null check (kind in ('bought', 'used', 'discarded', 'counted', 'skipped')),
  -- Signed, in the item's unit. A count stores the difference it made.
  quantity     numeric(10, 2) not null,
  occurred_on  date not null default current_date,

  -- The spend a purchase was recorded as. Set null if the spend is removed:
  -- the eggs still arrived.
  spend_id     uuid references public.spends (id) on delete set null,
  -- The food log a use came from. Cascade: removing the log puts the food back.
  food_log_id  uuid references public.food_logs (id) on delete cascade,

  note         text check (note is null or char_length(note) <= 200),
  created_at   timestamptz not null default now(),

  constraint pantry_movements_sign check (
    (kind = 'bought'    and quantity > 0) or
    (kind = 'used'      and quantity < 0) or
    (kind = 'discarded' and quantity < 0) or
    (kind = 'counted'   and quantity <> 0) or
    (kind = 'skipped'   and quantity = 0)
  ),
  constraint pantry_movements_spend_is_purchase check (spend_id is null or kind = 'bought'),
  constraint pantry_movements_log_is_use check (
    food_log_id is null or kind in ('used', 'skipped')
  ),
  constraint pantry_movements_skip_has_log check (kind <> 'skipped' or food_log_id is not null)
);

create index pantry_movements_item_idx on public.pantry_movements (item_id, occurred_on desc);
create index pantry_movements_user_idx on public.pantry_movements (user_id, occurred_on desc);
create index pantry_movements_spend_idx on public.pantry_movements (spend_id) where spend_id is not null;

-- A food log is dealt with once: taken from stock, or marked not from home.
create unique index pantry_movements_one_per_log
  on public.pantry_movements (food_log_id) where food_log_id is not null;

comment on table public.pantry_movements is
  'Everything that changed what is in the kitchen. Signed quantities in the '
  'item''s unit; the sum is what is on hand.';

-- ---------------------------------------------------------------------------
-- Ownership of every reference
--
-- Foreign-key checks run with the table owner's rights and ignore RLS (see
-- 20260903120014). An item can only point at a food its owner can see; a
-- movement only at its owner's item, spend and food log — and a log only
-- counts against the item for that same food.
-- ---------------------------------------------------------------------------
create or replace function private.check_pantry_item_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.food_id is not null and not exists (
    select 1 from public.foods f
    where f.id = new.food_id
      and (f.is_public or f.created_by = new.user_id)
  ) then
    raise exception 'a kitchen item cannot be linked to a food its owner cannot see'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger pantry_items_refs
  before insert or update of food_id, user_id on public.pantry_items
  for each row execute function private.check_pantry_item_refs();

create or replace function private.check_pantry_movement_refs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_food uuid;
begin
  -- Unlinking is always allowed. Deleting an account removes its spends, which
  -- sets spend_id to null here — possibly after the item itself has gone — and
  -- refusing that would abort the deletion (the trap from 20260829100014).
  if tg_op = 'UPDATE'
     and new.item_id = old.item_id
     and new.user_id = old.user_id
     and (new.spend_id is null or new.spend_id = old.spend_id)
     and (new.food_log_id is null or new.food_log_id = old.food_log_id) then
    return new;
  end if;

  select i.food_id into item_food
  from public.pantry_items i
  where i.id = new.item_id and i.user_id = new.user_id;

  if not found then
    raise exception 'a kitchen movement cannot belong to another user''s item'
      using errcode = '42501';
  end if;

  if new.spend_id is not null and not exists (
    select 1 from public.spends s where s.id = new.spend_id and s.user_id = new.user_id
  ) then
    raise exception 'a purchase cannot be linked to another user''s spend'
      using errcode = '42501';
  end if;

  if new.food_log_id is not null and not exists (
    select 1 from public.food_logs l
    where l.id = new.food_log_id
      and l.user_id = new.user_id
      and l.food_id = item_food
  ) then
    raise exception 'a food log can only be taken from its owner''s stock of that same food'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger pantry_movements_refs
  before insert or update of item_id, user_id, spend_id, food_log_id on public.pantry_movements
  for each row execute function private.check_pantry_movement_refs();

-- ---------------------------------------------------------------------------
-- An edited log is no longer what was taken from stock
--
-- Changing a log's food or portion removes the movement it produced, so the log
-- is offered again at its new size instead of the kitchen keeping the old one.
-- A delete, not an insert, so it cannot trip the account-deletion trap.
-- ---------------------------------------------------------------------------
create or replace function private.release_pantry_use_on_log_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.food_id is distinct from old.food_id
     or new.grams is distinct from old.grams
     or new.quantity is distinct from old.quantity
     or new.unit_label is distinct from old.unit_label then
    delete from public.pantry_movements m where m.food_log_id = old.id;
  end if;

  return null;
end;
$$;

create trigger food_logs_release_pantry_use
  after update of food_id, grams, quantity, unit_label on public.food_logs
  for each row execute function private.release_pantry_use_on_log_edit();

-- ---------------------------------------------------------------------------
-- RLS. Owner-only. Movements have no update policy: a mistaken one is removed
-- and recorded again.
-- ---------------------------------------------------------------------------
alter table public.pantry_items enable row level security;
alter table public.pantry_movements enable row level security;

create policy pantry_items_select on public.pantry_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy pantry_items_insert on public.pantry_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy pantry_items_update on public.pantry_items
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy pantry_items_delete on public.pantry_items
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy pantry_movements_select on public.pantry_movements
  for select to authenticated using ((select auth.uid()) = user_id);
create policy pantry_movements_insert on public.pantry_movements
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy pantry_movements_delete on public.pantry_movements
  for delete to authenticated using ((select auth.uid()) = user_id);
