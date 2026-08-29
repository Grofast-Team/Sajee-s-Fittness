-- 0009_functions.sql
-- Triggers and RPCs. Anything that must stay consistent no matter which client
-- writes lives here rather than in application code.

-- ---------------------------------------------------------------------------
-- New user bootstrap: create the empty profile rows so the onboarding UI never
-- has to handle a "row does not exist yet" state.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (user_id) do nothing;

  insert into public.lifestyle (user_id) values (new.id)
  on conflict (user_id) do nothing;

  insert into public.food_profile (user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Daily rollup: keep daily_logs in step with food_logs.
--
-- The dashboard reads one row per day instead of aggregating a user's entire
-- logging history on every page load.
-- ---------------------------------------------------------------------------
create or replace function private.recalc_daily_log(p_user uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  select
    coalesce(sum(fl.kcal), 0)      as kcal,
    coalesce(sum(fl.protein_g), 0) as protein_g,
    coalesce(sum(fl.carb_g), 0)    as carb_g,
    coalesce(sum(fl.fat_g), 0)     as fat_g,
    coalesce(sum(fl.fibre_g), 0)   as fibre_g,
    count(distinct fl.meal)        as meals
  into t
  from public.food_logs fl
  where fl.user_id = p_user and fl.log_date = p_date;

  insert into public.daily_logs (user_id, log_date, kcal, protein_g, carb_g, fat_g, fibre_g, meals_logged)
  values (p_user, p_date, t.kcal, t.protein_g, t.carb_g, t.fat_g, t.fibre_g, t.meals)
  on conflict (user_id, log_date) do update
    set kcal         = excluded.kcal,
        protein_g    = excluded.protein_g,
        carb_g       = excluded.carb_g,
        fat_g        = excluded.fat_g,
        fibre_g      = excluded.fibre_g,
        meals_logged = excluded.meals_logged,
        updated_at   = now();
end;
$$;

create or replace function private.food_logs_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.recalc_daily_log(old.user_id, old.log_date);
    return old;
  end if;

  perform private.recalc_daily_log(new.user_id, new.log_date);

  -- An edit that moves an entry to another day must fix both days.
  if tg_op = 'UPDATE' and (old.log_date <> new.log_date or old.user_id <> new.user_id) then
    perform private.recalc_daily_log(old.user_id, old.log_date);
  end if;

  return new;
end;
$$;

create trigger food_logs_rollup_trigger
  after insert or update or delete on public.food_logs
  for each row execute function private.food_logs_rollup();

-- ---------------------------------------------------------------------------
-- Steps and sleep roll into daily_logs the same way.
-- ---------------------------------------------------------------------------
create or replace function private.steps_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_date date := coalesce(new.log_date, old.log_date);
  v_steps integer;
begin
  -- Prefer a device reading over a manual one for the same day.
  select sl.steps into v_steps
  from public.step_logs sl
  where sl.user_id = v_user and sl.log_date = v_date
  order by (sl.source <> 'manual') desc, sl.created_at desc
  limit 1;

  insert into public.daily_logs (user_id, log_date, steps)
  values (v_user, v_date, v_steps)
  on conflict (user_id, log_date) do update
    set steps = excluded.steps, updated_at = now();

  return null;
end;
$$;

create trigger step_logs_rollup_trigger
  after insert or update or delete on public.step_logs
  for each row execute function private.steps_rollup();

create or replace function private.sleep_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_logs (user_id, log_date, sleep_minutes)
  values (new.user_id, new.log_date, new.minutes)
  on conflict (user_id, log_date) do update
    set sleep_minutes = excluded.sleep_minutes, updated_at = now();
  return new;
end;
$$;

create trigger sleep_logs_rollup_trigger
  after insert or update on public.sleep_logs
  for each row execute function private.sleep_rollup();

create or replace function private.water_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_date date := coalesce(new.log_date, old.log_date);
  v_ml integer;
begin
  select coalesce(sum(w.ml), 0) into v_ml
  from public.water_logs w
  where w.user_id = v_user and w.log_date = v_date;

  insert into public.daily_logs (user_id, log_date, water_ml)
  values (v_user, v_date, v_ml)
  on conflict (user_id, log_date) do update
    set water_ml = excluded.water_ml, updated_at = now();

  return null;
end;
$$;

create trigger water_logs_rollup_trigger
  after insert or update or delete on public.water_logs
  for each row execute function private.water_rollup();

-- ---------------------------------------------------------------------------
-- Food search.
--
-- SECURITY INVOKER (the default) so RLS still applies: a user can find public
-- foods and their own custom foods, and nobody else's.
--
-- Ranking blends exact-prefix, trigram similarity on the food name, and
-- trigram similarity on any alias, so "thosai", "dosai" and "dosa" all land on
-- the same record.
-- ---------------------------------------------------------------------------
create or replace function public.search_foods(q text, max_results integer default 20)
returns table (
  id uuid,
  name text,
  name_local text,
  brand text,
  category text,
  food_state food_state,
  kcal_per_100g numeric,
  protein_per_100g numeric,
  carb_per_100g numeric,
  fat_per_100g numeric,
  fibre_per_100g numeric,
  default_serving_g numeric,
  is_vegetarian boolean,
  matched_alias text,
  score real
)
language sql
stable
set search_path = public, extensions
as $$
  with needle as (
    select lower(trim(q)) as term
  ),
  alias_hits as (
    select fa.food_id, fa.alias, max(similarity(lower(fa.alias), n.term)) as sim
    from public.food_aliases fa, needle n
    where lower(fa.alias) % n.term or lower(fa.alias) like n.term || '%'
    group by fa.food_id, fa.alias
  )
  select
    f.id, f.name, f.name_local, f.brand, f.category, f.food_state,
    f.kcal_per_100g, f.protein_per_100g, f.carb_per_100g, f.fat_per_100g,
    f.fibre_per_100g, f.default_serving_g, f.is_vegetarian,
    ah.alias as matched_alias,
    greatest(
      similarity(f.search_text, n.term),
      coalesce(ah.sim, 0),
      case when f.search_text like n.term || '%' then 0.95 else 0 end
    )::real as score
  from public.foods f
  cross join needle n
  left join alias_hits ah on ah.food_id = f.id
  where
    f.search_text % n.term
    or f.search_text like '%' || n.term || '%'
    or ah.food_id is not null
  order by score desc, f.is_verified desc, f.name
  limit greatest(1, least(max_results, 50));
$$;

comment on function public.search_foods is
  'Alias- and typo-tolerant food search. Runs as the caller, so RLS still governs visibility.';

-- ---------------------------------------------------------------------------
-- Recipe nutrition is derived, never typed in by hand.
-- ---------------------------------------------------------------------------
create or replace function public.recalc_recipe_nutrition(p_recipe uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_servings numeric;
  t record;
begin
  select r.servings into v_servings from public.recipes r where r.id = p_recipe;
  if v_servings is null or v_servings = 0 then
    return;
  end if;

  select
    sum(ri.grams * f.kcal_per_100g    / 100.0) as kcal,
    sum(ri.grams * f.protein_per_100g / 100.0) as protein,
    sum(ri.grams * f.carb_per_100g    / 100.0) as carb,
    sum(ri.grams * f.fat_per_100g     / 100.0) as fat,
    sum(ri.grams * coalesce(f.fibre_per_100g, 0) / 100.0) as fibre,
    sum(ri.grams * coalesce(f.typical_cost_per_100g, 0) / 100.0) as cost
  into t
  from public.recipe_ingredients ri
  join public.foods f on f.id = ri.food_id
  where ri.recipe_id = p_recipe and not ri.is_optional;

  update public.recipes r
  set kcal_per_serving    = round(coalesce(t.kcal, 0)    / v_servings, 1),
      protein_per_serving = round(coalesce(t.protein, 0) / v_servings, 1),
      carb_per_serving    = round(coalesce(t.carb, 0)    / v_servings, 1),
      fat_per_serving     = round(coalesce(t.fat, 0)     / v_servings, 1),
      fibre_per_serving   = round(coalesce(t.fibre, 0)   / v_servings, 1),
      cost_per_serving    = nullif(round(coalesce(t.cost, 0) / v_servings, 2), 0),
      updated_at          = now()
  where r.id = p_recipe;
end;
$$;

create or replace function private.recipe_ingredients_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recalc_recipe_nutrition(coalesce(new.recipe_id, old.recipe_id));
  return null;
end;
$$;

create trigger recipe_ingredients_recalc
  after insert or update or delete on public.recipe_ingredients
  for each row execute function private.recipe_ingredients_changed();

-- ---------------------------------------------------------------------------
-- Only one active plan per user. Activating a new one retires the old.
-- ---------------------------------------------------------------------------
create or replace function private.retire_previous_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active then
    update public.plans
    set is_active = false
    where user_id = new.user_id and id <> new.id and is_active;
  end if;
  return new;
end;
$$;

create trigger plans_retire_previous
  before insert on public.plans
  for each row execute function private.retire_previous_plan();

grant execute on function public.search_foods(text, integer) to authenticated;
grant execute on function public.recalc_recipe_nutrition(uuid) to authenticated;
