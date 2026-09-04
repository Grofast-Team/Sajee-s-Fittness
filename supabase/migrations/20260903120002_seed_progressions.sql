-- 20260903120002_seed_progressions.sql
--
-- Levels the exercise library and extends the difficulty chains.
--
-- Each chain is a real progression, not a relabelling: every step changes the
-- demand in one specific way — leverage, range, tempo, then load — so a person
-- who cannot do step 3 has an honest step 2 to work at rather than being told
-- to try harder.
--
-- No video URLs are seeded. There is no curated footage yet, and inventing
-- links would be exactly the failure this schema's review_status exists to
-- prevent. The app shows written instructions and says demonstrations are not
-- available yet, which is true.

-- ---------------------------------------------------------------------------
-- Level the exercises that already exist.
-- ---------------------------------------------------------------------------
update public.exercises set level = 1, movement_pattern = 'squat',      impact_level = 'none' where slug = 'box-squat';
update public.exercises set level = 2, movement_pattern = 'squat',      impact_level = 'none' where slug = 'bodyweight-squat';
update public.exercises set level = 1, movement_pattern = 'horiz_push', impact_level = 'none' where slug = 'wall-pushup';
update public.exercises set level = 2, movement_pattern = 'horiz_push', impact_level = 'none' where slug = 'knee-pushup';
update public.exercises set level = 3, movement_pattern = 'horiz_push', impact_level = 'none' where slug = 'full-pushup';
update public.exercises set level = 2, movement_pattern = 'horiz_pull', impact_level = 'none' where slug = 'band-row';
update public.exercises set level = 3, movement_pattern = 'horiz_pull', impact_level = 'none' where slug = 'db-row';
update public.exercises set level = 1, movement_pattern = 'hinge',      impact_level = 'none' where slug = 'glute-bridge';
update public.exercises set level = 2, movement_pattern = 'brace',      impact_level = 'none' where slug = 'plank';
update public.exercises set level = 1, movement_pattern = 'brace',      impact_level = 'none' where slug = 'dead-bug';
update public.exercises set level = 1, movement_pattern = 'gait',       impact_level = 'none' where slug = 'seated-march';
update public.exercises set level = 2, movement_pattern = 'gait',       impact_level = 'low'  where slug = 'brisk-walk';

-- ---------------------------------------------------------------------------
-- Extend the chains so there is somewhere to progress *to*.
--
-- Without these the ladder stops at level 2 or 3 and the engine has nothing to
-- offer someone who is doing well — which is the point at which people leave.
-- ---------------------------------------------------------------------------
insert into public.exercises
  (slug, name, category, equipment, difficulty, level, movement_pattern,
   impact_level, space_required, apartment_friendly, target_muscles, met_value,
   instructions, common_mistakes, contraindications)
values
  ('tempo-squat', 'Tempo squat', 'lower', 'none', 'intermediate', 3, 'squat',
   'none', 'minimal', true, '{quadriceps,glutes,core}', 5.0,
   '["Stand with your feet about shoulder-width apart.",
     "Lower for a slow count of four — this is the whole point of the exercise.",
     "Pause for one count at the bottom, without bouncing.",
     "Stand up at normal speed."]'::jsonb,
   '["Rushing the lowering phase, which removes the difficulty entirely.",
     "Bouncing out of the bottom instead of pausing."]'::jsonb,
   '{knee_injury}'),

  ('goblet-squat', 'Goblet squat', 'lower', 'dumbbells', 'intermediate', 4, 'squat',
   'none', 'minimal', true, '{quadriceps,glutes,core}', 5.5,
   '["Hold one dumbbell against your chest with both hands, like a cup.",
     "Squat down, keeping your chest up — the weight helps you stay upright.",
     "Go as low as you can with your heels down.",
     "Stand back up."]'::jsonb,
   '["Letting the weight drift away from your chest.",
     "Choosing a weight that makes your back round."]'::jsonb,
   '{knee_injury,back_injury}'),

  ('incline-pushup', 'Incline push-up', 'upper_push', 'none', 'beginner', 2, 'horiz_push',
   'none', 'minimal', true, '{chest,triceps,shoulders}', 3.5,
   '["Put your hands on a sturdy table, worktop or windowsill.",
     "Walk your feet back so your body is a straight line.",
     "Lower your chest to the surface, then push back up.",
     "The lower the surface, the harder it gets — this is your dial."]'::jsonb,
   '["Hips sagging or piking up.",
     "Using something that can slide. Check it first."]'::jsonb,
   '{shoulder_injury,wrist_injury}'),

  ('split-squat', 'Split squat', 'lower', 'none', 'intermediate', 3, 'lunge',
   'none', 'moderate', true, '{quadriceps,glutes}', 5.0,
   '["Stand with one foot forward and one well back, as if on train tracks.",
     "Lower straight down until your back knee is near the floor.",
     "Push through the front heel to stand.",
     "Hold a wall or chair for balance — that is not cheating."]'::jsonb,
   '["Stepping too narrow, which makes balancing the hard part instead of the legs.",
     "Leaning forward over the front knee."]'::jsonb,
   '{knee_injury}'),

  ('side-plank-knees', 'Side plank from knees', 'core', 'none', 'beginner', 1, 'brace',
   'none', 'minimal', true, '{core,obliques}', 3.0,
   '["Lie on your side, propped on your forearm, knees bent.",
     "Lift your hips so your body makes a straight line from head to knees.",
     "Breathe normally and hold. Swap sides."]'::jsonb,
   '["Letting the hips drop backwards.",
     "Holding your breath."]'::jsonb,
   '{shoulder_injury}'),

  ('marching-glute-bridge', 'Marching glute bridge', 'lower', 'none', 'intermediate', 2, 'hinge',
   'none', 'minimal', true, '{glutes,hamstrings,core}', 3.8,
   '["Set up as a normal glute bridge and lift your hips.",
     "Keeping your hips level, lift one foot a few inches.",
     "Put it down and swap. The hips staying level is the exercise."]'::jsonb,
   '["Hips tipping to one side as the foot lifts.",
     "Going fast. Slow is harder and safer here."]'::jsonb,
   '{}'),

  ('chair-stand', 'Sit to stand', 'lower', 'none', 'beginner', 1, 'squat',
   'none', 'minimal', true, '{quadriceps,glutes}', 3.5,
   '["Sit on the front half of a sturdy chair.",
     "Lean your chest forward and stand up.",
     "Sit back down slowly, taking three seconds.",
     "Use your hands on your thighs if you need to — that still counts."]'::jsonb,
   '["Dropping onto the chair rather than lowering.",
     "Using a chair with wheels."]'::jsonb,
   '{}')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Wire the chains. Each link is set in both directions so the engine can walk
