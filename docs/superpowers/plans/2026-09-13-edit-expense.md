# Edit Expense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone correct or remove a recorded spend, without being able to change who owns it, break the category rules, or silently un-pay a bill.

**Architecture:** Ownership and history are enforced in Postgres — RLS for who can touch a row, `before` triggers for the rules an edit must not break, an `after` trigger that writes every change to an append-only `spend_revisions` table. The decision about what an edit *means* (what changed, whether a bill stops being paid) is a pure engine, `planSpendEdit`, which the server action calls and which is unit-tested. The UI is a client list that edits inline.

**Tech Stack:** Next.js 16 App Router (server actions), Supabase Postgres with RLS, Zod 4.4.3, Vitest, Playwright (system Chrome) for end-to-end verification.

**Spec:** `docs/superpowers/specs/2026-09-13-money-roadmap.md` — Feature 1, and findings 1–7, which this plan closes. Read the findings before starting; they explain why each guard exists.

## Global Constraints

- Money is integer paise everywhere. Zod money fields use `.int()`. No rupee value is ever stored.
- Zod is **4.4.3**: strict objects are `z.strictObject({...})`, not `.strict()`.
- RLS policies are owner-only, one per command, `to authenticated`, written `(select auth.uid()) = user_id`.
- Every `security definer` function sets `search_path = ''` and schema-qualifies every name.
- Any trigger that writes a user-owned row while rows are being deleted must first check `if not exists (select 1 from auth.users u where u.id = old.user_id)`. Precedent: `20260829100014_fix_rollup_on_user_delete.sql`.
- An update action never accepts `user_id` or `commitment_id` from the client.
- A `'use server'` file may export only async functions. Exported constants and non-async helpers fail `npm run build`.
- **Migration number: take the next free one at execution time** from `npx supabase migration list --linked`. Latest applied when this plan was written: `20260903120013`. Another session allocates from the same sequence.
- If `npx supabase db push` fails with `LegacyDbConnectError`, the direct database port is intermittently unreachable from this machine. Wait 20–30 seconds and retry; it has always recovered.
- This Next.js has breaking changes from older versions. Before using an API you have not seen elsewhere in `src/`, read the relevant guide in `node_modules/next/dist/docs/` (see `AGENTS.md`).
- Copy never scolds. A consequence is stated as a fact in plain words.
- Unit tests: `npm test`. Live isolation tests: `npm run test:rls` (needs `.env.local`; creates and deletes real users on the linked project).
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Before each commit, run `git status` and confirm you are not committing an unrelated change made concurrently by another session.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/<next>_spend_edits.sql` | **Create.** `spends.updated_at`; `spend_revisions` table and its RLS; revision trigger; ownership guards for `spends.commitment_id` and `incomes.source_id`; category lock on bill payments |
| `src/lib/engines/spend-edit.ts` | **Create.** Pure: given a spend, a requested change and the bill it settled, decide the patch and any warning |
| `src/components/spend-list.tsx` | **Create.** Client list of recent spends with inline edit and confirmed remove |
| `tests/spend-edit.test.ts` | **Create.** Unit tests for the engine |
| `tests/money-categories.test.ts` | **Create.** Fails if either database category constraint drifts from the engine's list |
| `src/lib/engines/money.ts` | **Modify.** Export `SPEND_CATEGORY_IDS` |
| `src/lib/engines/commitments.ts` | **Modify.** Export `PAID_THRESHOLD` and use it |
| `src/lib/actions/money.ts` | **Modify.** Use the engine's category list; UUID-check `deleteSpend`; add `updateSpend`; add `warning` to `MoneyResult` |
| `src/lib/data/money.ts` | **Modify.** `SpendRow` carries `commitmentId` and `intent` |
| `src/app/(app)/money/page.tsx` | **Modify.** Render `SpendList` in place of the static Recent list |
| `tests/rls/harness.ts` | **Modify.** Add seven tables to `OWNER_TABLES` |
| `tests/rls/isolation.test.ts` | **Modify.** Two new `describe` blocks |
| `docs/STATUS.md` | **Modify.** Record what shipped |

---

### Task 1: Put the money tables under the isolation suite

These tests pin behaviour the RLS policies **already** provide, so they are expected to pass on first run. What makes them meaningful rather than vacuous is the first test, which fails if Alice has no row to protect.

**Files:**
- Modify: `tests/rls/harness.ts` (the `OWNER_TABLES` array)
- Modify: `tests/rls/isolation.test.ts` (new `describe` inserted before the `// --- reference data` comment)

**Interfaces:**
- Consumes: `createTestUser`, `adminClient`, `alice`, `bob` from the existing suite.
- Produces: `OWNER_TABLES` now includes `spends`, `money_settings`, `commitments`, `income_sources`, `incomes`, `step_segments`, `step_validations`.

- [ ] **Step 1: Record the baseline**

Run: `npm run test:rls`
Expected: `Tests  19 passed (19)`. If the count differs, another session has changed the suite — read the diff before continuing.

- [ ] **Step 2: Add the tables to the sweep**

In `tests/rls/harness.ts`, replace:

```ts
  'notification_prefs',
  'notifications',
] as const;
```

with:

```ts
  'notification_prefs',
  'notifications',
  // Money and step validation. These have carried owner-only policies since
  // they were created, and were missing from this list until 2026-09-13 — so
  // the guarantee in the comment above did not actually hold for them.
  'spends',
  'money_settings',
  'commitments',
  'income_sources',
  'incomes',
  'step_segments',
  'step_validations',
] as const;
```

`food_prices` is deliberately **not** added: its `user_id` is nullable because shared and private prices share the table, so a generic "no foreign rows" sweep would flag the shared ones. It needs its own test and is out of scope here.

- [ ] **Step 3: Write the money isolation tests**

In `tests/rls/isolation.test.ts`, insert this block immediately before the line `  // --- reference data -----------------------------------------------------`:

```ts
  // --- money --------------------------------------------------------------

  describe('money stays with its owner', () => {
    const MONEY_TABLES = [
      'spends',
      'money_settings',
      'commitments',
      'income_sources',
      'incomes',
      'step_segments',
      'step_validations',
    ] as const;

    let aliceSpendId: string;

    beforeAll(async () => {
      const { data: spend, error: spendError } = await alice.client
        .from('spends')
        .insert({
          user_id: alice.id,
          spent_on: '2026-01-15',
          amount_paise: 45_000,
          category: 'medical',
          note: 'alice private pharmacy',
        })
        .select('id')
        .single();
      expect(spendError).toBeNull();
      aliceSpendId = spend!.id as string;

      const seeds = await Promise.all([
        alice.client
          .from('money_settings')
          .upsert({ user_id: alice.id, monthly_limit_paise: 5_000_000 }, { onConflict: 'user_id' }),
        alice.client
          .from('commitments')
          .insert({ user_id: alice.id, label: 'alice rent', amount_paise: 1_200_000, category: 'rent' }),
        alice.client
          .from('income_sources')
          .insert({ user_id: alice.id, label: 'alice salary', kind: 'salary' }),
        alice.client
          .from('incomes')
          .insert({ user_id: alice.id, amount_paise: 5_000_000, received_on: '2026-01-01' }),
        alice.client.from('step_segments').insert({
          user_id: alice.id,
          log_date: '2026-01-15',
          started_at: '2026-01-15T08:00:00Z',
          ended_at: '2026-01-15T08:30:00Z',
          steps: 3000,
          platform_id: `rls-${alice.id}`,
        }),
        alice.client.from('step_validations').insert({
          user_id: alice.id,
          log_date: '2026-01-15',
          raw_steps: 3000,
          validated_steps: 3000,
          excluded_steps: 0,
          confidence: 'high',
        }),
      ]);
      for (const seed of seeds) expect(seed.error).toBeNull();
    }, 60_000);

    it('has something of Alice’s in every money table, so the checks below mean something', async () => {
      const admin = adminClient();
      for (const table of MONEY_TABLES) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', alice.id);
        expect((data ?? []).length, `${table} has no row for Alice`).toBeGreaterThan(0);
      }
    });

    it('never shows Bob a row of Alice’s money', async () => {
      for (const table of MONEY_TABLES) {
        const { data } = await bob.client.from(table).select('user_id');
        const foreign = (data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id);
        expect(foreign, `${table} leaked rows to another user`).toHaveLength(0);
      }
    }, 60_000);

    it('silently changes nothing when Bob edits Alice’s spend', async () => {
      const { data } = await bob.client
        .from('spends')
        .update({ amount_paise: 1 })
        .eq('id', aliceSpendId)
        .select();
      expect(data ?? []).toHaveLength(0);

      const { data: after } = await alice.client
        .from('spends')
        .select('amount_paise')
        .eq('id', aliceSpendId)
        .single();
      expect(Number(after!.amount_paise)).toBe(45_000);
    });

    it('refuses to move Bob’s own spend onto Alice’s account', async () => {
      const { data: own } = await bob.client
        .from('spends')
        .insert({ user_id: bob.id, amount_paise: 100, category: 'other' })
        .select('id')
        .single();

      const { error } = await bob.client
        .from('spends')
        .update({ user_id: alice.id })
        .eq('id', own!.id);
      expect(error).not.toBeNull();
      // The row would fail the policy's WITH CHECK after the update.
      expect(error!.code).toBe('42501');
    });

    it('cannot delete Alice’s spend', async () => {
      await bob.client.from('spends').delete().eq('id', aliceSpendId);
      const { data } = await alice.client.from('spends').select('id').eq('id', aliceSpendId);
      expect(data ?? []).toHaveLength(1);
    });

    it('refuses income recorded on Alice’s behalf', async () => {
      const { error } = await bob.client
        .from('incomes')
        .insert({ user_id: alice.id, amount_paise: 100 });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });
  });

```

