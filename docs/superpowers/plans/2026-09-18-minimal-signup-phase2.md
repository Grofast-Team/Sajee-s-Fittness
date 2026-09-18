# Minimal Signup (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fitness-gated onboarding wall with a minimal
signup-completion step, and change who owns `profiles.onboarding_done_at`
and `user_categories(fitness)`, per §3 of the design spec.

**Architecture:** A new, small route (`/onboarding-name`) and server action
own stamping `onboarding_done_at`. `(app)/layout.tsx`'s gate is rewritten to
check that column instead of an active `plans` row. `saveOnboarding` (the
existing 9-step Fitness interview) stops touching `onboarding_done_at` and
starts upserting `user_categories(fitness, enabled=true)` — its ownership
narrows from "finishes account setup" to "finishes Fitness setup."

**Tech Stack:** Next.js 16 App Router (Server Actions), Supabase, Zod,
TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-modular-categories-design.md`
(§3 — `onboarding_done_at` ownership; §5 — the Fitness activation invariant,
partially: this plan implements `saveOnboarding`'s half of it, not the
toggle's)

## Global Constraints

- Redirect target on completion is **`/today`, not `/dashboard`** —
  `/dashboard` does not exist until Phase 4. Do not point anything at it.
- `profiles.display_name` may already be set. The signup form
  (`auth-form.tsx`) has an optional "What should we call you?" field with no
  `required` attribute, written by `private.handle_new_user()` before
  onboarding starts. `/onboarding-name` **prefills** from this value and
  only requires typing when it is empty — it is not a from-scratch name ask.
- **`(app)/(fitness)/layout.tsx` does not exist yet — do not build it, and
  do not add any Fitness-specific check to `/today` or anywhere else in this
  plan.** A user who completes minimal signup without ever running the
  Fitness interview can reach `/today` with no active plan until Phase 3
  ships. This is accepted as a known, temporary condition — not patched
  here, because doing so would put the same invariant (is Fitness usable) in
  two places: a one-off check here, and the real route-group guard in
  Phase 3. Record it in code as a comment (Task 2), not as logic.
- `saveOnboarding` keeps writing `plans`, `lifestyle`, `food_profile`, and
  keeps `onboarding_step: 8` untouched — only `onboarding_done_at` moves
  ownership. Nothing else about that action's existing writes changes.
- `category_key` has no `check` constraint on `user_categories` (§1) — write
  the literal string `'fitness'`, nothing to validate against.

---

## File Structure

- **Create:** `src/lib/actions/onboarding-name.ts` — the minimal-signup
  server action and its Zod schema. New, small, separate file rather than
  added to the existing `onboarding.ts` — it is a different flow with a
  different job (stamp one column, not compute a plan), and `onboarding.ts`
  is already the home of the much larger 9-step interview.
- **Create:** `src/components/onboarding-name.tsx` — the one-field client
  form.
- **Create:** `src/app/onboarding-name/page.tsx` — server page, mirrors the
  structure of `src/app/onboarding/page.tsx` (reads current state, renders
  the form, offers a sign-out escape hatch).
- **Create:** `tests/onboarding-name.test.ts` — the one pure, testable piece
  of Task 1: the Zod schema.
- **Modify:** `src/lib/data/onboarding-state.ts` — `needsOnboarding()`
  rewritten to check `profiles.onboarding_done_at`.
- **Modify:** `src/app/(app)/layout.tsx` — redirect target
  `/onboarding` → `/onboarding-name`, plus the transitional-gap comment.
- **Modify:** `src/lib/actions/auth.ts` — `signUp`'s `emailRedirectTo`
  target, same change.
- **Modify:** `src/lib/actions/onboarding.ts` — `saveOnboarding`'s
  ownership change.

---

### Task 1: The `/onboarding-name` step

**Files:**
- Create: `src/lib/actions/onboarding-name.ts`
- Create: `src/components/onboarding-name.tsx`
- Create: `src/app/onboarding-name/page.tsx`
- Test: `tests/onboarding-name.test.ts`

**Interfaces:**
- Consumes: `Field`, `Button`, `Alert`, `inputClass`, `inputStyle` from
  `@/components/ui` (existing exports, confirmed present); `SignOutButton`
  from `@/components/settings-actions` (existing export); `createClient`
  from `@/lib/supabase/server`; `supabaseConfigured` from `@/lib/config`.
- Produces: `minimalSignupSchema` (Zod schema, exported so it is directly
  testable — same pattern as `answersSchema` in `onboarding-schema.ts`),
  `type MinimalSignupResult = { ok: true } | { ok: false; error: string }`,
  `async function completeMinimalSignup(input: unknown): Promise<MinimalSignupResult>`,
  `function OnboardingName({ initialName }: { initialName: string })`. Task
  2 does not consume any of these — it only changes where users are sent,
  not what they do once there.

- [ ] **Step 1: Write the failing schema test**

Create `tests/onboarding-name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { minimalSignupSchema } from '@/lib/actions/onboarding-name';

