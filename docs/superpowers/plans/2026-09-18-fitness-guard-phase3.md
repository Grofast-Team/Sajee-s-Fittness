# Fitness Route Guard (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate every Fitness-domain route and write action behind
`user_categories(fitness).enabled`, closing the transitional gap Phase 2
opened, without regressing any existing user who already has a real plan.

**Architecture:** A shared `requireCategoryEnabled(supabase, userId,
categoryKey)` helper, built once, used two ways: as a Next.js route-group
layout guard (`(app)/(fitness)/layout.tsx`) for the UI path, and as an
explicit call at the top of eleven server actions for the stale-tab path a
layout guard can't close. `reviewAllDueUsers` — a batch job with no single
caller — gets its own fix, filtering its candidate query instead.

**Tech Stack:** Next.js 16 App Router (nested route groups, Server Actions),
Supabase, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-18-modular-categories-design.md`
(§4 routing, §6 redirects, §8 write guards)

## Global Constraints

- **Ordering is safety-critical.** Task 0's migration must run and be
  verified *before* Task 2's guard code ships. Every existing user who
  completed the old nine-step interview has an active `plans` row but, as
  of Phase 2, no `user_categories` row at all — shipping the guard first
  would lock every real existing user out of Fitness. This is not a
  stylistic preference; it is the difference between a clean rollout and a
  real regression.
- **Interim redirect target is `/onboarding` for both failure cases**
  (`not enabled` and `enabled but no plan`) — decided explicitly, because
  `/profile` does not exist until Phase 4. Running the interview is
  currently the only working way to enable Fitness. §6's exact table
  (`not enabled → /profile`) is corrected in Phase 4, not here — leave a
  code comment marking this as temporary, not a silent permanent choice.
- **`/food/kitchen` moves to `/kitchen`, outside `(fitness)`** — decided
  explicitly, because kitchen-stock tracking is not a fitness-specific
  concern and Next.js layout nesting has no way to exempt one sub-route
  from its parent route group's guard. Two files reference the old path
  (`src/app/(app)/food/page.tsx`, `src/lib/actions/pantry.ts`) — both must
  be updated in the same commit as the move, or the app links to a 404.
- **The resolver reads only `user_categories`**, per spec §2 — never a
  fallback to checking `plans` directly, in the layout guard or in any
  action guard. This is what Task 0 exists to make safe: fixing the *data*
  so the pure rule can stay pure, rather than weakening the rule.
- `requireCategoryEnabled` takes an already-resolved `supabase` client and
  `userId` rather than creating its own — every one of the eleven callers
  already has both from its own auth check, and creating a second client
  per guarded action would be eleven redundant round trips for no benefit.

---

## File Structure

- **Create:** `supabase/migrations/<next-number>_backfill_fitness_categories.sql`
  — the pulled-forward fitness half of §9's backfill. Task 0 only; the
  money-category backfill and the rest of Phase 5 are untouched.
- **Create:** `src/lib/data/categories.ts` — `getEnabledCategories`,
  `requireCategoryEnabled`. The one new shared module every other task in
  this phase depends on.
- **Move:** `src/app/(app)/today/` → `src/app/(app)/(fitness)/today/`
  (and identically for `activity/`, `progress/`, `coach/`).
- **Move:** `src/app/(app)/food/page.tsx` →
  `src/app/(app)/(fitness)/food/page.tsx`.
- **Move:** `src/app/(app)/food/kitchen/page.tsx` →
  `src/app/(app)/kitchen/page.tsx` (URL changes `/food/kitchen` → `/kitchen`
  — see Global Constraints).
- **Create:** `src/app/(app)/(fitness)/layout.tsx` — the route-group guard.
- **Modify:** `src/app/(app)/(fitness)/food/page.tsx` (post-move) — the
  `/kitchen` link href.
- **Modify:** `src/lib/actions/pantry.ts` — the `/kitchen` revalidate path.
- **Modify:** `src/lib/actions/tracking.ts`, `training.ts`, `food.ts`,
  `session.ts`, `steps-sync.ts`, `weekly-review.ts` — the guard call sites.

---

### Task 0: Pull forward the fitness-enabling backfill

**Files:**
- Create: `supabase/migrations/<next-number>_backfill_fitness_categories.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `user_categories(fitness, enabled=true)` rows for every existing
  user with an active plan. Every later task in this phase depends on this
  having run — Task 2's guard and Task 3's action guards will reject real
  users until it has.

