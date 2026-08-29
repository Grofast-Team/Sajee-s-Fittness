-- 0004_food.sql
-- Food master data, aliases, household serving units, local prices,
-- food logs, and AI photo analyses.

-- ---------------------------------------------------------------------------
-- foods
--
-- Nutrition is ALWAYS stored per 100 g of the food in the state named by
-- `food_state`. Mixing raw and cooked values is the single most common source
-- of silent error in nutrition databases, so the state is not nullable.
-- ---------------------------------------------------------------------------
create type food_state as enum ('raw','cooked','as_sold','prepared','dry');

create table public.foods (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  name_local     text,
  script_local   text,
  brand          text,
  category       text not null,
  cuisine        text,
  region         text,
  food_state     food_state not null,
  is_vegetarian  boolean not null,
  is_vegan       boolean not null default false,
  contains_egg   boolean not null default false,
  contains_dairy boolean not null default false,
  allergens      text[] not null default array[]::text[],
  kcal_per_100g     numeric(6,1) not null check (kcal_per_100g >= 0 and kcal_per_100g <= 950),
  protein_per_100g  numeric(5,1) not null default 0 check (protein_per_100g >= 0),
  carb_per_100g     numeric(5,1) not null default 0 check (carb_per_100g >= 0),
  fat_per_100g      numeric(5,1) not null default 0 check (fat_per_100g >= 0),
  fibre_per_100g    numeric(5,1) check (fibre_per_100g >= 0),
  sodium_mg_per_100g numeric(7,1),
  micros            jsonb not null default '{}'::jsonb,
  default_serving_g numeric(7,1) check (default_serving_g > 0),
  typical_cost_per_100g numeric(8,2),
  cost_currency  text default 'INR',
  source         text not null,
  source_year    smallint,
  data_confidence confidence_level not null default 'medium',
  is_verified    boolean not null default false,
  created_by     uuid references auth.users (id) on delete set null,
  is_public      boolean not null default true,
  search_text    text generated always as (
                   lower(coalesce(name,'') || ' ' || coalesce(name_local,'') || ' ' ||
                         coalesce(brand,'') || ' ' || coalesce(category,''))
                 ) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index foods_search_trgm_idx on public.foods using gin (search_text gin_trgm_ops);
create index foods_category_idx on public.foods (category);
create index foods_cuisine_idx on public.foods (cuisine) where cuisine is not null;
create index foods_created_by_idx on public.foods (created_by) where created_by is not null;
create index foods_public_idx on public.foods (is_public) where is_public;
create trigger foods_touch before update on public.foods
  for each row execute function private.touch_updated_at();

comment on column public.foods.food_state is
  'Never mix states: 100 g raw rice is not 100 g cooked rice.';
comment on column public.foods.source is
  'Provenance, e.g. IFCT 2017, USDA FDC 173691, manufacturer label, user submitted.';

-- ---------------------------------------------------------------------------
-- food_aliases: regional and misspelled names all resolve to one food
-- ---------------------------------------------------------------------------
create table public.food_aliases (
  id       uuid primary key default gen_random_uuid(),
  food_id  uuid not null references public.foods (id) on delete cascade,
  alias    text not null,
  language text,
  unique (food_id, alias)
);
create index food_aliases_food_idx on public.food_aliases (food_id);
create index food_aliases_trgm_idx on public.food_aliases using gin (lower(alias) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- food_servings: household measures -> grams
--
-- This is what lets a user say "one katori of sambar" instead of weighing it,
-- and what the portion engine uses when no scale reading is available.
-- ---------------------------------------------------------------------------
create table public.food_servings (
  id          uuid primary key default gen_random_uuid(),
  food_id     uuid not null references public.foods (id) on delete cascade,
  unit_label  text not null,
  grams       numeric(7,1) not null check (grams > 0),
  is_default  boolean not null default false,
  confidence  confidence_level not null default 'medium',
  note        text,
  unique (food_id, unit_label)
);
create index food_servings_food_idx on public.food_servings (food_id);

-- ---------------------------------------------------------------------------
-- food_prices: user- and region-contributed. Never invented by the model.
-- ---------------------------------------------------------------------------
create table public.food_prices (
  id            uuid primary key default gen_random_uuid(),
  food_id       uuid not null references public.foods (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete cascade,
  country_code  text,
  region        text,
  price         numeric(10,2) not null check (price >= 0),
  currency_code text not null default 'INR',
  per_quantity  numeric(8,2) not null default 100,
  per_unit      text not null default 'g',
  observed_on   date not null default current_date,
  created_at    timestamptz not null default now()
);
create index food_prices_food_idx on public.food_prices (food_id, observed_on desc);
create index food_prices_user_idx on public.food_prices (user_id) where user_id is not null;
create index food_prices_region_idx on public.food_prices (country_code, region);

comment on table public.food_prices is
  'Prices are observed, never generated. Absent price renders as "estimated - set your local price".';

-- ---------------------------------------------------------------------------
-- food_logs
-- ---------------------------------------------------------------------------
create table public.food_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  food_id       uuid references public.foods (id) on delete set null,
  recipe_id     uuid,
  analysis_id   uuid,
  log_date      date not null default current_date,
  meal          meal_slot not null default 'other',
  description   text not null,
  quantity      numeric(8,2) not null check (quantity > 0),
  unit_label    text not null default 'g',
  grams         numeric(8,1) check (grams > 0),
  kcal          numeric(7,1) not null check (kcal >= 0),
  protein_g     numeric(6,1) not null default 0,
  carb_g        numeric(6,1) not null default 0,
  fat_g         numeric(6,1) not null default 0,
  fibre_g       numeric(6,1),
  kcal_low      numeric(7,1),
  kcal_high     numeric(7,1),
  source        log_source not null default 'search',
  confidence    confidence_level not null default 'high',
  portion_basis text not null default 'user_input'
                check (portion_basis in ('kitchen_scale','user_input','household_measure','visual_estimate','label')),
  cost          numeric(8,2),
  logged_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index food_logs_user_date_idx on public.food_logs (user_id, log_date desc);
create index food_logs_food_idx on public.food_logs (food_id) where food_id is not null;
create index food_logs_meal_idx on public.food_logs (user_id, log_date, meal);
create index food_logs_analysis_idx on public.food_logs (analysis_id) where analysis_id is not null;
create index food_logs_recipe_idx on public.food_logs (recipe_id) where recipe_id is not null;

alter table public.food_logs
  add constraint food_logs_range_ordered check (
    kcal_low is null or kcal_high is null or kcal_low <= kcal_high
  );

comment on column public.food_logs.portion_basis is
  'How grams were determined. kitchen_scale is the only measured option; the rest are estimates.';
comment on column public.food_logs.kcal_low is
  'Populated only when confidence is not high. The UI renders a range, never a fake point value.';

-- ---------------------------------------------------------------------------
-- ai_food_analyses: keeps the model estimate AND the user correction
-- ---------------------------------------------------------------------------
create table public.ai_food_analyses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  storage_path     text,
  model            text,
  scale_present    boolean not null default false,
  scale_readable   boolean not null default false,
  scale_value      numeric(8,2),
  scale_unit       text check (scale_unit in ('g','kg','oz','lb')),
  container_on_scale boolean,
  tare_confirmed   boolean,
  ai_items         jsonb not null default '[]'::jsonb,
  ai_confidence    confidence_level not null default 'low',
  clarifications   jsonb not null default '[]'::jsonb,
  user_corrections jsonb not null default '[]'::jsonb,
  final_items      jsonb not null default '[]'::jsonb,
  final_kcal       numeric(7,1),
  status           text not null default 'pending'
                   check (status in ('pending','needs_input','confirmed','failed','discarded')),
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index ai_food_analyses_user_idx on public.ai_food_analyses (user_id, created_at desc);
create trigger ai_food_analyses_touch before update on public.ai_food_analyses
  for each row execute function private.touch_updated_at();

alter table public.food_logs
  add constraint food_logs_analysis_fk
  foreign key (analysis_id) references public.ai_food_analyses (id) on delete set null;

comment on table public.ai_food_analyses is
  'Both the model estimate and the corrected truth are retained, so the system can learn this users real portions.';
comment on column public.ai_food_analyses.ai_items is
  'Model output: identification only. Contains no energy or macro values by design.';
