-- 20260903120004_level_since.sql
--
-- Record *when* someone's fitness level last changed.
--
-- Without this, "sessions at this level" and "days at this level" have to be
-- inferred from the total feedback count, and both go wrong the moment a level
-- actually changes:
--
--   * The eight sessions that earned a promotion from level 2 are still
--     sitting there after it, so the readiness checklist passes again straight
--     away and the level ratchets 2 -> 3 -> 4 across consecutive page loads.
--     Someone who trained consistently for a fortnight would be handed
--     advanced sessions on their third visit.
--
--   * "Days at this level" was being derived as `sessions * 2`, which is a
--     fabricated number. This codebase does not invent numbers — a real
--     timestamp is the only honest source for a duration.
--
-- Defaulting to now() for existing rows is correct rather than merely
-- convenient: nobody has been at a *tracked* level before this migration, so
-- the clock genuinely starts here, and the minimum-time check will hold their
-- level steady for the next ten days instead of promoting on stale history.

alter table public.profiles
  add column if not exists fitness_level_set_at timestamptz not null default now();

comment on column public.profiles.fitness_level_set_at is
  'When fitness_level last changed. Progression counts sessions and days from '
  'here, so a promotion resets the evidence rather than reusing the sessions '
  'that earned it.';

-- Keep the timestamp honest without relying on every writer to remember it.
-- A level can be changed by the assessment, by the feedback loop, or by hand
-- in the dashboard; a trigger is the only place that covers all three.
create or replace function private.touch_fitness_level_set_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fitness_level is distinct from old.fitness_level then
    new.fitness_level_set_at := now();
  end if;
  return new;
end;
$$;

create trigger profiles_fitness_level_set_at
  before update of fitness_level on public.profiles
  for each row execute function private.touch_fitness_level_set_at();