- [ ] **Step 1: Find the real next migration number**

Run: `ls supabase/migrations/ | tail -5` and, if linked,
`supabase migration list`. Trust the higher of the two if they disagree.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/<next-number>_backfill_fitness_categories.sql`:

```sql
-- <next-number>_backfill_fitness_categories.sql
--
-- Pulled forward from the full backfill in design spec section 9,
-- deliberately - not the whole thing, just this half.
--
-- Every user who completed the nine-step Fitness interview before
-- 20260903120021_user_categories.sql existed has an active plans row and
-- no user_categories row at all. Phase 3 adds a route guard and twelve
-- write guards that check user_categories(fitness).enabled - if that ships
-- before this backfill runs, every one of those real users loses Fitness
-- access the moment it deploys. This migration is the fix, and it has to
-- land and be verified before the guard code does, not after.
--
-- ON CONFLICT DO NOTHING, never DO UPDATE: if this is ever re-run after
-- launch, it must not re-enable a category someone has since explicitly
-- turned off. The money-category half of the full backfill, and this
-- migration's own eventual folding into design spec section 9's complete
-- version, are Phase 5 - not touched here.

insert into public.user_categories (user_id, category_key, enabled, enabled_at)
select p.user_id, 'fitness', true, coalesce(p.onboarding_done_at, now())
from public.profiles p
where exists (
  select 1 from public.plans where user_id = p.user_id and is_active
)
on conflict (user_id, category_key) do nothing;
```

- [ ] **Step 3: Apply the migration**

Run: `supabase db push`
If nothing is linked in this environment, state that plainly and stop here
— do not proceed to Task 2 without this having actually run somewhere real,
since Task 2's guard is unsafe without it.

- [ ] **Step 4: Verify against the live project**

This is the one step in this phase worth extra care, given what depends on
it. Confirm both that the insert worked and that it is genuinely safe to
re-run:

```bash
cat > verify-backfill.tmp.mjs <<'SCRIPT'
import { WebSocket as NodeWebSocket } from 'ws';
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = NodeWebSocket;
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: activePlanUsers } = await admin.from('plans').select('user_id').eq('is_active', true);
const { data: enabledRows } = await admin.from('user_categories').select('user_id').eq('category_key', 'fitness').eq('enabled', true);
const enabledIds = new Set((enabledRows ?? []).map((r) => r.user_id));
const missing = (activePlanUsers ?? []).filter((p) => !enabledIds.has(p.user_id));

console.log(`Active-plan users: ${activePlanUsers?.length ?? 0}`);
console.log(`Backfilled as fitness-enabled: ${enabledRows?.length ?? 0}`);
console.log(`Missing (should be 0): ${missing.length}`);
if (missing.length > 0) { console.error('BACKFILL INCOMPLETE', missing); process.exit(1); }
console.log('PASS: every active-plan user has fitness enabled.');
SCRIPT
npx dotenv -e .env.local -- node verify-backfill.tmp.mjs
rm -f verify-backfill.tmp.mjs
```

Expected: `Missing (should be 0): 0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_backfill_fitness_categories.sql
git commit -m "Backfill fitness-enabled for existing active-plan users

Pulled forward from the full backfill in design spec section 9 -
just the fitness half, as a prerequisite for the route and write
guards landing in this same phase. Every user who completed the old
nine-step interview before user_categories existed has an active
plans row and no user_categories row - shipping the guards before
this runs would lock every one of them out.

ON CONFLICT DO NOTHING: safe to re-run, and re-running it can never
re-enable a category someone has since explicitly disabled.

Verified against the live project: every user with an active plan
now has a fitness-enabled user_categories row, zero missing.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 1: The shared guard helper

**Files:**
- Create: `src/lib/data/categories.ts`

**Interfaces:**
- Consumes: `isCategoryVisible` from `@/lib/engines/categories` (Phase 1).
- Produces:
  - `async function getEnabledCategories(supabase: SupabaseClient, userId: string): Promise<ReadonlySet<string>>`
  - `async function requireCategoryEnabled(supabase: SupabaseClient, userId: string, categoryKey: string): Promise<{ ok: true } | { ok: false; error: string }>`

  Every task after this one calls one or both of these by these exact
  names and signatures — the route guard (Task 2) and all eleven action
  guards (Task 3).

