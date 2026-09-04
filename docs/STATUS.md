# Build Status

An honest account of what exists, what is partial, and what has not been built.
The brief's rule 98 applies to this document as much as to the UI: nothing is
described as working that has not been run.

Verified by `npm test` (191 passing), `npm run test:rls` (19 passing against a
live project), `npm run build` (clean), `eslint` (clean),
and — as of this revision — **against a live Supabase project and a production
Vercel deployment**, not only in sample mode.

Live verification performed:

- All 15 migrations applied to a fresh project, first attempt, no manual fixes
- Migrations `20260903120001`–`20260903120004` (video system, progression
  seeding, ladder fixes, level history) applied and committed. `supabase
  migration list` is the authority on what is actually applied.
- 51 foods, 71 aliases, 34 serving units, 12 exercises, 4 workouts, 6 lessons seeded
- Alias search exercised against the real RPC: thosai/dosai/idly/sambhar/thayir/
  "meal maker" all resolve correctly; gibberish returns nothing
- **Cross-user RLS proven with two real accounts and now automated**: see
  `tests/rls/isolation.test.ts` — 19 tests walking every user-owned table
- Anonymous key returns empty on every user table
- `handle_new_user()` bootstraps profile/lifestyle/food_profile on signup
- Rollup triggers verified: food, steps, water and sleep all land in `daily_logs`,
  and deleting an entry correctly reduces the totals
- Full write path run end to end: onboarding to stored plan, food logging by
  grams and by household measure, weight, steps, water, sleep, week generation,
  session completion
- Account deletion cascades all 14 user tables, leaving reference data intact
- Production deployment gated correctly; API routes return JSON status codes

---

## Phase 1 — Foundation

| Item | Status |
| --- | --- |
| Next.js 16 / React 19 / TypeScript / Tailwind v4 | **Done** |
| Full Postgres schema, 9 ordered migrations, 38 tables | **Done** |
| RLS on every user-owned table + storage policies | **Done** |
| Supabase client / server / admin factories | **Done** |
| Auth middleware with `getUser()` validation | **Done** |
| Onboarding interview — 8 steps, conditional, resumable | **Done** |
| Login / signup, email confirmation callback | **Done** |
| Writing onboarding answers to Supabase | **Done** — `saveOnboarding` derives the plan server-side |

## Phase 2 — Core fat-loss engine

| Item | Status |
| --- | --- |
| BMR (Mifflin–St Jeor + Katch–McArdle gating) | **Done**, tested |
| Activity level derived from lifestyle answers | **Done**, tested |
| Energy target with four safety floors | **Done**, tested |
| Macro targets with reference-weight protein dosing | **Done**, tested |
| Safety screening → capability restrictions | **Done**, tested |
| Unrealistic-timeline handling | **Done**, tested |
| Weight trend: EWMA + OLS fit + confidence interval | **Done**, tested |
| "Why did my weight change?" explainer | **Done**, tested |
| Adaptive adjustment with gates and caps | **Done**, tested |
| Plateau detection with ranked causes | **Done**, tested |
| Step goal baseline and progression | **Done**, tested |
| Adherence scoring and recovery plans | **Done**, tested |
| Persisting the generated plan | **Done** — `plans` row written on setup |
| Weight and waist entry (`logMeasurement`) | **Done** — one row per day, upserted |
| Step entry (`logSteps`) | **Done** — source recorded, device beats manual |
| Water entry (`logWater`) | **Done** — one tap per glass, optimistic with rollback |
| Sleep entry (`logSleep`) | **Action written, no UI yet** |
| Running adaptation on a schedule | **Not built** |

## Phase 3 — Food

| Item | Status |
| --- | --- |
| Food schema with raw/cooked separation and provenance | **Done** |
| Alias- and typo-tolerant `search_foods()` RPC | **Done** (SQL written; needs a live DB to exercise) |
| Food search API + fuzzy matching | **Done**, 25 tests — verified against a running server |
| Search UI with grams / household-measure portion picker | **Done** |
| Writing a `food_logs` row (`logFood`) | **Done** — server recomputes nutrition from the food id |
| Deleting a log entry | **Done** |
| Dashboard reads the signed-in user's real day | **Done** — `getDayView()` |
| Household serving units → grams | **Done** (schema + seed) |
| Portion resolution engine, scale-first | **Done**, tested |
| Nutrition calculation with ranges | **Done**, tested |
| ~50 Indian foods, 70 aliases, 34 serving units, 17 substitutions | **Done** — *unverified values, see below* |
| Daily rollup triggers | **Done** (SQL) |
| Recipes schema + nutrition derivation | **Done** (SQL); **no recipe seed data yet** |
| Quick add | **Not built** — button present and correctly disabled |
| Editing a logged entry | **Not built** |
| Barcode scanning | **Not built** — shown as unavailable |

## Phase 4 — Activity

