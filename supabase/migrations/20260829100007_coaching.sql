-- 0007_coaching.sql
-- Habits, coach conversations, reviews, feedback, notifications, education.

-- ---------------------------------------------------------------------------
-- habits: 1-3 at a time, never twenty on day one
-- ---------------------------------------------------------------------------
create table public.habit_templates (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  description  text not null,
  category     text not null check (category in ('nutrition','activity','sleep','hydration','logging','mindset')),
  difficulty   smallint not null default 1 check (difficulty between 1 and 3),
  impact       smallint not null default 2 check (impact between 1 and 3),
  prerequisite uuid references public.habit_templates (id) on delete set null,
  is_active    boolean not null default true
);
create index habit_templates_cat_idx on public.habit_templates (category, difficulty);
create index habit_templates_prereq_idx on public.habit_templates (prerequisite) where prerequisite is not null;

create table public.user_habits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  template_id  uuid references public.habit_templates (id) on delete set null,
  title        text not null,
  started_on   date not null default current_date,
  status       text not null default 'active' check (status in ('active','mastered','paused','dropped')),
  target_days_per_week smallint not null default 5 check (target_days_per_week between 1 and 7),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index user_habits_user_idx on public.user_habits (user_id, status);
create index user_habits_template_idx on public.user_habits (template_id) where template_id is not null;
create trigger user_habits_touch before update on public.user_habits
  for each row execute function private.touch_updated_at();

create table public.habit_checkins (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users (id) on delete cascade,
  habit_id  uuid not null references public.user_habits (id) on delete cascade,
  log_date  date not null default current_date,
  done      boolean not null default true,
  unique (habit_id, log_date)
);
create index habit_checkins_user_idx on public.habit_checkins (user_id, log_date desc);

-- ---------------------------------------------------------------------------
-- coach conversations
-- ---------------------------------------------------------------------------
create table public.coach_threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default 'Coach',
  kind       text not null default 'chat' check (kind in ('chat','daily_checkin','weekly_review','what_if')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_threads_user_idx on public.coach_threads (user_id, updated_at desc);
create trigger coach_threads_touch before update on public.coach_threads
  for each row execute function private.touch_updated_at();

create table public.coach_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.coach_threads (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('user','assistant','system')),
  content    text not null,
  context    jsonb not null default '{}'::jsonb,
  model      text,
  safety_gated boolean not null default false,
  created_at timestamptz not null default now()
);
create index coach_messages_thread_idx on public.coach_messages (thread_id, created_at);
create index coach_messages_user_idx on public.coach_messages (user_id, created_at desc);

comment on column public.coach_messages.context is
  'The grounded facts handed to the model for this turn, retained for auditability.';

-- ---------------------------------------------------------------------------
-- reviews: weekly and monthly
-- ---------------------------------------------------------------------------
create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  period        text not null check (period in ('week','month')),
  period_start  date not null,
  period_end    date not null,
  metrics       jsonb not null default '{}'::jsonb,
  went_well     text[] not null default array[]::text[],
  was_hard      text[] not null default array[]::text[],
  biggest_lever text,
  next_goal     text,
  narrative     text,
  user_reported_difficulty difficulty_rating,
  user_hardest_part text,
  created_at    timestamptz not null default now(),
  unique (user_id, period, period_start)
);
create index reviews_user_idx on public.reviews (user_id, period_start desc);

-- ---------------------------------------------------------------------------
-- plan_feedback: "was this realistic for you?"
-- ---------------------------------------------------------------------------
create table public.plan_feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  subject_type text not null check (subject_type in ('meal','recipe','workout','step_goal','plan','habit')),
  subject_id   uuid,
  rating       difficulty_rating not null,
  reason       text,
  created_at   timestamptz not null default now()
);
create index plan_feedback_user_idx on public.plan_feedback (user_id, created_at desc);
create index plan_feedback_subject_idx on public.plan_feedback (subject_type, subject_id);

comment on table public.plan_feedback is
  'The adherence-over-perfection signal. Repeated "difficult" ratings simplify the next plan.';

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table public.notification_prefs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null,
  enabled       boolean not null default true,
  send_at       time,
  days_of_week  smallint[] not null default array[0,1,2,3,4,5,6],
  priority      smallint not null default 2 check (priority between 1 and 3),
  unique (user_id, kind)
);
create index notification_prefs_user_idx on public.notification_prefs (user_id) where enabled;

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null,
  title         text not null,
  body          text not null,
  deep_link     text,
  scheduled_at  timestamptz not null,
  sent_at       timestamptz,
  opened_at     timestamptz,
  dismissed_at  timestamptz,
  status        text not null default 'scheduled'
                check (status in ('scheduled','sent','opened','dismissed','suppressed','cancelled')),
  suppressed_reason text,
  created_at    timestamptz not null default now()
);
create index notifications_user_sched_idx on public.notifications (user_id, scheduled_at desc);
create index notifications_pending_idx on public.notifications (scheduled_at) where status = 'scheduled';

comment on column public.notifications.suppressed_reason is
  'Quiet hours, frequency cap, or repeated ignores. Suppression is recorded, not silent.';

-- ---------------------------------------------------------------------------
-- education content, managed not hardcoded
-- ---------------------------------------------------------------------------
create table public.lessons (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  topic       text not null check (topic in ('nutrition','exercise','fat_loss','lifestyle','safety','app')),
  reading_minutes smallint not null default 2,
  summary     text not null,
  body        text not null,
  sort_order  smallint not null default 0,
  is_published boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index lessons_topic_idx on public.lessons (topic, sort_order) where is_published;
create trigger lessons_touch before update on public.lessons
  for each row execute function private.touch_updated_at();

create table public.evidence_claims (
  id          uuid primary key default gen_random_uuid(),
  claim       text not null,
  source_name text not null,
  source_url  text,
  source_year smallint,
  evidence_grade text not null check (evidence_grade in ('guideline','systematic_review','rct','observational','expert_opinion')),
  reviewed_on date,
  lesson_id   uuid references public.lessons (id) on delete set null
);
create index evidence_claims_lesson_idx on public.evidence_claims (lesson_id) where lesson_id is not null;

comment on table public.evidence_claims is
  'Health claims carry provenance so guidance can be re-reviewed as evidence changes.';