- [ ] **Step 1: Write the module**

Create `src/lib/data/categories.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { isCategoryVisible } from '@/lib/engines/categories';

/**
 * Which top-level categories this user has enabled, as the set
 * isCategoryVisible expects.
 *
 * Takes an already-authenticated client and user id rather than creating
 * its own. Every real caller - a route guard, a server action - already
 * has both from its own auth check by the time it needs this, and a
 * second createClient()/auth.getUser() round trip per call site would be
 * pure waste repeated across every guarded action in this phase.
 */
export async function getEnabledCategories(
  supabase: SupabaseClient,
  userId: string,
): Promise<ReadonlySet<string>> {
  const { data } = await supabase
    .from('user_categories')
    .select('category_key')
    .eq('user_id', userId)
    .eq('enabled', true);

  return new Set((data ?? []).map((row) => row.category_key as string));
}

/**
 * The write-path half of category gating (design spec section 8).
 *
 * A route-group layout blocks the UI path once a category is off, but not
 * a page left open in another tab from before it was disabled - that tab
 * can still submit its form after. This is the guard for that gap: called
 * at the top of a server action, before any write, on every category
 * whose actions create or extend that category's state.
 */
export async function requireCategoryEnabled(
  supabase: SupabaseClient,
  userId: string,
  categoryKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const enabled = await getEnabledCategories(supabase, userId);
  if (!isCategoryVisible(categoryKey, enabled)) {
    return { ok: false, error: 'That category is not turned on for your account.' };
  }
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/categories.ts
git commit -m "Add the shared category-enabled guard

getEnabledCategories and requireCategoryEnabled, used by both the
Fitness route-group layout and all eleven action-level guards in
this phase. Takes an already-resolved client and user id rather than
creating its own, since every real caller has both already.

No unit test: this is an I/O wrapper around a Supabase query, not
pure logic - isCategoryVisible (Phase 1) already has full coverage
for the actual gating rule this composes with. Verified live in the
tasks that use it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: The Fitness route group and its guard

**Files:**
- Move: `src/app/(app)/today/page.tsx` → `src/app/(app)/(fitness)/today/page.tsx`
- Move: `src/app/(app)/activity/page.tsx` → `src/app/(app)/(fitness)/activity/page.tsx`
- Move: `src/app/(app)/progress/page.tsx` → `src/app/(app)/(fitness)/progress/page.tsx`
- Move: `src/app/(app)/coach/page.tsx` → `src/app/(app)/(fitness)/coach/page.tsx`
- Move: `src/app/(app)/food/page.tsx` → `src/app/(app)/(fitness)/food/page.tsx`
- Move: `src/app/(app)/food/kitchen/page.tsx` → `src/app/(app)/kitchen/page.tsx`
- Modify: `src/app/(app)/(fitness)/food/page.tsx` (the `/kitchen` link)
- Modify: `src/lib/actions/pantry.ts` (the `/kitchen` revalidate path)
- Create: `src/app/(app)/(fitness)/layout.tsx`

**Interfaces:**
- Consumes: `getEnabledCategories` (Task 1); `isCategoryVisible` from
  `@/lib/engines/categories` (Phase 1); `supabaseConfigured` from
  `@/lib/config`.
- Produces: nothing further tasks depend on — this is a leaf in the
  dependency graph within this phase.

- [ ] **Step 1: Move the four wholly-fitness route directories**

```bash
mkdir -p "src/app/(app)/(fitness)"
git mv "src/app/(app)/today" "src/app/(app)/(fitness)/today"
git mv "src/app/(app)/activity" "src/app/(app)/(fitness)/activity"
git mv "src/app/(app)/progress" "src/app/(app)/(fitness)/progress"
git mv "src/app/(app)/coach" "src/app/(app)/(fitness)/coach"
```

- [ ] **Step 2: Split food from kitchen**

```bash
mkdir -p "src/app/(app)/(fitness)/food"
git mv "src/app/(app)/food/page.tsx" "src/app/(app)/(fitness)/food/page.tsx"
mkdir -p "src/app/(app)/kitchen"
git mv "src/app/(app)/food/kitchen/page.tsx" "src/app/(app)/kitchen/page.tsx"
# The old food/ and food/kitchen/ directories are now empty and can be removed.
rmdir "src/app/(app)/food/kitchen" 2>/dev/null || true
rmdir "src/app/(app)/food" 2>/dev/null || true
```

- [ ] **Step 3: Update the two references to the old `/food/kitchen` path**

In `src/app/(app)/(fitness)/food/page.tsx`, find the link to the kitchen
page and change its `href` from `/food/kitchen` to `/kitchen`. (The exact
surrounding markup depends on the file as moved — search for
`href="/food/kitchen"` and replace the string only; do not alter anything
else in that block.)

In `src/lib/actions/pantry.ts`, find:

```ts
  revalidatePath('/food/kitchen');