-- either way — progression and regression are the same ladder.
-- ---------------------------------------------------------------------------
do $$
declare
  chain text[][] := array[
    -- easier                 harder
    array['chair-stand',      'box-squat'],
    array['box-squat',        'bodyweight-squat'],
    array['bodyweight-squat', 'tempo-squat'],
    array['tempo-squat',      'goblet-squat'],

    array['wall-pushup',      'incline-pushup'],
    array['incline-pushup',   'knee-pushup'],
    array['knee-pushup',      'full-pushup'],

    array['band-row',         'db-row'],

    array['glute-bridge',     'marching-glute-bridge'],
    array['bodyweight-squat', 'split-squat'],

    array['side-plank-knees', 'plank'],
    array['dead-bug',         'plank'],

    array['seated-march',     'brisk-walk']
  ];
  link text[];
begin
  foreach link slice 1 in array chain loop
    update public.exercises e
      set harder_variant = h.id
      from public.exercises h
      where e.slug = link[1] and h.slug = link[2];

    update public.exercises e
      set easier_variant = l.id
      from public.exercises l
      where e.slug = link[2] and l.slug = link[1]
        and e.easier_variant is null;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shorter sessions, so "I only have ten minutes" is a real answer rather than
-- an excuse to skip. A person who does ten minutes keeps the habit; a person
-- who skips because they could not do thirty loses it.
-- ---------------------------------------------------------------------------
insert into public.workouts (slug, name, focus, equipment, difficulty, minutes, description, warmup, cooldown)
values
  ('reset-5', '5-minute reset', 'mobility', 'none', 'beginner', 5,
   'For days when everything has gone. Five minutes still counts.',
   '["30 seconds of easy marching"]'::jsonb,
   '["Three slow breaths"]'::jsonb),
  ('mini-10', '10-minute mini session', 'full_body', 'none', 'beginner', 10,
   'Short, complete, and genuinely worth doing.',
   '["1 minute of marching on the spot"]'::jsonb,
   '["1 minute of easy breathing"]'::jsonb),
  ('mobility-10', '10-minute mobility', 'mobility', 'none', 'beginner', 10,
   'Gentle movement for a rest day, a sore day, or a day with no appetite for training.',
   '["Shoulder rolls, ten each way"]'::jsonb,
   '["Slow breathing, one minute"]'::jsonb)
on conflict (slug) do nothing;

insert into public.workout_exercises
  (workout_id, exercise_id, sort_order, sets, rep_low, rep_high, hold_seconds, rest_seconds, note)
select w.id, e.id, v.sort_order, v.sets, v.rep_low, v.rep_high, v.hold_seconds, v.rest_seconds, v.note
from (values
  ('reset-5',     'chair-stand',      1, 2, 8,  10,  null, 30, 'Slowly.'),
  ('reset-5',     'glute-bridge',     2, 2, 10, 12,  null, 30, null),
  ('reset-5',     'dead-bug',         3, 1, 6,  8,   null, 30, 'Six per side.'),
  ('mini-10',     'box-squat',        1, 2, 10, 12,  null, 45, null),
  ('mini-10',     'incline-pushup',   2, 2, 6,  10,  null, 45, 'Use a worktop.'),
  ('mini-10',     'glute-bridge',     3, 2, 12, 15,  null, 45, null),
  ('mini-10',     'side-plank-knees', 4, 2, null, null, 15, 45, 'Fifteen seconds each side.'),
  ('mobility-10', 'seated-march',     1, 1, null, null, 60, 30, null),
  ('mobility-10', 'dead-bug',         2, 2, 6,  8,   null, 30, null),
  ('mobility-10', 'glute-bridge',     3, 2, 10, 12,  null, 30, null)
) as v(workout_slug, exercise_slug, sort_order, sets, rep_low, rep_high, hold_seconds, rest_seconds, note)
join public.workouts w on w.slug = v.workout_slug
join public.exercises e on e.slug = v.exercise_slug
on conflict do nothing;
