-- 0002_exercises.sql — exercise library, workout templates, habits, lessons.
--
-- Every exercise carries plain-language instructions, the mistakes beginners
-- actually make, and an easier variant. A beginner who cannot do a full push-up
-- should never be shown a full push-up with no way down from it.
--
-- MET values are from the Compendium of Physical Activities (Ainsworth et al.).
-- They are population averages and are used only for rough expenditure display,
-- never added to the eating target by default.

insert into public.exercises
  (slug, name, category, equipment, difficulty, target_muscles, met_value, instructions, common_mistakes, contraindications)
values
  ('bodyweight-squat', 'Bodyweight squat', 'lower', 'none', 'beginner',
   '{quadriceps,glutes,core}', 5.0,
   '["Stand with your feet about shoulder-width apart, toes turned out slightly.",
     "Take a breath and tighten your stomach as if bracing for a poke.",
     "Sit down and back, as though reaching for a chair behind you.",
     "Go as low as you can while keeping your heels on the floor.",
     "Stand back up, squeezing your glutes at the top."]'::jsonb,
   '["Heels lifting off the floor - stand slightly wider or hold a support.",
     "Knees caving inwards - think about pushing them out over your toes.",
     "Rushing. Two seconds down, one second up."]'::jsonb,
   '{knee_injury}'),

  ('box-squat', 'Sit-to-stand (chair squat)', 'lower', 'none', 'beginner',
   '{quadriceps,glutes}', 4.0,
   '["Sit on the front edge of a sturdy chair, feet flat.",
     "Lean your chest forward slightly and stand up without using your hands.",
     "Sit back down slowly, taking three seconds.",
     "If standing without hands is too hard, use them - that still counts."]'::jsonb,
   '["Dropping onto the chair instead of lowering under control.",
     "Using a chair with wheels. Please do not."]'::jsonb,
   '{}'),

  ('knee-pushup', 'Push-up from knees', 'upper_push', 'none', 'beginner',
   '{chest,triceps,shoulders,core}', 3.8,
   '["Kneel and place your hands slightly wider than your shoulders.",
     "Walk your knees back so your body makes a straight line from head to knees.",
     "Lower your chest towards the floor with your elbows at about 45 degrees.",
     "Push back up without letting your hips sag."]'::jsonb,
   '["Hips sagging or lifting - squeeze your glutes to keep the line.",
     "Elbows flaring straight out to the sides, which irritates shoulders.",
     "Only going down a few inches. Range matters more than reps."]'::jsonb,
   '{shoulder_injury,wrist_injury}'),

  ('wall-pushup', 'Wall push-up', 'upper_push', 'none', 'beginner',
   '{chest,triceps,shoulders}', 3.0,
   '["Stand about an arm''s length from a wall.",
     "Place your hands on the wall at chest height, slightly wider than your shoulders.",
     "Lower your chest towards the wall, then push back."]'::jsonb,
   '["Standing too close, which removes most of the work.",
     "Letting the hips lead instead of the chest."]'::jsonb,
   '{}'),

  ('full-pushup', 'Push-up', 'upper_push', 'none', 'intermediate',
   '{chest,triceps,shoulders,core}', 4.5,
   '["Start in a plank with hands slightly wider than your shoulders.",
     "Keep a straight line from your head to your heels.",
     "Lower until your chest is close to the floor.",
     "Push back up, keeping your stomach tight throughout."]'::jsonb,
   '["Sagging hips - the most common fault by a distance.",
     "Head dropping forward before the chest."]'::jsonb,
   '{shoulder_injury,wrist_injury}'),

  ('db-row', 'Dumbbell row', 'upper_pull', 'dumbbells', 'beginner',
   '{back,biceps}', 4.5,
   '["Put one knee and one hand on a bench or sturdy chair.",
     "Hold the dumbbell in your free hand, arm hanging straight down.",
     "Pull the weight towards your hip, leading with your elbow.",
     "Lower it all the way back down under control."]'::jsonb,
   '["Twisting the torso to help the weight up.",
     "Pulling towards the shoulder rather than the hip.",
     "Going too heavy and losing the back position."]'::jsonb,
   '{back_injury}'),

  ('band-row', 'Resistance band row', 'upper_pull', 'bands', 'beginner',
   '{back,biceps}', 3.8,
   '["Anchor the band at chest height, or loop it around your feet while seated.",
     "Hold one end in each hand with your arms straight.",
     "Pull your elbows back, squeezing your shoulder blades together.",
     "Return slowly."]'::jsonb,
   '["Shrugging the shoulders up towards the ears.",
     "Letting the band snap back instead of controlling it."]'::jsonb,
   '{}'),

  ('glute-bridge', 'Glute bridge', 'lower', 'none', 'beginner',
   '{glutes,hamstrings,core}', 3.5,
   '["Lie on your back, knees bent, feet flat and close to your hips.",
     "Push through your heels and lift your hips until your body is straight.",
     "Squeeze your glutes hard at the top for a second.",
     "Lower slowly."]'::jsonb,
   '["Arching the lower back instead of using the glutes.",
     "Pushing through the toes rather than the heels."]'::jsonb,
   '{}'),

  ('plank', 'Plank', 'core', 'none', 'beginner',
   '{core,shoulders}', 3.3,
   '["Rest on your forearms and toes, elbows under your shoulders.",
     "Make a straight line from head to heels.",
     "Squeeze your glutes and stomach.",
     "Breathe normally. Hold for time, not until collapse."]'::jsonb,
   '["Hips too high, which makes it easy.",
     "Hips sagging, which stresses the lower back.",
     "Holding your breath."]'::jsonb,
   '{}'),

  ('dead-bug', 'Dead bug', 'core', 'none', 'beginner',
   '{core}', 2.8,
   '["Lie on your back with arms pointing at the ceiling and knees bent at 90 degrees.",
     "Press your lower back gently into the floor.",
     "Slowly lower one arm overhead and the opposite leg towards the floor.",
     "Return and swap sides."]'::jsonb,
   '["Letting the lower back arch away from the floor.",
     "Moving fast. Slow is the whole point."]'::jsonb,
   '{}'),

  ('brisk-walk', 'Brisk walk', 'cardio', 'none', 'beginner',
   '{legs,heart}', 4.3,
   '["Walk at a pace where you can talk but not sing.",
     "Keep your posture tall and let your arms swing naturally.",
     "If you are short on time, walking after a meal is the highest-value slot."]'::jsonb,
   '["Starting too fast and having to stop.",
     "Treating a slow stroll as a brisk walk - use the talk test."]'::jsonb,
   '{}'),

  ('seated-march', 'Seated march', 'cardio', 'none', 'beginner',
   '{legs,core}', 2.5,
   '["Sit tall towards the front of a chair.",
     "Lift one knee, then the other, as though marching.",
     "Swing your arms if you can. Build up the pace gradually."]'::jsonb,
   '["Slouching back into the chair."]'::jsonb,
   '{}')
