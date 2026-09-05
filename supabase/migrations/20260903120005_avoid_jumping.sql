-- 20260903120005_avoid_jumping.sql
--
-- Somewhere to put the answer to "do you need to avoid jumping?".
--
-- Onboarding has been asking this question since the wizard was written, and
-- the answer was being thrown away — there was no column to put it in. The
-- recommender already supports the filter (`apartmentOnly`), and every video
-- carries `apartment_friendly`, so the only missing link was storage.
--
-- Asking a question and discarding the answer is worse than not asking. It
-- tells someone with neighbours below that the plan accounts for their floor,
-- and then hands them burpees.

alter table public.lifestyle
  add column if not exists avoid_jumping boolean not null default false;

comment on column public.lifestyle.avoid_jumping is
  'Shared floors, thin walls, a sleeping baby, or knees that would rather not. '
  'Filters the session recommender to low-impact work.';
