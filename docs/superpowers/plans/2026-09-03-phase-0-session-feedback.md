# Phase 0: Session Feedback Capture — Implementation Plan

> **SUPERSEDED IN PART — read this before executing anything below.**
>
> Tasks 1–4 were implemented concurrently by parallel work while this plan was
> being written. **Do not execute Tasks 2, 3 or 4.** Running them would create
> a second `logSessionFeedback`, duplicate the difficulty and pain constants,
> and claim migration numbers that are already taken.
>
> | Task | Where it actually landed |
> | --- | --- |
> | 1 — migrations | Applied through `20260903120004`; confirm with `supabase migration list` |
> | 1 — RLS coverage | **Done** in commit `64103ef`, including a `pain_location` leak test |
> | 2 — mapping constants | `DIFFICULTY` / `PAIN` in `src/components/session-feedback.tsx` |
> | 3 — server action | `logSessionFeedback` in `src/lib/actions/session.ts` |
> | 4 — feedback panel | `SessionFeedback` in `src/components/session-feedback.tsx` |
> | 5 — STATUS.md | **Done** in commit `3383ca5` |
>
> The delivered implementation uses the **full 1–5 difficulty scale**, not the
> 2/3/4 mapping specified below. That is the better choice and the plan is
> wrong here: a rating of 5 reaches `decideProgression()`, so the regression
> branch is live rather than unreachable.
>
> **One item remains unbuilt:** the `comment on column` migration deprecating
> `workout_plans.rpe` in favour of `session_feedback.difficulty`. It was left
> alone because the migration sequence was being extended concurrently and the
> next free number kept being taken. Take the next free number and write it.
>
> The design reasoning below is kept for context. The task steps are history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record how hard each session felt, and whether it hurt, into
`session_feedback` — the input `decideProgression()` already consumes but that
nothing currently writes.

**Architecture:** A pure mapping module converts UI choices into
`session_feedback` rows and converts those rows back into the
`ProgressionSignals` shape `src/lib/engines/progression.ts` expects. A server
action persists. The week-plan component gains a two-question panel after a
session is marked done. No engine is modified.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase
(`@supabase/ssr`), Zod v4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-03-adaptive-coach-loop-design.md`

## Global Constraints

- **`session_feedback` is the single source of truth for session difficulty.**
  Do not write `workout_plans.rpe`. It is deprecated by this work.
- **Difficulty and pain are separate fields.** Never fold pain into the
  difficulty scale. "Hard" is progress; "hurts" is a stop signal.
- **The difficulty scale must reach 5.** `decideProgression()` regresses only on
  two consecutive ratings of 5; a scale capping at 4 leaves that branch dead.
- **Both questions are optional.** A completed session with no feedback is a
  completed session. Missing feedback is missing evidence, never a middle value.
- **Engines stay pure.** No I/O, no network, no `Date.now()` in
  `src/lib/engines/` or `src/lib/session-feedback.ts`. Clock reads happen in
  server actions and components.
- **Existing suite must stay green:** `npm test` is 187 tests in 10 files.
- Every user-visible string follows the repo's tone: no shaming, no "good
  food"/"bad food", no congratulating restriction.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/session-feedback.ts` (create) | Pure. The four difficulty options, the three pain options, and `toProgressionSignals()` which converts stored rows into the engine's input shape. |
| `tests/session-feedback.test.ts` (create) | Unit tests for the above, including the round trip that proves the buttons and `decideProgression()` agree. |
| `src/lib/actions/training.ts` (modify) | Add `logSessionFeedback`. Existing `updateSession` is left alone. |
| `src/components/week-plan.tsx` (modify) | Add the feedback panel shown after a session is marked done. |
| `tests/rls/harness.ts` (modify) | Add the three new user-owned tables to `OWNER_TABLES`. |
| `tests/rls/isolation.test.ts` (modify) | Prove Bob cannot read Alice's `session_feedback`. |
| `docs/STATUS.md` (modify) | Correct the stale "nothing is persisted" claim. |

---

### Task 1: Apply the migrations and extend RLS coverage