- [ ] **Step 4: Run the suite**

Run: `npm run test:rls`
Expected: `Tests  25 passed (25)`.

If `has something of Alice’s in every money table` fails, the seeding failed and every other result in the block is meaningless — read the seed error before anything else. If any other test fails, **stop**: a live table is leaking and that is a security incident, not a test to adjust.

- [ ] **Step 5: Commit**

```bash
git add tests/rls/harness.ts tests/rls/isolation.test.ts
git commit -m "Cover the money tables in the isolation suite

OWNER_TABLES promised that a table added without a policy would fail the
build. Seven user-owned tables were never added, so for them it did not.
They now are, with a seeded row each so the checks are not vacuous.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: One definition of the spending categories

**Files:**
- Create: `tests/money-categories.test.ts`
- Modify: `src/lib/engines/money.ts` (add export before `const LABELS = …`)
- Modify: `src/lib/actions/money.ts` (delete local tuple, import engine list)

**Interfaces:**
- Produces: `SPEND_CATEGORY_IDS: [SpendCategory, ...SpendCategory[]]` from `@/lib/engines/money`. Task 5 uses it in `updateSpend`'s schema.

- [ ] **Step 1: Write the failing test**

Create `tests/money-categories.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, SPEND_CATEGORY_IDS } from '@/lib/engines/money';

/**
 * The category list used to live in four places: the engine, a tuple in the
 * money action, and two database CHECK constraints that were typed out
 * separately. They agreed by coincidence. This fails the moment either
 * constraint drifts from the engine.
 *
 * If a later migration alters either constraint, point the matching test at
 * that migration instead.
 */
