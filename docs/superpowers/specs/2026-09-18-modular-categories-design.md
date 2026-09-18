# Design: Modular categories — from a fitness-gated app to an opt-in one

**Date:** 2026-09-18
**Status:** Approved for implementation
**Scope:** The category registry, activation state, dashboard, profile
screen, routing split, and the server-side rules that keep "enabled" from
becoming a silent substitute for "configured." A future-roadmap appendix
records the larger category vision without building it now.

---

## Why this document exists

Every route under `(app)/` is gated by one check in
[layout.tsx](../../../src/app/(app)/layout.tsx): `needsOnboarding()` looks for
an active `plans` row — a *fat-loss plan* — and redirects to a 9-step
weight-loss interview if one doesn't exist. That means a user who wants
nothing but expense tracking cannot reach `/money` without first answering
"Sex at birth" and "Are you pregnant?". The Money module, the habit/checkin
schema, and `cycle_logs` all already exist; none of them are reachable without
finishing a fitness interview first.

This design decouples "finished enough setup to use the app at all" from
"finished fitness setup," and makes fitness one opt-in category among several,
chosen from a profile screen rather than forced at signup.

## What already exists and what this build adds

| Piece | State before this design |
| --- | --- |
| Money (`/money`, commitments, savings, bank import) | Built, but unreachable without a fitness plan |
| Habits (`user_habits`, `habit_checkins`) | Built; maps to the future "Daily Checklist" category |
| Notifications (`notifications`, `inbox.tsx`) | Built, currently commitment-reminders only; maps to "Daily Reminders" |
| `cycle_logs` | Built, framed as a fitness sub-feature ("used only to contextualise weight fluctuation") |
| A generic dashboard | Does not exist — `/` redirects straight to `/today`, the fitness home |
| A way to turn a category on/off | Does not exist |

---

## 1. Categories are code, not data

A small TypeScript registry, the same pattern `ITEMS` already uses in
[app-nav.tsx](../../../src/components/app-nav.tsx). A category only exists
once its pages ship, so a database table of category *definitions* would only
be a join for something the code already knows. The only thing that needs
per-user persistence is *enabled state* — see §2.

```ts
type CategoryDefinition = {
  key: string;
  label: string;
  icon: LucideIcon;
  route: string;
  requiresSetup: boolean;
  /** Sub-features have no user_categories row of their own — see §7. */
  parentKey?: string;
};

const CATEGORIES: CategoryDefinition[] = [
  { key: 'money',     label: 'Money',     icon: Wallet,      route: '/money',     requiresSetup: false },
  { key: 'fitness',   label: 'Fitness',   icon: Footprints,  route: '/today',     requiresSetup: true  },
  { key: 'reminders', label: 'Reminders', icon: Bell,        route: '/reminders', requiresSetup: false },
  { key: 'checklist', label: 'Checklist', icon: CheckSquare, route: '/checklist', requiresSetup: false },
  { key: 'cycle',     label: 'Cycle',     icon: Droplet,     route: '/cycle',     requiresSetup: false },
  { key: 'coach',     label: 'Coach',     icon: MessageCircleHeart, route: '/coach', requiresSetup: false, parentKey: 'fitness' },
];
```

`category_key` in the database is **deliberately unconstrained** (no `check`),
following the precedent of `notifications.kind` rather than
`coach_threads.kind` in this schema — the set is expected to grow (see the
roadmap appendix), and a `check` constraint would demand a migration for every
future category the code adds.

## 2. The three states — each with exactly one owner

| State | Source of truth | Owner |
| --- | --- | --- |
| **Exists** | The `CATEGORIES` registry | Developer, shipped in code |
| **Enabled** | `user_categories.enabled = true` | The toggle action (§5), or `saveOnboarding` for Fitness |
| **Configured** | Domain data — `plans.is_active`, a `commitments`/`spends`/`savings` row, etc. | Each category's own actions |

Enabled and configured are not the same thing, even for categories with no
setup step. This separation is what stops `enabled = true` from quietly
standing in for "has data" — a distinction that matters once cross-category
features (the roadmap appendix) start asking "is this category actually
usable," not just "is it turned on."

```sql
create table public.user_categories (
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_key  text not null,
  enabled       boolean not null default false,
  enabled_at    timestamptz,
  disabled_at   timestamptz,
  primary key (user_id, category_key)
);
```

RLS: own-row select/insert/update/delete, the same four-policy shape used for
`session_feedback`/`fitness_assessments`/`skill_unlocks`. Add `user_categories`
to `OWNER_TABLES` in `tests/rls/harness.ts`, per the existing discipline that
the isolation sweep fails the build on a table it doesn't know about.

