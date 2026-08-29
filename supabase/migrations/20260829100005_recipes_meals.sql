-- 0005_recipes_meals.sql
-- Recipes, ingredients, substitutions, meal plans, grocery lists.

create table public.recipes (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  name             text not null,
  name_local       text,
  summary          text,
  cuisine          text,
  region           text,
  meal_slots       meal_slot[] not null default array[]::meal_slot[],
  servings         smallint not null default 1 check (servings > 0),
  prep_minutes     smallint not null default 0 check (prep_minutes >= 0),
  cook_minutes     smallint not null default 0 check (cook_minutes >= 0),
  total_minutes    smallint generated always as (prep_minutes + cook_minutes) stored,
  difficulty       text not null default 'easy' check (difficulty in ('very_easy','easy','moderate','involved')),
  equipment        text[] not null default array[]::text[],
  requires_fridge  boolean not null default false,
  no_cook          boolean not null default false,
  is_vegetarian    boolean not null default true,
  is_vegan         boolean not null default false,
  contains_egg     boolean not null default false,
  contains_dairy   boolean not null default false,
  allergens        text[] not null default array[]::text[],
  dietary_tags     text[] not null default array[]::text[],
  budget_tier      text not null default 'medium' check (budget_tier in ('low','medium','high')),
  instructions     jsonb not null default '[]'::jsonb,
  tips             text,
  kcal_per_serving    numeric(7,1),
  protein_per_serving numeric(6,1),
  carb_per_serving    numeric(6,1),
  fat_per_serving     numeric(6,1),
  fibre_per_serving   numeric(6,1),
  cost_per_serving    numeric(8,2),
  cost_currency    text default 'INR',
  is_public        boolean not null default true,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index recipes_cuisine_idx on public.recipes (cuisine);
create index recipes_budget_idx on public.recipes (budget_tier);
create index recipes_time_idx on public.recipes (total_minutes);
create index recipes_created_by_idx on public.recipes (created_by) where created_by is not null;
create index recipes_name_trgm_idx on public.recipes using gin (lower(name) gin_trgm_ops);
create trigger recipes_touch before update on public.recipes
  for each row execute function private.touch_updated_at();

comment on column public.recipes.kcal_per_serving is
  'Derived from ingredients by recalc_recipe_nutrition(), not hand-entered.';

alter table public.food_logs
  add constraint food_logs_recipe_fk
  foreign key (recipe_id) references public.recipes (id) on delete set null;

-- ---------------------------------------------------------------------------
-- recipe_ingredients
-- ---------------------------------------------------------------------------
create table public.recipe_ingredients (
  id          uuid primary key default gen_random_uuid(),
  recipe_id   uuid not null references public.recipes (id) on delete cascade,
  food_id     uuid references public.foods (id) on delete restrict,
  label       text not null,
  grams       numeric(8,1) not null check (grams > 0),
  display_qty text,
  is_optional boolean not null default false,
  sort_order  smallint not null default 0
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, sort_order);
create index recipe_ingredients_food_idx on public.recipe_ingredients (food_id) where food_id is not null;

-- ---------------------------------------------------------------------------
-- ingredient_substitutions: powers the "Can't eat this?" affordance
-- ---------------------------------------------------------------------------
create table public.ingredient_substitutions (
  id           uuid primary key default gen_random_uuid(),
  food_id      uuid not null references public.foods (id) on delete cascade,
  substitute_id uuid not null references public.foods (id) on delete cascade,
  ratio        numeric(5,2) not null default 1.0 check (ratio > 0),
  reason       text not null check (reason in ('unavailable','cheaper','vegetarian','vegan','allergy','no_cook','no_fridge','preference','higher_protein')),
  note         text,
  unique (food_id, substitute_id, reason)
);
create index ingredient_substitutions_food_idx on public.ingredient_substitutions (food_id, reason);
create index ingredient_substitutions_sub_idx on public.ingredient_substitutions (substitute_id);

-- ---------------------------------------------------------------------------
-- meal_plans
-- ---------------------------------------------------------------------------
create table public.meal_plans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  plan_date      date not null,
  meal           meal_slot not null,
  recipe_id      uuid references public.recipes (id) on delete set null,
  food_id        uuid references public.foods (id) on delete set null,
  custom_label   text,
  servings       numeric(5,2) not null default 1 check (servings > 0),
  target_kcal    integer,
  target_protein_g integer,
  est_cost       numeric(8,2),
  status         text not null default 'planned' check (status in ('planned','eaten','skipped','swapped')),
  swapped_from   uuid references public.recipes (id) on delete set null,
  rationale      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- A meal slot legitimately holds several items (dosa + sambar + chutney),
  -- so uniqueness is per item, not per slot.
  constraint meal_plans_has_subject check (
    recipe_id is not null or food_id is not null or custom_label is not null
  )
);
create index meal_plans_user_date_idx on public.meal_plans (user_id, plan_date);
create index meal_plans_recipe_idx on public.meal_plans (recipe_id) where recipe_id is not null;
create index meal_plans_food_idx on public.meal_plans (food_id) where food_id is not null;
create index meal_plans_swapped_idx on public.meal_plans (swapped_from) where swapped_from is not null;
create trigger meal_plans_touch before update on public.meal_plans
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- grocery_lists
-- ---------------------------------------------------------------------------
create table public.grocery_lists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  week_start    date not null,
  est_total     numeric(10,2),
  currency_code text not null default 'INR',
  budget_amount numeric(10,2),
  created_at    timestamptz not null default now(),
  unique (user_id, week_start)
);
create index grocery_lists_user_idx on public.grocery_lists (user_id, week_start desc);

create table public.grocery_items (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid not null references public.grocery_lists (id) on delete cascade,
  food_id     uuid references public.foods (id) on delete set null,
  label       text not null,
  category    text not null default 'other',
  grams       numeric(9,1),
  display_qty text,
  est_cost    numeric(8,2),
  cost_is_estimated boolean not null default true,
  meals_covered smallint not null default 0,
  purchased   boolean not null default false,
  sort_order  smallint not null default 0
);
create index grocery_items_list_idx on public.grocery_items (list_id, category, sort_order);
create index grocery_items_food_idx on public.grocery_items (food_id) where food_id is not null;

comment on column public.grocery_items.cost_is_estimated is
  'True until the user records a real local price. Estimated costs are labelled as such in the UI.';
