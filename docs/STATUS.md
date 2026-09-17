# Build Status

An honest account of what exists, what is partial, and what has not been built.
The brief's rule 98 applies to this document as much as to the UI: nothing is
described as working that has not been run.

Verified by `npm test` (515 passing), `npm run build` (clean), `eslint` and
`tsc` (clean), and against a live Supabase project, not only in sample mode.

As of 2026-09-14, with migrations up to `20260903120018` applied, `npm run
test:rls` passes **60/60** against the live project, and the end-to-end scripts
in `scripts/e2e/` pass: savings 9/9, trends 13/13, kitchen 9/9, import 14/14.
The counts below this paragraph are from earlier revisions.

Live verification performed:

- All 15 migrations applied to a fresh project, first attempt, no manual fixes
- Migrations `20260903120001`–`20260903120007` (video system, progression
  seeding, ladder fixes, level history, avoid-jumping, step segments, verified
  flag in search) applied and committed. `supabase migration list` is the
  authority on what is actually applied.
- The adaptive loop run end to end against a real account: a session rated,
  stored, and the level promoted exactly once — then held across three
  reloads, which is the regression the `fitness_level_set_at` column exists to
  prevent.
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
| Sleep entry (`logSleep`) | **Done** — `SleepEntry` on Today takes hours and quality, so `daily_logs.sleep_minutes` is populated and the adherence engine's sleep component scores from real data |
| Running adaptation on a schedule | **Done** — `/api/cron/review` runs `adapt()` for every active plan, scheduled weekly in `vercel.ts`, behind a `CRON_SECRET` that fails closed. Applying a change writes a new plan *version* and Today announces it, because a target that moves overnight has to say so |

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
| Quick add | **Done** — the foods you log most, replayed in one tap. Ordered by how often each has been logged, and keyed on food *and* portion so 150 g and 250 g of the same thing stay separate choices |
| Editing a logged entry | **Done** — `updateFoodLog` changes the quantity or the meal and recomputes nutrition through the same path the insert uses; the rollup trigger already handled UPDATE, so the day's totals follow |
| Meal times and the unlogged-meal prompt | **Done**, tested — onboarding asks when they usually eat; Today names the one meal not logged yet. Measured in minutes since waking rather than clock time, so a night-shift schedule that crosses midnight works; all three times are optional and derive from `wake_time` when absent |
| Personal portion calibration | **Done**, tested — once someone weighs a household measure, `calibrateServing` resolves it from their own median instead of the shared `food_servings` guess. Derived on read from `food_logs`, so there is no second copy to drift. Confidence rises only when repeated weighings *agree*, so a portion that genuinely varies is not reported as precise |
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
| Video / progression **UI** | **Done** — "Your next step" chooses the session from level, equipment, injuries and today's available time; exercise demonstrations, post-session feedback, and a readiness checklist so "not yet" is legible |
| Device integrations (Health Connect / HealthKit) | **Partial** — Capacitor shell, bridge, step-validity engine, schema and UI are built and tested; **never run on a device**, because there is no Android SDK here. The web path degrades honestly and says step sync needs the Android app |

## Phase 5 — AI

| Item | Status |
| --- | --- |
| Output schemas with no nutrition fields | **Done** |
| System prompts with hard guardrails | **Done** |
| Scale-reading extraction contract | **Done** |
| Photo analysis route: vision → DB match → portion → calc | **Done** — *never executed against a live model* |
| Nutrition confidence reflects data quality, not just portion | **Done** — a weighed portion of an unverified food now reports a range, because the scale measures the mass and not the recipe |
| Photo capture UI with scale instructions | **Done** |
| Coach context builder | **Done** |
| Coach chat endpoint | **Not built** — UI states this plainly |
| Voice logging | **Not built** — schema ready, shown as unavailable |

## Money

