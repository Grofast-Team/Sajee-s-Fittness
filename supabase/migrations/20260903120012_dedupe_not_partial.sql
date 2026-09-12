-- 20260903120012_dedupe_not_partial.sql
--
-- Make the dedupe index usable by ON CONFLICT.
--
-- 20260903120011 created it as a *partial* unique index, `where dedupe_key is
-- not null`. Postgres will not match a partial index to an `on conflict
-- (user_id, dedupe_key)` clause unless the statement repeats the same
-- predicate, which PostgREST has no way to express — so every upsert from the
-- daily job failed with 42P10 and the job quietly raised nothing.
--
-- The predicate was buying nothing anyway: nulls are distinct in a Postgres
-- unique index, so a plain index already allows any number of notifications
-- with no dedupe key while still rejecting a repeat of the same event.

drop index if exists notifications_dedupe_idx;

create unique index notifications_dedupe_idx
  on public.notifications (user_id, dedupe_key);
