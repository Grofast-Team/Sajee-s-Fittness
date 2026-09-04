-- 20260903120003_fix_ladder_rungs.sql
--
-- Fixes two problems in the difficulty ladders, both found by reading the
-- seeded chains back rather than trusting the insert.
--
-- 1. `chair-stand` and `box-squat` are the same movement — sit down on a chair,
--    stand back up. Seeding both put a redundant rung in the squat ladder, so
--    "progress to the next level" would have handed someone the exercise they
--    had just done under a different name. That is worse than no progression:
--    it makes the system look like it is not paying attention.
--
-- 2. `incline-pushup` and `knee-pushup` both sat at level 2 while the chain
--    ran incline -> knee. A ladder whose rungs share a height cannot be walked
--    by level, only by pointer, which defeats the reason `level` exists.

-- --- 1. Merge the duplicate squat entry -------------------------------------

-- Move anything pointing at the duplicate onto the surviving exercise first,
-- so no workout loses a slot.
update public.workout_exercises we
set exercise_id = keep.id
from public.exercises dup, public.exercises keep
where we.exercise_id = dup.id
  and dup.slug = 'chair-stand'
  and keep.slug = 'box-squat';

update public.exercise_sets es
set exercise_id = keep.id
from public.exercises dup, public.exercises keep
where es.exercise_id = dup.id
  and dup.slug = 'chair-stand'
  and keep.slug = 'box-squat';

-- Detach the chain links before removing it.
update public.exercises
set easier_variant = null
where easier_variant = (select id from public.exercises where slug = 'chair-stand');

update public.exercises
set harder_variant = null
where harder_variant = (select id from public.exercises where slug = 'chair-stand');

delete from public.exercises where slug = 'chair-stand';

-- `box-squat` is now the bottom rung, and it has no easier variant because
-- there genuinely is not one — sitting and standing is the floor.
update public.exercises
set easier_variant = null, level = 1
where slug = 'box-squat';

-- --- 2. Give the push-up ladder distinct rungs ------------------------------
--
-- wall -> incline -> knee -> full. Each step meaningfully increases the share
-- of bodyweight carried, which is the actual variable.
update public.exercises set level = 1 where slug = 'wall-pushup';
update public.exercises set level = 2 where slug = 'incline-pushup';
update public.exercises set level = 3 where slug = 'knee-pushup';
update public.exercises set level = 4 where slug = 'full-pushup';

-- --- Guard the invariant ----------------------------------------------------
--
-- A harder variant must sit at a strictly higher level than the exercise it
-- progresses from. Without this the ladder can silently develop flat rungs
-- again the next time someone seeds an exercise.
create or replace function private.check_progression_levels()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  harder_level smallint;
begin
  if new.harder_variant is null then
    return new;
  end if;

  select level into harder_level
  from public.exercises
  where id = new.harder_variant;

  if harder_level is not null and harder_level <= new.level then
    raise exception
      'progression must go up: % is level %, but its harder variant is level %',
      new.slug, new.level, harder_level;
  end if;

  return new;
end;
$$;

create trigger exercises_progression_levels
  before insert or update of level, harder_variant on public.exercises
  for each row execute function private.check_progression_levels();