**Files:**
- Modify: `tests/rls/harness.ts:146-177`
- Modify: `tests/rls/isolation.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a verified `session_feedback` table that Task 3 can write to.

- [ ] **Step 1: Apply both migrations to a live project**

The two migrations are committed but have never been run. Everything below
depends on `session_feedback` existing.

```bash
supabase db push
```

Expected: `20260903120001_video_system.sql` and
`20260903120002_seed_progressions.sql` both apply cleanly. If the `do $$ ... $$`
policy loop in `120001` errors, stop and report — that block creates RLS
policies for all three new tables and a partial failure leaves some tables
unprotected.

- [ ] **Step 2: Confirm the three tables exist and are protected**

```bash
supabase db push --dry-run
```

Expected: "Remote database is up to date." No pending migrations.

- [ ] **Step 3: Add the new tables to the RLS sweep**

In `tests/rls/harness.ts`, extend `OWNER_TABLES`. Add these three entries after
`'notifications'`:

```ts
  'notifications',
  'fitness_assessments',
  'session_feedback',
  'skill_unlocks',
] as const;
```

This is safe: the "new user bootstrap" test iterates a hardcoded
`['profiles', 'lifestyle', 'food_profile']`, not `OWNER_TABLES`, so adding
tables that start empty does not break it. The two sweeps that do use
`OWNER_TABLES` — anonymous access and cross-user leakage — both pass on an
empty table.

- [ ] **Step 4: Write the failing cross-user test**

Add to `tests/rls/isolation.test.ts`, inside the existing
`describe('one user cannot read another', ...)` block, after the
`safety_flags` insert in its `beforeAll`:

```ts
      await alice.client.from('session_feedback').insert({
        user_id: alice.id,
        performed_on: '2026-01-15',
        difficulty: 5,
        pain: 'pain',
        pain_location: 'alice private knee note',
        completed: true,
      });
```

And add this test alongside the other cross-user assertions:

```ts
    it('never leaks a pain report to another user', async () => {
      const { data } = await bob.client
        .from('session_feedback')
        .select('pain_location');
      expect(data ?? []).toHaveLength(0);
    });
```

- [ ] **Step 5: Run the RLS suite to verify it passes**

Run: `npm run test:rls`
Expected: PASS. Previously 18 tests; now 19. If `session_feedback` appears in
the leak sweep with foreign rows, the policy loop in `120001` did not apply —
go back to Step 1.

- [ ] **Step 6: Mark `workout_plans.rpe` deprecated in the schema**

The spec requires the superseded column to say so where someone will actually
read it. Create `supabase/migrations/20260903120003_deprecate_rpe.sql`:

```sql
-- 20260903120003_deprecate_rpe.sql
--
-- session_feedback supersedes workout_plans.rpe.
--
-- The column stays: dropping it would rewrite a table for no gain, and the few
-- rows that carry a value are real. Nothing writes it from here on.

comment on column public.workout_plans.rpe is
  'DEPRECATED. Superseded by session_feedback.difficulty (1-5) and '
  'session_feedback.pain. Not written by the application. Kept because a 1-10 '
  'effort value does not map cleanly onto the 1-5 scale, so backfilling either '
  'direction would invent precision that was never collected.';
```

Apply it:

```bash
supabase db push
```

Expected: applies cleanly. A `comment on` statement cannot fail on data.

- [ ] **Step 7: Commit**

```bash
git add tests/rls/harness.ts tests/rls/isolation.test.ts supabase/migrations/20260903120003_deprecate_rpe.sql
git commit -m "Extend RLS coverage to the video-system tables

A pain report with a body location is among the most sensitive rows this
app stores. The isolation sweep now walks session_feedback,
fitness_assessments and skill_unlocks alongside every other user-owned
table, and asserts specifically that a pain location cannot cross users.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The pure mapping module

**Files:**
- Create: `src/lib/session-feedback.ts`
- Test: `tests/session-feedback.test.ts`

**Interfaces:**
- Consumes: `ProgressionSignals`, `FitnessLevel` from
  `src/lib/engines/progression.ts`.
