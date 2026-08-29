-- 0008_rls.sql
-- Row Level Security. Health data is sensitive personal data; the default
-- posture is deny, and every policy is scoped to the calling user.
--
-- Conventions used throughout:
--   * (select auth.uid())  -- wrapped in a subselect so it is evaluated once
--                             per statement rather than once per row
--   * `to authenticated`   -- anon never reaches user data
--   * separate policies per command, so INSERT gets a WITH CHECK and
--     UPDATE gets both USING and WITH CHECK
--   * every column referenced by a policy is indexed (see prior migrations)

-- ===========================================================================
-- Helper: generate the standard "owner" policy set for a user_id table.
-- Written out explicitly per table rather than generated, so the policies are
-- greppable and reviewable.
-- ===========================================================================

do $$
declare
  t text;
  owner_tables text[] := array[
    'profiles','lifestyle','food_profile','budgets','goals','safety_flags',
    'plans','plan_adjustments','user_memory',
    'measurements','daily_logs','step_logs','sleep_logs','water_logs','cycle_logs',
    'food_logs','ai_food_analyses',
    'meal_plans','grocery_lists',
    'workout_plans','exercise_sets','activity_sessions',
    'user_habits','habit_checkins','coach_threads','coach_messages',
    'reviews','plan_feedback','notification_prefs','notifications'
  ];
begin
  foreach t in array owner_tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format($p$
      create policy %I on public.%I
        for select to authenticated
        using ((select auth.uid()) = user_id)
    $p$, t || '_select_own', t);

    execute format($p$
      create policy %I on public.%I
        for insert to authenticated
        with check ((select auth.uid()) = user_id)
    $p$, t || '_insert_own', t);

    execute format($p$
      create policy %I on public.%I
        for update to authenticated
        using ((select auth.uid()) = user_id)
        with check ((select auth.uid()) = user_id)
    $p$, t || '_update_own', t);

    execute format($p$
      create policy %I on public.%I
        for delete to authenticated
        using ((select auth.uid()) = user_id)
    $p$, t || '_delete_own', t);
  end loop;
end;
$$;

-- ===========================================================================
-- Shared reference data: readable by any signed-in user, writable by admins.
-- User-contributed rows (custom foods and recipes) stay private to their
-- author until an admin marks them public.
-- ===========================================================================

alter table public.foods enable row level security;

create policy foods_select_public on public.foods
  for select to authenticated
  using (is_public or created_by = (select auth.uid()));

create policy foods_insert_own on public.foods
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    -- a user may add a custom food, but may not publish it to everyone
    and is_public = false
    and is_verified = false
  );

create policy foods_update_own on public.foods
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and is_public = false and is_verified = false);

create policy foods_delete_own on public.foods
  for delete to authenticated
  using (created_by = (select auth.uid()));

create policy foods_admin_all on public.foods
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Aliases and servings follow their parent food's visibility.
alter table public.food_aliases enable row level security;
create policy food_aliases_select on public.food_aliases
  for select to authenticated
  using (exists (
    select 1 from public.foods f
    where f.id = food_id and (f.is_public or f.created_by = (select auth.uid()))
  ));
create policy food_aliases_admin on public.food_aliases
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.food_servings enable row level security;
create policy food_servings_select on public.food_servings
  for select to authenticated
  using (exists (
    select 1 from public.foods f
    where f.id = food_id and (f.is_public or f.created_by = (select auth.uid()))
  ));
create policy food_servings_admin on public.food_servings
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Prices: community rows (user_id null) plus your own observations.
alter table public.food_prices enable row level security;
create policy food_prices_select on public.food_prices
  for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy food_prices_insert_own on public.food_prices
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy food_prices_update_own on public.food_prices
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy food_prices_delete_own on public.food_prices
  for delete to authenticated
  using (user_id = (select auth.uid()));

alter table public.recipes enable row level security;
create policy recipes_select_public on public.recipes
  for select to authenticated
  using (is_public or created_by = (select auth.uid()));
create policy recipes_insert_own on public.recipes
  for insert to authenticated
  with check (created_by = (select auth.uid()) and is_public = false);
create policy recipes_update_own on public.recipes
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and is_public = false);
create policy recipes_delete_own on public.recipes
  for delete to authenticated
  using (created_by = (select auth.uid()));
create policy recipes_admin_all on public.recipes
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.recipe_ingredients enable row level security;
create policy recipe_ingredients_select on public.recipe_ingredients
  for select to authenticated
  using (exists (
    select 1 from public.recipes r
    where r.id = recipe_id and (r.is_public or r.created_by = (select auth.uid()))
  ));
create policy recipe_ingredients_write_own on public.recipe_ingredients
  for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and r.created_by = (select auth.uid())))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id and r.created_by = (select auth.uid())));
create policy recipe_ingredients_admin on public.recipe_ingredients
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.ingredient_substitutions enable row level security;
create policy ingredient_substitutions_select on public.ingredient_substitutions
  for select to authenticated using (true);
create policy ingredient_substitutions_admin on public.ingredient_substitutions
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.exercises enable row level security;
create policy exercises_select on public.exercises
  for select to authenticated using (true);
create policy exercises_admin on public.exercises
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.workouts enable row level security;
create policy workouts_select on public.workouts
  for select to authenticated using (is_public);
create policy workouts_admin on public.workouts
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.workout_exercises enable row level security;
create policy workout_exercises_select on public.workout_exercises
  for select to authenticated
  using (exists (select 1 from public.workouts w where w.id = workout_id and w.is_public));
create policy workout_exercises_admin on public.workout_exercises
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.habit_templates enable row level security;
create policy habit_templates_select on public.habit_templates
  for select to authenticated using (is_active);
create policy habit_templates_admin on public.habit_templates
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.lessons enable row level security;
create policy lessons_select on public.lessons
  for select to authenticated using (is_published);
create policy lessons_admin on public.lessons
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

alter table public.evidence_claims enable row level security;
create policy evidence_claims_select on public.evidence_claims
  for select to authenticated using (true);
create policy evidence_claims_admin on public.evidence_claims
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ===========================================================================
-- Child tables whose ownership is inherited from a parent row.
-- ===========================================================================

alter table public.grocery_items enable row level security;
create policy grocery_items_own on public.grocery_items
  for all to authenticated
  using (exists (
    select 1 from public.grocery_lists gl
    where gl.id = list_id and gl.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.grocery_lists gl
    where gl.id = list_id and gl.user_id = (select auth.uid())
  ));

-- ===========================================================================
-- Admin read access to user data is deliberately NOT granted here.
-- Support workflows go through audited server-side functions instead, so that
-- "an admin can read every user's health record by default" is never true.
-- ===========================================================================

-- ===========================================================================
-- Storage: private bucket for meal photos, one folder per user.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

create policy meal_photos_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy meal_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy meal_photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
