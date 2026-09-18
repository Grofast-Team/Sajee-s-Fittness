-- 20260903120022_backfill_fitness_categories.sql
--
-- Pulled forward from the full backfill in design spec section 9,
-- deliberately - not the whole thing, just this half.
--
-- Every user who completed the nine-step Fitness interview before
-- 20260903120021_user_categories.sql existed has an active plans row and
-- no user_categories row at all. Phase 3 adds a route guard and twelve
-- write guards that check user_categories(fitness).enabled - if that ships
-- before this backfill runs, every one of those real users loses Fitness
-- access the moment it deploys. This migration is the fix, and it has to
-- land and be verified before the guard code does, not after.
--
-- ON CONFLICT DO NOTHING, never DO UPDATE: if this is ever re-run after
-- launch, it must not re-enable a category someone has since explicitly
-- turned off. The money-category half of the full backfill, and this
-- migration's own eventual folding into design spec section 9's complete
-- version, are Phase 5 - not touched here.

insert into public.user_categories (user_id, category_key, enabled, enabled_at)
select p.user_id, 'fitness', true, coalesce(p.onboarding_done_at, now())
from public.profiles p
where exists (
  select 1 from public.plans where user_id = p.user_id and is_active
)
on conflict (user_id, category_key) do nothing;