- Produces:
  - `DIFFICULTY_OPTIONS: readonly { value: 1|2|3|4|5; label: string; hint: string }[]`
  - `PAIN_OPTIONS: readonly { value: PainLevel; label: string }[]`
  - `type PainLevel = 'none' | 'mild_discomfort' | 'pain'`
  - `interface FeedbackRow { performedOn: string; difficulty: number; pain: PainLevel }`
  - `toProgressionSignals(rows: FeedbackRow[], ctx: SignalContext): ProgressionSignals`
  - `interface SignalContext { sessionsPlanned: number; sessionsCompleted: number; daysAtLevel: number; restrictions?: string[] }`

- [ ] **Step 1: Write the failing tests**

Create `tests/session-feedback.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_OPTIONS,
  PAIN_OPTIONS,
  toProgressionSignals,
} from '@/lib/session-feedback';
import { decideProgression } from '@/lib/engines/progression';

describe('difficulty options', () => {
  it('offers four choices', () => {
    expect(DIFFICULTY_OPTIONS).toHaveLength(4);
  });

  it('reaches 5, so the regression branch is live', () => {
    // decideProgression() regresses only on two consecutive 5s. A scale that
    // stops at 4 can promote a user and never demote one.
    expect(DIFFICULTY_OPTIONS.map((o) => o.value)).toContain(5);
  });

  it('does not offer 1, which changes no decision', () => {
    expect(DIFFICULTY_OPTIONS.map((o) => o.value)).not.toContain(1);
  });

  it('is ordered easiest first', () => {
    const values = DIFFICULTY_OPTIONS.map((o) => o.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });
});

describe('pain options', () => {
  it('keeps pain separate from difficulty and defaults to none', () => {
    expect(PAIN_OPTIONS[0].value).toBe('none');
    expect(PAIN_OPTIONS.map((o) => o.value)).toEqual([
      'none',
      'mild_discomfort',
      'pain',
    ]);
  });
});

describe('toProgressionSignals', () => {
  const ctx = {
    sessionsPlanned: 8,
    sessionsCompleted: 6,
    daysAtLevel: 21,
  };

  it('orders difficulty oldest first, as the engine expects', () => {
    const signals = toProgressionSignals(
      [
        { performedOn: '2026-01-10', difficulty: 4, pain: 'none' as const },
        { performedOn: '2026-01-03', difficulty: 2, pain: 'none' as const },
      ],
      ctx,
    );
    expect(signals.recentDifficulty).toEqual([2, 4]);
  });

  it('keeps pain aligned with its own session', () => {
    const signals = toProgressionSignals(
      [
        { performedOn: '2026-01-03', difficulty: 2, pain: 'none' as const },
        { performedOn: '2026-01-10', difficulty: 4, pain: 'pain' as const },
      ],
      ctx,
    );
    expect(signals.recentPain).toEqual(['none', 'pain']);
  });

  it('derives consistency from planned versus completed', () => {
    const signals = toProgressionSignals([], ctx);
    expect(signals.consistency).toBeCloseTo(0.75);
  });

  it('reports zero consistency rather than dividing by zero', () => {
    const signals = toProgressionSignals([], {
      ...ctx,
      sessionsPlanned: 0,
      sessionsCompleted: 0,
    });
    expect(signals.consistency).toBe(0);
  });

  it('counts sessions at level from the rows it was given', () => {
    const rows = [
      { performedOn: '2026-01-03', difficulty: 3, pain: 'none' as const },
      { performedOn: '2026-01-05', difficulty: 3, pain: 'none' as const },
    ];
    expect(toProgressionSignals(rows, ctx).sessionsAtLevel).toBe(2);
  });

  it('passes restrictions through untouched', () => {
    const signals = toProgressionSignals([], {
      ...ctx,
      restrictions: ['high_intensity_training'],
    });
    expect(signals.restrictions).toEqual(['high_intensity_training']);
  });
});

describe('round trip: buttons to engine decision', () => {
  it('turns two "Too hard to finish" taps into a regression', () => {
    // This is the test that proves the UI mapping and the engine agree. If
    // someone shrinks the button set back to three, this fails.
    const tooHard = DIFFICULTY_OPTIONS.at(-1)!.value;

    const rows = [
      { performedOn: '2026-01-01', difficulty: 3, pain: 'none' as const },
      { performedOn: '2026-01-03', difficulty: 3, pain: 'none' as const },
      { performedOn: '2026-01-06', difficulty: tooHard, pain: 'none' as const },
      { performedOn: '2026-01-08', difficulty: tooHard, pain: 'none' as const },
    ];

    const signals = toProgressionSignals(rows, {
      sessionsPlanned: 4,
      sessionsCompleted: 4,
      daysAtLevel: 30,
    });

    expect(decideProgression(3, signals).decision).toBe('regress');
  });

  it('lets a pain report override an otherwise perfect window', () => {
    const rows = [
      { performedOn: '2026-01-01', difficulty: 2, pain: 'none' as const },
      { performedOn: '2026-01-03', difficulty: 2, pain: 'none' as const },
      { performedOn: '2026-01-06', difficulty: 2, pain: 'none' as const },
      { performedOn: '2026-01-08', difficulty: 2, pain: 'pain' as const },
    ];

    const signals = toProgressionSignals(rows, {
      sessionsPlanned: 4,
      sessionsCompleted: 4,
      daysAtLevel: 30,
    });

    expect(decideProgression(2, signals).decision).toBe('hold_for_pain');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/session-feedback.test.ts`