on conflict (slug) do nothing;

-- Progression links: every exercise needs a way down as well as a way up.
update public.exercises e set easier_variant = v.id
from public.exercises v where e.slug = 'bodyweight-squat' and v.slug = 'box-squat';
update public.exercises e set easier_variant = v.id
from public.exercises v where e.slug = 'knee-pushup' and v.slug = 'wall-pushup';
update public.exercises e set easier_variant = v.id
from public.exercises v where e.slug = 'full-pushup' and v.slug = 'knee-pushup';
update public.exercises e set harder_variant = v.id
from public.exercises v where e.slug = 'knee-pushup' and v.slug = 'full-pushup';
update public.exercises e set easier_variant = v.id
from public.exercises v where e.slug = 'brisk-walk' and v.slug = 'seated-march';

-- ---------------------------------------------------------------------------
-- Workout templates
-- ---------------------------------------------------------------------------
insert into public.workouts (slug, name, focus, equipment, difficulty, minutes, description, warmup, cooldown)
values
  ('home-full-body-a', 'Home full body A', 'full_body', 'none', 'beginner', 25,
   'A complete beginner session needing no equipment and very little space.',
   '["2 minutes of marching on the spot", "10 arm circles each way", "5 slow sit-to-stands"]'::jsonb,
   '["30 seconds of calf stretch each side", "30 seconds of chest doorway stretch", "1 minute of slow breathing"]'::jsonb),
  ('home-full-body-b', 'Home full body B', 'full_body', 'none', 'beginner', 25,
   'The second session of the week. Same pattern, different emphasis.',
   '["2 minutes of marching on the spot", "10 hip circles each way"]'::jsonb,
   '["30 seconds of hamstring stretch each side", "1 minute of slow breathing"]'::jsonb),
  ('quick-15', '15-minute session', 'full_body', 'none', 'beginner', 15,
   'For days when time has disappeared. Short, but it counts.',
   '["1 minute of marching on the spot"]'::jsonb,
   '["1 minute of slow breathing"]'::jsonb),
  ('dumbbell-full-body', 'Dumbbell full body', 'full_body', 'dumbbells', 'beginner', 35,
   'For a pair of dumbbells at home.',
   '["3 minutes of brisk walking", "10 bodyweight squats"]'::jsonb,
   '["2 minutes of easy walking", "Stretch whatever feels tight"]'::jsonb)
