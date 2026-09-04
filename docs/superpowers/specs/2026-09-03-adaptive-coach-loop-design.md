# Design: Closing the adaptive coach loop

**Date:** 2026-09-03
**Status:** Approved for implementation
**Scope:** Phases 0–2 in depth. The video and progression schema landing
alongside this work is treated as existing context, not respecified.

---

## Why this document exists

FitCoach has ten tested calculation engines and a schema of more than forty
tables. Its problem is not a shortage of intelligence. Its problem is that the
intelligence is not connected to anything:

- `adapt()` — the adaptive-adjustment engine the product premise rests on — is
  built, tested, and **called from zero files**. Plans never change.
- The Coach screen ships six prompt chips describing the product's signature
  interactions. **None of them do anything**, because the endpoint behind them
  does not exist.
- `session_feedback` — the table the whole progression loop is designed around —
  **has no UI writing to it**, so the difficulty signal every training feature
  depends on is never recorded.

So this phase adds almost no new capability. It wires up what is already built,
and adds the one missing input without which the rest cannot work. That is
deliberate: the fastest route to a genuinely adaptive product is not another
feature, it is making the existing ones reachable.

## Schema this design assumes but does not specify

Two migrations landing alongside this work are treated here as given:

- `20260903120001_video_system.sql` — `videos` (review-gated, with provenance),
  `video_exercises`, `session_feedback`, `fitness_assessments`, `skill_unlocks`,
  `profiles.fitness_level`, and new `exercises` columns: `level`,
  `movement_pattern`, `impact_level`, `space_required`, `apartment_friendly`.
- `20260903120002_seed_progressions.sql` — levels the existing exercise library
  and extends the difficulty chains so there is somewhere to progress *to*.

**Both must be applied and verified against a live project before Phase 0 UI
work begins**, because Phase 0 writes to `session_feedback`.

### The two `level` scales are not the same scale

An implementation trap worth stating plainly, because it will otherwise be
found the hard way:

| Column | Range | Meaning |
| --- | --- | --- |
| `profiles.fitness_level` | **1–4** | the person; derived from `fitness_assessments`, never asked directly |
| `videos.level_min` / `level_max` | **1–4** | the person this video suits — same scale as above |
| `exercises.level` | **1–5** | the movement's position on its own progression chain |

A user at `fitness_level` 2 is not restricted to `exercises.level` 2. The
exercise scale is per-chain and finer-grained. Do not join them or compare them
directly.

## What remains genuinely blocked

| Feature | Blocker |
| --- | --- |
| ₹ budget meal planning | `food_prices` has a table, three indexes, RLS — and **zero rows**. Indian food pricing is regional and volatile; populating it is a data-acquisition project. |
| Video playback | `videos` now has a full schema, provenance model and review gate — and **zero approved rows**. `review_status` defaults to `pending`, and unreviewed rows are inert by design. |

Both are handled the same way, and it is the way this repo already handles
unconfigured capability: **the feature says it is unavailable**. It does not
show a plausible placeholder. `src/lib/config.ts` states the rule directly —
"never show a plausible-looking number the user cannot distinguish from their
own data" — and `<Unavailable>` in `src/components/ui.tsx` is the component for
saying so.

The video decision, taken 2026-09-03: **illustrated demonstrations first**,
using the already-seeded `exercises.instructions` and
`exercises.common_mistakes` JSONB. `20260903120002_seed_progressions.sql`
already commits to this in its header — *"No video URLs are seeded. There is no
curated footage yet, and inventing links would be exactly the failure this
schema's review_status exists to prevent."* Recommendation logic is identical
whether the media is a still or a video, so adding footage later is a
media-layer change, not an architectural one.

---

## Phase 0 — Unblock

Small, and first, because everything downstream starves without it.

### 0.1 Apply and verify the two migrations

Against a live project, not only in sample mode. `session_feedback` must exist
before anything can write to it, and RLS on the three new user-owned tables
(`fitness_assessments`, `session_feedback`, `skill_unlocks`) should be added to
the `tests/rls/isolation.test.ts` sweep, which currently walks every other
user-owned table.

### 0.2 Capture perceived difficulty

**`session_feedback` is the single source of truth for how hard a session was.**

`workout_plans.rpe` exists and `updateSession` already persists it, but it is
**not** to be written by this work. Two columns recording the same signal will
drift, and `rpe` cannot express the distinction that matters most — the
migration puts it well: *"Pain is kept separate from difficulty on purpose.
'Hard' is progress; 'hurts' is a stop signal, and collapsing them loses the
distinction."* Add a comment marking `workout_plans.rpe` deprecated in favour
of `session_feedback.difficulty`.