Expected: FAIL — "Failed to resolve import '@/lib/session-feedback'".

- [ ] **Step 3: Write the implementation**

Create `src/lib/session-feedback.ts`:

```ts
import type { ProgressionSignals } from '@/lib/engines/progression';

/**
 * Turning a tap into a signal.
 *
 * Two questions after a session, both optional. They are kept separate
 * deliberately: "hard" is what progress feels like, "hurts" is a reason to
 * stop, and a single scale that runs from easy to agony cannot tell a coach
 * which one it is looking at.
 */

export type PainLevel = 'none' | 'mild_discomfort' | 'pain';

export type DifficultyValue = 2 | 3 | 4 | 5;

/**
 * The scale must reach 5. `decideProgression()` steps a level back only on two
 * consecutive 5s, so a set of buttons that stops at 4 would leave the app able
 * to promote someone and never demote them.
 *
 * 1 is deliberately absent. Four questions is already as many as someone will
 * answer honestly after training, and `checkReadiness()` gates progression on
 * an average at or below 3 — which "Easy" at 2 already clears, so a separate
 * "very easy" would change no decision.
 */
export const DIFFICULTY_OPTIONS = [
  { value: 2, label: 'Easy', hint: 'I could have done more' },
  { value: 3, label: 'About right', hint: 'Worked, but I finished it' },
  { value: 4, label: 'Hard', hint: 'I finished, but only just' },
  { value: 5, label: 'Too hard to finish', hint: 'I had to stop early' },
] as const satisfies readonly {
  value: DifficultyValue;
  label: string;
  hint: string;
}[];

export const PAIN_OPTIONS = [
  { value: 'none', label: 'No pain' },
  { value: 'mild_discomfort', label: 'Some discomfort' },
  { value: 'pain', label: 'It hurt' },
] as const satisfies readonly { value: PainLevel; label: string }[];

/** One stored `session_feedback` row, reduced to what progression needs. */
export interface FeedbackRow {
  /** ISO date, `session_feedback.performed_on`. */
  performedOn: string;
  difficulty: number;
  pain: PainLevel;
}

export interface SignalContext {
  sessionsPlanned: number;
  sessionsCompleted: number;
  daysAtLevel: number;
  restrictions?: string[];
}

/**
 * Convert stored rows into the shape `progression.ts` consumes.
 *
 * The engine reads `recentDifficulty` and `recentPain` with `.slice(-N)`, so
 * both arrays must be oldest-first and index-aligned — the pain at position 3
 * has to belong to the same session as the difficulty at position 3.
 */
export function toProgressionSignals(
  rows: FeedbackRow[],
  ctx: SignalContext,
): ProgressionSignals {
  const ordered = [...rows].sort((a, b) =>
    a.performedOn.localeCompare(b.performedOn),
  );

  return {
    sessionsAtLevel: ordered.length,
    recentDifficulty: ordered.map((r) => r.difficulty),
    recentPain: ordered.map((r) => r.pain),
    consistency:
      ctx.sessionsPlanned > 0
        ? ctx.sessionsCompleted / ctx.sessionsPlanned
        : 0,
    daysAtLevel: ctx.daysAtLevel,
    restrictions: ctx.restrictions,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/session-feedback.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 11 files, 199 tests. Nothing previously passing may break.

- [ ] **Step 6: Commit**

```bash
git add src/lib/session-feedback.ts tests/session-feedback.test.ts
git commit -m "Map session feedback onto the progression engine's input

