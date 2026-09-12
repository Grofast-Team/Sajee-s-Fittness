-- 20260903120011_notification_dedupe.sql
--
-- Make a duplicate notification impossible.
--
-- A daily job that says "your rent is due in three days" must say it once, not
-- once per run. Application logic can check before inserting, but a check and
-- an insert are two steps: two overlapping cron runs, or a retry after a
-- timeout, will both pass the check and both insert. The only place this can
-- be enforced reliably is the database.
--
-- `dedupe_key` carries the identity of the *event*, not of the row — for a
-- bill that is the commitment plus the date it falls due, so next month's rent
-- is a different event and notifies again, while today's second cron run is
-- the same event and does not.

alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_idx
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

comment on column public.notifications.dedupe_key is
  'Identity of the event this notifies about, e.g. commitment:<id>:2026-09-05. '
  'Uniquely indexed per user so a repeated job cannot create a second copy.';

-- Read path: the unread list, newest first.
create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where dismissed_at is null and opened_at is null;
