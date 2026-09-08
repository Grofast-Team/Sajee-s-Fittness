-- 20260903120008_day_map.sql
--
-- Store the day someone described, and the activity factor derived from it.
--
-- Onboarding used to ask people to classify their own activity level. That
-- question produces the least reliable answer in the interview: people answer
-- it with their self-image. A homemaker on her feet for nine hours calls
-- herself "not very active" because she does not go to a gym, and the entire
-- calorie target is then built on that.
--
-- The day map is evidence instead of self-assessment, so it is worth keeping:
-- the derived PAL can be recomputed if the MET values are ever corrected, and
-- the user can be shown exactly which blocks produced their number.

alter table public.lifestyle
  add column if not exists day_map jsonb not null default '[]'::jsonb,
  add column if not exists derived_pal numeric(4,2)
    check (derived_pal is null or derived_pal between 1.0 and 2.6);

comment on column public.lifestyle.day_map is
  'What the user said they do through a normal day: [{slot, activityId, minutes}]. '
  'Kept raw so the activity factor can be recomputed if MET values change.';
comment on column public.lifestyle.derived_pal is
  'Physical activity level computed from day_map — MET-hours over 24. An '
  'estimate from population-average MET values, never a measurement.';