on conflict (slug) do nothing;

insert into public.workout_exercises (workout_id, exercise_id, sort_order, sets, rep_low, rep_high, hold_seconds, rest_seconds, note)
select w.id, e.id, v.sort_order, v.sets, v.rep_low, v.rep_high, v.hold_seconds, v.rest_seconds, v.note
from (values
  ('home-full-body-a', 'bodyweight-squat', 1, 3, 8,  12, null, 75, 'Stop two reps before it gets ugly.'),
  ('home-full-body-a', 'knee-pushup',      2, 3, 6,  10, null, 75, 'Use the wall version if your hips sag.'),
  ('home-full-body-a', 'glute-bridge',     3, 3, 10, 15, null, 60, null),
  ('home-full-body-a', 'plank',            4, 3, null, null, 20, 60, 'Hold for time. Stop when the line breaks.'),
  ('home-full-body-b', 'box-squat',        1, 3, 10, 15, null, 60, null),
  ('home-full-body-b', 'band-row',         2, 3, 10, 15, null, 60, 'Use a towel anchored in a door if you have no band.'),
  ('home-full-body-b', 'dead-bug',         3, 3, 6,  10, null, 45, 'Six per side, slowly.'),
  ('home-full-body-b', 'glute-bridge',     4, 3, 12, 15, null, 60, null),
  ('quick-15',         'bodyweight-squat', 1, 2, 10, 15, null, 45, null),
  ('quick-15',         'knee-pushup',      2, 2, 6,  10, null, 45, null),
  ('quick-15',         'plank',            3, 2, null, null, 20, 45, null),
  ('dumbbell-full-body','bodyweight-squat',1, 3, 8,  12, null, 90, 'Hold a dumbbell at your chest once this feels easy.'),
  ('dumbbell-full-body','db-row',          2, 3, 8,  12, null, 90, 'Each side.'),
  ('dumbbell-full-body','knee-pushup',     3, 3, 8,  12, null, 75, null),
  ('dumbbell-full-body','plank',           4, 3, null, null, 30, 60, null)
) as v(workout_slug, exercise_slug, sort_order, sets, rep_low, rep_high, hold_seconds, rest_seconds, note)
join public.workouts w on w.slug = v.workout_slug
join public.exercises e on e.slug = v.exercise_slug
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Habits. One to three at a time, ordered by impact per unit of effort.
-- ---------------------------------------------------------------------------
insert into public.habit_templates (slug, title, description, category, difficulty, impact)
values
  ('log-breakfast', 'Log breakfast', 'Log just your first meal each day. Not the whole day - only breakfast.', 'logging', 1, 3),
  ('protein-at-breakfast', 'Protein at breakfast', 'Include an egg, curd, dal or soya at your first meal. It makes the rest of the day easier.', 'nutrition', 1, 3),
  ('walk-after-a-meal', 'Walk after one meal', 'A ten-minute walk after your largest meal. The single best-value ten minutes in your day.', 'activity', 1, 3),
  ('water-with-meals', 'Water with each meal', 'A glass of water at each meal. Simple, and it handles most of your hydration target.', 'hydration', 1, 2),
  ('consistent-bedtime', 'Same bedtime', 'Go to bed within thirty minutes of the same time each night.', 'sleep', 2, 3),
  ('weigh-in-routine', 'Weigh in the same way', 'Same time, after the toilet, before eating. Consistency matters far more than frequency.', 'logging', 1, 2),
  ('veg-at-lunch-dinner', 'Vegetables twice a day', 'Some vegetable at both lunch and dinner. Volume and fibre, for very few calories.', 'nutrition', 2, 2),
  ('log-everything', 'Log the whole day', 'Every meal, including the tastes while cooking and the tea. This unlocks accurate coaching.', 'logging', 3, 3),
  ('plan-tomorrow', 'Decide dinner in advance', 'Choose tomorrow''s dinner tonight. Removes the 7pm decision that usually goes badly.', 'mindset', 2, 2)
on conflict (slug) do nothing;

update public.habit_templates h set prerequisite = p.id
from public.habit_templates p where h.slug = 'log-everything' and p.slug = 'log-breakfast';