```

Replace with:

```ts
  revalidatePath('/kitchen');
```

- [ ] **Step 4: Write the route-group guard**

Create `src/app/(app)/(fitness)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { isCategoryVisible } from '@/lib/engines/categories';

/**
 * The Fitness category's own gate.
 *
 * (app)/layout.tsx only checks that minimal signup is done - it has no
 * opinion on Fitness specifically, deliberately, so that check stays true
 * for every category. This layout is where "is Fitness actually usable"
 * lives, wrapping only the five routes that need it: today, activity,
 * food, progress, coach.
 *
 * Interim redirect target: /onboarding for both failure cases below.
 * Design spec section 6 says "not enabled -> /profile", but /profile does
 * not exist until Phase 4 - running the interview is currently the only
 * working way to enable Fitness, so both cases land there for now. This
 * gets corrected to the exact section 6 table once /profile ships.
 */
export default async function FitnessLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured) return children;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return children; // (app)/layout.tsx already handles this case.

  const enabled = await getEnabledCategories(supabase, auth.user.id);
  if (!isCategoryVisible('fitness', enabled)) {
    redirect('/onboarding');
  }

  const { data: plan } = await supabase
    .from('plans')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!plan) {
    redirect('/onboarding');
  }

  return children;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. Pay particular attention to any import paths that
referenced the moved files by their old location (e.g. a relative import
from inside `today/page.tsx` to a sibling file) — none are expected, since
every file in this codebase imports via the `@/` alias rather than
relative paths, but this is the step that would catch it if one existed.

- [ ] **Step 6: Manual verification against the live project**

Route moves and a redirect guard have no automated test harness in this
codebase. If a live project is available:

1. Sign in as a test user with Fitness enabled and an active plan (the
   backfilled state, or a fresh signup that completed the interview).
   Confirm `/today`, `/activity`, `/food`, `/progress`, `/coach` all still
   render normally.
2. From `/food`, follow the kitchen link. Confirm it lands on `/kitchen`,
   not `/food/kitchen`, and that the page renders.
3. Sign in as a test user with minimal signup done but Fitness never
   enabled (no `saveOnboarding` ever run). Visit `/today` directly.
   Confirm it redirects to `/onboarding`, not a 404 and not a crash.
4. Confirm `/money` still renders normally for that same Fitness-disabled
   user — this phase must not touch any non-Fitness category's reachability.

If no live project is available, state that plainly.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/(fitness)" "src/app/(app)/kitchen" src/lib/actions/pantry.ts
git commit -m "Gate Fitness routes behind the category guard

today, activity, food, progress and coach move into a new
(app)/(fitness)/ route group; its layout redirects to /onboarding
when Fitness is not enabled or a plan does not exist. URLs are
unchanged for all five - route groups do not appear in the path.

food/kitchen moves out to its own top-level /kitchen instead of
nesting under the new group: kitchen-stock tracking is not a
fitness-specific concern, and Next.js layout nesting has no way to
exempt one sub-route from its parent's guard, so keeping it under
food/ would have locked it behind Fitness as a side effect of file
placement rather than a real decision. Both references to the old
/food/kitchen path (the link in food/page.tsx, the revalidatePath in
pantry.ts) are updated in this same commit.

Interim redirect target for both failure cases is /onboarding, not
the /profile design spec section 6 specifies - that page is Phase 4.
Corrected there, not patched here with a placeholder.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: The eleven action-level guards

**Files:**
- Modify: `src/lib/actions/tracking.ts` (logMeasurement, logSteps, logWater, logSleep)
- Modify: `src/lib/actions/training.ts` (ensureWeekPlanned, updateSession)
- Modify: `src/lib/actions/food.ts` (logFood only — not updateFoodLog or deleteFoodLog)
- Modify: `src/lib/actions/session.ts` (logSessionFeedback, saveFitnessAssessment)
- Modify: `src/lib/actions/steps-sync.ts` (syncStepSegments)
- Modify: `src/lib/actions/weekly-review.ts` (reviewMyPlan)