describe('minimalSignupSchema', () => {
  it('accepts an ordinary name', () => {
    const result = minimalSignupSchema.safeParse({ displayName: 'Priya' });
    expect(result.success).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    const result = minimalSignupSchema.safeParse({ displayName: '  Priya  ' });
    expect(result.success && result.data.displayName).toBe('Priya');
  });

  it('rejects an empty string', () => {
    expect(minimalSignupSchema.safeParse({ displayName: '' }).success).toBe(false);
  });

  it('rejects whitespace-only input, not just a literal empty string', () => {
    // A pasted string of spaces passes an HTML `required` attribute but
    // should not pass here - trim runs before the length check.
    expect(minimalSignupSchema.safeParse({ displayName: '   ' }).success).toBe(false);
  });

  it('rejects a name longer than 80 characters', () => {
    const tooLong = 'a'.repeat(81);
    expect(minimalSignupSchema.safeParse({ displayName: tooLong }).success).toBe(false);
  });

  it('accepts exactly 80 characters', () => {
    const atLimit = 'a'.repeat(80);
    expect(minimalSignupSchema.safeParse({ displayName: atLimit }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/onboarding-name.test.ts`
Expected: FAIL — `Cannot find module '@/lib/actions/onboarding-name'`

- [ ] **Step 3: Write the server action**

Create `src/lib/actions/onboarding-name.ts`:

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * The one thing required before reaching the app at all.
 *
 * Deliberately separate from src/lib/actions/onboarding.ts, which owns the
 * nine-step Fitness interview. That is a different, much larger flow with a
 * different job - compute a plan - and this one's only job is to stamp
 * profiles.onboarding_done_at. See design spec section 3: each piece of
 * onboarding state now has exactly one writer, and this is this column's.
 *
 * profiles.display_name may already be set - the signup form's name field
 * is optional, and private.handle_new_user() writes whatever was given
 * before this ever runs. The caller (OnboardingName) prefills from that
 * value; this action does not care whether the name changed or was already
 * correct, it just saves whatever it is given.
 */

export type MinimalSignupResult = { ok: true } | { ok: false; error: string };

export const minimalSignupSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export async function completeMinimalSignup(input: unknown): Promise<MinimalSignupResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = minimalSignupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Tell us what to call you first.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // An update, not an upsert: private.handle_new_user() guarantees a
  // profiles row exists for every signed-in user, created at signup.
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: parsed.data.displayName,
      onboarding_done_at: new Date().toISOString(),
    })
    .eq('user_id', auth.user.id);

  if (error) {
    return { ok: false, error: 'We could not save that. Please try again.' };
  }

  // This changes what (app)/layout.tsx's gate decides on every route, so it
  // follows the account.ts/auth.ts precedent for a shell-wide change rather
  // than a single-path revalidate.
  revalidatePath('/', 'layout');
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/onboarding-name.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Write the client component**

Create `src/components/onboarding-name.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import { completeMinimalSignup } from '@/lib/actions/onboarding-name';

/**
 * The one screen between confirming an account and reaching the app.
 *
 * `initialName` comes from profiles.display_name - see
 * src/lib/actions/onboarding-name.ts. When it is already set (the signup
 * form's name field was filled in), this is a single confirm-and-continue
 * tap. When it is not, this is the only place a name is genuinely required.
 */
export function OnboardingName({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const result = await completeMinimalSignup({ displayName: name });
    if (result.ok) {
      // Not /dashboard - that route does not exist yet. This is the same
      // destination the old nine-step interview sent people to, and stays
      // correct until Phase 4 introduces a generic dashboard to send people
      // to instead.
      router.push('/today');
      return;
    }
    setError(result.error);
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">
          {initialName ? `Welcome, ${initialName}` : 'What should we call you?'}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
          That&rsquo;s the only thing we need right now. Fitness, Money and everything else
          are things you switch on later, from your profile.
        </p>
      </div>

      <Field label="Your name" htmlFor="displayName">
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          autoComplete="given-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button type="submit" variant="primary" fullWidth disabled={pending}>
        {pending ? <Loader2 className="animate-spin" size={16} aria-hidden /> : 'Continue'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 6: Write the page**

Create `src/app/onboarding-name/page.tsx`:

```tsx
import { OnboardingName } from '@/components/onboarding-name';
import { SignOutButton } from '@/components/settings-actions';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Welcome — FitCoach' };

/**
 * The one screen between confirming an account and reaching the app.
 *
 * Reachable from every other route via (app)/layout.tsx's gate until
 * profiles.onboarding_done_at is set - so, like /onboarding, this needs its
 * own way out for someone who wants to sign out instead of continuing.
 */
export default async function OnboardingNamePage() {
  let email: string | null = null;
  let initialName = '';

  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    email = auth.user?.email ?? null;

    if (auth.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      initialName = profile?.display_name ?? '';
    }
  }

  return (
    <main id="main" className="gutter mx-auto min-h-dvh max-w-xl py-6 md:py-12">
      <OnboardingName initialName={initialName} />

      {email ? (
        <div className="mt-10 border-t pt-6" style={{ borderColor: 'var(--line)' }}>
          <p className="mb-3 text-center text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
            Signed in as {email}
          </p>
          <SignOutButton />
        </div>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/lib/actions/onboarding-name.ts src/components/onboarding-name.tsx src/app/onboarding-name/page.tsx`
Expected: both clean. (`typecheck` may show pre-existing, unrelated errors
confined to `.next/dev/types/routes.d.ts` or an uncommitted test file
belonging to other in-progress work — confirm no new error in the three
files just created, not a zero-error run overall.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/actions/onboarding-name.ts src/components/onboarding-name.tsx src/app/onboarding-name/page.tsx tests/onboarding-name.test.ts
git commit -m "Add the minimal-signup step

A new, small route and action, separate from the nine-step Fitness
interview: completeMinimalSignup's only job is to stamp
profiles.onboarding_done_at, which is all that will be required to
reach the app once (app)/layout.tsx's gate changes in the next commit.

Prefills from profiles.display_name rather than asking from scratch -
the signup form already has an optional name field, written by
handle_new_user() before this page ever renders. A name is only
genuinely required here when that value came through empty.

Verified: 6 new tests passing, typecheck and eslint clean on the new
files.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Point the front door at it

**Files:**
- Modify: `src/lib/data/onboarding-state.ts`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/lib/actions/auth.ts`

**Interfaces:**
- Consumes: nothing from Task 1 — this task only changes *where* users are
  sent and *what column* gates entry; it does not import anything Task 1
  created.
- Produces: `needsOnboarding()` keeps its existing name and signature
  (`(): Promise<boolean>`) so `(app)/layout.tsx`'s call site is unchanged —
  only the query inside it changes. No other task depends on this beyond
  Task 2 itself.

- [ ] **Step 1: Rewrite `needsOnboarding`**

In `src/lib/data/onboarding-state.ts`, replace the entire file:

```ts
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * Has this user finished the one thing required before reaching the app at
 * all?
 *
 * This used to mean "has an active Fitness plan" - the whole app was gated
 * behind the nine-step interview, so a user who wanted nothing but expense
 * tracking could not reach /money without answering "Sex at birth" first.
 *
 * It now means the much smaller thing the function's name implies: has
 * profiles.onboarding_done_at been stamped. Fitness is an opt-in category
 * like any other (see src/lib/engines/categories.ts) and is gated
 * separately, by its own route group - not here. See design spec section 3.
 *
 * Kept deliberately tiny - one indexed lookup - because the app layout calls
 * it on every page load to decide whether to send someone to
 * /onboarding-name.
 */
export async function needsOnboarding(): Promise<boolean> {
  // Sample mode is a legitimate state, not an unfinished signup.
  if (!supabaseConfigured) return false;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;

  const { data } = await supabase
    .from('profiles')
    .select('onboarding_done_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  return data?.onboarding_done_at == null;
}
```

- [ ] **Step 2: Point the layout gate at the new page**

In `src/app/(app)/layout.tsx`, replace:

```tsx
  // A signed-in user with no plan has not finished setup. Showing them the
  // sample profile — someone else's numbers behind a warning banner — is worse
  // than useless: it looks like the app is broken. Send them to finish instead.
  if (await needsOnboarding()) {
    redirect('/onboarding');
  }
```

with:

```tsx
  // The only thing required before reaching the app at all is the minimal
  // signup step - a name, nothing else. Fitness, Money and every other
  // category are opt-in from Profile, not gated here.
  //
  // Known transitional condition, accepted deliberately: until the Fitness
  // route-group guard in (app)/(fitness)/layout.tsx ships (design spec
  // section 4, a later phase), a user who reaches this point without ever
  // running the Fitness interview can still open /today with no active
  // plan. That guard is the fix - not a check added here - so this gap is
  // accepted as temporary rather than patched in two places that would then
  // both be responsible for the same question.
  if (await needsOnboarding()) {
    redirect('/onboarding-name');
  }
```

- [ ] **Step 3: Point new signups at the new page**

In `src/lib/actions/auth.ts`, in `signUp`, replace:

```ts
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
```

with:

```ts
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding-name`,
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors beyond the pre-existing, unrelated ones noted in
Task 1 Step 7.

- [ ] **Step 5: Manual verification, stated honestly**

This task changes a redirect target and a database query, neither of which
has an automated test harness in this codebase (server actions and
route-level redirects are verified live, not mocked — see `tests/` for the
established pattern: pure logic gets Vitest, I/O gets exercised against a
real project). If a live Supabase project is available in this environment:

1. Sign up as a brand-new test account.
2. Confirm the email link lands on `/onboarding-name`, not `/onboarding`.
3. Submit a name. Confirm the redirect lands on `/today`.
4. Reload `/today`. Confirm it does **not** bounce back to
   `/onboarding-name` (i.e., `onboarding_done_at` actually persisted).
5. Sign in as an **existing** account that completed the old nine-step
   interview before this change. Confirm it reaches the app directly with
   no redirect at all — its `onboarding_done_at` was already stamped by the
   old code path, so nothing about this change should affect it.

If no live project is available, state that plainly rather than claim this
was verified — consistent with how earlier phases in this project have
handled the same limitation.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/onboarding-state.ts "src/app/(app)/layout.tsx" src/lib/actions/auth.ts
git commit -m "Gate the app on minimal signup, not a Fitness plan

needsOnboarding() used to check for an active plans row - the whole
app was gated behind the nine-step Fitness interview, so a user who
wanted nothing but expense tracking could not reach /money without
answering 'Sex at birth' first. It now checks
profiles.onboarding_done_at instead, stamped by the new
/onboarding-name step from the previous commit.

New signups land on /onboarding-name via emailRedirectTo. Existing
users, whose onboarding_done_at was already stamped by the old
saveOnboarding path, pass this gate unaffected - nothing about this
change touches their data.

Records a known transitional condition as a code comment rather than
patching it: until the Fitness route-group guard ships in a later
phase, a user can reach /today having never run the Fitness interview.
That guard is the intended fix. Adding a check here instead would put
the same invariant in two places.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `saveOnboarding`'s ownership change

**Files:**
- Modify: `src/lib/actions/onboarding.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1 or 2.
- Produces: `saveOnboarding` continues to have the exact same exported
  signature (`(rawAnswers: unknown): Promise<SaveResult>`) and continues to
  write `plans`, `lifestyle`, `food_profile` exactly as before. The only
  behavioural change is which columns/tables receive writes.

- [ ] **Step 1: Stop writing `onboarding_done_at`, start writing `user_categories`**

In `src/lib/actions/onboarding.ts`, find the `profiles` upsert inside the
`Promise.all([...])` in `saveOnboarding` (currently):

```ts
      supabase.from('profiles').upsert(
        {
          user_id: userId,
          display_name: a.name ?? '',
          age_years: a.age,
          sex: a.sex,
          height_cm: a.heightCm,
          experience: experienceFor(assessment.level),
          fitness_level: assessment.level,
          onboarding_step: 8,
          onboarding_done_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      ),
```

Replace with (removing only `onboarding_done_at` — `onboarding_step: 8`
stays; it tracks Fitness-interview progress specifically, a different
question this change does not touch):

```ts
      supabase.from('profiles').upsert(
        {
          user_id: userId,
          display_name: a.name ?? '',
          age_years: a.age,
          sex: a.sex,
          height_cm: a.heightCm,
          experience: experienceFor(assessment.level),
          fitness_level: assessment.level,
          onboarding_step: 8,
        },
        { onConflict: 'user_id' },
      ),

      // Completing the interview is what enables Fitness - not a separate
      // toggle action, which does not exist yet (a later phase). See design
      // spec section 5: Fitness can only become enabled through a
      // successfully completed saveOnboarding, or when a plan already
      // exists. This is that half of the invariant.
      supabase.from('user_categories').upsert(
        {
          user_id: userId,
          category_key: 'fitness',
          enabled: true,
          enabled_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,category_key' },
      ),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: same pass count as before this change (this file has no
dedicated unit test in this codebase — `saveOnboarding`'s correctness is
covered by `tests/onboarding-schema.test.ts`, which tests schema/`STEPS`
consistency, not this write path — confirm that test still passes
unchanged, since nothing about the schema or the step definitions moved).

- [ ] **Step 4: Manual verification, stated honestly**

Same caveat as Task 2 Step 5 — this is a live-write path with no mock-based
test in this codebase. If a live project is available:

1. As a signed-in test account past minimal signup, complete the nine-step
   Fitness interview at `/onboarding`.
2. Confirm a `plans` row is written as before (unchanged behaviour).
3. Confirm a `user_categories` row now exists for that user with
   `category_key = 'fitness'`, `enabled = true`, `enabled_at` set.
4. Confirm `profiles.onboarding_done_at` was **not** changed by this
   action — it should already have been set by `/onboarding-name` before
   this user could even reach `/onboarding` (per Task 2's gate). Re-running
   the interview a second time should not touch that column at all.

If no live project is available, state that plainly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions/onboarding.ts
git commit -m "saveOnboarding stops owning onboarding_done_at

Each piece of onboarding state now has exactly one writer (design spec
section 3): onboarding-name.ts owns profiles.onboarding_done_at,
completed in the previous two commits. saveOnboarding's write to that
same column is removed - leaving it would mean two actions racing to
set the same timestamp for different reasons.

In its place, saveOnboarding now upserts
user_categories(fitness, enabled=true, enabled_at=now()) on success -
completing the interview is what enables the Fitness category, per the
activation invariant in section 5: Fitness can only become enabled
through a completed saveOnboarding, or when a plan already exists,
never through an abandoned interview.

onboarding_step is left untouched - it tracks progress through this
specific interview, a different question from account-level signup
completion, and this change does not touch it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** §3's ownership table — `onboarding-name → onboarding_done_at`,
`saveOnboarding → plans + user_categories(fitness)` — is Tasks 1 and 3
respectively. The layout-gate half of §4/§6 that belongs to this phase (gate
on `onboarding_done_at`, not `plans`) is Task 2; the Fitness-specific
route-group half of §4/§6 is explicitly deferred to Phase 3 and named as such
in Global Constraints, not silently dropped. §5's Fitness activation
invariant is implemented from `saveOnboarding`'s side in Task 3; the toggle
action's side of that invariant is Phase 4 and not touched here.

**Placeholder scan.** No TBD/TODO. The one intentional forward reference —
the transitional-gap comment in Task 2 Step 2 — is a description of a real,
deliberate, temporary condition with a named owner (Phase 3's route-group
guard), not an unfinished instruction.

**Type consistency.** `MinimalSignupResult`, `minimalSignupSchema`,
`completeMinimalSignup`, `OnboardingName` are named identically across the
Interfaces block, the test file, and every code block that references them.
`needsOnboarding` keeps its existing name and `Promise<boolean>` signature
across `onboarding-state.ts` and its one call site in `(app)/layout.tsx`.

## Done when

- All three tasks' automated steps pass: 6 new schema tests, typecheck and
  eslint clean on new/changed files, full suite unchanged elsewhere.
- The manual verification sequences in Tasks 2 and 3 have either been run
  against a live project with the stated results, or are explicitly marked
  as not run in this environment — never silently skipped and never
  claimed without having actually run.
- Three commits, each independently reviewable.

## Out of scope (later phases, per the spec's Order of work)

`/today` itself (untouched — see Global Constraints on the transitional
gap), the `(app)/(fitness)/layout.tsx` route-group guard, all twelve
`requireCategoryEnabled` / `reviewAllDueUsers` write guards, the Dashboard,
the Profile screen, the category toggle actions, and the existing-user
backfill migration. None of these are touched by this plan.
