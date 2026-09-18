# Category Registry & Visibility (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `user_categories` table with RLS, and the pure
category registry + visibility algorithm from §1 and §7 of the design spec —
fully unit-tested, with zero UI and zero dependency on `plans`.

**Architecture:** One migration (table + RLS, following the exact `do $$`
policy pattern already used for `fitness_assessments`/`session_feedback`/
`skill_unlocks`). One new pure module, `src/lib/engines/categories.ts`,
holding the registry and the visibility algorithm — no I/O, no framework
imports, same discipline as every other file in that directory. Later phases
(dashboard, profile, toggle actions, routing, the twelve write guards, the
backfill) are explicitly out of scope here and are not touched.

**Tech Stack:** PostgreSQL (Supabase migrations), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-modular-categories-design.md`
(§1 registry, §2 data model, §7 visibility algorithm)

## Global Constraints

- `category_key` gets **no `check` constraint** — the set is expected to
  grow; a constraint would demand a migration per future category (spec §1).
- The visibility algorithm and registry lookups must be **pure**: no
  database read, no `Date.now()`, no framework import with runtime cost.
  This module lives in `src/lib/engines/` specifically because that
  directory enforces this today — verified empty of any `lucide-react`
  import before writing this plan.
- The resolver must be structurally incapable of consulting `plans` —
  not just tested as not doing so. `isCategoryVisible` takes only an
  `enabled: ReadonlySet<string>` argument; there is nowhere for a `plans`
  row to enter its signature.
- RLS policy shape (own-row select/insert/update/delete) must match the
  `do $$ ... end $$` loop already used in
  `supabase/migrations/20260903120001_video_system.sql` — copy the pattern,
  don't invent a new one.
- Icons are stored as kebab-case strings (`'wallet'`, `'check-square'`),
  **not** live `lucide-react` component references — see the deviation note
  above. This keeps the module framework-free; a string→component map is a
  later phase's concern, built where `app-nav.tsx` already imports icons.
- Before creating the migration file, check `ls supabase/migrations/ | tail
  -5` and `supabase migration list` for the *actual* next free number —
  every migration number assumed earlier in this project's history has been
  claimed by concurrent work by the time it was used. Do not hardcode
  `20260903120021` as certainly free.

---

## File Structure

- **Create:** `supabase/migrations/<next-number>_user_categories.sql` —
  table DDL + RLS policies. Nothing else touches this file.
- **Modify:** `tests/rls/harness.ts` — add `'user_categories'` to
  `OWNER_TABLES`. One line.
- **Create:** `src/lib/engines/categories.ts` — `CategoryDefinition` type,
  the `CATEGORIES` registry, `findCategory`, `isCategoryVisible`,
  `visibleCategories`. This is the entire pure-logic deliverable of this
  phase.
- **Create:** `tests/categories.test.ts` — the full test suite for the
  module above.

---

### Task 1: `user_categories` table, RLS, and RLS-suite coverage

**Files:**
- Create: `supabase/migrations/<next-number>_user_categories.sql`
- Modify: `tests/rls/harness.ts`

**Interfaces:**
- Produces: a `public.user_categories` table with columns `user_id uuid`,
  `category_key text`, `enabled boolean`, `enabled_at timestamptz`,
  `disabled_at timestamptz`, primary key `(user_id, category_key)`. No
  other task in this phase reads or writes it yet — Task 2 is pure
  TypeScript with no database dependency.

- [ ] **Step 1: Find the real next migration number**

Run:
```bash
ls supabase/migrations/ | tail -5
```
and, if the Supabase CLI is linked in this environment:
```bash
supabase migration list
```
Use one past the highest number either command shows. If they disagree
(concurrent work has landed migrations locally that aren't listed, or vice
versa), trust the higher of the two — a collision fails loudly at apply
time; a gap does not.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/<next-number>_user_categories.sql`:

```sql
-- <next-number>_user_categories.sql
--
-- Per-user category activation state.
--
-- What categories *exist* is a TypeScript registry
-- (src/lib/engines/categories.ts), not a database table — a category only
-- exists once its pages ship, and a table of definitions would just be a
-- join for something the code already knows. This table holds the one
-- thing that genuinely is per-user data: whether a given category is
-- switched on.
--
-- category_key deliberately carries no `check` constraint, matching
-- notifications.kind rather than coach_threads.kind elsewhere in this
-- schema. The category set is expected to grow, and a check constraint
-- would demand a migration for every category the application code adds.
--
-- enabled=false must never be read as "delete this user's domain data" -
-- disabling a category is a visibility change, not a data-deletion
-- operation. Nothing in this migration, or in any code that reads this
-- table, touches plans, commitments, or any other domain table.

create table public.user_categories (
  user_id       uuid not null references auth.users (id) on delete cascade,
  category_key  text not null,
  enabled       boolean not null default false,
  enabled_at    timestamptz,
  disabled_at   timestamptz,
  primary key (user_id, category_key)
);

comment on table public.user_categories is
  'Per-user category activation state. The registry of what categories '
  'exist lives in code (src/lib/engines/categories.ts), not here.';
comment on column public.user_categories.category_key is
  'Unconstrained on purpose - see the migration header. Validated by the '
  'application against the registry, not by the database.';

-- ---------------------------------------------------------------------------
-- Row Level Security. Same four-policy shape as fitness_assessments,
-- session_feedback and skill_unlocks in 20260903120001_video_system.sql.
-- ---------------------------------------------------------------------------
alter table public.user_categories enable row level security;

create policy user_categories_select_own on public.user_categories
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy user_categories_insert_own on public.user_categories
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy user_categories_update_own on public.user_categories
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy user_categories_delete_own on public.user_categories
  for delete to authenticated
  using ((select auth.uid()) = user_id);
```

- [ ] **Step 3: Apply the migration**

If a Supabase project is linked in this environment:
```bash
supabase db push
```
If nothing is linked (no live project available), skip to Step 4 and note
in the commit message that this migration is written but unapplied —
consistent with how earlier unapplied migrations in this project's history
have been handled; do not fabricate a "verified" claim for a step that
did not run.

- [ ] **Step 4: Add the table to the RLS isolation sweep**

In `tests/rls/harness.ts`, find the `OWNER_TABLES` array and add the new
table. Keep it near the other tables added alongside the video/progression
system, since it's part of the same "small per-user state table" family:

```ts
  'fitness_assessments',
  'session_feedback',
  'skill_unlocks',
  'user_categories',
```

- [ ] **Step 5: Run the RLS suite**

Run: `npm run test:rls`
Expected: all existing tests still pass, including the "never leaks
Alice's rows through any owner table" and "reaches no user-owned table"
sweeps, both of which now iterate `user_categories` too. If no live project
is linked in this environment, this step cannot run — say so plainly rather
than claiming a result.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_user_categories.sql tests/rls/harness.ts
git commit -m "Add user_categories table with RLS

Per-user activation state for the category system in
docs/superpowers/specs/2026-09-18-modular-categories-design.md.
category_key is unconstrained on purpose (categories are a code
registry, not database rows) - see the migration header.

RLS follows the existing four-policy own-row pattern; added to the
isolation sweep in tests/rls/harness.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Category registry and visibility algorithm

**Files:**
- Create: `src/lib/engines/categories.ts`
- Test: `tests/categories.test.ts`

**Interfaces:**
- Consumes: nothing — no dependency on Task 1's table, or on any other
  module in this codebase beyond TypeScript itself.
- Produces (for later phases to build on):
  - `type CategoryDefinition = { key: string; label: string; route: string; requiresSetup: boolean; icon: string; parentKey?: string }`
  - `const CATEGORIES: CategoryDefinition[]`
  - `function findCategory(key: string): CategoryDefinition | undefined`
  - `function isCategoryVisible(key: string, enabled: ReadonlySet<string>): boolean`
  - `function visibleCategories(enabled: ReadonlySet<string>): CategoryDefinition[]`

  A later phase's data-layer function (not part of this plan) is
  responsible for querying `user_categories` and building the
  `enabled: ReadonlySet<string>` argument these functions take — this
  module never queries anything itself.

- [ ] **Step 1: Write the failing test file**