**Four buttons on session completion**, not a 1–5 slider:

| Button | `session_feedback.difficulty` |
| --- | --- |
| Easy | 2 |
| About right | 3 |
| Hard | 4 |
| Too hard to finish | 5 |

**The top of the scale must be reachable, and this is not a cosmetic choice.**
`decideProgression()` in `src/lib/engines/progression.ts` regresses a level only
on two consecutive ratings of 5. A three-button design capping at 4 would leave
that branch permanently dead — the engine would be able to promote a user and
never demote one, which is the failure mode that matters most for someone who
has been over-levelled.

Value 1 ("easy") stays unreachable. Four post-session buttons is already at the
limit of what someone will answer honestly, and the distinction between "easy"
and "very easy" changes no decision: `checkReadiness()` gates progression on an
average at or below 3, which "Easy" at 2 already clears.

**Pain is a second, separate control**, defaulting to `none`. It is not a
difficulty value and must never be folded into one.

Both are **optional**. A user who completes a session and dismisses the
question has completed the session; the adaptation engine treats missing
feedback as missing evidence, not as a middle value.

### 0.3 Fix a user-facing rendering bug

`src/components/week-plan.tsx:66` reads:

```tsx
<Section title="You missed {missed.dayName}">
```

That is a plain string attribute, not JSX interpolation. Users are reading the
literal text `You missed {missed.dayName}` — on the missed-session panel, which
is the single screen this product's philosophy cares most about. Fix to a
template literal.

### 0.4 Correct `docs/STATUS.md`

STATUS.md claims the Activity week grid is "fixed content and nothing is
persisted." That is no longer true: `ensureWeekPlanned()` writes `workout_plans`
rows on page load, `updateSession` persists completion, skip, move and partial,
and `getWeekView()` reads them back. Leaving this wrong actively misleads the
next contributor — and STATUS.md's own stated rule is that nothing is described
inaccurately.

---

## Phase 1 — The coach endpoint

### What already exists

More than STATUS.md suggests. Missing pieces are marked.

| Piece | Location | State |
| --- | --- | --- |
| System prompt | `prompts.ts:53` `COACH_SYSTEM` | Written |
| Grounding block builder | `prompts.ts:153` `buildCoachContext()` | Written |
| Context type | `prompts.ts` `CoachContext` | Written |
| Output schema | `schemas.ts` `coachReplySchema` | Written |
| Model routing | `config.ts` `MODELS.coach` | Written |
| **HTTP route** | `src/app/api/coach/` | **Missing** |
| **Intent handlers** | `src/lib/coach/` | **Missing** |
| **Client UI** | `src/app/(app)/coach/page.tsx` | Chips render; nothing is wired |

`buildCoachContext()` needs sixteen fields. `getDayView()` already returns
fourteen of them directly or derivably — targets, floor, consumed, remaining,
steps, constraints, trend, timezone, display name. Only `activeSafetyNotes` and
`goal` need an additional read. **The context builder is nearly free.**

### The architectural decision

**The model classifies and extracts. It does not compute, and it does not
render numbers.**

```
user message
     ↓
model: classify intent + extract parameters      ← no numbers in this schema
     ↓
pure handler in src/lib/coach/  ← runs engines over real DayView / WeekView
     ↓
typed CoachAnswer (discriminated union)
     ↓
React renders the card from the struct
     ↓
model writes one sentence of framing into coachReplySchema.reply
```

**The rejected alternative was AI SDK tool-calling with free narration.** The
model would call the engines correctly and then restate their numbers in prose,
where nothing clamps them. That is precisely the failure mode the
no-nutrition-fields output schema was built to make structurally impossible —
see the header of `src/lib/ai/schemas.ts`. Reintroducing it through the coach
would undo the product's central guarantee. Tool-calling is acceptable **only**
on the `fallback` intent, under the existing `COACH_SYSTEM` rule that the model
may never state a figure it was not given.

### The intents

Each is a **pure function** in `src/lib/coach/`, taking already-fetched view
data and returning a `CoachAnswer` variant. No I/O, no clock, no network — the
same discipline as `src/lib/engines/`, and unit-tested the same way.