**The runtime resolver reads only `user_categories`.** It must never fall back
to "or check if `plans` has an active row" as a shortcut for "fitness is
enabled" — that would make `user_categories` a second, sometimes-wrong source
of truth. The one-time backfill (§9) is what populates it for legacy users;
after that, `user_categories` is authoritative, full stop.

## 3. `profiles.onboarding_done_at` changes meaning

Today, `saveOnboarding` stamps this column at the end of the 9-step interview
— it currently means "finished fitness setup." Under this design it means
"finished minimal account signup," so:

- A new, separate minimal-signup action (name only) stamps it.
- `saveOnboarding` **stops touching this column.** It now owns exactly two
  things: writing `plans`, and upserting `user_categories(fitness,
  enabled=true, enabled_at=now())` on success.

Each piece of state keeps exactly one writer:

```
onboarding-name  → profiles.onboarding_done_at
saveOnboarding   → plans + user_categories(fitness)
category toggle  → user_categories(everything else)
```

## 4. Routing split

- `/` redirects to `/dashboard` (new, generic) instead of `/today`.
- `/today` is unchanged — it stays Fitness's own home screen, reachable only
  from within the Fitness category.
- A new nested layout, `(app)/(fitness)/layout.tsx`, wraps `/today`,
  `/activity`, `/food`, `/progress`, `/coach`. One check: fitness enabled →
  render; not enabled → redirect to `/profile`. This replaces the single
  blanket redirect in `(app)/layout.tsx` with one guard per category group,
  and — because it keys off the route group the request is actually in,
  server-side, on every request — it cannot be bypassed by direct URL entry
  or by client-side navigation state.
- `(app)/layout.tsx` keeps only the minimal check: `profiles.onboarding_done_at
  is null` → redirect to `/onboarding-name`.

## 5. Toggle flow

**No-setup category** (Money, Reminders, Checklist, Cycle): one server action,
upserts `user_categories` to `enabled=true`, `revalidatePath('/', 'layout')` —
following the precedent in `account.ts`/`auth.ts` for a change that affects the
whole shell (nav + dashboard), not the narrower single-path calls used
elsewhere for a change scoped to one page.

**Fitness** — the one category where enabling can fail or be abandoned, so the
invariant is explicit:

> Fitness cannot become enabled through the toggle unless an active plan
> already exists, or through a successfully completed `saveOnboarding`.
> Abandoning onboarding must never leave a `user_categories` row that says
> Fitness is enabled.

```
toggle Fitness on
  → active plans row already exists?
      YES → upsert user_categories enabled=true directly
      NO  → redirect to /onboarding (user_categories NOT written yet)
              → saveOnboarding succeeds → plans written, then
                user_categories(fitness, enabled=true, enabled_at=now())
              → onboarding abandoned → no user_categories row is written;
                a later visit to /today redirects to /profile, not back
                into onboarding automatically
```

## 6. Redirect rules

| Situation | Destination |
| --- | --- |
| `profiles.onboarding_done_at is null`, any route | `/onboarding-name` |
| Name done | allowed through |
| A fitness route, Fitness not enabled | `/profile` |
| A fitness route, Fitness enabled but no active plan (should not happen; the guard checks both anyway) | `/onboarding` |
| Any other category's route, that category not enabled | `/profile` |

## 7. Sub-features: a generic algorithm, not special-cased logic

Coach is not a `user_categories` row. Its visibility is computed:

```
no parentKey  → this category's own enabled state
has parentKey → the parent category's enabled state
```

This is written once, generically, so a later `Food ├── Kitchen` or
`Money ├── Investments` costs one registry entry, not new toggle logic. For
this build, Coach is the only entry with a `parentKey`, and its context stays
exactly what it is today — fitness data only. Generalising Coach's context to
other categories is explicitly out of scope here (see appendix).

## 8. Server-side write guards

The route-group layout (§4) blocks the UI path once Fitness is off. The gap it
doesn't close: a page left open in another tab *before* disabling can still
submit its form after. So writes that **create or extend** fitness state carry
an explicit guard:

```ts
await requireCategoryEnabled(userId, 'fitness');
```

Applied to: `logMeasurement`, `logSteps`, `logWater`, `logSleep`, `logFood`,
`updateSession`, `ensureWeekPlanned`, `logSessionFeedback`,
`saveFitnessAssessment`, the step-sync ingest action, and the weekly-review /
`adapt()` action. Eleven call sites, named explicitly here so none of them get
missed during implementation.

**Explicitly exempt:** `updateFoodLog`, `deleteFoodLog`, and `saveOnboarding`
itself (it is the action that *creates* the enabled state — gating it on that
state would be circular). The rule, stated precisely because the exemption
could otherwise look like an oversight:

> Disabled users cannot create new active Fitness state, but they can manage
> or clean up historical Fitness data where explicitly permitted. Disabling a
> category is a visibility/access-state change, not a data-deletion operation.

