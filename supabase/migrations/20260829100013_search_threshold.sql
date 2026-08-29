-- 20260829100013_search_threshold.sql
--
-- Raises the match threshold from pg_trgm's default 0.3 to 0.55, matching the
-- value already validated in tests/search.test.ts.
--
-- At 0.3, "chawal" returns tea (via the "chai" alias) and "dosai" returns curd
-- (via "mosaru") — shared bigrams, unrelated foods. Every genuine spelling
-- variant scores far higher: thosai/dosai and idly/idli 0.67, sambhar/sambar
-- 0.73. The near misses sit at 0.44-0.50, so the gap is wide enough not to be
-- fragile.
--
-- Filtering on the computed score (rather than setting the operator threshold)
-- keeps the index-backed `%` prefilter doing the cheap work first.

create or replace function public.search_foods(q text, max_results integer default 20)
returns table (
  id uuid, name text, name_local text, brand text, category text,
  food_state food_state, kcal_per_100g numeric, protein_per_100g numeric,
  carb_per_100g numeric, fat_per_100g numeric, fibre_per_100g numeric,
  default_serving_g numeric, is_vegetarian boolean, matched_alias text, score real
)
language sql
stable
set search_path = public, extensions
as $$
  with needle as (
    select lower(trim(q)) as term
  ),
  alias_hits as (
    select distinct on (fa.food_id)
      fa.food_id, fa.alias, similarity(lower(fa.alias), n.term) as sim
    from public.food_aliases fa
    cross join needle n
    where lower(fa.alias) % n.term or lower(fa.alias) like n.term || '%'
    order by fa.food_id, similarity(lower(fa.alias), n.term) desc
  ),
  scored as (
    select
      f.id, f.name, f.name_local, f.brand, f.category, f.food_state,
      f.kcal_per_100g, f.protein_per_100g, f.carb_per_100g, f.fat_per_100g,
      f.fibre_per_100g, f.default_serving_g, f.is_vegetarian, f.is_verified,
      ah.alias as matched_alias,
      greatest(
        similarity(f.search_text, n.term),
        coalesce(ah.sim, 0),
        -- A word-boundary hit beats a mid-word one: searching "oil" should not
        -- surface "b-oil-ed egg".
        case when f.search_text ~ ('(^|[^a-z])' || n.term) then 0.9 else 0 end
      )::real as score
    from public.foods f
    cross join needle n
    left join alias_hits ah on ah.food_id = f.id
    where f.search_text % n.term
       or f.search_text like '%' || n.term || '%'
       or ah.food_id is not null
  )
  select id, name, name_local, brand, category, food_state,
         kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g,
         fibre_per_100g, default_serving_g, is_vegetarian, matched_alias, score
  from scored
  where score >= 0.55
  order by score desc, is_verified desc, name
  limit greatest(1, least(max_results, 50));
$$;

grant execute on function public.search_foods(text, integer) to authenticated;