| Intent | Chip | Backed by | Ships |
| --- | --- | --- | --- |
| `what_to_eat_now` | "What should I eat now?" | remaining macros + food search; three options — cheapest, quickest, best fit, per `COACH_SYSTEM` | Yes |
| `swap_ingredient` | "I have no eggs" | `ingredient_substitutions`, 17 rows seeded | Yes |
| `time_boxed_workout` | "I only have 15 minutes" | `workouts` filtered by minutes, equipment, safety restrictions | Yes |
| `missed_workout` | "I skipped my workout" | `recoveryPlan()`, `adherence.ts:150` | Yes |
| `can_i_eat_x` | "Can I eat biryani tonight?" | remaining kcal + food lookup | Yes |
| `budget_meal` | "I only have ₹80 for dinner" | `food_prices` — **no data** | **No — `<Unavailable>`** |
| `fallback` | free text | `COACH_SYSTEM`, no figures permitted | Yes |

`time_boxed_workout` must filter on the new `exercises` columns where they
apply — `impact_level` and `apartment_friendly` in particular. A fifteen-minute
suggestion involving jumping, given to someone on a first-floor flat with a
knee complaint, is the exact failure that metadata was added to prevent.

`can_i_eat_x` is **always yes**, followed by the portion and what it leaves for
the day. Never a refusal, never "bad food" framing. This is already mandated by
`COACH_SYSTEM` and is restated here because it is the intent most likely to be
implemented wrongly.

### Safety interception

`coachReplySchema.safetyConcern` already enumerates `disordered_eating`,
`extreme_restriction`, `medical` and `self_harm`.

When the model sets a concern, **the server discards the model's reply and
answers from `src/lib/engines/safety.ts`**. The model flags; it does not
counsel. A generated response to a disclosure of purging is the highest-stakes
text this product can emit, and it must not be improvised per-turn.

### Degradation

`aiConfigured` is false in most development environments and in sample mode.
The Coach page already renders `<Unavailable>` in that case and must continue
to. Manual logging keeps working. No chip may render a plausible answer from
sample data.

---

## Phase 2 — Run the two engines that already exist

### Correction to an earlier draft of this spec

An earlier version of this section specified adding `increase_training_load`
and `reduce_training_load` decisions to `adapt()`. **That work is already done,
in a different and better place.** `src/lib/engines/progression.ts` — landing
alongside this spec, tested, green — exports `checkReadiness()` and
`decideProgression()`, consuming exactly the columns Phase 0 writes:

```ts
interface ProgressionSignals {
  sessionsAtLevel: number;
  recentDifficulty: number[];                            // session_feedback.difficulty
  recentPain: ('none' | 'mild_discomfort' | 'pain')[];   // session_feedback.pain
  consistency: number;
  daysAtLevel: number;
  restrictions?: string[];
}
```

Duplicating that logic inside `adapt()` would leave two engines deciding
training load from the same table with different thresholds. **`adapt()` keeps
energy and steps. `progression.ts` owns training.** Neither is extended.

### What Phase 2 actually builds

An orchestrator, not an engine. `/api/cron/adapt`, weekly, via Vercel Cron:

1. Read the window's weigh-ins, logging completeness, step and workout
   adherence, and `session_feedback` rows.
2. Call `adapt()` for the energy and step decision.
3. Call `decideProgression()` for the training decision.
4. Apply **at most one** of the two, by the precedence below.
5. Write a new `plans` version if anything changed; otherwise write nothing.

### Precedence between the two engines

`adapt()` already enforces one lever per run internally. The orchestrator must
enforce the same discipline *between* the engines, because a user told in one
week that their calories are dropping **and** their workouts are getting harder
has been handed two variables to fail at and no way to attribute the result.

The order is fixed:

1. **`hasReferralFlag`** — nothing runs. Existing `adapt()` behaviour.
2. **`decideProgression()` returns `hold_for_pain` or `regress`** — apply it,
   and hold the energy lever until the next window. Someone reporting pain
   while completing every session is exactly who a consistency-driven system
   would otherwise reward with more load; a calorie cut in the same week
   compounds it.
3. **Otherwise `adapt()`'s decision**, when it is not `hold`.
4. **Otherwise `decideProgression()`'s `progress`**, if any.

Progression sits last among the non-pain branches deliberately. Adding
difficulty is the most reversible of these changes and the least urgent.

### Thresholds belong to the engines, not to this document

`progression.ts` sets `MIN_SESSIONS_BEFORE_PROGRESSING = 4` and
`MIN_DAYS_AT_LEVEL = 10`, and gates progression on a recent difficulty average
at or below 3. `adapt()` sets `MIN_DAYS_BETWEEN_CHANGES = 14`,
`MIN_WEIGH_INS = 10` and `MAX_ADJUSTMENT_FRACTION = 0.08`. **The orchestrator
imposes no thresholds of its own** and must not re-derive or override them.
They are tested where they live.