| Item | Status |
| --- | --- |
| Spend recording, categories, monthly limit | **Done** — built in a parallel session (`fbe20e9`); amounts are integers in paise, RLS on both tables |
| Food cost surfaced from the meal log | **Done** — `food_logs.cost` had been written on every entry since food logging existed and read nowhere, and the onboarding food budget was only ever displayed back as a static string. The money screen now shows what the month's logged meals are worth |
| Recurring commitments — rent, bills, EMI, subscriptions | **Done** — `commitments` holds the plan; settling one writes an ordinary `spends` row carrying `commitment_id`, so there is one ledger and "is the rent paid" is answered from it. Turns the screen from "what has gone out" into "what is genuinely free" |
| Income and "where did my salary go?" | **Done** — `income_sources` (the plan) and `incomes` (the ledger), so salary history is kept rather than overwritten. Spending is broken down by what it was for — already spoken for, needs, wants, set aside — and the last line is "not accounted for", never "remaining", because without a bank balance money still in the account and money spent but not recorded cannot be told apart |
| Need / want classification | **Done** — defaults only for categories where the answer is not in doubt; clothes, gifts, education and similar stay unclassified until the user says, and the wants figure is reported as a floor until they do |
| Editing and removing a recorded spend | **Done** — inline in the Recent list. Until this shipped a spend could only be added: `deleteSpend` existed but nothing called it. Edits cannot change ownership or the bill a payment settled (rejected by a strict schema, then again by triggers), a bill payment keeps its bill's category, an edit that leaves a bill unpaid says so before it happens, and every change and removal is kept in append-only `spend_revisions` |
| Savings goals | **Done** — `savings_goals` holds the plan (target, optional date, anything saved before starting). Adding money writes an ordinary spend filed as savings with `savings_goal_id`, so there is still one ledger, and it cannot be recategorised or linked to another user's goal. Shows what each month needs to meet the date and — only once there are two full calendar months of history — the actual pace, a likely finish month and the monthly gap. A goal can be edited (name, target, date, amount saved before), and each has a history of money in and out where a mistake can be removed |
| Taking money back out of a goal | **Done, live-verified** — `savings_withdrawals` (migration `20260903120016`), because a withdrawal is neither spending nor income. A goal holds opening + contributions − withdrawals, and the pace is what stayed in. "Where your income went" places withdrawals beside income, so spending funded from savings balances without moving the salary trend or savings rate. The database refuses a withdrawal from another user's goal or for more than the goal holds, locking the goal while it checks. Migration applied 2026-09-14; isolation tests pass, and `scripts/e2e/savings.mjs` passes 9/9 including taking money out |
| Savings and the monthly amount | **Decided 2026-09-13** — money filed as savings does **not** count as spending against the monthly amount. The ring is "Spent" and the amount is "what you plan to spend", so a deposit reading as "₹2,500 spent" contradicted both. Set-aside money is shown beside the spending instead. A savings commitment (a SIP) stays in what is owed but not in what is free, or paying it would hand the money back. The rule lives in one function, `countsAsSpending` in `src/lib/engines/money.ts` |
| Trends over time | **Done, live-verified** — `/money/trends`. This month against the *same point* of last month; what moved between the last two full months and which categories moved it; a usual month; savings rate; whether money with no recorded destination is shrinking; whether wants take a larger share; fixed costs against usual income; subscriptions at their yearly cost. Only full, fully-recorded months are compared — the current month and a month recording began partway through are shown and never compared. Month-by-month stacked columns in the same colours as "where your income went", with a readout on hover, focus or tap and a table view; series palette run through the colour validator in both themes. Reads existing tables only, paged past PostgREST's 1,000-row limit. Verified end to end with a throwaway account: 13/13 (`scripts/e2e/trends.mjs`), light, dark and phone |
| Statement import (CSV) | **Done, live-verified** — `/money/import`, migration `20260903120018`. The agreed pipeline, unshortened: the file is read on the device; the header is found beneath a bank's preamble; dates, amounts and direction are normalised (HDFC-, SBI- and ICICI-style exports, Dr/Cr columns, signed single amounts); every line is stored as read, unreadable ones with a reason; duplicates are found within the file and against spends already recorded a day either side; merchants are recognised from UPI/POS/NEFT/ATM narrations; categories are suggested from rules the person taught it, then a short list of unambiguous merchants — Amazon, cash and payments to a person get no guess, and no model classifies anything. Nothing is recorded until the person confirms, and confirmed lines go through `insertSpends`, the same insert "Add a spend" uses. Corrections are remembered per merchant. **Not built:** a transfer to savings becoming a goal contribution, a grocery shop adding kitchen stock. Migration applied 2026-09-14; `scripts/e2e/import.mjs` passes 14/14 on an HDFC-style statement — mapping, duplicates against a typed spend and within the file, confirmation, a learned merchant, and a second import of the same file finding everything already recorded |

Two rules the food estimate is built on, both worth keeping:

- **It is never added to the spend total.** Someone who logs their meals *and*
  records a grocery shop has described the same money twice; summing them
  would inflate their spending and then, since the screen compares against a
  monthly limit, report an overspend that did not happen.
- **It will not compare against the budget off a partial log.** `cost` comes
  from a seeded price table with no provenance, and the estimate can only see
  food that was entered. With 30% of a day's energy logged, "₹133 a day under
  budget" is arithmetically right and substantively false — confidently wrong
  in the direction that tells someone to spend more. Below two thirds
  coverage the comparison is withheld and the reason given.