Create `tests/categories.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  findCategory,
  isCategoryVisible,
  visibleCategories,
} from '@/lib/engines/categories';

describe('CATEGORIES', () => {
  it('defines exactly the six categories this build ships', () => {
    const keys = CATEGORIES.map((c) => c.key).sort();
    expect(keys).toEqual(
      ['checklist', 'coach', 'cycle', 'fitness', 'money', 'reminders'].sort(),
    );
  });

  it('marks only Fitness as requiring setup', () => {
    for (const category of CATEGORIES) {
      const expected = category.key === 'fitness';
      expect(category.requiresSetup, category.key).toBe(expected);
    }
  });

  it('marks only Coach as a sub-feature, parented to fitness', () => {
    for (const category of CATEGORIES) {
      if (category.key === 'coach') {
        expect(category.parentKey).toBe('fitness');
      } else {
        expect(category.parentKey, category.key).toBeUndefined();
      }
    }
  });

  it('gives every category a route and a label', () => {
    for (const category of CATEGORIES) {
      expect(category.route.startsWith('/'), category.key).toBe(true);
      expect(category.label.length, category.key).toBeGreaterThan(0);
    }
  });
});

describe('findCategory', () => {
  it('finds a known category by key', () => {
    expect(findCategory('money')?.label).toBe('Money');
  });

  it('returns undefined for an unknown key rather than throwing', () => {
    expect(findCategory('not-a-real-category')).toBeUndefined();
  });
});

describe('isCategoryVisible', () => {
  it('is visible when a top-level category is in the enabled set', () => {
    expect(isCategoryVisible('money', new Set(['money']))).toBe(true);
  });

  it('is not visible when the enabled set is empty', () => {
    expect(isCategoryVisible('money', new Set())).toBe(false);
  });

  it('is not visible when a different category is enabled', () => {
    expect(isCategoryVisible('money', new Set(['fitness']))).toBe(false);
  });

  it('resolves a sub-feature from its parent, not its own key', () => {
    // Coach has no independent toggle - only 'fitness' ever appears in the
    // enabled set, never 'coach' itself.
    expect(isCategoryVisible('coach', new Set(['fitness']))).toBe(true);
    expect(isCategoryVisible('coach', new Set(['money']))).toBe(false);
    expect(isCategoryVisible('coach', new Set(['coach']))).toBe(false);
  });

  it('returns false for a key that is not in the registry at all', () => {
    // A stray or typo'd user_categories row must never grant visibility to
    // something the registry does not define.
    expect(isCategoryVisible('not-a-real-category', new Set(['not-a-real-category']))).toBe(
      false,
    );
  });

  it(
    'cannot be influenced by an active fitness plan - the function has ' +
      'nowhere for one to enter',
    () => {
      // This is a structural test, not a behavioural one: isCategoryVisible
      // takes only an enabled set as its second argument. There is no plan,
      // no user id, no database handle anywhere in its signature, so a
      // caller cannot make Fitness visible by any means other than putting
      // 'fitness' in the enabled set - regardless of what plans says.
      expect(isCategoryVisible('fitness', new Set())).toBe(false);
      expect(isCategoryVisible('fitness', new Set(['money']))).toBe(false);
    },
  );
});

describe('visibleCategories', () => {
  it('returns nothing when nothing is enabled', () => {
    expect(visibleCategories(new Set())).toEqual([]);
  });

  it('returns enabled top-level categories and their visible sub-features', () => {
    const visible = visibleCategories(new Set(['fitness'])).map((c) => c.key);
    expect(visible).toContain('fitness');
    expect(visible).toContain('coach');
    expect(visible).not.toContain('money');
  });

  it('preserves registry order rather than enabled-set order', () => {
    const visible = visibleCategories(new Set(['fitness', 'money'])).map((c) => c.key);
    const registryOrder = CATEGORIES.map((c) => c.key).filter((k) => visible.includes(k));
    expect(visible).toEqual(registryOrder);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/categories.test.ts`
Expected: FAIL — `Cannot find module '@/lib/engines/categories'`

- [ ] **Step 3: Write the module**

Create `src/lib/engines/categories.ts`:

```ts
/**
 * What categories this app supports, and whether a given user has one
 * switched on.
 *
 * Categories are a code-defined registry, not a database table. A category
 * only exists once its pages ship, so a table of category *definitions*
 * would only be a join for something the code already knows. The one thing
 * that genuinely is per-user data is *enabled state*, which lives in
 * `public.user_categories` (see the migration in this same phase) and is
 * read by a later data-layer function - never by this module.
 *
 * Everything here is pure: no database read, no clock, no framework
 * import with runtime cost - the same discipline as the rest of
 * `src/lib/engines`. Icons are kebab-case strings rather than live
 * `lucide-react` component references, so this module stays free of a
 * framework dependency; the render layer resolves the string to a
 * component where it already imports icons.
 */

export interface CategoryDefinition {
  key: string;
  label: string;
  route: string;
  requiresSetup: boolean;
  icon: string;
  /** Sub-features (currently only Coach) have no user_categories row of
   *  their own - their visibility is computed from this parent's enabled
   *  state. See isCategoryVisible. */
  parentKey?: string;
}

export const CATEGORIES: CategoryDefinition[] = [
  { key: 'money', label: 'Money', route: '/money', requiresSetup: false, icon: 'wallet' },
  { key: 'fitness', label: 'Fitness', route: '/today', requiresSetup: true, icon: 'footprints' },
  { key: 'reminders', label: 'Reminders', route: '/reminders', requiresSetup: false, icon: 'bell' },
  { key: 'checklist', label: 'Checklist', route: '/checklist', requiresSetup: false, icon: 'check-square' },
  { key: 'cycle', label: 'Cycle', route: '/cycle', requiresSetup: false, icon: 'droplet' },
  {
    key: 'coach',
    label: 'Coach',
    route: '/coach',
    requiresSetup: false,
    icon: 'message-circle-heart',
    parentKey: 'fitness',
  },
];

export function findCategory(key: string): CategoryDefinition | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

/**
 * Is this category visible to a user who has the given top-level
 * categories enabled?
 *
 * The algorithm is generic, not special-cased for Coach: a category with no
 * parentKey is gated on its own key; a category with a parentKey is gated
 * on the parent's key instead. The next sub-feature (a future `Food >
 * Kitchen`, say) costs one registry entry, not new logic here.
 *
 * Takes only the enabled set - never a user id, a plan, or a database
 * handle - so a caller has no way to make a category visible except by
 * putting its gating key in that set. In particular, nothing about an
 * active fitness plan can make Fitness visible; only user_categories can.
 */
export function isCategoryVisible(key: string, enabled: ReadonlySet<string>): boolean {
  const category = findCategory(key);
  if (!category) return false;

  const gateKey = category.parentKey ?? category.key;
  // A parentKey pointing at a typo'd or removed category must not silently
  // grant visibility to anyone.
  if (!findCategory(gateKey)) return false;

  return enabled.has(gateKey);
}

/** Every category currently visible to this user, in registry order. */
export function visibleCategories(enabled: ReadonlySet<string>): CategoryDefinition[] {
  return CATEGORIES.filter((c) => isCategoryVisible(c.key, enabled));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/categories.test.ts`
Expected: PASS, all 15 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. (`npm run typecheck` may report pre-existing errors confined
to `.next/dev/types/routes.d.ts` or an unrelated in-progress test file —
those are not this task's concern; confirm no new error appears in
`src/lib/engines/categories.ts` or `tests/categories.test.ts` specifically.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/engines/categories.ts tests/categories.test.ts
git commit -m "Add the category registry and visibility algorithm

Pure module: the CATEGORIES registry from design spec section 1, and
isCategoryVisible/visibleCategories implementing the generic
parent-visibility algorithm from section 7 - a sub-feature like Coach
is gated on its parent's key, with no Coach-specific logic.

isCategoryVisible takes only an enabled set, never a user id or a
plan - there is nowhere for an active fitness plan to enter its
signature, which is what the 'cannot be influenced by an active
fitness plan' test is checking structurally rather than just
behaviourally.

Icons are kebab-case strings, not live lucide-react component
references, keeping this module free of the one framework import the
rest of src/lib/engines never carries; a later phase resolves the
string in app-nav.tsx, where lucide-react is already imported.

Verified: 15 new tests passing, full suite and typecheck clean.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** §1 (registry) → Task 2's `CATEGORIES`/`CategoryDefinition`.
§2 (`user_categories` table + RLS + `OWNER_TABLES`) → Task 1. §7 (visibility
algorithm, generic parent-gating) → Task 2's `isCategoryVisible`. The user's
explicitly requested test — an active `plans` row alone must not make Fitness
visible — is covered structurally in Task 2 Step 1, not just behaviourally:
`isCategoryVisible`'s signature has no parameter a plan could occupy.
Everything else in the spec (dashboard, profile, toggle actions, routing,
the twelve guards, the backfill) is out of scope for this phase, per the
spec's own "Order of work," and nothing in this plan touches those files.

**Placeholder scan.** No TBD/TODO; every step carries complete code, not a
description of code.

**Type consistency.** `CategoryDefinition`, `CATEGORIES`, `findCategory`,
`isCategoryVisible`, `visibleCategories` are named identically between the
Interfaces block, the test file, and the implementation — checked by hand
after writing both.

## Done when

- `user_categories` exists with RLS, `npm run test:rls` passes (or, if no
  live project is available in this environment, the migration is written
  and the harness updated, with that limitation stated plainly rather than
  a false "verified").
- `src/lib/engines/categories.ts` and `tests/categories.test.ts` exist,
  `npm test` and `npm run typecheck` are clean.
- Two commits, each independently reviewable.

## Out of scope (later phases, per the spec's Order of work)

Dashboard, Profile screen, toggle server actions, `/dashboard` routing,
`onboarding-name`, the `(app)/(fitness)/layout.tsx` guard, all twelve
`requireCategoryEnabled` / `reviewAllDueUsers` write guards, and the
existing-user backfill migration. None of these are touched by this plan.