-- ---------------------------------------------------------------------------
-- Beginner education. Content lives in the database so it can be corrected
-- without a redeploy.
-- ---------------------------------------------------------------------------
insert into public.lessons (slug, title, topic, reading_minutes, summary, body, sort_order)
values
  ('what-is-a-calorie', 'What a calorie actually is', 'nutrition', 2,
   'A unit of energy, not a measure of whether a food is good or bad.',
   'A calorie is just a unit of energy, like a rupee is a unit of money. Your body spends energy all day - keeping you warm, breathing, digesting, moving - and it gets that energy from food.

If you take in less than you spend over time, your body makes up the difference from its own stores, and you lose weight. That is the whole mechanism. It is not about specific foods being magic or forbidden.

Two things people find surprising. First, most of your daily energy use is not exercise - it is just being alive. Second, the numbers on any app, including this one, are estimates. Your real expenditure is not knowable without a lab, which is why we adjust based on what actually happens to your weight rather than trusting the arithmetic.', 1),

  ('why-protein-matters', 'Why we push protein', 'nutrition', 2,
   'It keeps you full and protects muscle while you lose fat.',
   'When you eat less, your body loses some fat and some muscle. How much of each depends largely on two things: whether you eat enough protein, and whether you do some resistance training.

Protein also keeps you fuller than the same calories from carbohydrate or fat. That is not willpower advice - it is a measurable effect, and it is why hitting your protein target usually makes everything else easier.

You do not need powders or expensive foods. Eggs, curd, dal, chana, soya chunks, milk, paneer, fish and chicken all do the job. Soya chunks in particular are one of the cheapest sources of protein available anywhere.', 2),

  ('water-weight', 'Why the scale jumps around', 'fat_loss', 3,
   'Day-to-day changes are mostly water, not fat.',
   'Your weight can move a kilo or two within a single day, and almost none of that is fat.

Salt makes you hold water. Carbohydrate is stored with water attached - roughly three grams of water per gram of stored carbohydrate. A new or harder workout causes temporary fluid retention while the muscle repairs. Food still in your digestive system has weight. So does not having been to the toilet yet. For people who menstruate, the week before a period commonly adds a kilo or more of water that leaves on its own.

Here is the arithmetic that settles it. For one kilogram of body fat to appear in two days, you would have had to eat about 7,700 calories beyond your usual - roughly three extra days of food, on top of everything else. That almost never happens. So when the scale is up two kilos on Tuesday, it is water.

This is why we show you a smoothed trend line rather than reacting to each reading.', 3),

  ('plateaus', 'What a plateau really is', 'fat_loss', 3,
   'Three weeks of no movement. Not three days.',
   'A few flat days is not a plateau. It is not even unusual. Weight loss does not happen in a straight line - it happens in steps, with long flat stretches and sudden drops, and that pattern is normal.

A real plateau means about three weeks with no downward trend. When that happens, the causes in order of how often they turn out to be the answer:

First, unlogged food. This is by far the most common, and it is almost never deliberate - it is the oil, the tastes while cooking, the second helping, the weekend.

Second, portions creeping up. Portions grow slowly over weeks without anyone noticing. Weighing your usual foods for three days usually finds it.

Third, moving less. Daily movement quietly falls during a deficit, and it can cancel out a large part of it.

Last, and least often, your body genuinely needing less than before. This is real, but it is smaller than people expect - and it is the last thing to check, not the first.', 4),

  ('after-a-bad-day', 'What to do after a heavy day', 'lifestyle', 2,
   'Go back to normal. Do not try to make up for it.',
   'You ate more than you planned. Here is what actually helps: eat your normal next meal, at the normal time, of the normal size.

Here is what does not help, despite feeling like it should - skipping the next meal, eating far less the following day, or adding an extra workout to burn it off. All three make you hungrier, and hungrier reliably leads to another heavy day. That cycle is what turns one meal into a lost month.

The arithmetic is on your side. One meal that was 800 calories over is about 0.1 kg of fat. Your normal week absorbs it without you ever seeing it on the scale.

The people who succeed at this are not the ones who never go over. They are the ones who go back to normal the next morning.', 5),

  ('using-a-kitchen-scale', 'Why we ask for a photo with a scale', 'app', 3,
   'Portion size is where nearly all tracking error comes from.',
   'A photograph can tell us what you ate. It cannot tell us how much, and how much is where almost all the error lives.

Consider a plate of rice. Ninety grams and two hundred and ten grams look nearly identical in a photo, especially from above. The difference between them is about 160 calories - and repeated daily, that is the entire difference between losing weight and not.

So we ask you to put your plate on a kitchen scale, press tare to zero it, serve your food, and take the photo with the display visible. We read the weight from the display, and your numbers stop being a guess.

If you do not have a scale, the app still works. We fall back to identifying the food and giving you a range instead of a single number, and we ask you a question or two to narrow it down. We would rather show you an honest range than a precise-looking number we made up.

A basic kitchen scale costs a few hundred rupees, and it is the single highest-value thing you can buy for this. You will not need it forever - a few weeks of weighing teaches your eye what a portion looks like.', 6)
on conflict (slug) do nothing;