**Interfaces:**
- Consumes: `requireCategoryEnabled` from `@/lib/data/categories` (Task 1).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: `tracking.ts` — four sites sharing one pattern**

All four functions in this file resolve auth the same way:
`const { supabase, user } = await requireUser(); if (!user) return {...};`.
Add the guard immediately after that check, in each of the four functions.

In `logMeasurement`, after:
```ts
  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: 'You need to be signed in to record this.' };
```
add:
```ts

  const guard = await requireCategoryEnabled(supabase, user.id, 'fitness');
  if (!guard.ok) return { ok: false, error: guard.error };
```

Repeat identically — same three lines, same insertion point right after the
`if (!user) return {...}` line — in `logSteps`, `logWater`, and `logSleep`.

Add the import at the top of the file:
```ts
import { requireCategoryEnabled } from '@/lib/data/categories';
```

- [ ] **Step 2: `training.ts` — two sites**

Both functions resolve auth as
`const supabase = await createClient(); const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return {...};`.

In `ensureWeekPlanned`, after:
```ts
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;
```
add:
```ts

  const guard = await requireCategoryEnabled(supabase, userId, 'fitness');
  if (!guard.ok) return { ok: false, error: guard.error };
```

In `updateSession`, after:
```ts
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
```
add:
```ts

  const guard = await requireCategoryEnabled(supabase, auth.user.id, 'fitness');
  if (!guard.ok) return { ok: false, error: guard.error };
```

Add the import at the top of the file:
```ts
import { requireCategoryEnabled } from '@/lib/data/categories';
```

- [ ] **Step 3: `food.ts` — `logFood` only**

After:
```ts
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in to log food.' };
```
add:
```ts

  const guard = await requireCategoryEnabled(supabase, auth.user.id, 'fitness');
  if (!guard.ok) return { ok: false, error: guard.error };
```

Do **not** add this to `updateFoodLog` or `deleteFoodLog` — per design spec
section 8, editing or deleting an existing entry stays available regardless
of category state; only creating new fitness data is guarded.

Add the import at the top of the file:
```ts
import { requireCategoryEnabled } from '@/lib/data/categories';
```

- [ ] **Step 4: `session.ts` — two sites**

In `logSessionFeedback`, after:
```ts
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;
```
add:
```ts

  const guard = await requireCategoryEnabled(supabase, userId, 'fitness');
  if (!guard.ok) return { ok: false, error: guard.error };
```

In `saveFitnessAssessment`, after:
```ts
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
```
add:
```ts

  const guard = await requireCategoryEnabled(supabase, auth.user.id, 'fitness');
  if (!guard.ok) return { ok: false, error: guard.error };
```

Add the import at the top of the file:
```ts
import { requireCategoryEnabled } from '@/lib/data/categories';
```

- [ ] **Step 5: `steps-sync.ts` — one site**

After:
```ts
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;
```
add:
```ts

  const guard = await requireCategoryEnabled(supabase, userId, 'fitness');
  if (!guard.ok) return { ok: false, error: guard.error };
```

Add the import at the top of the file:
```ts
import { requireCategoryEnabled } from '@/lib/data/categories';
```

- [ ] **Step 6: `weekly-review.ts` — `reviewMyPlan` only**

`reviewAllDueUsers` is Task 4, not this one — it needs a different fix, not
this guard.

After:
```ts
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
```
add:
```ts

  const guard = await requireCategoryEnabled(supabase, auth.user.id, 'fitness');
  if (!guard.ok) return { ok: false, error: guard.error };
```

