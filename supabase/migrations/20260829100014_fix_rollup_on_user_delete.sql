-- 20260829100014_fix_rollup_on_user_delete.sql
--
-- Fixes: deleting a user account failed with
--   23503 insert or update on table "daily_logs" violates foreign key
--   constraint "daily_logs_user_id_fkey"
--
-- Cause: deleting an auth.users row cascades to food_logs / step_logs /
-- water_logs / sleep_logs. Each of those has an AFTER DELETE trigger that
-- recomputes the day and upserts into daily_logs — so the rollup tried to
-- re-insert a row for a user that had just ceased to exist.
--
-- This mattered more than a failed test: account deletion is a privacy
-- obligation, not a nice-to-have, and it was silently broken for any user who
-- had ever logged anything.
--
-- Fix: every rollup checks the owner still exists before writing. During a
-- cascade the user row is already gone, so the rollup becomes a no-op and the
-- cascade completes cleanly.

create or replace function private.recalc_daily_log(p_user uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
begin
  -- Mid-cascade the owner is already deleted; there is nothing to roll up to.
  if not exists (select 1 from auth.users u where u.id = p_user) then
    return;
  end if;

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
  if not exists (select 1 from auth.users u where u.id = v_user) then
    return null;
  end if;

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
  if not exists (select 1 from auth.users u where u.id = v_user) then
    return null;
  end if;

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

create or replace function private.sleep_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users u where u.id = new.user_id) then
    return new;
  end if;

  insert into public.daily_logs (user_id, log_date, sleep_minutes)
  values (new.user_id, new.log_date, new.minutes)
  on conflict (user_id, log_date) do update
    set sleep_minutes = excluded.sleep_minutes, updated_at = now();

  return new;
end;
$$;

-- Recipe nutrition has the same shape of problem: deleting a user cascades to
-- their custom recipes, whose ingredient deletions fire a recalc against a
-- recipe row that is already gone.
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