The difficulty scale reaches 5 because decideProgression() regresses only
on two consecutive 5s. A three-button scale stopping at 4 would have left
that branch permanently dead - able to promote someone, never to step them
back. There is a test asserting the 5 exists, so shrinking the button set
fails loudly rather than silently disabling regression.

Pain stays a separate field. Difficulty is what progress feels like; pain
is a reason to stop, and one scale cannot say which it is looking at.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The server action

**Files:**
- Modify: `src/lib/actions/training.ts` (append; do not alter `updateSession`)

**Interfaces:**
- Consumes: `PainLevel` from `src/lib/session-feedback.ts`; the existing
  `TrainingResult` type and `notConfigured()` helper already in this file.
- Produces: `logSessionFeedback(input: unknown): Promise<TrainingResult>`

- [ ] **Step 1: Add the action**

Append to `src/lib/actions/training.ts`:

```ts
const feedbackSchema = z.object({
  workoutPlanId: z.string().uuid(),
  performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  difficulty: z.number().int().min(1).max(5).optional(),
  pain: z.enum(['none', 'mild_discomfort', 'pain']).optional(),
  actualMinutes: z.number().int().min(0).max(300).optional(),
});

/**
 * Record how a session felt.
 *
 * Deliberately separate from `updateSession`. Marking a session done is the
 * commitment; rating it is optional, and a failure to save a rating must never
 * roll back the completion. `workout_plans.rpe` is left alone — it is
 * superseded by `session_feedback.difficulty`, and writing both would give the
 * progression engine two sources that can disagree.
 */
export async function logSessionFeedback(input: unknown): Promise<TrainingResult> {
  if (!supabaseConfigured) return notConfigured();

  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not save that.' };
  const { workoutPlanId, performedOn, difficulty, pain, actualMinutes } = parsed.data;

  // Nothing to record. Not an error - both questions are optional.
  if (difficulty === undefined && pain === undefined) {
    return { ok: true, message: 'Session saved.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // The plan row is re-read under the user's own client rather than trusted
  // from the request, so a crafted workoutPlanId cannot attach feedback to
  // someone else's session. RLS would reject the insert anyway; this returns a
  // clean message instead of a constraint error.
  const { data: session } = await supabase
    .from('workout_plans')
    .select('id')
    .eq('id', workoutPlanId)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!session) return { ok: false, error: 'We could not find that session.' };

  const { error } = await supabase.from('session_feedback').insert({
    user_id: auth.user.id,
    workout_plan_id: workoutPlanId,
    performed_on: performedOn,
    difficulty: difficulty ?? 3,
    pain: pain ?? 'none',
    completed: true,
    actual_minutes: actualMinutes ?? null,
  });

  if (error) {
    console.error('session feedback failed', error);
    return { ok: false, error: "We couldn't save that. Your session is still logged." };
  }

  revalidatePath('/activity');

  return {
    ok: true,
    message:
      pain === 'pain'
        ? 'Thanks for telling us. We will not add difficulty while that is going on.'
        : 'Thanks — that helps us pitch the next one.',
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. `z`, `createClient`, `supabaseConfigured`, `revalidatePath`,
`TrainingResult` and `notConfigured` are all already imported at the top of
this file.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/training.ts
git commit -m "Add logSessionFeedback, separate from marking a session done

Rating a session is optional and must not be able to undo the completion,
so this is its own action rather than more fields on updateSession. A
failed rating leaves the session logged and says so.

The plan row is re-read under the user's own client, so a crafted id
cannot attach feedback to someone else's session - RLS would reject it
regardless, but this returns a sentence instead of a constraint error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The feedback panel

**Files:**
- Modify: `src/components/week-plan.tsx`

**Interfaces:**
- Consumes: `logSessionFeedback` from Task 3; `DIFFICULTY_OPTIONS`,
  `PAIN_OPTIONS`, `PainLevel` from Task 2; existing `Button`, `Section` from
  `@/components/ui`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the panel component**

Add to `src/components/week-plan.tsx`, above `StatusChip`:

```tsx
/**
 * Asked once, after a session is marked done.
 *
 * Two questions, both skippable. The pain question is not a difficulty value:
 * someone who trained through a sore knee has told us something a 1-5 effort
 * scale cannot express, and the progression engine treats it as a stop signal
 * rather than a data point to average.
 */