function constraintCategories(migration: string): string[] {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', migration), 'utf8');
  const match = sql.match(/check\s*\(\s*category\s+in\s*\(([\s\S]*?)\)\s*\)/i);
  if (!match) throw new Error(`No category check constraint found in ${migration}`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('spending categories have one definition', () => {
  it('exposes the ids in the same order as the labelled list', () => {
    expect(SPEND_CATEGORY_IDS).toEqual(CATEGORIES.map((c) => c.id));
  });

  it('has no duplicates', () => {
    expect(new Set(SPEND_CATEGORY_IDS).size).toBe(SPEND_CATEGORY_IDS.length);
  });

  it('matches the constraint on spends', () => {
    expect(constraintCategories('20260903120009_money.sql').sort()).toEqual(
      [...SPEND_CATEGORY_IDS].sort(),
    );
  });

  it('matches the constraint on commitments, which retyped the list', () => {
    expect(constraintCategories('20260903120010_commitments.sql').sort()).toEqual(
      [...SPEND_CATEGORY_IDS].sort(),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/money-categories.test.ts`
Expected: FAIL — `SPEND_CATEGORY_IDS` is not exported, so it is `undefined`.

- [ ] **Step 3: Export the list from the engine**

In `src/lib/engines/money.ts`, insert immediately before `const LABELS = new Map(CATEGORIES.map((c) => [c.id, c.label]));`:

```ts
/**
 * The category ids as a non-empty tuple, which is the shape `z.enum` needs.
 *
 * This is the one list the others are checked against:
 * `tests/money-categories.test.ts` fails if either database constraint drifts
 * from it.
 */
export const SPEND_CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [
  SpendCategory,
  ...SpendCategory[],
];

```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/money-categories.test.ts`
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Remove the action's private copy**

In `src/lib/actions/money.ts`, replace:

```ts
import { formatRupees } from '@/lib/engines/money';
```

with:

```ts
import { formatRupees, SPEND_CATEGORY_IDS } from '@/lib/engines/money';
```

Delete the whole block that begins `const CATEGORIES = [` and ends `] as const;` (the sixteen quoted ids and the blank line after it).

In `spendSchema`, replace:

```ts
  category: z.enum(CATEGORIES),
```

with:

```ts
  category: z.enum(SPEND_CATEGORY_IDS),
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all unit tests pass, including the four new ones.

- [ ] **Step 7: Commit**

```bash
git add tests/money-categories.test.ts src/lib/engines/money.ts src/lib/actions/money.ts
git commit -m "Keep the spending categories in one place

The list was typed out four times — engine, action, and two database
constraints — and agreed by coincidence. The action now imports the
engine's list, and a test fails if either constraint drifts from it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Guard edits in the database and remember every change

**Files:**
- Modify: `tests/rls/isolation.test.ts` (second new `describe`, directly after Task 1's)
- Create: `supabase/migrations/<next>_spend_edits.sql`

**Interfaces:**
- Consumes: the Task 1 suite structure.
- Produces:
  - `spends.updated_at timestamptz`
  - `spend_revisions(id, user_id, spend_id, action 'update'|'delete', before jsonb, changed_fields text[], changed_at)`
  - Error `42501` when a spend references another user's commitment, or an income references another user's income source
  - Error `23514` when the category of a spend with `commitment_id` is changed

- [ ] **Step 1: Write the failing tests**

In `tests/rls/isolation.test.ts`, insert immediately after the closing `});` of Task 1's `describe('money stays with its owner', …)` block:

```ts
  describe('money edits are guarded and remembered', () => {
    let aliceCommitmentId: string;
    let aliceSourceId: string;

    beforeAll(async () => {
      const [{ data: commitment }, { data: source }] = await Promise.all([
        alice.client
          .from('commitments')
          .insert({
            user_id: alice.id,
            label: 'alice internet',
            amount_paise: 89_900,
            category: 'phone_internet',
          })
          .select('id')
          .single(),
        alice.client
          .from('income_sources')
          .insert({ user_id: alice.id, label: 'alice freelance', kind: 'freelance' })
          .select('id')
          .single(),
      ]);
      aliceCommitmentId = commitment!.id as string;
      aliceSourceId = source!.id as string;
    }, 60_000);

    // Found 2026-09-13. Foreign-key checks run with the table owner's rights
    // and ignore RLS, so both inserts were accepted even though Bob could not
    // read either row.
    it('refuses a spend that settles another user’s commitment', async () => {
      const { error } = await bob.client.from('spends').insert({
        user_id: bob.id,
        amount_paise: 100,
        category: 'phone_internet',
        commitment_id: aliceCommitmentId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('refuses income attributed to another user’s income source', async () => {
      const { error } = await bob.client.from('incomes').insert({
        user_id: bob.id,
        amount_paise: 100,
        source_id: aliceSourceId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('still lets Alice settle her own commitment', async () => {
      const { error } = await alice.client.from('spends').insert({
        user_id: alice.id,
        amount_paise: 89_900,
        category: 'phone_internet',
        commitment_id: aliceCommitmentId,
      });
      expect(error).toBeNull();
    });

    it('will not recategorise a payment that settled a commitment', async () => {
      const { data: payment } = await alice.client
        .from('spends')
        .insert({
          user_id: alice.id,
          amount_paise: 89_900,
          category: 'phone_internet',
          commitment_id: aliceCommitmentId,
        })
        .select('id')
        .single();

      const { error } = await alice.client
        .from('spends')
        .update({ category: 'groceries' })
        .eq('id', payment!.id);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
    });

    it('stamps updated_at on an edit', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 500, category: 'other' })
        .select('id')
        .single();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const { data: after } = await alice.client
        .from('spends')
        .update({ amount_paise: 600 })
        .eq('id', spend!.id)
        .select('created_at, updated_at')
        .single();

      expect(new Date(after!.updated_at as string).getTime()).toBeGreaterThan(
        new Date(after!.created_at as string).getTime(),
      );
    });

    it('records what a spend looked like before it was edited', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 25_000, category: 'clothes', note: 'before' })
        .select('id')
        .single();

      await alice.client
        .from('spends')
        .update({ amount_paise: 30_000, note: 'after' })
        .eq('id', spend!.id);

      const { data: revisions, error } = await alice.client
        .from('spend_revisions')
        .select('action, before, changed_fields')
        .eq('spend_id', spend!.id);

      expect(error).toBeNull();
      expect(revisions).toHaveLength(1);
      expect(revisions![0].action).toBe('update');
      const before = revisions![0].before as { amount_paise: number; note: string };
      expect(Number(before.amount_paise)).toBe(25_000);
      expect(before.note).toBe('before');
      expect([...(revisions![0].changed_fields as string[])].sort()).toEqual([
        'amount_paise',
        'note',
      ]);
    });

    it('does not record an edit that changed nothing', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 700, category: 'other' })
        .select('id')
        .single();

      await alice.client.from('spends').update({ amount_paise: 700 }).eq('id', spend!.id);

      const { data: revisions } = await alice.client
        .from('spend_revisions')
        .select('id')
        .eq('spend_id', spend!.id);
      expect(revisions ?? []).toHaveLength(0);
    });

    it('keeps a removed spend in the history', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 1_500, category: 'gifts' })
        .select('id')
        .single();

      await alice.client.from('spends').delete().eq('id', spend!.id);

      const { data: revisions } = await alice.client
        .from('spend_revisions')
        .select('action, before')
        .eq('spend_id', spend!.id);
      expect(revisions).toHaveLength(1);
      expect(revisions![0].action).toBe('delete');
      expect(Number((revisions![0].before as { amount_paise: number }).amount_paise)).toBe(1_500);
    });

    it('never shows Bob Alice’s history', async () => {
      const { data: exists } = await adminClient()
        .from('spend_revisions')
        .select('id')
        .eq('user_id', alice.id);
      expect((exists ?? []).length, 'Alice needs history for this to mean anything').toBeGreaterThan(0);

      const { data } = await bob.client.from('spend_revisions').select('user_id');
      const foreign = (data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id);
      expect(foreign).toHaveLength(0);
    });

    it('does not let Alice rewrite or erase her own history', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 900, category: 'other' })
        .select('id')
        .single();
      await alice.client.from('spends').update({ amount_paise: 950 }).eq('id', spend!.id);

      const { data: edited } = await alice.client
        .from('spend_revisions')
        .update({ changed_fields: [] })
        .eq('spend_id', spend!.id)
        .select();
      expect(edited ?? []).toHaveLength(0);

      await alice.client.from('spend_revisions').delete().eq('spend_id', spend!.id);

      const { data: kept } = await adminClient()
        .from('spend_revisions')
        .select('id')
        .eq('spend_id', spend!.id);
      expect(kept ?? []).toHaveLength(1);
    });

    // The trap from 20260829100014: a trigger that writes a row for a user who
    // is being deleted fails the foreign key and aborts the whole deletion.
    it('still deletes an account whose spends have history', async () => {
      const doomed = await createTestUser('doomed-money');
      const { data: spend } = await doomed.client
        .from('spends')
        .insert({ user_id: doomed.id, amount_paise: 1_000, category: 'other' })
        .select('id')
        .single();
      await doomed.client.from('spends').update({ amount_paise: 1_100 }).eq('id', spend!.id);

      const { error } = await adminClient().auth.admin.deleteUser(doomed.id);
      expect(error, 'account deletion failed').toBeNull();

      const admin = adminClient();
      for (const table of ['spends', 'spend_revisions']) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', doomed.id);
        expect(data ?? [], `${table} kept rows for a deleted user`).toHaveLength(0);
      }
    }, 60_000);
  });

```

- [ ] **Step 2: Run the suite to verify the right tests fail**

Run: `npm run test:rls`
Expected: `Tests  8 failed | 28 passed (36)`.

The eight failures must be: *refuses a spend that settles…*, *refuses income attributed…*, *will not recategorise…*, *stamps updated_at…*, *records what a spend looked like…*, *keeps a removed spend…*, *never shows Bob Alice’s history*, *does not let Alice rewrite…*.

Three new tests pass before the migration, and that is expected: *still lets Alice settle her own commitment* guards against the fix over-reaching; *does not record an edit that changed nothing* and *still deletes an account…* are vacuous until the table and trigger exist, and become real regression guards after Step 4.

If *refuses a spend that settles another user’s commitment* **passes** here, the foreign-key hole has been closed by someone else. Read the new migrations before writing a duplicate guard.

- [ ] **Step 3: Write the migration**

Run `npx supabase migration list --linked` and take the next free number. Create `supabase/migrations/<that number>_spend_edits.sql`:

```sql
-- <number>_spend_edits.sql
--
-- What an edit to a spend is allowed to do, and a record of every edit made.
--
-- Spends could be added and nothing else. Correcting one needs three things
-- the schema did not have:
--
-- 1. **Rules an edit cannot break**, enforced where no application bug can
--    skip them. A spend that settled a bill keeps the bill's category, and no
--    spend or income can point at another user's commitment or income source.
-- 2. **A history.** Every change and every removal writes the row as it was.
-- 3. **`updated_at`**, so "when was this last touched" has an answer.

-- ---------------------------------------------------------------------------
-- 1. updated_at
-- ---------------------------------------------------------------------------
alter table public.spends
  add column if not exists updated_at timestamptz not null default now();

comment on column public.spends.updated_at is
  'Set by trigger on every update. Rows that existed before this migration '
  'carry the time the migration ran, not their true last edit.';

create trigger spends_touch before update on public.spends
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Ownership of references
--
-- Foreign-key checks run with the table owner's rights and ignore RLS. Proven
-- on 2026-09-13: a user who could not read another user's commitment could
-- still insert a spend with commitment_id set to it. The ids are random and
-- unreadable to them, so the practical risk is low — but the data model's
-- ownership rule was not actually being enforced.
-- ---------------------------------------------------------------------------
create or replace function private.check_spend_commitment_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.commitment_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.commitments c
    where c.id = new.commitment_id
      and c.user_id = new.user_id
  ) then
    raise exception 'a spend cannot settle a commitment belonging to another user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger spends_commitment_owner
  before insert or update of commitment_id, user_id on public.spends
  for each row execute function private.check_spend_commitment_owner();

create or replace function private.check_income_source_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.income_sources s
    where s.id = new.source_id
      and s.user_id = new.user_id
  ) then
    raise exception 'income cannot belong to an income source owned by another user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger incomes_source_owner
  before insert or update of source_id, user_id on public.incomes
  for each row execute function private.check_income_source_owner();

-- ---------------------------------------------------------------------------
-- 3. A bill payment keeps the bill's category
--
-- A spend carrying commitment_id is what marks that commitment paid. Letting
-- its category change would file a rent payment under groceries while it still
-- counted towards rent. To file it differently, remove it and record it again.
-- ---------------------------------------------------------------------------
create or replace function private.lock_settled_spend_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.commitment_id is not null
     and new.commitment_id is not distinct from old.commitment_id
     and new.category is distinct from old.category then
    raise exception 'the category of a spend that settled a commitment follows that commitment'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger spends_lock_settled_category
  before update of category on public.spends
  for each row execute function private.lock_settled_spend_category();

-- ---------------------------------------------------------------------------
-- 4. History
--
-- Append-only from the user's side: they can read their own revisions and
-- nothing else. Only the trigger writes, as security definer.
--
-- spend_id has no foreign key on purpose. A removed spend's history has to
-- outlive the spend, or "what did I delete" has no answer.
-- ---------------------------------------------------------------------------
create table public.spend_revisions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  spend_id       uuid not null,
  action         text not null check (action in ('update', 'delete')),
  -- The whole row as it was before the change.
  before         jsonb not null,
  changed_fields text[] not null default array[]::text[],
  changed_at     timestamptz not null default now()
);

create index spend_revisions_spend_idx on public.spend_revisions (spend_id, changed_at desc);
create index spend_revisions_user_idx on public.spend_revisions (user_id, changed_at desc);

comment on table public.spend_revisions is
  'Every edit and removal of a spend, as the row was before it. Written only by '
  'trigger; readable only by its owner; not editable by anyone through the API.';

alter table public.spend_revisions enable row level security;

create policy spend_revisions_select on public.spend_revisions
  for select to authenticated using ((select auth.uid()) = user_id);
-- No insert, update or delete policy: history is not something a client writes.

create or replace function private.record_spend_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed text[] := array[]::text[];
begin
  -- The account-deletion trap (see 20260829100014). Deleting a user cascades to
  -- their spends and fires this trigger for each one; writing a revision for a
  -- user who no longer exists fails the foreign key and aborts the deletion.
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.spend_revisions (user_id, spend_id, action, before)
    values (old.user_id, old.id, 'delete', to_jsonb(old));
    return null;
  end if;

  if new.amount_paise  is distinct from old.amount_paise  then changed := changed || 'amount_paise'::text;  end if;
  if new.category      is distinct from old.category      then changed := changed || 'category'::text;      end if;
  if new.note          is distinct from old.note          then changed := changed || 'note'::text;          end if;
  if new.spent_on      is distinct from old.spent_on      then changed := changed || 'spent_on'::text;      end if;
  if new.intent        is distinct from old.intent        then changed := changed || 'intent'::text;        end if;
  if new.commitment_id is distinct from old.commitment_id then changed := changed || 'commitment_id'::text; end if;

  -- An update that changed nothing a person would recognise is not history.
  -- updated_at is ignored here for the same reason.
  if cardinality(changed) = 0 then
    return null;
  end if;

  insert into public.spend_revisions (user_id, spend_id, action, before, changed_fields)
  values (old.user_id, old.id, 'update', to_jsonb(old), changed);

  return null;
end;
$$;

create trigger spends_revision
  after update or delete on public.spends
  for each row execute function private.record_spend_revision();
```

- [ ] **Step 4: Apply it**

Run: `npx supabase db push --linked --include-all`
Expected: `Applying migration <number>_spend_edits.sql...` then `Finished supabase db push.`

- [ ] **Step 5: Run the suite to verify everything passes**

Run: `npm run test:rls`
Expected: `Tests  36 passed (36)`.

Then run `npm test` and confirm the unit suite is unaffected.

- [ ] **Step 6: Commit**

```bash
git add tests/rls/isolation.test.ts supabase/migrations/*_spend_edits.sql
git commit -m "Guard spend edits in the database and keep their history

Foreign-key checks ignore RLS, so a spend could settle another user's
commitment and an income could claim another user's source; both now
raise 42501. A bill payment keeps its bill's category. Every edit and
removal writes the prior row to append-only spend_revisions, with the
auth.users guard that account deletion needs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Decide what an edit means

**Files:**
- Create: `tests/spend-edit.test.ts`
- Create: `src/lib/engines/spend-edit.ts`
- Modify: `src/lib/engines/commitments.ts` (export `PAID_THRESHOLD`; use it at the `0.95` line)

**Interfaces:**
- Consumes: `formatRupees`, `SpendCategory` from `@/lib/engines/money`.
- Produces:
  - `PAID_THRESHOLD = 0.95` from `@/lib/engines/commitments`
  - From `@/lib/engines/spend-edit`:

```ts
export type SpendIntent = 'need' | 'want' | 'obligation' | 'savings';

export interface ExistingSpend {
  id: string;
  amountPaise: number;
  category: SpendCategory;
  note: string | null;
  spentOn: string;          // YYYY-MM-DD
  intent: SpendIntent | null;
  commitmentId: string | null;
}

export interface SpendChange {
  amountPaise?: number;
  category?: SpendCategory;
  note?: string | null;
  spentOn?: string;
  intent?: SpendIntent | null;
}

export interface LinkedCommitment {
  label: string;
  amountPaise: number;
  /** Paid against it in the same window by *other* spends. */
  otherPaidPaise: number;
}

export type SpendEditPlan =
  | { ok: true; changed: false }
  | { ok: true; changed: true; patch: SpendChange; warning: string | null }
  | { ok: false; error: string };

export function planSpendEdit(
  existing: ExistingSpend,
  change: SpendChange,
  linked: LinkedCommitment | null,
): SpendEditPlan;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/spend-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { planSpendEdit, type ExistingSpend, type LinkedCommitment } from '@/lib/engines/spend-edit';

const groceries: ExistingSpend = {
  id: 'spend-1',
  amountPaise: 45_000,
  category: 'groceries',
  note: 'veg',
  spentOn: '2026-09-10',
  intent: null,
  commitmentId: null,
};

const rentPayment: ExistingSpend = {
  id: 'spend-2',
  amountPaise: 1_200_000,
  category: 'rent',
  note: 'Rent',
  spentOn: '2026-09-01',
  intent: null,
  commitmentId: 'commitment-rent',
};

const rent: LinkedCommitment = { label: 'Rent', amountPaise: 1_200_000, otherPaidPaise: 0 };

describe('planSpendEdit', () => {
  it('reports no change when nothing differs', () => {
    const plan = planSpendEdit(groceries, { amountPaise: 45_000, note: 'veg' }, null);
    expect(plan).toEqual({ ok: true, changed: false });
  });

  it('puts only the fields that actually changed into the patch', () => {
    const plan = planSpendEdit(groceries, { amountPaise: 52_000, note: 'veg', category: 'groceries' }, null);
    expect(plan).toEqual({ ok: true, changed: true, patch: { amountPaise: 52_000 }, warning: null });
  });

  it('refuses an amount that is not a positive whole number of paise', () => {
    for (const amountPaise of [0, -100, 10.5]) {
      const plan = planSpendEdit(groceries, { amountPaise }, null);
      expect(plan.ok).toBe(false);
    }
  });

  it('trims a note and treats an empty one as no note', () => {
    expect(planSpendEdit(groceries, { note: '  veg  ' }, null)).toEqual({ ok: true, changed: false });

    const cleared = planSpendEdit(groceries, { note: '   ' }, null);
    expect(cleared).toEqual({ ok: true, changed: true, patch: { note: null }, warning: null });
  });

  it('allows recategorising an ordinary spend', () => {
    const plan = planSpendEdit(groceries, { category: 'eating_out' }, null);
    expect(plan).toEqual({ ok: true, changed: true, patch: { category: 'eating_out' }, warning: null });
  });

  it('refuses to recategorise a payment that settled a bill, and names the bill', () => {
    const plan = planSpendEdit(rentPayment, { category: 'groceries' }, rent);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error).toContain('Rent');
      expect(plan.error).toMatch(/remove it and record it again/i);
    }
  });

  /*
   * An explicit need/want choice answered a question about the *old* category.
   * Carrying it onto a new one would silently force that category's
   * classification, which is exactly the guessing the salary breakdown refuses.
   */
  it('clears a need/want choice when the category changes', () => {
    const clothes: ExistingSpend = { ...groceries, category: 'clothes', intent: 'need' };
    const plan = planSpendEdit(clothes, { category: 'gifts' }, null);
    expect(plan).toEqual({
      ok: true,
      changed: true,
      patch: { category: 'gifts', intent: null },
      warning: null,
    });
  });

  it('keeps a need/want choice made in the same edit as the category change', () => {
    const clothes: ExistingSpend = { ...groceries, category: 'clothes', intent: 'need' };
    const plan = planSpendEdit(clothes, { category: 'gifts', intent: 'want' }, null);
    expect(plan).toEqual({
      ok: true,
      changed: true,
      patch: { category: 'gifts', intent: 'want' },
      warning: null,
    });
  });

  it('warns when an edit leaves a bill no longer fully paid', () => {
    const plan = planSpendEdit(rentPayment, { amountPaise: 500_000 }, rent);
    expect(plan.ok && plan.changed && plan.warning).toMatch(/Rent will show as not fully paid/);
    expect(plan.ok && plan.changed && plan.warning).toContain('₹5,000 of ₹12,000');
  });

  it('does not warn when other payments still cover the bill', () => {
    const covered: LinkedCommitment = { ...rent, otherPaidPaise: 1_000_000 };
    const plan = planSpendEdit(rentPayment, { amountPaise: 200_000 }, covered);
    expect(plan.ok && plan.changed && plan.warning).toBeNull();
  });

  it('does not warn about a bill that was not fully paid to begin with', () => {
    const partial: ExistingSpend = { ...rentPayment, amountPaise: 600_000 };
    const plan = planSpendEdit(partial, { amountPaise: 500_000 }, rent);
    expect(plan.ok && plan.changed && plan.warning).toBeNull();
  });

  it('warns when a bill payment moves to another month', () => {
    const plan = planSpendEdit(rentPayment, { spentOn: '2026-08-31' }, rent);
    expect(plan.ok && plan.changed && plan.warning).toMatch(/may no longer count/);
  });

  it('never warns about an ordinary spend', () => {
    const plan = planSpendEdit(groceries, { amountPaise: 1, spentOn: '2025-01-01' }, null);
    expect(plan.ok && plan.changed && plan.warning).toBeNull();
  });

  it('never scolds', () => {
    const plan = planSpendEdit(rentPayment, { amountPaise: 100 }, rent);
    const text = plan.ok && plan.changed ? (plan.warning ?? '') : '';
    expect(text).not.toMatch(/should|must|careful|mistake|wrong/i);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/spend-edit.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/engines/spend-edit"`.

- [ ] **Step 3: Export the paid threshold**

In `src/lib/engines/commitments.ts`, insert immediately after `export const DUE_SOON_DAYS = 5;`:

```ts

/**
 * Share of a commitment that counts as settling it.
 *
 * ₹11,950 by bank transfer settles a ₹12,000 rent. Exported because editing a
 * payment must use the same line to know when an edit would un-pay a bill.
 */
export const PAID_THRESHOLD = 0.95;
```

Replace:

```ts
    const paid = paidPaise >= commitment.amountPaise * 0.95;
```

with:

```ts
    const paid = paidPaise >= commitment.amountPaise * PAID_THRESHOLD;
```

- [ ] **Step 4: Write the engine**

Create `src/lib/engines/spend-edit.ts`:

```ts
import { PAID_THRESHOLD } from '@/lib/engines/commitments';
import { formatRupees, type SpendCategory } from '@/lib/engines/money';

/**
 * What an edit to a recorded spend means.
 *
 * The database decides what an edit is *allowed* to do. This decides what it
 * *does*: which fields really changed, and whether the change has a
 * consequence the person should hear about before they see it somewhere else —
 * a rent payment edited down to ₹5,000 leaves the rent unpaid, and the daily
 * job will raise an overdue reminder the next morning.
 */

export type SpendIntent = 'need' | 'want' | 'obligation' | 'savings';

export interface ExistingSpend {
  id: string;
  amountPaise: number;
  category: SpendCategory;
  note: string | null;
  /** YYYY-MM-DD. */
  spentOn: string;
  intent: SpendIntent | null;
  commitmentId: string | null;
}

export interface SpendChange {
  amountPaise?: number;
  category?: SpendCategory;
  note?: string | null;
  spentOn?: string;
  intent?: SpendIntent | null;
}

export interface LinkedCommitment {
  label: string;
  amountPaise: number;
  /** Paid against the commitment in the same window by other spends. */
  otherPaidPaise: number;
}

export type SpendEditPlan =
  | { ok: true; changed: false }
  | { ok: true; changed: true; patch: SpendChange; warning: string | null }
  | { ok: false; error: string };

export function planSpendEdit(
  existing: ExistingSpend,
  change: SpendChange,
  linked: LinkedCommitment | null,
): SpendEditPlan {
  const patch: SpendChange = {};

  if (change.amountPaise !== undefined) {
    if (!Number.isInteger(change.amountPaise) || change.amountPaise <= 0) {
      return { ok: false, error: 'Enter an amount greater than zero.' };
    }
    if (change.amountPaise !== existing.amountPaise) patch.amountPaise = change.amountPaise;
  }

  if (change.category !== undefined && change.category !== existing.category) {
    if (existing.commitmentId !== null) {
      const bill = linked ? linked.label : 'a recurring bill';
      return {
        ok: false,
        error: `This payment settled ${bill}, so it stays filed with it. To file it differently, remove it and record it again.`,
      };
    }

    patch.category = change.category;

    // A need/want choice answered a question about the old category. Carried
    // onto a new one it would silently decide that category's classification,
    // so it is cleared unless this same edit makes the choice again.
    if (change.intent === undefined && existing.intent !== null) patch.intent = null;
  }

  if (change.note !== undefined) {
    const note = change.note === null ? null : change.note.trim() || null;
    if (note !== existing.note) patch.note = note;
  }

  if (change.spentOn !== undefined && change.spentOn !== existing.spentOn) {
    patch.spentOn = change.spentOn;
  }

  if (change.intent !== undefined && change.intent !== existing.intent) {
    patch.intent = change.intent;
  }

  if (Object.keys(patch).length === 0) return { ok: true, changed: false };

  return { ok: true, changed: true, patch, warning: warningFor(existing, patch, linked) };
}

function warningFor(
  existing: ExistingSpend,
  patch: SpendChange,
  linked: LinkedCommitment | null,
): string | null {
  if (existing.commitmentId === null || linked === null) return null;

  const threshold = linked.amountPaise * PAID_THRESHOLD;
  const before = linked.otherPaidPaise + existing.amountPaise;
  const after = linked.otherPaidPaise + (patch.amountPaise ?? existing.amountPaise);

  if (before >= threshold && after < threshold) {
    return (
      `${linked.label} will show as not fully paid: ` +
      `${formatRupees(after)} of ${formatRupees(linked.amountPaise)} recorded.`
    );
  }

  // Month-level rather than exact money-month, which depends on the user's
  // start day — hence "may".
  if (patch.spentOn !== undefined && patch.spentOn.slice(0, 7) !== existing.spentOn.slice(0, 7)) {
    return `This payment settled ${linked.label}. In another month it may no longer count as paid for this one.`;
  }

  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/spend-edit.test.ts tests/commitments.test.ts`
Expected: all pass — 14 in `spend-edit`, and the existing `commitments` tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add tests/spend-edit.test.ts src/lib/engines/spend-edit.ts src/lib/engines/commitments.ts
git commit -m "Decide what a spend edit means, including when it un-pays a bill

Pure engine: which fields changed, refusing to recategorise a bill
payment, clearing a stale need/want choice when the category changes, and
warning before an edit leaves a bill unpaid or moves it to another month.
PAID_THRESHOLD is now shared with the commitments engine.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The server action, a checked delete, and the fields the list needs

Server actions call `createClient()`, which reads `next/headers`, so they cannot run under Vitest. This action is deliberately thin — every decision is in the Task 4 engine, which is tested — and it is verified end to end in Task 6.

**Files:**
- Modify: `src/lib/actions/money.ts`
- Modify: `src/lib/data/money.ts`

**Interfaces:**
- Consumes: `SPEND_CATEGORY_IDS`, `monthWindow` (`@/lib/engines/money`); `planSpendEdit`, `ExistingSpend`, `LinkedCommitment`, `SpendIntent` (`@/lib/engines/spend-edit`).
- Produces:
  - `MoneyResult = { ok: true; message: string; warning?: string | null } | { ok: false; error: string }`
  - `updateSpend(input: unknown): Promise<MoneyResult>` — input `{ id: string; amountPaise?: number; category?: SpendCategory; note?: string | null; spentOn?: string; intent?: SpendIntent | null }`; any other key is rejected
  - `SpendRow` gains `commitmentId: string | null` and `intent: string | null`

- [ ] **Step 1: Carry the new fields in the read model**

In `src/lib/data/money.ts`, replace:

```ts
export interface SpendRow {
  id: string;
  amountPaise: number;
  category: string;
  note: string | null;
  spentOn: string;
}
```

with:

```ts
export interface SpendRow {
  id: string;
  amountPaise: number;
  category: string;
  note: string | null;
  spentOn: string;
  /** Set when this spend settled a recurring commitment. Its category is locked. */
  commitmentId: string | null;
  intent: string | null;
}
```

Replace:

```ts
const SAMPLE_SPENDS: SpendRow[] = [
```

with:

```ts
const SAMPLE_SPEND_ROWS: Omit<SpendRow, 'commitmentId' | 'intent'>[] = [
```

Directly after the closing `];` of that array (the line after `{ id: 's6', … }`), add:

```ts

const SAMPLE_SPENDS: SpendRow[] = SAMPLE_SPEND_ROWS.map((s) => ({
  ...s,
  commitmentId: null,
  intent: null,
}));
```

Replace:

```ts
    .select('id, amount_paise, category, note, spent_on')
```

with:

```ts
    .select('id, amount_paise, category, note, spent_on, commitment_id, intent')
```

Replace:

```ts
    spentOn: r.spent_on as string,
  }));
```

with:

```ts
    spentOn: r.spent_on as string,
    commitmentId: (r.commitment_id as string) ?? null,
    intent: (r.intent as string) ?? null,
  }));
```

- [ ] **Step 2: Typecheck the read model**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Update the action's imports and result type**

In `src/lib/actions/money.ts`, replace:

```ts
import { formatRupees, SPEND_CATEGORY_IDS } from '@/lib/engines/money';
```

with:

```ts
import { formatRupees, monthWindow, SPEND_CATEGORY_IDS, type SpendCategory } from '@/lib/engines/money';
import {
  planSpendEdit,
  type ExistingSpend,
  type LinkedCommitment,
  type SpendIntent,
} from '@/lib/engines/spend-edit';
```

Replace:

```ts
export type MoneyResult = { ok: true; message: string } | { ok: false; error: string };
```

with:

```ts
export type MoneyResult =
  | { ok: true; message: string; warning?: string | null }
  | { ok: false; error: string };
```

- [ ] **Step 4: Make delete check its id**

Replace:

```ts
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // RLS would reject someone else's row anyway; the explicit filter keeps the
```

with:

```ts
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: 'We could not find that spend.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // RLS would reject someone else's row anyway; the explicit filter keeps the
```

- [ ] **Step 5: Add `updateSpend`**

Insert immediately before `const limitSchema = z.object({`:

```ts
/**
 * Correct a recorded spend.
 *
 * `z.strictObject` rejects any key it does not name, so a request carrying
 * `user_id` or `commitment_id` fails validation rather than being quietly
 * ignored — ownership and the bill a payment settled are never editable from
 * here. The database enforces both again underneath.
 */
const updateSchema = z.strictObject({
  id: z.string().uuid(),
  amountPaise: z.number().int().positive().max(100_000_000_000).optional(),
  category: z.enum(SPEND_CATEGORY_IDS).optional(),
  note: z.string().max(200).nullable().optional(),
  spentOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  intent: z.enum(['need', 'want', 'obligation', 'savings']).nullable().optional(),
});

export async function updateSpend(input: unknown): Promise<MoneyResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that change.' };
  const { id, ...change } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  const { data: row } = await supabase
    .from('spends')
    .select('id, amount_paise, category, note, spent_on, intent, commitment_id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!row) return { ok: false, error: 'We could not find that spend.' };

  const existing: ExistingSpend = {
    id: row.id as string,
    amountPaise: Number(row.amount_paise),
    category: row.category as SpendCategory,
    note: (row.note as string) ?? null,
    spentOn: row.spent_on as string,
    intent: (row.intent as SpendIntent) ?? null,
    commitmentId: (row.commitment_id as string) ?? null,
  };

  const linked = existing.commitmentId
    ? await loadLinkedCommitment(supabase, userId, existing)
    : null;

  const plan = planSpendEdit(existing, change, linked);
  if (!plan.ok) return { ok: false, error: plan.error };
  if (!plan.changed) return { ok: true, message: 'Nothing to change.' };

  const { patch } = plan;
  const { data: updated, error } = await supabase
    .from('spends')
    .update({
      ...(patch.amountPaise !== undefined ? { amount_paise: patch.amountPaise } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.spentOn !== undefined ? { spent_on: patch.spentOn } : {}),
      ...(patch.intent !== undefined ? { intent: patch.intent } : {}),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  // Exactly one row, or the change did not happen — never report success on
  // an update that quietly matched nothing.
  if (error || !updated || updated.length !== 1) {
    console.error('spend update failed', error);
    return { ok: false, error: "We couldn't save that change." };
  }

  revalidatePath('/money');
  revalidatePath('/today');

  return { ok: true, message: 'Updated.', warning: plan.warning };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The bill a payment settled, and what else has been paid towards it in the
 * same money-month. Not exported: a 'use server' module's exports are callable
 * from the browser, and this takes a database client.
 */
async function loadLinkedCommitment(
  supabase: Client,
  userId: string,
  spend: ExistingSpend,
): Promise<LinkedCommitment | null> {
  const [commitmentRes, settingsRes] = await Promise.all([
    supabase
      .from('commitments')
      .select('label, amount_paise')
      .eq('id', spend.commitmentId!)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('money_settings').select('month_start_day').eq('user_id', userId).maybeSingle(),
  ]);

  if (!commitmentRes.data) return null;

  const window = monthWindow(
    new Date(`${spend.spentOn}T12:00:00Z`),
    settingsRes.data?.month_start_day ?? 1,
  );

  const { data: others } = await supabase
    .from('spends')
    .select('amount_paise')
    .eq('user_id', userId)
    .eq('commitment_id', spend.commitmentId!)
    .neq('id', spend.id)
    .gte('spent_on', window.start)
    .lt('spent_on', window.end);

  return {
    label: commitmentRes.data.label as string,
    amountPaise: Number(commitmentRes.data.amount_paise),
    otherPaidPaise: (others ?? []).reduce((sum, r) => sum + Number(r.amount_paise), 0),
  };
}

```

- [ ] **Step 6: Verify, including the build**

Run: `npx tsc --noEmit && npx eslint src && npm test && npm run build`
Expected: no type errors; lint clean; all unit tests pass; `✓ Compiled successfully`.

The build is the check that matters most here. If it fails with *"A 'use server' file can only export async functions"*, something other than an async function was exported from `money.ts` — `Client` and `loadLinkedCommitment` must stay unexported.

- [ ] **Step 7: Commit**

```bash
git add src/lib/actions/money.ts src/lib/data/money.ts
git commit -m "Add updateSpend, and check the id deleteSpend receives

The action is thin: validation with a strict schema so user_id and
commitment_id cannot be sent, then planSpendEdit decides what changes and
whether it un-pays a bill. An update that matches no row reports failure,
not success. SpendRow now carries commitmentId and intent for the list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Edit and remove from the Recent list, verified end to end

**Files:**
- Create: `src/components/spend-list.tsx`
- Modify: `src/app/(app)/money/page.tsx`
- Modify: `docs/STATUS.md`
- Create then delete: `.verify-edit-expense.mjs` (repository root, never committed)

**Interfaces:**
- Consumes: `updateSpend`, `deleteSpend`, `MoneyResult` (`@/lib/actions/money`); `SpendRow` (`@/lib/data/money`); `CATEGORIES`, `categoryLabel`, `formatRupees`, `parseAmountToPaise`, `SpendCategory` (`@/lib/engines/money`); `Alert`, `Button`, `Field`, `inputClass`, `inputStyle` (`@/components/ui`).
- Produces: `SpendList({ spends: SpendRow[]; canEdit: boolean })`.

- [ ] **Step 1: Write the component**

Create `src/components/spend-list.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import {
  CATEGORIES,
  categoryLabel,
  formatRupees,
  parseAmountToPaise,
  type SpendCategory,
} from '@/lib/engines/money';
import { deleteSpend, updateSpend } from '@/lib/actions/money';
import type { SpendRow } from '@/lib/data/money';

/**
 * This month's spends, each one correctable.
 *
 * A wrong amount in a total is worse than no amount, because it looks right.
 * Until this existed a spend could only be added: a typo stayed in every
 * figure on the screen for the rest of the month.
 *
 * Editing is inline rather than in a dialog, so the entry being corrected stays
 * in view beside its neighbours while it changes.
 */

const EMOJI = new Map(CATEGORIES.map((c) => [c.id, c.emoji]));

type Notice = { tone: 'success' | 'warning' | 'error'; text: string };

export function SpendList({ spends, canEdit }: { spends: SpendRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();

  if (spends.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
        Nothing recorded yet.
      </p>
    );
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteSpend(id);
      setConfirming(null);
      setNotice(
        result.ok ? { tone: 'success', text: result.message } : { tone: 'error', text: result.error },
      );
    });
  }

  return (
    <div>
      {notice ? (
        <div className="mb-3">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}

      <ul>
        {spends.map((s) => {
          const label = `${categoryLabel(s.category)} ${formatRupees(s.amountPaise)}`;

          return (
            <li
              key={s.id}
              className="border-b py-2.5 first:pt-0 last:border-0 last:pb-0"
              style={{ borderColor: 'var(--line)' }}
            >
              {editing === s.id ? (
                <EditForm
                  spend={s}
                  onCancel={() => setEditing(null)}
                  onDone={(next) => {
                    setEditing(null);
                    setNotice(next);
                  }}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm">
                        {EMOJI.get(s.category as SpendCategory) ?? '•'} {categoryLabel(s.category)}
                      </span>
                      {s.note ? (
                        <span className="ml-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                          {s.note}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center">
                      <span className="data text-sm font-semibold">{formatRupees(s.amountPaise)}</span>
                      <span className="data ml-2 text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
                        {s.spentOn.slice(8)}/{s.spentOn.slice(5, 7)}
                      </span>

                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            aria-label={`Edit ${label}`}
                            onClick={() => {
                              setEditing(s.id);
                              setConfirming(null);
                              setNotice(null);
                            }}
                            className="ml-1 flex size-11 cursor-pointer items-center justify-center rounded-[10px]"
                            style={{ color: 'var(--fg-subtle)' }}
                          >
                            <Pencil size={15} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${label}`}
                            aria-expanded={confirming === s.id}
                            onClick={() => {
                              setConfirming(confirming === s.id ? null : s.id);
                              setEditing(null);
                              setNotice(null);
                            }}
                            className="flex size-11 cursor-pointer items-center justify-center rounded-[10px]"
                            style={{ color: 'var(--fg-subtle)' }}
                          >
                            <Trash2 size={15} aria-hidden />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {confirming === s.id ? (
                    <div
                      className="mt-2.5 flex flex-wrap items-center gap-2 p-3"
                      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
                    >
                      <span className="flex-1 text-sm">
                        {s.commitmentId
                          ? 'Remove this payment? The bill it settled may show as unpaid again.'
                          : 'Remove this spend?'}
                      </span>
                      <Button variant="danger" size="sm" disabled={pending} onClick={() => remove(s.id)}>
                        {pending ? 'Removing…' : 'Remove'}
                      </Button>
                      <Button variant="quiet" size="sm" disabled={pending} onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EditForm({
  spend,
  onCancel,
  onDone,
}: {
  spend: SpendRow;
  onCancel: () => void;
  onDone: (notice: Notice) => void;
}) {
  const [amount, setAmount] = useState((spend.amountPaise / 100).toFixed(2).replace(/\.00$/, ''));
  const [category, setCategory] = useState(spend.category);
  const [note, setNote] = useState(spend.note ?? '');
  const [spentOn, setSpentOn] = useState(spend.spentOn);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const settled = spend.commitmentId !== null;

  async function save() {
    const paise = parseAmountToPaise(amount);
    if (paise === null || paise <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    setSaving(true);
    setError(null);

    const result = await updateSpend({
      id: spend.id,
      amountPaise: paise,
      // A bill payment's category follows the bill, and the database refuses
      // to change it — so it is not sent rather than sent and rejected.
      ...(settled ? {} : { category }),
      note: note.trim() === '' ? null : note.trim(),
      spentOn,
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onDone(
      result.warning
        ? { tone: 'warning', text: result.warning }
        : { tone: 'success', text: result.message },
    );
  }

  return (
    <div
      className="space-y-3 p-3"
      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" htmlFor={`edit-amount-${spend.id}`}>
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id={`edit-amount-${spend.id}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`data ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field label="Date" htmlFor={`edit-date-${spend.id}`}>
          <input
            id={`edit-date-${spend.id}`}
            type="date"
            value={spentOn}
            onChange={(e) => setSpentOn(e.target.value)}
            className={`data ${inputClass}`}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field
        label="What it was for"
        htmlFor={`edit-category-${spend.id}`}
        description={settled ? 'This paid a recurring bill, so it stays filed with that bill.' : undefined}
      >
        <select
          id={`edit-category-${spend.id}`}
          value={category}
          disabled={settled}
          onChange={(e) => setCategory(e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Note" htmlFor={`edit-note-${spend.id}`}>
        <input
          id={`edit-note-${spend.id}`}
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex gap-2">
        <Button disabled={saving} onClick={save}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
        <Button variant="quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Use it on the money page**

In `src/app/(app)/money/page.tsx`, replace:

```tsx
import { CATEGORIES, categoryLabel, formatRupees, type CategoryTotal } from '@/lib/engines/money';
```

with:

```tsx
import { CATEGORIES, formatRupees, type CategoryTotal } from '@/lib/engines/money';
import { SpendList } from '@/components/spend-list';
```

Replace this whole block inside the `Recent` section:

```tsx
              {view.recent.length > 0 ? (
                <ul>
                  {view.recent.slice(0, 25).map((s) => (
                    <li
                      key={s.id}
                      className="flex items-baseline justify-between gap-3 border-b py-2.5 first:pt-0 last:border-0 last:pb-0"
                      style={{ borderColor: 'var(--line)' }}
                    >
                      <div className="min-w-0">
                        <span className="text-sm">
                          {EMOJI.get(s.category as never) ?? '•'} {categoryLabel(s.category)}
                        </span>
                        {s.note ? (
                          <span className="ml-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                            {s.note}
                          </span>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="data text-sm font-semibold">
                          {formatRupees(s.amountPaise)}
                        </span>
                        <span
                          className="data ml-2 text-[12px]"
                          style={{ color: 'var(--fg-subtle)' }}
                        >
                          {s.spentOn.slice(8)}/{s.spentOn.slice(5, 7)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  Nothing recorded yet.
                </p>
              )}
```

with:

```tsx
              <SpendList spends={view.recent.slice(0, 25)} canEdit={!view.isSample} />
```

`EMOJI` is still used by `CategoryBar` in the same file; leave its definition.

- [ ] **Step 3: Verify statically**

Run: `npx tsc --noEmit && npx eslint src && npm test && npm run build`
Expected: no type errors; lint clean (in particular no unused `categoryLabel`); all unit tests pass; `✓ Compiled successfully`.

- [ ] **Step 4: Start the dev server and confirm it is this app**

Run the dev server in the background with `npm run dev`, then:

Run: `curl -s http://localhost:3000/login | grep -o "<title>[^<]*</title>"`
Expected: `<title>Sign in — FitCoach</title>`.

Another project on this machine has served port 3000 before. If the title is anything else, or `next dev` reports *"Another next dev server is already running"*, use the port it names and change `BASE` in the next step to match.

- [ ] **Step 5: Write the end-to-end check**

Create `.verify-edit-expense.mjs` in the repository root:

```js
/**
 * End-to-end check for editing and removing spends. Creates a real user on the
 * linked project, drives the page in system Chrome, reads the database back,
 * and deletes the user. Not committed.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:3000';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function call(method, path, body, prefer = 'return=representation') {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: { ...H, Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const EMAIL = 'verify-edit-expense@example.com';
const PASSWORD = 'VerifyEdit!2026xyz';

const existing = await call('GET', '/auth/v1/admin/users?per_page=200');
for (const u of existing.users ?? []) {
  if (u.email === EMAIL) await call('DELETE', `/auth/v1/admin/users/${u.id}`);
}
const user = await call('POST', '/auth/v1/admin/users', { email: EMAIL, password: PASSWORD, email_confirm: true });
const uid = user.id;

try {
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  await call('POST', '/rest/v1/profiles?on_conflict=user_id', {
    user_id: uid, display_name: 'Verify', sex: 'male', age_years: 31, height_cm: 172,
    onboarding_done_at: new Date().toISOString(),
  }, 'resolution=merge-duplicates,return=minimal');
  await call('POST', '/rest/v1/goals', { user_id: uid, goal: 'fat_loss', status: 'active', pace: 'steady', starting_weight_kg: 80 }, 'return=minimal');
  // Onboarding is gated on an active plan; without one the page redirects.
  await call('POST', '/rest/v1/plans', {
    user_id: uid, is_active: true, version: 1, bmr_kcal: 1680, tdee_kcal: 2520, activity: 'light',
    energy_target_kcal: 2100, energy_floor_kcal: 1500, protein_g: 130, fat_g: 65, carb_g: 230,
    fibre_g: 30, water_ml: 2600, step_target: 8000, training_days: 3, sleep_target_hours: 7.5,
    binding_constraint: 'rate_cap',
  }, 'return=minimal');

  const [commitment] = await call('POST', '/rest/v1/commitments', {
    user_id: uid, label: 'Rent', amount_paise: 1_200_000, category: 'rent', due_day: 1, started_on: '2026-01-01',
  });
  const [groceries] = await call('POST', '/rest/v1/spends', {
    user_id: uid, spent_on: today, amount_paise: 45_000, category: 'groceries', note: 'veg',
  });
  await call('POST', '/rest/v1/spends', {
    user_id: uid, spent_on: firstOfMonth, amount_paise: 1_200_000, category: 'rent',
    note: 'Rent', commitment_id: commitment.id,
  });

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1400 } })).newPage();
  page.on('pageerror', (e) => check('no page errors', false, e.message));

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.goto(`${BASE}/money`, { waitUntil: 'networkidle' });

  // Locators use exact matching: Playwright matches names and text as
  // substrings by default, and this page has other buttons and messages that
  // would otherwise satisfy them and let a broken flow pass.

  // 1. Edit an ordinary spend.
  await page.getByRole('button', { name: 'Edit Groceries ₹450' }).click();
  await page.fill(`#edit-amount-${groceries.id}`, '520');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Updated.', { exact: true }).waitFor({ timeout: 15_000 });
  const [afterEdit] = await call('GET', `/rest/v1/spends?id=eq.${groceries.id}&select=amount_paise`);
  check('an ordinary edit is saved', Number(afterEdit.amount_paise) === 52_000, `amount_paise=${afterEdit.amount_paise}`);

  // 2. A bill payment cannot be recategorised, and editing it down warns.
  await page.getByRole('button', { name: 'Edit Rent ₹12,000' }).click();
  const categoryDisabled = await page.locator('select[id^="edit-category-"]').isDisabled();
  check('a bill payment’s category cannot be changed', categoryDisabled);
  await page.fill('input[id^="edit-amount-"]', '5000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const warning = page.getByText(/Rent will show as not fully paid/);
  await warning.waitFor({ timeout: 15_000 });
  check('editing a bill payment down warns', (await warning.textContent()).includes('₹5,000 of ₹12,000'));

  // 3. Remove the ordinary spend.
  await page.getByRole('button', { name: 'Remove Groceries ₹520' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByText('Removed.', { exact: true }).waitFor({ timeout: 15_000 });
  const gone = await call('GET', `/rest/v1/spends?id=eq.${groceries.id}&select=id`);
  check('removal deletes the spend', gone.length === 0);

  // 4. Every change is in the history.
  const revisions = await call('GET', `/rest/v1/spend_revisions?user_id=eq.${uid}&select=action,changed_fields&order=changed_at`);
  const summary = revisions.map((r) => `${r.action}:${(r.changed_fields ?? []).join('+')}`).join(', ');
  check('history records two edits and one removal', revisions.length === 3, summary);

  await browser.close();
} finally {
  await call('DELETE', `/auth/v1/admin/users/${uid}`);
}

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed');
```

- [ ] **Step 6: Run it**

Run: `MSYS_NO_PATHCONV=1 node .verify-edit-expense.mjs`
Expected, in this order:

```text
PASS  an ordinary edit is saved — amount_paise=52000
PASS  a bill payment’s category cannot be changed
PASS  editing a bill payment down warns
PASS  removal deletes the spend
PASS  history records two edits and one removal — update:amount_paise, update:amount_paise, delete:

All checks passed
```

`MSYS_NO_PATHCONV=1` stops Git Bash on Windows from rewriting arguments that begin with `/`. Leave it in.

If *history records two edits and one removal* reports more than three, the form sent a field it did not change. The revision trigger only writes when a value differs, so an extra revision means a real extra edit.

- [ ] **Step 7: Look at it**

Screenshot `/money` at 1280px and at 390px with a spend in edit mode. Confirm the edit form does not overflow its row on the phone, and that the pencil and bin controls are separate 44px targets that do not overlap the date.

- [ ] **Step 8: Delete the verification script**

Run: `rm -f .verify-edit-expense.mjs && git status --short`
Expected: the script is not listed.

- [ ] **Step 9: Update STATUS.md**

In `docs/STATUS.md`, replace:

```markdown
| Editing a recorded spend | **Not built** — same gap food logging had until `f7f07a6`: you can add and delete but not correct |
```

with:

```markdown
| Editing and removing a recorded spend | **Done** — inline in the Recent list. Until this shipped a spend could only be added: `deleteSpend` existed but nothing called it. Edits cannot change ownership or the bill a payment settled (rejected by a strict schema, then again by triggers), a bill payment keeps its bill's category, an edit that leaves a bill unpaid says so before it happens, and every change and removal is kept in append-only `spend_revisions` |
```

- [ ] **Step 10: Commit**

```bash
git add src/components/spend-list.tsx "src/app/(app)/money/page.tsx" docs/STATUS.md
git commit -m "Edit and remove spends from the Recent list

A spend could only be added; deleteSpend had no caller. The list now edits
inline and removes with a confirmation. A bill payment's category is shown
but cannot be changed, and editing one down shows the warning from
planSpendEdit instead of silently leaving the bill unpaid.

Verified end to end against the linked project: an edit saved, a bill
payment's category locked, the un-pay warning shown, a removal deleted,
and three revisions recorded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Deploy**

GitHub pushes do not deploy this project automatically. Push, then deploy:

```bash
git push origin master
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

Run: `curl -s -o /dev/null -w '%{http_code}' https://sajees-fittness.vercel.app/money`
Expected: `307` — the page exists and redirects a signed-out request to the login page.