## Kitchen

| Item | Status |
| --- | --- |
| Kitchen stock | **Done, live-verified** — `/food/kitchen`, migration `20260903120017`. `pantry_items` is what is kept and `pantry_movements` is what happened to it (bought, used, thrown out, counted); on hand is their sum, and a count stores the difference it made. The unused `grocery_items` list tables were left alone: a shopping list is not a running balance. Buying can record its cost as a groceries spend, taken back out if the stock write fails. "About N days left" needs three uses across at least a week in the last four weeks; what was thrown out is not use. A short to-buy list shows only what can honestly be called low. Migration applied 2026-09-14; `scripts/e2e/kitchen.mjs` passes 9/9, including a purchase cost reaching the money screen |
| Food log → stock | **Done, live-verified** — only foods logged *as themselves* (eggs, milk, curd) are offered, and only when the person confirms they came from home: `food_logs` does not record where a meal was eaten, and food eaten out must never empty the kitchen. A log is taken from stock once, only against the item for that same food; editing or removing the log releases it. **Not built:** mixed dishes depleting ingredients, which needs `recipe_id` on logs and seeded recipes |

## Phase 6–8 — Adherence, advanced, production

Schema exists for habits, reviews, notifications, feedback, grocery lists,
budgets and evidence claims. The **engines** for adherence, recovery and reviews
are built and tested. The **UI and scheduling** for notifications, weekly
reviews, grocery-list generation, travel mode and restaurant mode are **not
built**. Kitchen stock, which the grocery tables were once expected to carry,
is its own ledger — see Kitchen above.

---

## Two things that need attention before this is used by anyone

**1. Seed nutrition data is unverified.** The ~50 food rows carry widely-published
approximate values, marked `source = 'seed_approximate'`, `is_verified = false`,
`data_confidence = 'medium'`. They are good enough to develop against and not
good enough to ship. Each needs reconciling against IFCT 2017 (NIN/ICMR) or USDA
FoodData Central.

The provenance columns existed specifically so unverified data could not
masquerade as verified — and until recently nothing read them. `is_verified`
was written by the seed and referenced nowhere in the application, so weighing
an unverified food produced a confident single figure and a "Weighed" badge.
That is now fixed: the estimate widens to a range and drops to medium
confidence whenever the composition data is unverified, which is currently
every food in the database. Verifying a food therefore has a visible effect,
which is the incentive that was missing. Mixed dishes — sambar, chicken curry, biryani —
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

1. **Curate the video library.** `videos` is empty and `review_status` defaults
   to `pending`, so `video-recommendation.ts` has nothing approved to return.
   The engine, the metadata and the review gate are all built; only the content
   is missing. This needs a person to review real videos — it is deliberately
   not something to generate, since the whole point of the review gate is that
   a human has actually watched the thing.
2. **Run the native shell on a device.** The Capacitor config, the Health
   Connect bridge and the step-validity engine are written and typechecked
   against the plugin's real definitions, but no Android SDK exists in this
   environment, so none of it has executed. `npx cap add android`, a Health
   Connect permissions block in the manifest, and a real phone.
3. Verify the seed nutrition data.
5. Coach chat endpoint.
6. Test the photo pipeline against real scale photographs.
7. Deprecate `workout_plans.rpe`. `session_feedback.difficulty` is now the
   source of truth for how hard a session was, and `rpe` cannot distinguish
   "hard" from "hurts". It is unwritten but still present, so a future
   contributor may reasonably assume it is the column to use.

A note on a whole class of bug found since. The onboarding wizard was asking
six questions — the four fitness-assessment ones, "do you need to avoid
jumping?", and shift start/end times — whose answers the save schema did not
accept, so Zod stripped them silently. Nothing failed and nothing was logged;
every user was assessed from nothing and landed on the default level while the
interface implied otherwise. `tests/onboarding-schema.test.ts` now asserts that
every field the wizard asks about has somewhere to land, and it found the shift
times on its first run. Worth remembering that the most durable defects here
have been silent ones, not crashes.

Three items have left this list. Workout completion and difficulty capture
both shipped. Sleep entry was listed as having no UI long after `SleepEntry`
was rendering on Today and calling `logSleep` — and "run the whole loop
against a live project" sat at number one while the verification list at the
top of this file described that exact run. Both had been wrong for a while,
which is worth noting in a document whose only job is to be accurate: a stale
next-steps list sends people to build things that already exist.

Two items used to head this list and no longer do. Workout completion: the week
grid persists, so `workout_adherence` is computed from real rows. Difficulty
capture: `session_feedback` is written by the post-session panel.