function FeedbackPanel({
  session,
  onDone,
}: {
  // `WeekSession.id` is `string | null` — a sample-mode session has no row to
  // attach feedback to. The caller only renders this panel after a successful
  // save, so the id is known non-null here and the type says so rather than
  // forcing a non-null assertion inside.
  session: WeekSession & { id: string };
  onDone: () => void;
}) {
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [pain, setPain] = useState<PainLevel | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(nextPain: PainLevel) {
    setPain(nextPain);
    startTransition(async () => {
      const result = await logSessionFeedback({
        workoutPlanId: session.id,
        performedOn: session.date,
        difficulty: difficulty ?? undefined,
        pain: nextPain,
        actualMinutes: session.plannedMinutes ?? undefined,
      });
      if (!result.ok) setError(result.error);
      onDone();
    });
  }

  return (
    <Section title="How did that feel?" meta="Optional">
      <p className="measure text-sm" style={{ color: 'var(--fg-muted)' }}>
        This is how we decide what to give you next. Skip it if you would rather.
      </p>

      <fieldset className="mt-3" disabled={pending}>
        <legend className="eyebrow mb-2">Effort</legend>
        <div className="flex flex-wrap gap-2">
          {DIFFICULTY_OPTIONS.map((o) => (
            <Button
              key={o.value}
              variant={difficulty === o.value ? 'primary' : 'ghost'}
              aria-pressed={difficulty === o.value}
              onClick={() => setDifficulty(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      </fieldset>

      {difficulty !== null ? (
        <fieldset className="mt-4" disabled={pending}>
          <legend className="eyebrow mb-2">Any pain?</legend>
          <div className="flex flex-wrap gap-2">
            {PAIN_OPTIONS.map((o) => (
              <Button
                key={o.value}
                variant={pain === o.value ? 'primary' : 'ghost'}
                aria-pressed={pain === o.value}
                onClick={() => save(o.value)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-4">
        <Button variant="ghost" disabled={pending} onClick={onDone}>
          Skip
        </Button>
      </div>
    </Section>
  );
}
```

- [ ] **Step 2: Show it after a session is marked done**

In the `WeekPlan` component, add state near the existing `busyId`:

```tsx
  const [ratingId, setRatingId] = useState<string | null>(null);
```

In the "Mark as done" button's `onClick`, set it after the action resolves.
Replace the existing `run(today.id, {...})` call for `status: 'completed'`
with:

```tsx
              onClick={() => {
                if (!today.id) return;
                const id = today.id;
                setBusyId(id);
                setError(null);
                startTransition(async () => {
                  const result = await updateSession({
                    id,
                    status: 'completed',
                    actualMinutes: today.plannedMinutes ?? undefined,
                  });
                  if (!result.ok) setError(result.error);
                  else setRatingId(id);
                  setBusyId(null);
                });
              }}
```

Then render the panel, immediately after the closing tag of the "Today"
`<Section>`:

```tsx
      {ratingId && today && today.id === ratingId ? (
        <FeedbackPanel
          session={{ ...today, id: ratingId }}
          onDone={() => setRatingId(null)}
        />
      ) : null}
```

Spreading `today` with the known-non-null `ratingId` satisfies
`WeekSession & { id: string }` without a non-null assertion. Note this renders
*outside* the `today.status === 'planned'` guard on the Today section — once the
session is marked complete its status is no longer `planned`, so a panel nested
inside that block would unmount the instant it was needed.

- [ ] **Step 3: Add the imports**

At the top of `src/components/week-plan.tsx`, extend the existing imports:

```tsx
import { logSessionFeedback, updateSession } from '@/lib/actions/training';
import {
  DIFFICULTY_OPTIONS,
  PAIN_OPTIONS,
  type PainLevel,
} from '@/lib/session-feedback';
```

`useState`, `useTransition`, `Button`, `Section` and `Alert` are already
imported in this file.

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean. `Button` at `src/components/ui.tsx:568` accepts
`variant?: 'primary' | 'ghost' | 'quiet' | 'danger'`, so the selected/unselected
pairing above needs no new variant.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`, sign in, go to `/activity`, mark today's session done.
Expected: the effort question appears; choosing an effort reveals the pain
question; choosing a pain option dismisses the panel. "Skip" dismisses it
without saving. Confirm a row landed:

```sql
select difficulty, pain, performed_on from session_feedback order by created_at desc limit 1;
```

- [ ] **Step 6: Commit**

```bash
git add src/components/week-plan.tsx
git commit -m "Ask how the session felt, once, after it is marked done

Effort first, then pain, both skippable. The pain question only appears
after an effort answer so the panel is two taps rather than a form, and
the session is already saved before either is asked - a rating that fails
to send must never undo the completion it describes.

This is the input decideProgression() has been waiting for. Until now
nothing in the app wrote session_feedback, so the progression engine could
never see a reason to move anyone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Correct STATUS.md

**Files:**
- Modify: `docs/STATUS.md:95`

**Interfaces:**
- Consumes: nothing. Produces: nothing. Documentation only.

- [ ] **Step 1: Fix the stale row**

`docs/STATUS.md:95` currently reads:

```markdown
| Weekly plan + missed-session recovery UI | **Partial** — renders from engines, but the week grid is still fixed content and nothing is persisted |
```

Replace with:

```markdown
| Weekly plan + missed-session recovery UI | **Done** — `ensureWeekPlanned()` writes `workout_plans` on first visit; completion, skip, move and partial all persist through `updateSession` |
| Session difficulty and pain capture | **Done** — four-point effort scale and a separate pain question write `session_feedback` |
| Running progression on a schedule | **Not built** — `decideProgression()` is tested but nothing calls it |
```

- [ ] **Step 2: Update the verification header**

The header says "Verified by `npm test` (143 passing)". Update the count to
match what `npm test` actually reports after Task 2:

Run: `npm test`
Then set the number in `docs/STATUS.md` to the observed figure. Do not guess
it — this document's stated rule is that nothing is described as working that
has not been run.

- [ ] **Step 3: Commit**

```bash
git add docs/STATUS.md
git commit -m "Correct the week-plan status and record feedback capture

STATUS.md claimed the week grid was fixed content and nothing persisted.
That stopped being true when ensureWeekPlanned and updateSession landed,
and a status document that is wrong is worse than one that is missing -
the next contributor plans around it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- [ ] `npm test` green, including the round-trip regression and pain tests.
- [ ] `npm run test:rls` green, sweeping the three new tables.
- [ ] `npm run typecheck` and `npm run lint` clean.
- [ ] Marking a session done in the browser writes a `session_feedback` row.
- [ ] `docs/STATUS.md` reflects what was actually run.

## Already done — do not redo

Spec §0.3 called for fixing `week-plan.tsx:66`, which rendered the literal text
`You missed {missed.dayName}` from a string attribute. **It is already fixed**
— the line is now `<Section title={\`You missed ${missed.dayName}\`}>` at
`src/components/week-plan.tsx:95`. Verify it still reads that way before
starting Task 4, and if so, leave it alone.

## Out of scope

Deliberately not in Phase 0, to keep it reviewable:

- Calling `decideProgression()` anywhere. Phase 2 builds that orchestrator.
- Writing `profiles.fitness_level`, or the assessment flow that derives it.
- Anything touching `videos` — the library is empty and review-gated.
- Backfilling `session_feedback` from historic `workout_plans.rpe` values.
  There are few of them, they were never collected through a UI, and their
  1–10 scale does not map cleanly onto 1–5.
