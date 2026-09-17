-- 20260903120020_meal_times.sql
--
-- When this person usually eats.
--
-- ## Why store the times at all
--
-- "Log your food" is a request the app currently makes at whatever moment the
-- person happens to open it. Asked at 3pm, they reconstruct breakfast from
-- memory; asked at 1:30pm, they are describing the plate they just put down.
-- Knowing the schedule lets the prompt arrive while the answer is still easy,
-- which is the difference between an estimate and a recollection.
--
-- ## Why three columns rather than a table
--
-- A meal_schedule table would allow arbitrary named meals per user, which
-- sounds more flexible and buys nothing: the thing being modelled is three
-- optional clock times that change perhaps twice a year. Columns on the row
-- that already holds wake_time and sleep_time keep the whole daily rhythm in
-- one place, and the query that reads them is the one already being run.
--
-- Snacks deliberately get no time. They are not missed, they are had, and a
-- schedule for them would generate prompts nobody wants.
--
-- ## Nullable on purpose
--
-- Every one of these is optional. When a time is absent the app derives it from
-- wake_time instead (see src/lib/engines/meal-times.ts), because someone who
-- gets up at 05:00 and someone who gets up at 11:00 do not eat breakfast at the
-- same hour. A NOT NULL default here would bake in a single wrong hour for
-- everybody and look like an answer the user had given.

alter table public.lifestyle
  add column if not exists breakfast_time time,
  add column if not exists lunch_time     time,
  add column if not exists dinner_time    time;

comment on column public.lifestyle.breakfast_time is
  'Usual first meal. Null means derive from wake_time rather than assume an hour.';
comment on column public.lifestyle.lunch_time is
  'Usual midday meal. Null means derive from wake_time.';
comment on column public.lifestyle.dinner_time is
  'Usual evening meal. Null means derive from wake_time. May fall after midnight '
  'for a night-shift worker, which is why the app measures from waking rather '
  'than from the clock.';