| Item | Status |
| --- | --- |
| Exercise library with instructions, mistakes, easier variants | **Done** (12 exercises seeded) |
| Workout templates | **Done** (4 seeded) |
| Weekly plan + missed-session recovery UI | **Done** — `ensureWeekPlanned()` writes the week on first visit and is idempotent; `updateSession` persists completed / partial / skipped / moved, and a moved session is re-created on its new date rather than left as a dead "moved" row |
| Perceived difficulty and pain capture | **Done** — `SessionFeedback` asks difficulty and pain separately, because hard is often correct while pain never is; `logSessionFeedback` writes `session_feedback`, which is the only signal the progression engine reads |
| Video / progression engines | **Done**, tested — `progression.ts` and `video-recommendation.ts`. The library itself is empty: `videos` has no approved rows, so nothing is recommendable yet |
| MET-based expenditure, net of resting | **Done**, tested |
| Device integrations (Apple Health / Health Connect) | **Not built** — manual entry only, honestly labelled |

## Phase 5 — AI

| Item | Status |
| --- | --- |
| Output schemas with no nutrition fields | **Done** |
| System prompts with hard guardrails | **Done** |
| Scale-reading extraction contract | **Done** |
| Photo analysis route: vision → DB match → portion → calc | **Done** — *never executed against a live model* |
| Photo capture UI with scale instructions | **Done** |
| Coach context builder | **Done** |
| Coach chat endpoint | **Not built** — UI states this plainly |
| Voice logging | **Not built** — schema ready, shown as unavailable |

## Phase 6–8 — Adherence, advanced, production

Schema exists for habits, reviews, notifications, feedback, grocery lists,
budgets and evidence claims. The **engines** for adherence, recovery and reviews
are built and tested. The **UI and scheduling** for notifications, weekly
reviews, grocery generation, travel mode and restaurant mode are **not built**.

---

## Two things that need attention before this is used by anyone

**1. Seed nutrition data is unverified.** The ~50 food rows carry widely-published
approximate values, marked `source = 'seed_approximate'`, `is_verified = false`,
`data_confidence = 'medium'`. They are good enough to develop against and not
good enough to ship. Each needs reconciling against IFCT 2017 (NIN/ICMR) or USDA
FoodData Central. The provenance columns exist specifically so unverified data
cannot masquerade as verified. Mixed dishes — sambar, chicken curry, biryani —
vary enormously by household, mostly through oil, and are marked `low`
confidence for that reason.

**2. Four bugs were found only by running it live**, all now fixed and each with
a migration or commit of its own:

- `search_foods()` returned duplicate rows when a food matched several of its own
  aliases — "thosai" returned Dosa twice
- pg_trgm's default 0.3 threshold matched unrelated foods ("chawal" returned tea
  via the "chai" alias); raised to 0.55 to match the tested TypeScript behaviour
- **Account deletion was broken.** Deleting a user cascaded to `food_logs`, whose
  AFTER DELETE trigger tried to re-insert a `daily_logs` row for a user that no
  longer existed (23503). Any user who had ever logged anything could not be
  deleted — a privacy obligation, silently failing
- A user signing up mid-week was shown every earlier day of that week marked
  "missed", greeting new users with a wall of failure they had no chance to avoid

**3. The photo pipeline has not been run end to end.** The code path is complete
and typechecks, but no AI provider was configured in this environment, so it has
never made a real call. The scale-reading extraction in particular needs
testing against actual photographs of actual scales — glare, angle, and
seven-segment displays are exactly the conditions where a vision model will
confidently misread a digit, which is the failure the whole design is built to
avoid. Treat the `displayReadable` discipline as unproven until measured.

## Suggested next order of work

1. **Run the whole loop against a live Supabase project.** Sign up, complete
   setup, log a food, see it on the dashboard. Every piece of that path is
   written and typechecks, but it has only been exercised in sample mode — no
   Supabase project was available in this environment. Until someone runs it,
   treat the write paths as unproven.
2. **Sleep entry UI.** `logSleep` exists but nothing calls it, so
   `daily_logs.sleep_minutes` stays null and the adherence engine's sleep
   component always scores zero for real users.
3. **Curate the video library.** `videos` is empty and `review_status` defaults
   to `pending`, so `video-recommendation.ts` has nothing approved to return.
   The engine, the metadata and the review gate are all built; only the content
   is missing.
4. **Scheduled adaptation.** The adapt engine is built and tested but nothing
   runs it weekly, so intake and step targets never actually change.
   `progression.ts` owns the training lever separately, and does run.
5. Verify the seed nutrition data.
6. Coach chat endpoint.
7. Test the photo pipeline against real scale photographs.
8. Deprecate `workout_plans.rpe`. `session_feedback.difficulty` is now the
   source of truth for how hard a session was, and `rpe` cannot distinguish
   "hard" from "hurts". It is unwritten but still present, so a future
   contributor may reasonably assume it is the column to use.

Two items used to head this list and no longer do. Workout completion: the week
grid persists, so `workout_adherence` is computed from real rows. Difficulty
capture: `session_feedback` is written by the post-session panel.