`pantry.ts` is not wired into any page yet — nothing under `(app)/` imports it
— so there is nothing to gate; noted rather than silently skipped.

## 9. Migration for existing users

A one-time, idempotent backfill — **not** part of the runtime resolver (§2):

```sql
insert into user_categories (user_id, category_key, enabled, enabled_at)
select user_id, 'fitness', true, coalesce(onboarding_done_at, now())
from profiles p
where exists (select 1 from plans where user_id = p.user_id and is_active)
on conflict (user_id, category_key) do nothing;

insert into user_categories (user_id, category_key, enabled, enabled_at)
select distinct user_id, 'money', true, now()
from (
  select user_id from commitments
  union select user_id from spends
  union select user_id from savings_goals
) money_users
on conflict (user_id, category_key) do nothing;

update profiles set onboarding_done_at = now()
where onboarding_done_at is null
  and exists (select 1 from plans where user_id = profiles.user_id and is_active);
```

`do nothing`, never `do update` — if this migration is re-run after launch,
it must not re-enable a category someone has since explicitly turned off. A
migration may establish missing state; it must never override a user's
explicit choice. Effect after running once:

```
Existing user with an active plan   → Fitness enabled
Existing user with money data       → Money enabled
New user, post-launch                → nothing enabled until they choose
```

## 10. Dashboard

One tile per enabled category, each with a live one-line summary ("₹2,340
spent this month", "820 kcal remaining today", "Day 14"). Nothing enabled →
one prompt, "Set up your first category" → Profile. At least one category
enabled → the same destination stays reachable as a quieter "+ Add a
category," never fully hidden.

## 11. Profile screen

A toggle card per top-level category (sub-features like Coach don't appear
here — they have no independent toggle). Turning a category off never touches
its domain data — the invariant that governs §8 applies equally to what the
UI itself may do.

| Category | Setup |
| --- | --- |
| Money | None |
| Fitness | 9-step interview |
| Daily Reminders | None |
| Daily Checklist | None |
| Menstrual Cycle | None |

---

## Appendix: future roadmap, not built here

Recorded so it isn't lost, and so the registry design above (code-defined,
`parentKey` for sub-features, unconstrained `category_key`) is validated
against where this is headed — not because any of it ships in this pass.

**A larger first-level set**, with some of today's categories becoming
parents of their own sub-features rather than flat leaves:; Food (with Kitchen
and Recipes as sub-features), Home, Goals, Learning, Work, Documents. Further
out: Vehicle, Travel, Digital Life, People, Shopping/Wishlist, Sleep/Recovery
— most of these framed as sub-features of a nearer category (Wishlist under
Money; Vehicle/Travel expenses linked to Money) rather than new top-level
entries, to keep the first-level list from growing without bound.

**Cross-category intelligence** — the connective layer the roadmap discussion
called the real differentiator: spend-pattern correlation across Money and
Food, grocery purchases depleting kitchen stock which feeds nutrition
calculation, goal progress computed from linked Money/Habit data, document
expiry dates auto-creating Reminders. None of this is buildable until several
categories exist with real data flowing through them; it is out of scope until
then, and is exactly what the enabled/configured distinction in §2 is laying
groundwork for — a feature can already ask "is Money not just enabled but
actually configured" before it tries to correlate against it.

**Rebranding** away from "FitCoach" — deferred per direct decision earlier in
this design process. Cosmetic, no functional dependency on this build.

---

## Testing

- The visibility algorithm (§7) and any pure registry lookups: unit tests, no
  I/O — same discipline as `src/lib/engines`.
- `requireCategoryEnabled`: tests for the enabled/disabled/missing-row cases,
  and that it is actually wired into all eleven call sites named in §8 — not
  just that the helper itself is correct.
- The Fitness toggle invariant (§5): a test asserting that an abandoned
  onboarding leaves no `user_categories` row, not just that a completed one
  leaves the right one.
- Migration idempotency (§9): running it twice must be a no-op the second
  time, and it must not touch a row where `disabled_at` is already set.
- RLS: `user_categories` added to `tests/rls/isolation.test.ts`'s sweep.

## Order of work

1. `user_categories` migration + RLS + registry module + the visibility
   algorithm (§7), all unit-testable before any UI exists.
2. Minimal signup step (`onboarding-name`) + the `(app)/layout.tsx` gate
   change + `saveOnboarding`'s two column-ownership changes (§3).
3. `(app)/(fitness)/layout.tsx` route-group guard (§4) + the eleven
   `requireCategoryEnabled` call sites (§8).
4. Dashboard + Profile screens (§10, §11) + the toggle actions (§5).
5. The existing-user backfill migration (§9), applied and verified last, once
   everything it backfills *for* actually exists to be tested against.