Add the import at the top of the file:
```ts
import { requireCategoryEnabled } from '@/lib/data/categories';
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: same pass count as before this task — none of these six files
have dedicated unit tests in this codebase (they are I/O-heavy server
actions, verified live per this project's established convention), so this
step confirms nothing else broke, not that these specific changes are
covered.

- [ ] **Step 9: Manual verification against the live project**

If available:

1. As a Fitness-disabled test user (minimal signup done, never ran the
   interview), attempt to call `logMeasurement` directly (or through the
   UI, if reachable by URL despite the route guard from Task 2 — this is
   exactly the stale-tab scenario the guard is for). Confirm it returns
   `{ ok: false, error: 'That category is not turned on for your account.' }`
   rather than writing a row.
2. As a Fitness-enabled test user with an active plan, confirm the same
   action still succeeds normally — the guard must not have broken the
   happy path for anyone actually allowed to use it.
3. Confirm `updateFoodLog` and `deleteFoodLog` still work for a
   Fitness-disabled user with existing logged entries — these two must
   remain ungated.

If no live project is available, state that plainly.

- [ ] **Step 10: Commit**

```bash
git add src/lib/actions/tracking.ts src/lib/actions/training.ts src/lib/actions/food.ts src/lib/actions/session.ts src/lib/actions/steps-sync.ts src/lib/actions/weekly-review.ts
git commit -m "Guard the eleven single-user fitness write actions

The route-group layout from the previous commit closes the UI path,
not a tab left open from before Fitness was disabled - that tab can
still submit its form after. requireCategoryEnabled closes it:
logMeasurement, logSteps, logWater, logSleep, ensureWeekPlanned,
updateSession, logFood, logSessionFeedback, saveFitnessAssessment,
syncStepSegments, reviewMyPlan.

updateFoodLog and deleteFoodLog are deliberately not guarded -
editing or removing an existing entry stays available regardless of
category state, per design spec section 8: disabling a category is
an access-state change, not a data-deletion operation.

Verified against the live project: a disabled user's write is
refused with the guard's error, not silently written; an enabled
user's write still succeeds unchanged; edit/delete remain reachable
either way.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `reviewAllDueUsers`'s query-level fix

**Files:**
- Modify: `src/lib/actions/weekly-review.ts`

**Interfaces:**
- Consumes: nothing new — this is a query change within an existing
  function, not a call to `requireCategoryEnabled` (that helper takes a
  single user id; this function has none, since it processes many users
  per invocation, which is exactly why it needs a different fix).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Filter the candidate query by `user_categories`, not just `plans`**

Find `reviewAllDueUsers`:

```ts
export async function reviewAllDueUsers(): Promise<{ reviewed: number; changed: number }> {
  const supabase = createServiceClient();

  const { data: plans } = await supabase
    .from('plans')
    .select('user_id')
    .eq('is_active', true);

  let reviewed = 0;
  let changed = 0;

  for (const row of plans ?? []) {
    const result = await reviewUser(supabase as unknown as Client, row.user_id as string);
    if (result.ok) {
      reviewed += 1;
      if (result.changed) changed += 1;
    }
  }

  return { reviewed, changed };
}
```

Replace with:

```ts
export async function reviewAllDueUsers(): Promise<{ reviewed: number; changed: number }> {
  const supabase = createServiceClient();

  const { data: plans } = await supabase
    .from('plans')
    .select('user_id')
    .eq('is_active', true);

  const candidateIds = (plans ?? []).map((row) => row.user_id as string);
  if (candidateIds.length === 0) return { reviewed: 0, changed: 0 };

  // An active plan alone is not enough - this must not silently keep
  // adjusting a plan for someone who has explicitly disabled Fitness.
  // requireCategoryEnabled takes a single user id and does not fit a
  // batch job with no single caller, so this filters the candidate list
  // directly instead: the same rule, applied as a query rather than a
  // per-call guard.
  const { data: enabledRows } = await supabase
    .from('user_categories')
    .select('user_id')
    .in('user_id', candidateIds)
    .eq('category_key', 'fitness')
    .eq('enabled', true);
  const enabledIds = new Set((enabledRows ?? []).map((row) => row.user_id as string));

  let reviewed = 0;
  let changed = 0;

  for (const userId of candidateIds) {
    if (!enabledIds.has(userId)) continue;
    const result = await reviewUser(supabase as unknown as Client, userId);
    if (result.ok) {
      reviewed += 1;
      if (result.changed) changed += 1;
    }
  }

  return { reviewed, changed };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Manual verification against the live project**

This is the one guard in this phase with no route and no single caller to
exercise through the UI — it can only be verified by seeding data and
calling the function directly. If a live project is available:

```bash
cat > verify-review-all.tmp.mjs <<'SCRIPT'
import { WebSocket as NodeWebSocket } from 'ws';
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = NodeWebSocket;
// This script only proves the query-level filter, not the full
// reviewAllDueUsers business logic (adapt(), trend analysis) - it checks
// that a Fitness-disabled user's active plan is excluded from the
// candidate set the real function would process.
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: created } = await admin.auth.admin.createUser({
  email: `phase3-reviewall-${Date.now()}@example.test`,
  password: 'Test-xyz123!9',
  email_confirm: true,
});
const userId = created.user.id;

