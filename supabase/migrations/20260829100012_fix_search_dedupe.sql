-- 20260829100012_fix_search_dedupe.sql
--
-- Fixes duplicate rows from search_foods().
--
-- The previous version grouped alias matches by (food_id, alias), so a food
-- matching several of its own aliases produced one row per alias. Searching
-- "thosai" returned "Dosa (plain)" twice, because dosai/thosai/dosha/dose all
-- scored against the query.
--
-- Aliases are now collapsed to one row per food, keeping the best-scoring
-- alias as the one to display.

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
    -- distinct on collapses to one row per food: the highest-scoring alias.
    select distinct on (fa.food_id)
      fa.food_id,
      fa.alias,
      similarity(lower(fa.alias), n.term) as sim
    from public.food_aliases fa
    cross join needle n
    where lower(fa.alias) % n.term
       or lower(fa.alias) like n.term || '%'
    order by fa.food_id, similarity(lower(fa.alias), n.term) desc
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

grant execute on function public.search_foods(text, integer) to authenticated;

comment on function public.search_foods is
  'Alias- and typo-tolerant food search, one row per food. Runs as the caller, so RLS governs visibility.';