The two cadences differ on purpose: training can move on ten days of evidence,
energy needs fourteen days and ten weigh-ins, because bodyweight is the noisier
signal. A weekly orchestrator changes neither — each engine declines on its own
terms when asked too early.

### Progression is an addressable chain

`20260903120001` settled this better than a global ladder would have.
`exercises.level` (1–5) plus `movement_pattern`, alongside the pre-existing
`easier_variant` / `harder_variant` pointers, means a session can be built by
asking for "the level-3 horizontal push" directly instead of walking pointers
one at a time — while keeping progression **per movement pattern**.

`profiles.fitness_level` (1–4) is what `decideProgression()` moves. The
exercise chain is what a session is built from. They are different scales; see
the table near the top of this document.

### Scheduling

`/api/cron/adapt`, weekly, via Vercel Cron.

**No new history table is required.** `public.plans` is already versioned:
`version`, `is_active`, and a partial unique index `plans_one_active_idx` on
`(user_id) where is_active`. An adaptation writes a new plan row and deactivates
the previous one; `daysSinceLastChange` is derived from the active row's
`created_at`. The schema anticipated this.

**No migration is required either.** An earlier draft proposed
`plans.session_minutes` to persist a duration adjustment. It has no consumer:
`decideProgression()` moves `profiles.fitness_level`, not session length, and
session length already has a home in `lifestyle.session_minutes_available`,
which `buildWeek()` reads. Adding a third place to record the same thing would
be exactly the drift Phase 0 refuses for `rpe`.

The cron must be idempotent per user per week: a retry after a partial failure
must not write a second plan version, and must not be able to stack two
adjustments inside one cooldown window.

---

## Testing

`src/lib/coach/` and the `adapt()` training lever are pure functions and are
tested as the existing 143 engine tests are — no database, no network, no
`Date.now()`. That purity is what makes the caps and gates verifiable, and it
is the reason the numbers in this product can be trusted.

Required coverage:

- Each intent handler: a correct answer, and a graceful answer when its backing
  data is absent.
- `budget_meal` returns unavailable rather than an invented price.
- `time_boxed_workout` excludes high-impact and non-apartment-friendly work
  when the user's context rules it out.
- Safety interception replaces the model's reply, and is not merely appended.
- Orchestrator precedence: each of the four branches selected in isolation,
  and the case where `adapt()` and `decideProgression()` both want to act —
  exactly one change is applied.
- **Pain precedence end to end: a window with full adherence and one pain
  report must apply the progression hold and leave the energy target
  untouched.** This is the test most worth writing first, because every other
  signal in that scenario argues for a change.
- Round trip from the Phase 0 buttons: four "Too hard to finish" ratings must
  reach `decideProgression()` as two consecutive 5s and produce `regress`.
  This is what proves the button mapping and the engine agree.
- Cron idempotency: a second run inside the cooldown changes nothing.
- RLS isolation extended to `fitness_assessments`, `session_feedback` and
  `skill_unlocks`.

## Honest status of what this design assumes

Consistent with STATUS.md's rule that nothing is claimed to work that has not
been run:

- **The photo pipeline has still never called a live model.** Nothing here
  changes that, and Phase 1 must not be read as evidence the AI layer is proven
  end to end.
- **Seed nutrition values remain unverified** (`is_verified = false`). The
  coach will quote them. They are good enough to develop against and not good
  enough to ship, and the coach makes them far more visible than a search
  result does.
- **`food_prices` is empty**, so budget answers are out of scope.
- **`videos` is empty**, and its review gate means it stays inert until someone
  curates and approves rows.
- **The two new migrations have not been applied to a live project**, so their
  RLS policies and the `do $$ ... $$` policy loop are unproven. Phase 0.1
  exists to close that.

## Order of work

1. Phase 0 — apply and verify the migrations, difficulty and pain capture
   writing `session_feedback`, the `week-plan.tsx:66` fix, STATUS.md correction.
2. Phase 1 — intent handlers, `/api/coach`, client wiring, five live chips and
   one honest `<Unavailable>`.
3. Phase 2 — the `/api/cron/adapt` orchestrator over the existing `adapt()`
   and `decideProgression()`. No engine changes, no migration.

Video recommendation and the fitness assessment are re-planned after Phase 2 is
running, against real adaptation data and a curated library that does not yet
exist.