// Give them an active plan but leave Fitness disabled - the exact
// scenario the old query would have wrongly included.
await admin.from('plans').insert({
  user_id: userId, version: 1, is_active: true, bmr_kcal: 1500, tdee_kcal: 2000,
  activity: 'sedentary', energy_target_kcal: 1800, energy_floor_kcal: 1500,
  protein_g: 100, fat_g: 60, carb_g: 180, fibre_g: 25, step_target: 8000,
});

const { data: plans } = await admin.from('plans').select('user_id').eq('is_active', true).eq('user_id', userId);
const candidateIds = (plans ?? []).map((r) => r.user_id);
const { data: enabledRows } = await admin.from('user_categories').select('user_id').in('user_id', candidateIds).eq('category_key', 'fitness').eq('enabled', true);
const enabledIds = new Set((enabledRows ?? []).map((r) => r.user_id));

console.log('Has active plan:', candidateIds.includes(userId));
console.log('Fitness enabled:', enabledIds.has(userId));
if (enabledIds.has(userId)) { console.error('FAIL: should not be enabled'); process.exit(1); }
console.log('PASS: this user would be correctly excluded from reviewAllDueUsers.');

await admin.from('plans').delete().eq('user_id', userId);
await admin.auth.admin.deleteUser(userId);
SCRIPT
npx dotenv -e .env.local -- node verify-review-all.tmp.mjs
rm -f verify-review-all.tmp.mjs
```

If no live project is available, state that plainly.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/weekly-review.ts
git commit -m "Stop the weekly review cron from adjusting disabled users' plans

reviewAllDueUsers selected candidates from plans.is_active alone -
exactly the runtime-inference-from-plans pattern design spec section
2 forbids for the resolver, and a real gap: the cron would have kept
adjusting a plan for anyone who had explicitly disabled Fitness.

requireCategoryEnabled doesn't fit here - it takes one user id, and
this function has none, processing many users per invocation. The
fix filters the candidate list with the same rule instead: an active
plan is fetched as before, then narrowed to users who also have
user_categories(fitness).enabled, before the review loop ever runs.

Verified against the live project: a user with an active plan and
Fitness disabled is correctly excluded from the candidate set.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** §4's routing split (the five routes into `(fitness)`) is
Task 2. §6's redirect table is implemented with the documented interim
substitution (`/onboarding` for both failure branches, not yet `/profile`).
§8's eleven single-user guards are Task 3, named individually and matched
against the actual current code, not assumed from the spec's earlier
paraphrase. §8's twelfth site, `reviewAllDueUsers`, is Task 4 with its
distinct query-based fix. §2's "resolver reads only `user_categories`"
invariant is what makes Task 0 necessary in the first place — without it,
the guard would either violate that rule (fall back to `plans`) or regress
real users, and Task 0 removes that dilemma by fixing the data instead.

The `/food/kitchen` → `/kitchen` split and the backfill-ordering hazard
were not in the original spec at all — both are documented here as
decisions made explicitly during this plan's own drafting, not silently
folded in.

**Placeholder scan.** No TBD/TODO. The interim-redirect and
`/kitchen`-instead-of-`/profile`-guard substitutions are documented,
deliberate, temporary conditions with a named correction point (Phase 4),
not unfinished instructions.

**Type consistency.** `getEnabledCategories(supabase, userId)` and
`requireCategoryEnabled(supabase, userId, categoryKey)` are called with
identical argument order and types at all twelve use sites (Task 2's
layout, Task 3's eleven actions) as declared in Task 1.

## Done when

- Task 0's backfill is verified with zero missing active-plan users before
  any later task's code is written, not just before it's committed.
- All four tasks' typecheck and (where applicable) full-suite steps pass.
- Every manual verification sequence has either been run against a live
  project with the stated result, or is explicitly marked as not run in
  this environment.
- Five commits (one per task, Task 0 first), each independently reviewable.

## Out of scope (later phases, per the spec's Order of work)

The Dashboard, the real `/profile` screen (which will correct this phase's
interim redirect target), the category toggle actions, and the
money-category half of the backfill plus its remaining Phase 5 pieces.
None of these are touched by this plan.
