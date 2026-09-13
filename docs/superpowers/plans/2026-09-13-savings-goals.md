# Savings Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone save towards named goals, see what each month needs to meet a date, and — once there is enough history to say — how their actual pace compares and when they are likely to get there.

**Architecture:** A goal is a plan in `savings_goals`; money added to it is an ordinary `spends` row filed as savings and carrying `savings_goal_id`, exactly as paying a bill carries `commitment_id`. There is no stored balance. Postgres enforces ownership of the link (trigger), that a contribution is always savings (check constraint), and records link changes in the existing `spend_revisions` history. What a goal's numbers mean is a pure engine, `goalProgress`, unit-tested; a loader feeds it, server actions write through it, and a client panel on `/money` shows it.

**Tech Stack:** Next.js 16 App Router (server actions), Supabase Postgres with RLS, Zod 4.4.3, Vitest, Playwright (system Chrome) for end-to-end verification.

**Spec:** `docs/superpowers/specs/2026-09-13-money-roadmap.md` — Feature 2. Built on what Feature 1 (`docs/superpowers/plans/2026-09-13-edit-expense.md`, shipped in `8697fd8`) left behind: `spend_revisions`, the ownership-trigger pattern, `planSpendEdit`, `updateSpend` and `SpendList`.

## Global Constraints

- Money is integer paise everywhere. No rupee value is ever stored; rupees exist only as typed input and formatted output.
- Zod is **4.4.3**: strict objects are `z.strictObject({...})`, not `.strict()`.
- RLS policies are owner-only, one per command, `to authenticated`, written `(select auth.uid()) = user_id`.
- Every `security definer` function sets `search_path = ''` and schema-qualifies every name.
- Any trigger that writes a user-owned row while rows are being deleted must first check `if not exists (select 1 from auth.users u where u.id = old.user_id)`. `private.record_spend_revision()` already does; keep that check when replacing it.
- A contribution is a spend. Never add a second table that records money going into a goal.
- "Actual average contribution" needs at least **two complete calendar months**; the partial month the goal started in and the partial current month are excluded. With less history, say it does not know yet — never extrapolate.
- A `'use server'` file may export only async functions. Exported constants and non-async helpers fail `npm run build`.
- **Migration number: take the next free one at execution time** from `npx supabase migration list --linked`. Latest applied when this plan was written: `20260903120014`. Another session allocates from the same sequence.
- If `npx supabase db push` fails with `LegacyDbConnectError`, wait 20–30 seconds and retry; it has always recovered.
- This Next.js has breaking changes from older versions. Before using an API you have not seen elsewhere in `src/`, read the relevant guide in `node_modules/next/dist/docs/` (see `AGENTS.md`).
- Copy never scolds. A shortfall is stated as a number, not a judgement.
- Unit tests: `npm test`. Live isolation tests: `npm run test:rls` (needs `.env.local`; creates and deletes real users on the linked project).
- Every commit message ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Before each commit, run `git status` and confirm you are not committing an unrelated change made concurrently by another session.

## Deliberately not in this plan

- **Taking money back out of a goal.** A withdrawal is neither income nor spending in "where did my salary go", and deciding how it shows there is its own piece of work. Until then a goal shows what was put in; a mistaken contribution is corrected or removed from the Recent list, which already keeps history.
- **Editing a goal** (label, target, date). Close it and add a new one.
- **Whether savings count against the monthly amount.** Spends filed as savings already count in the month's total on the ring; this plan does not change that. It is recorded as an open question in STATUS.md.
- **Linking a recurring commitment (a SIP, say) to a goal**, and **reminders** about goals.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/<next>_savings_goals.sql` | **Create.** `savings_goals` and its RLS; `spends.savings_goal_id`; the ownership trigger; the savings-only check; revision trigger replaced to track the new link |
| `src/lib/engines/savings.ts` | **Create.** Pure: a goal, its contributions and today → saved, required monthly, average monthly, projected month, gap, message |
| `src/lib/data/savings.ts` | **Create.** Load open goals and their contributions, run the engine |
| `src/lib/actions/savings.ts` | **Create.** `addSavingsGoal`, `contributeToSavingsGoal`, `closeSavingsGoal` |
| `src/components/savings-panel.tsx` | **Create.** Client panel: goals with progress, add money, close, add a goal |
| `tests/savings.test.ts` | **Create.** Unit tests for the engine |
| `tests/rls/harness.ts` | **Modify.** Add `savings_goals` to `OWNER_TABLES` |
| `tests/rls/isolation.test.ts` | **Modify.** The owner sweep fails on a query error; seed a goal in the money block; new `describe` for goals |
| `src/lib/engines/spend-edit.ts` | **Modify.** `ExistingSpend.savingsGoalId`; refuse to recategorise a contribution |
| `tests/spend-edit.test.ts` | **Modify.** Fixtures gain `savingsGoalId`; two new tests |
| `src/lib/actions/money.ts` | **Modify.** `updateSpend` reads `savings_goal_id` |
| `src/lib/data/money.ts` | **Modify.** `SpendRow.savingsGoalId` |
| `src/components/spend-list.tsx` | **Modify.** A contribution's category is locked in the edit form; removal wording |
| `src/app/(app)/money/page.tsx` | **Modify.** Load goals; render `SavingsPanel` |
| `docs/STATUS.md` | **Modify.** Record what shipped |

---

### Task 1: The goals table, the contribution link, and its guards

The isolation suite's owner-table sweep currently passes for a table that does not exist: a failed query returns `data: null`, which the sweep reads as "nothing leaked". Step 1 closes that first, so adding `savings_goals` to the sweep before the migration genuinely fails. (Verified 2026-09-13: with the error assertion added, the sweep passes against every current table.)

**Files:**
- Modify: `tests/rls/harness.ts` (the `OWNER_TABLES` array)
- Modify: `tests/rls/isolation.test.ts`
- Create: `supabase/migrations/<next>_savings_goals.sql`

**Interfaces:**
- Consumes: `private.touch_updated_at()`, `private.record_spend_revision()` and `public.spend_revisions` from `20260903120014_spend_edits.sql`.
- Produces: table `public.savings_goals (id, user_id, label, target_paise, opening_paise, started_on, target_date, closed_on, created_at, updated_at)`; column `public.spends.savings_goal_id uuid null`; constraint `spends_goal_contribution_is_savings` (violations raise `23514`); trigger `spends_savings_goal_owner` (violations raise `42501`); `spend_revisions.changed_fields` can contain `'savings_goal_id'`.

- [ ] **Step 1: Make the owner sweep fail on a query error**

In `tests/rls/isolation.test.ts`, replace:

```ts
      for (const table of OWNER_TABLES) {
        const { data } = await bob.client.from(table).select('user_id');
        const foreign = (data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id);
        expect(foreign, `${table} leaked rows to another user`).toHaveLength(0);
      }
    }, 90_000);
```

with:

```ts
      for (const table of OWNER_TABLES) {
        const { data, error } = await bob.client.from(table).select('user_id');
        // Without this a missing or misspelt table returns data: null, which
        // reads as "nothing leaked" and passes.
        expect(error, `${table} errored`).toBeNull();
        const foreign = (data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id);
        expect(foreign, `${table} leaked rows to another user`).toHaveLength(0);
      }
    }, 90_000);
```

- [ ] **Step 2: Add the table to the sweep**

In `tests/rls/harness.ts`, replace:

```ts
  'step_segments',
  'step_validations',
] as const;
```

with:

```ts
  'step_segments',
  'step_validations',
  'savings_goals',
] as const;
```

- [ ] **Step 3: Seed a goal in the money block**

In `tests/rls/isolation.test.ts`, replace:

```ts
      'step_segments',
      'step_validations',
    ] as const;

    let aliceSpendId: string;
```

with:

```ts
      'step_segments',
      'step_validations',
      'savings_goals',
    ] as const;

    let aliceSpendId: string;
```

Then replace:

```ts
        alice.client.from('step_validations').insert({
          user_id: alice.id,
          log_date: '2026-01-15',
          raw_steps: 3000,
          validated_steps: 3000,
          excluded_steps: 0,
          confidence: 'high',
        }),
      ]);
```

with:

```ts
        alice.client.from('step_validations').insert({
          user_id: alice.id,
          log_date: '2026-01-15',
          raw_steps: 3000,
          validated_steps: 3000,
          excluded_steps: 0,
          confidence: 'high',
        }),
        alice.client
          .from('savings_goals')
          .insert({ user_id: alice.id, label: 'alice deposit', target_paise: 50_000_000 }),
      ]);
```

- [ ] **Step 4: Write the goal tests**

In `tests/rls/isolation.test.ts`, insert this block immediately before the line `  // --- reference data -----------------------------------------------------`:

```ts
  describe('savings goals keep to their owner', () => {
    let aliceGoalId: string;
    let aliceOtherGoalId: string;
    let bobGoalId: string;

    beforeAll(async () => {
      const [{ data: goal }, { data: other }, { data: bobs }] = await Promise.all([
        alice.client
          .from('savings_goals')
          .insert({ user_id: alice.id, label: 'alice emergency', target_paise: 30_000_000 })
          .select('id')
          .single(),
        alice.client
          .from('savings_goals')
          .insert({ user_id: alice.id, label: 'alice trip', target_paise: 8_000_000 })
          .select('id')
          .single(),
        bob.client
          .from('savings_goals')
          .insert({ user_id: bob.id, label: 'bob bike', target_paise: 9_000_000 })
          .select('id')
          .single(),
      ]);
      aliceGoalId = goal!.id as string;
      aliceOtherGoalId = other!.id as string;
      bobGoalId = bobs!.id as string;
    }, 60_000);

    it('refuses a goal created on Alice’s behalf', async () => {
      const { error } = await bob.client
        .from('savings_goals')
        .insert({ user_id: alice.id, label: 'not yours', target_paise: 100 });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    // Foreign-key checks ignore RLS — the hole Feature 1 closed for
    // commitment_id. The same guard has to cover the new link from day one.
    it('refuses a contribution to another user’s goal', async () => {
      const { error } = await bob.client.from('spends').insert({
        user_id: bob.id,
        amount_paise: 100,
        category: 'savings',
        savings_goal_id: aliceGoalId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('refuses to move a contribution onto another user’s goal', async () => {
      const { data: own } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 1_000, category: 'savings', savings_goal_id: aliceGoalId })
        .select('id')
        .single();

      const { error } = await alice.client
        .from('spends')
        .update({ savings_goal_id: bobGoalId })
        .eq('id', own!.id);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('refuses a contribution that is not filed as savings', async () => {
      const { error } = await alice.client.from('spends').insert({
        user_id: alice.id,
        amount_paise: 1_000,
        category: 'groceries',
        savings_goal_id: aliceGoalId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
    });

    it('will not recategorise a contribution', async () => {
      const { data: contribution } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 2_000, category: 'savings', savings_goal_id: aliceGoalId })
        .select('id')
        .single();

      const { error } = await alice.client
        .from('spends')
        .update({ category: 'eating_out' })
        .eq('id', contribution!.id);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
    });

    it('records a contribution moved to another goal in the history', async () => {
      const { data: contribution } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 3_000, category: 'savings', savings_goal_id: aliceGoalId })
        .select('id')
        .single();

      const { error } = await alice.client
        .from('spends')
        .update({ savings_goal_id: aliceOtherGoalId })
        .eq('id', contribution!.id);
      expect(error).toBeNull();

      const { data: revisions } = await alice.client
        .from('spend_revisions')
        .select('changed_fields, before')
        .eq('spend_id', contribution!.id);
      expect(revisions).toHaveLength(1);
      expect(revisions![0].changed_fields).toEqual(['savings_goal_id']);
      expect((revisions![0].before as { savings_goal_id: string }).savings_goal_id).toBe(aliceGoalId);
    });

    // The money really moved, so removing the goal must not remove the record
    // of it — only the link.
    it('keeps contributions as savings when their goal is removed', async () => {
      const { data: goal } = await alice.client
        .from('savings_goals')
        .insert({ user_id: alice.id, label: 'alice abandoned', target_paise: 1_000_000 })
        .select('id')
        .single();
      const { data: contribution } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 4_000, category: 'savings', savings_goal_id: goal!.id })
        .select('id')
        .single();

      const { error } = await alice.client.from('savings_goals').delete().eq('id', goal!.id);
      expect(error).toBeNull();

      const { data: after } = await alice.client
        .from('spends')
        .select('category, savings_goal_id, amount_paise')
        .eq('id', contribution!.id)
        .single();
      expect(after!.savings_goal_id).toBeNull();
      expect(after!.category).toBe('savings');
      expect(Number(after!.amount_paise)).toBe(4_000);

      const { data: revisions } = await alice.client
        .from('spend_revisions')
        .select('changed_fields')
        .eq('spend_id', contribution!.id);
      expect(revisions).toHaveLength(1);
      expect(revisions![0].changed_fields).toEqual(['savings_goal_id']);
    });

    // Deleting a user cascades to goals (setting spends.savings_goal_id to
    // null, which fires the revision trigger) and to spends. The trap from
    // 20260829100014 in a new shape.
    it('still deletes an account with goals and contributions', async () => {
      const doomed = await createTestUser('doomed-savings');
      const { data: goal } = await doomed.client
        .from('savings_goals')
        .insert({ user_id: doomed.id, label: 'doomed', target_paise: 1_000_000 })
        .select('id')
        .single();
      await doomed.client.from('spends').insert({
        user_id: doomed.id,
        amount_paise: 1_000,
        category: 'savings',
        savings_goal_id: goal!.id,
      });

      const { error } = await adminClient().auth.admin.deleteUser(doomed.id);
      expect(error, 'account deletion failed').toBeNull();

      const admin = adminClient();
      for (const table of ['savings_goals', 'spends', 'spend_revisions']) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', doomed.id);
        expect(data ?? [], `${table} kept rows for a deleted user`).toHaveLength(0);
      }
    }, 60_000);
  });

```

- [ ] **Step 5: Run the suite and confirm it fails for the right reason**

Run: `npm run test:rls`
Expected: failures only in three places, each traceable to `savings_goals` or `savings_goal_id` not existing yet:
- `never leaks Alice’s rows through any owner table` — `savings_goals errored`
- every test in `money stays with its owner` — its setup cannot seed `savings_goals`
- every test in `savings goals keep to their owner`

Every other test passes. If anything else fails, stop: it is not caused by this task.

- [ ] **Step 6: Write the migration**

Run `npx supabase migration list --linked` and take the next free number. Create `supabase/migrations/<that number>_savings_goals.sql`:

```sql
-- <that number>_savings_goals.sql
--
-- Saving towards something: an emergency fund, a deposit, a trip.
--
-- ## A goal is a plan; putting money in is a spend
--
-- The same split as commitments. `savings_goals` holds the plan — what, how
-- much, by when, and anything saved before the app existed. Money added to a
-- goal is an ordinary `spends` row filed as savings and carrying
-- `savings_goal_id`, so "where did my salary go" already counts it as set
-- aside, and there is no second balance to drift out of step with the ledger.
--
-- Taking money back out is not modelled yet. A withdrawal is neither income
-- nor spending in the salary breakdown, and deciding how it should show there
-- is its own piece of work. Until then a goal shows what was put in.

create table public.savings_goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,

  label          text not null check (char_length(label) between 1 and 60),
  target_paise   bigint not null check (target_paise > 0 and target_paise <= 100000000000),

  -- Saved before the goal was recorded here. Kept apart from contributions so
  -- it never counts towards the monthly pace: it was not saved this month.
  opening_paise  bigint not null default 0
                   check (opening_paise >= 0 and opening_paise <= 100000000000),

  started_on     date not null default current_date,
  -- Null for a goal with no deadline.
  target_date    date,
  -- Closed rather than deleted, so contributions keep the goal they were for.
  closed_on      date,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint savings_goals_target_after_start check (target_date is null or target_date >= started_on),
  constraint savings_goals_closed_after_start check (closed_on is null or closed_on >= started_on)
);

create index savings_goals_user_idx on public.savings_goals (user_id) where closed_on is null;

create trigger savings_goals_touch before update on public.savings_goals
  for each row execute function private.touch_updated_at();

comment on table public.savings_goals is
  'What someone is saving towards. A plan, not a balance: what has been saved is '
  'opening_paise plus the spends carrying savings_goal_id.';

-- ---------------------------------------------------------------------------
-- The link from the ledger
-- ---------------------------------------------------------------------------
alter table public.spends
  add column if not exists savings_goal_id uuid
    references public.savings_goals (id) on delete set null;

create index if not exists spends_savings_goal_idx
  on public.spends (savings_goal_id) where savings_goal_id is not null;

comment on column public.spends.savings_goal_id is
  'Set when this spend was money added to a savings goal. Always filed as savings.';

-- A contribution is savings. A constraint rather than a trigger: it covers
-- inserts and edits alike, so a recategorised contribution is refused the same
-- way a mistyped one is.
alter table public.spends
  add constraint spends_goal_contribution_is_savings
    check (savings_goal_id is null or category = 'savings');

-- Foreign-key checks run with the table owner's rights and ignore RLS; see
-- 20260903120014 for the same guard on commitment_id.
create or replace function private.check_spend_savings_goal_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.savings_goal_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.savings_goals g
    where g.id = new.savings_goal_id
      and g.user_id = new.user_id
  ) then
    raise exception 'a spend cannot be added to a savings goal belonging to another user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger spends_savings_goal_owner
  before insert or update of savings_goal_id, user_id on public.spends
  for each row execute function private.check_spend_savings_goal_owner();

-- ---------------------------------------------------------------------------
-- History: the revision trigger learns the new link.
--
-- Identical to 20260903120014 apart from the savings_goal_id line, and it keeps
-- the account-deletion guard, which matters more now: deleting a user sets
-- savings_goal_id to null on their spends before those spends are deleted.
-- ---------------------------------------------------------------------------
create or replace function private.record_spend_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed text[] := array[]::text[];
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return null;
  end if;

  if tg_op = 'DELETE' then
    insert into public.spend_revisions (user_id, spend_id, action, before)
    values (old.user_id, old.id, 'delete', to_jsonb(old));
    return null;
  end if;

  if new.amount_paise    is distinct from old.amount_paise    then changed := changed || 'amount_paise'::text;    end if;
  if new.category        is distinct from old.category        then changed := changed || 'category'::text;        end if;
  if new.note            is distinct from old.note            then changed := changed || 'note'::text;            end if;
  if new.spent_on        is distinct from old.spent_on        then changed := changed || 'spent_on'::text;        end if;
  if new.intent          is distinct from old.intent          then changed := changed || 'intent'::text;          end if;
  if new.commitment_id   is distinct from old.commitment_id   then changed := changed || 'commitment_id'::text;   end if;
  if new.savings_goal_id is distinct from old.savings_goal_id then changed := changed || 'savings_goal_id'::text; end if;

  if cardinality(changed) = 0 then
    return null;
  end if;

  insert into public.spend_revisions (user_id, spend_id, action, before, changed_fields)
  values (old.user_id, old.id, 'update', to_jsonb(old), changed);

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS. Owner-only, per command, auth.uid() hoisted into a subselect.
-- ---------------------------------------------------------------------------
alter table public.savings_goals enable row level security;

create policy savings_goals_select on public.savings_goals
  for select to authenticated using ((select auth.uid()) = user_id);
create policy savings_goals_insert on public.savings_goals
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy savings_goals_update on public.savings_goals
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy savings_goals_delete on public.savings_goals
  for delete to authenticated using ((select auth.uid()) = user_id);
```

- [ ] **Step 7: Apply it**

Run: `npx supabase db push --linked --include-all`
Expected: `Applying migration <number>_savings_goals.sql...` then `Finished supabase db push.`

- [ ] **Step 8: Run the suite and confirm it passes**

Run: `npm run test:rls`
Expected: all tests pass (36 before this task, 44 after).

- [ ] **Step 9: Check the advisors**

Use the Supabase MCP `get_advisors` tool with `type: "security"`.
Expected: nothing mentioning `savings_goals`, `check_spend_savings_goal_owner` or `record_spend_revision`.

- [ ] **Step 10: Commit**

```bash
git status
git add tests/rls/harness.ts tests/rls/isolation.test.ts supabase/migrations/*_savings_goals.sql
git commit -m "Add savings goals, with contributions guarded as savings spends

A goal is a plan; money added to it is a spend filed as savings carrying
savings_goal_id. The link is ownership-checked by trigger (foreign keys
ignore RLS), a contribution cannot be filed as anything but savings, and
moving or unlinking one is kept in spend_revisions.

The owner-table sweep now fails on a query error. It used to read a
missing table as nothing leaked.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: What a goal's numbers mean

**Files:**
- Create: `src/lib/engines/savings.ts`
- Test: `tests/savings.test.ts`

**Interfaces:**
- Consumes: `formatRupees(paise: number): string` from `@/lib/engines/money`.
- Produces:

```ts
export const MIN_FULL_MONTHS = 2;
export interface SavingsGoal {
  id: string; label: string; targetPaise: number; openingPaise: number;
  startedOn: string; targetDate: string | null;
}
export interface Contribution { amountPaise: number; spentOn: string; }
export interface GoalProgress {
  goal: SavingsGoal; savedPaise: number; remainingPaise: number; share: number;
  reached: boolean; pastDate: boolean; requiredMonthlyPaise: number | null;
  averageMonthlyPaise: number | null; fullMonths: number; projectedMonth: string | null;
  onTrack: boolean | null; gapMonthlyPaise: number | null; message: string;
}
export function goalProgress(goal: SavingsGoal, contributions: Contribution[], today: string): GoalProgress;
```

**The model, stated once.** Contributions are assumed to happen once a month, starting **next** month — anything added this month is already in `savedPaise`. So:
- months left = target month − current month, at least 1
- required monthly = remaining ÷ months left, **rounded up to a whole rupee**
- projected month = current month + ⌈remaining ÷ average⌉
- on track = projected month ≤ max(current month + 1, target month)

Required and projection use the same months, so "on track" and "needs ₹X more" can never contradict each other.

- [ ] **Step 1: Write the failing tests**

Create `tests/savings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { goalProgress, type Contribution, type SavingsGoal } from '@/lib/engines/savings';

const TODAY = '2026-09-13';

const goal = (over: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'g1',
  label: 'Emergency fund',
  targetPaise: 10_000_000,
  openingPaise: 0,
  startedOn: '2026-06-01',
  targetDate: null,
  ...over,
});

const add = (spentOn: string, rupees: number): Contribution => ({ spentOn, amountPaise: rupees * 100 });

describe('goalProgress', () => {
  it('adds the opening balance to what has been put in', () => {
    const p = goalProgress(
      goal({ openingPaise: 2_000_000 }),
      [add('2026-07-05', 10_000), add('2026-09-02', 5_000)],
      TODAY,
    );
    expect(p.savedPaise).toBe(3_500_000);
    expect(p.remainingPaise).toBe(6_500_000);
    expect(p.share).toBeCloseTo(0.35);
    expect(p.reached).toBe(false);
  });

  it('caps progress at the target and stops asking for more', () => {
    const p = goalProgress(goal({ openingPaise: 9_000_000, targetDate: '2026-12-31' }), [add('2026-09-01', 20_000)], TODAY);
    expect(p.savedPaise).toBe(11_000_000);
    expect(p.share).toBe(1);
    expect(p.reached).toBe(true);
    expect(p.remainingPaise).toBe(0);
    expect(p.requiredMonthlyPaise).toBeNull();
    expect(p.projectedMonth).toBeNull();
    expect(p.message).toMatch(/^Reached/);
  });

  /*
   * The honesty rule from the roadmap. A goal started on 20 July has one full
   * month behind it (August). One deposit is not a pace, and a finish date
   * extrapolated from it would be a guess stated as a forecast.
   */
  it('reports no pace before two full months of history', () => {
    const p = goalProgress(goal({ startedOn: '2026-07-20' }), [add('2026-07-25', 50_000)], TODAY);
    expect(p.fullMonths).toBe(1);
    expect(p.averageMonthlyPaise).toBeNull();
    expect(p.projectedMonth).toBeNull();
    expect(p.onTrack).toBeNull();
    expect(p.message).toMatch(/two full months/);
  });

  it('leaves the partial first month and the current month out of the pace', () => {
    const p = goalProgress(
      goal({ startedOn: '2026-06-15' }),
      [add('2026-06-20', 9_000), add('2026-07-10', 4_000), add('2026-08-10', 6_000), add('2026-09-05', 50_000)],
      TODAY,
    );
    expect(p.fullMonths).toBe(2); // July and August
    expect(p.averageMonthlyPaise).toBe(500_000);
    // Every contribution still counts towards what has been saved.
    expect(p.savedPaise).toBe(6_900_000);
  });

  it('counts a month with nothing added as a zero', () => {
    const p = goalProgress(goal(), [add('2026-06-10', 6_000), add('2026-08-10', 3_000)], TODAY);
    expect(p.fullMonths).toBe(3); // June, July, August
    expect(p.averageMonthlyPaise).toBe(300_000);
  });

  it('works out what each month needs, starting next month', () => {
    // ₹60,000 to go; October, November and December are left.
    const p = goalProgress(goal({ openingPaise: 4_000_000, targetDate: '2026-12-31' }), [], TODAY);
    expect(p.requiredMonthlyPaise).toBe(2_000_000);
  });

  it('rounds the monthly amount up to a whole rupee', () => {
    // ₹1,000 over three months is ₹333.33…; ₹334 is what actually gets there.
    const p = goalProgress(goal({ targetPaise: 100_000, targetDate: '2026-12-31' }), [], TODAY);
    expect(p.requiredMonthlyPaise).toBe(33_400);
  });

  it('treats a date later this month as one month', () => {
    const p = goalProgress(goal({ targetPaise: 1_000_000, targetDate: '2026-09-30' }), [], TODAY);
    expect(p.requiredMonthlyPaise).toBe(1_000_000);
  });

  it('says when the usual pace meets the date', () => {
    const p = goalProgress(
      goal({ targetPaise: 16_000_000, openingPaise: 4_000_000, targetDate: '2026-12-31' }),
      [add('2026-06-10', 20_000), add('2026-07-10', 20_000), add('2026-08-10', 20_000)],
      TODAY,
    );
    expect(p.remainingPaise).toBe(6_000_000);
    expect(p.averageMonthlyPaise).toBe(2_000_000);
    expect(p.projectedMonth).toBe('2026-12');
    expect(p.onTrack).toBe(true);
    expect(p.gapMonthlyPaise).toBe(0);
    expect(p.message).toContain('gets you there by 31 Dec 2026');
  });

  it('states the monthly gap when the usual pace falls short', () => {
    const p = goalProgress(
      goal({ targetPaise: 16_000_000, openingPaise: 4_000_000, targetDate: '2026-12-31' }),
      [add('2026-06-10', 15_000), add('2026-07-10', 15_000), add('2026-08-10', 15_000)],
      TODAY,
    );
    expect(p.remainingPaise).toBe(7_500_000);
    expect(p.requiredMonthlyPaise).toBe(2_500_000);
    expect(p.averageMonthlyPaise).toBe(1_500_000);
    expect(p.projectedMonth).toBe('2027-02');
    expect(p.onTrack).toBe(false);
    expect(p.gapMonthlyPaise).toBe(1_000_000);
    expect(p.message).toContain('₹10,000 more');
    expect(p.message).toContain('February 2027');
  });

  it('gives a likely month instead of a monthly amount when there is no date', () => {
    const p = goalProgress(
      goal(),
      [add('2026-06-10', 20_000), add('2026-07-10', 20_000), add('2026-08-10', 20_000)],
      TODAY,
    );
    expect(p.requiredMonthlyPaise).toBeNull();
    expect(p.projectedMonth).toBe('2026-11');
    expect(p.onTrack).toBeNull();
    expect(p.gapMonthlyPaise).toBeNull();
  });

  it('says plainly when the date has passed, without asking for an amount', () => {
    const p = goalProgress(goal({ targetDate: '2026-08-31' }), [add('2026-07-10', 1_000)], TODAY);
    expect(p.pastDate).toBe(true);
    expect(p.requiredMonthlyPaise).toBeNull();
    expect(p.onTrack).toBeNull();
    expect(p.message).toMatch(/has passed/);
  });

  it('does not project a finish from a pace of nothing', () => {
    const p = goalProgress(goal(), [], TODAY);
    expect(p.averageMonthlyPaise).toBe(0);
    expect(p.projectedMonth).toBeNull();
    expect(p.message).toMatch(/Nothing has been added in the 3 full months/);
  });

  it('keeps every amount a whole number of paise', () => {
    const p = goalProgress(
      goal({ targetPaise: 9_999_999, targetDate: '2027-03-15' }),
      [
        { spentOn: '2026-06-03', amountPaise: 333_333 },
        { spentOn: '2026-07-03', amountPaise: 333_334 },
        { spentOn: '2026-08-03', amountPaise: 1 },
      ],
      TODAY,
    );
    for (const value of [p.requiredMonthlyPaise, p.averageMonthlyPaise, p.gapMonthlyPaise]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('never scolds', () => {
    const scenarios = [
      goalProgress(goal({ startedOn: '2026-07-20' }), [], TODAY),
      goalProgress(goal(), [], TODAY),
      goalProgress(goal({ targetDate: '2026-08-31' }), [], TODAY),
      goalProgress(
        goal({ targetPaise: 16_000_000, targetDate: '2026-12-31' }),
        [add('2026-06-10', 100), add('2026-07-10', 100), add('2026-08-10', 100)],
        TODAY,
      ),
    ];
    for (const p of scenarios) {
      expect(p.message).not.toMatch(/should|must|behind|fail|lazy|careful|only/i);
    }
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/savings.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/engines/savings"`.

- [ ] **Step 3: Write the engine**

Create `src/lib/engines/savings.ts`:

```ts
import { formatRupees } from '@/lib/engines/money';

/**
 * Savings goals: how far along, what it takes, and — only once there is
 * enough history to say — how the actual pace compares.
 *
 * ## A goal is a plan; the ledger is spends
 *
 * Money added to a goal is an ordinary spend filed as savings and carrying
 * `savings_goal_id`, the same way paying a bill carries `commitment_id`. This
 * file never sees a stored balance, so a goal's total cannot drift away from
 * the records it is built from.
 *
 * ## What it refuses to guess
 *
 * A pace needs history. One deposit in the week a goal was created is not a
 * monthly habit, and a finish date projected from it would state a guess as a
 * forecast. So the average is taken only over *full calendar months* since the
 * goal began — the month it was created and the current month are both
 * partial and left out, the same rule `salaryTrend` applies to income — and
 * with fewer than two such months there is no average and no projected date.
 *
 * ## One model for "needs" and "likely"
 *
 * Contributions are assumed once a month, starting next month; whatever was
 * added this month is already in the saved total. The monthly amount a date
 * needs and the month the usual pace reaches are both worked out on that
 * basis, so "on track" and "₹X a month more" cannot contradict each other.
 */

export const MIN_FULL_MONTHS = 2;

export interface SavingsGoal {
  id: string;
  label: string;
  targetPaise: number;
  /** Saved before the goal was recorded here. Not a contribution. */
  openingPaise: number;
  /** YYYY-MM-DD. */
  startedOn: string;
  /** YYYY-MM-DD, or null for a goal with no deadline. */
  targetDate: string | null;
}

export interface Contribution {
  amountPaise: number;
  /** YYYY-MM-DD. */
  spentOn: string;
}

export interface GoalProgress {
  goal: SavingsGoal;
  savedPaise: number;
  remainingPaise: number;
  /** 0-1, capped at 1. */
  share: number;
  reached: boolean;
  /** The target date is before today and the goal is not reached. */
  pastDate: boolean;
  /** What each month from next month to the target month needs. Null without a future date, or once reached. */
  requiredMonthlyPaise: number | null;
  /** Average over full months. Null until there are MIN_FULL_MONTHS of them. */
  averageMonthlyPaise: number | null;
  /** How many full calendar months the goal has existed for. */
  fullMonths: number;
  /** YYYY-MM the usual pace reaches the target. Null without a pace, at a pace of zero, or once reached. */
  projectedMonth: string | null;
  /** Whether the projection meets the target date. Null when either is unknown. */
  onTrack: boolean | null;
  /** Required minus average, when both are known. Positive means more is needed each month. */
  gapMonthlyPaise: number | null;
  message: string;
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

const monthFromIndex = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const dateLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** An average is not exact; it is shown to the rupee, never to the paisa. */
const about = (paise: number) => formatRupees(Math.round(paise / 100) * 100);

export function goalProgress(
  goal: SavingsGoal,
  contributions: Contribution[],
  today: string,
): GoalProgress {
  const contributed = contributions.reduce((sum, c) => sum + c.amountPaise, 0);
  const savedPaise = goal.openingPaise + contributed;
  const remainingPaise = Math.max(0, goal.targetPaise - savedPaise);
  const reached = savedPaise >= goal.targetPaise;
  const share = Math.min(1, savedPaise / goal.targetPaise);

  const current = monthIndex(today);

  // The first month the goal existed for the whole of.
  const firstFull = monthIndex(goal.startedOn) + (goal.startedOn.endsWith('-01') ? 0 : 1);
  const fullMonths = Math.max(0, current - firstFull);

  let averageMonthlyPaise: number | null = null;
  if (fullMonths >= MIN_FULL_MONTHS) {
    const inFullMonths = contributions
      .filter((c) => {
        const month = monthIndex(c.spentOn);
        return month >= firstFull && month < current;
      })
      .reduce((sum, c) => sum + c.amountPaise, 0);
    averageMonthlyPaise = Math.round(inFullMonths / fullMonths);
  }

  const pastDate = !reached && goal.targetDate !== null && goal.targetDate < today;

  let requiredMonthlyPaise: number | null = null;
  if (!reached && goal.targetDate !== null && !pastDate) {
    const monthsLeft = Math.max(1, monthIndex(goal.targetDate) - current);
    requiredMonthlyPaise = Math.ceil(remainingPaise / monthsLeft / 100) * 100;
  }

  const projectedMonth =
    !reached && averageMonthlyPaise !== null && averageMonthlyPaise > 0
      ? monthFromIndex(current + Math.ceil(remainingPaise / averageMonthlyPaise))
      : null;

  const onTrack =
    projectedMonth !== null && goal.targetDate !== null && !pastDate
      ? monthIndex(projectedMonth) <= Math.max(current + 1, monthIndex(goal.targetDate))
      : null;

  const gapMonthlyPaise =
    requiredMonthlyPaise !== null && averageMonthlyPaise !== null
      ? requiredMonthlyPaise - averageMonthlyPaise
      : null;

  const progress = {
    goal,
    savedPaise,
    remainingPaise,
    share,
    reached,
    pastDate,
    requiredMonthlyPaise,
    averageMonthlyPaise,
    fullMonths,
    projectedMonth,
    onTrack,
    gapMonthlyPaise,
  };

  return { ...progress, message: messageFor(progress) };
}

/**
 * What to say. States the position and the arithmetic; never a verdict on the
 * person. A pace that falls short is a number of rupees a month, not a failing.
 */
function messageFor(p: Omit<GoalProgress, 'message'>): string {
  if (p.reached) {
    return `Reached — ${formatRupees(p.savedPaise)} saved towards ${formatRupees(p.goal.targetPaise)}.`;
  }

  const toGo = `${formatRupees(p.remainingPaise)} to go`;
  const passed = `The date you set has passed, with ${toGo}.`;
  const byDate = p.goal.targetDate ? dateLabel(p.goal.targetDate) : '';

  if (p.averageMonthlyPaise === null) {
    const later = 'After two full months of adding to it, this will show when you are likely to get there.';
    if (p.pastDate) return `${passed} ${later}`;
    if (p.requiredMonthlyPaise !== null) {
      return (
        `${toGo}. About ${formatRupees(p.requiredMonthlyPaise)} a month would get there by ${byDate}. ` +
        `After two full months of adding to it, this will also show how your actual pace compares.`
      );
    }
    return `${toGo}. ${later}`;
  }

  if (p.averageMonthlyPaise === 0 || p.projectedMonth === null) {
    const nothing = `Nothing has been added in the ${p.fullMonths} full months since this goal began.`;
    if (p.pastDate) return `${passed} ${nothing}`;
    if (p.requiredMonthlyPaise !== null) {
      return `${nothing} About ${formatRupees(p.requiredMonthlyPaise)} a month would get there by ${byDate}.`;
    }
    return `${toGo}. ${nothing}`;
  }

  const pace = `You have been adding about ${about(p.averageMonthlyPaise)} a month`;
  const likely = monthLabel(p.projectedMonth);

  if (p.pastDate) return `${passed} ${pace} — at that pace, around ${likely}.`;
  if (p.requiredMonthlyPaise === null) return `${toGo}. ${pace} — at that pace, around ${likely}.`;

  if (p.onTrack) {
    return `${pace}, which gets you there by ${byDate} — around ${likely} at that pace.`;
  }

  return (
    `${pace}. Getting there by ${byDate} takes about ${formatRupees(p.requiredMonthlyPaise)} a month — ` +
    `${about(p.gapMonthlyPaise ?? 0)} more. At your current pace, around ${likely}.`
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/savings.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src tests/savings.test.ts`
Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git status
git add src/lib/engines/savings.ts tests/savings.test.ts
git commit -m "Work out what a savings goal needs, and its pace once there is one

Required monthly amount from next month to the target month, rounded up to
a rupee. An actual pace only over full calendar months, and only once there
are two; before that the message says it does not know yet. Required and
projected use the same months, so on track and the monthly gap agree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: A contribution stays savings when it is edited

Contributions appear in the Recent list like any spend, and `SpendList` can edit them. The database already refuses to recategorise one (Task 1). This task makes the engine refuse first with a sentence a person can act on, and the form show the category as locked instead of letting a change be typed and then rejected.

**Files:**
- Modify: `src/lib/engines/spend-edit.ts`
- Modify: `tests/spend-edit.test.ts`
- Modify: `src/lib/actions/money.ts`
- Modify: `src/lib/data/money.ts`
- Modify: `src/components/spend-list.tsx`

**Interfaces:**
- Consumes: `spends.savings_goal_id` (Task 1).
- Produces: `ExistingSpend.savingsGoalId: string | null`; `SpendRow.savingsGoalId: string | null`.

- [ ] **Step 1: Write the failing tests**

In `tests/spend-edit.test.ts`, replace:

```ts
  intent: null,
  commitmentId: null,
};
```

with:

```ts
  intent: null,
  commitmentId: null,
  savingsGoalId: null,
};
```

Replace:

```ts
  commitmentId: 'commitment-rent',
};
```

with:

```ts
  commitmentId: 'commitment-rent',
  savingsGoalId: null,
};
```

Replace:

```ts
  it('never scolds', () => {
```

with:

```ts
  it('refuses to recategorise money added to a savings goal', () => {
    const contribution: ExistingSpend = { ...groceries, category: 'savings', savingsGoalId: 'goal-1' };
    const plan = planSpendEdit(contribution, { category: 'eating_out' }, null);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error).toMatch(/savings goal/);
      expect(plan.error).toMatch(/remove it and record it again/i);
    }
  });

  it('still lets a contribution’s amount and date be corrected', () => {
    const contribution: ExistingSpend = { ...groceries, category: 'savings', savingsGoalId: 'goal-1' };
    const plan = planSpendEdit(contribution, { amountPaise: 60_000, spentOn: '2026-09-11' }, null);
    expect(plan).toEqual({
      ok: true,
      changed: true,
      patch: { amountPaise: 60_000, spentOn: '2026-09-11' },
      warning: null,
    });
  });

  it('never scolds', () => {
```

- [ ] **Step 2: Run the tests and confirm the right one fails**

Run: `npx vitest run tests/spend-edit.test.ts`
Expected: exactly 1 failure — `refuses to recategorise money added to a savings goal` (`expected true to be false`). The other 15 pass.

- [ ] **Step 3: Teach the engine**

In `src/lib/engines/spend-edit.ts`, replace:

```ts
  intent: SpendIntent | null;
  commitmentId: string | null;
}
```

with:

```ts
  intent: SpendIntent | null;
  commitmentId: string | null;
  /** Set when this spend was money added to a savings goal. Always savings. */
  savingsGoalId: string | null;
}
```

Replace:

```ts
    patch.category = change.category;
```

with:

```ts
    if (existing.savingsGoalId !== null) {
      return {
        ok: false,
        error:
          'This went into a savings goal, so it stays filed as savings. To file it differently, remove it and record it again.',
      };
    }

    patch.category = change.category;
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/spend-edit.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Read the link in the action**

In `src/lib/actions/money.ts`, replace:

```ts
 * `z.strictObject` rejects any key it does not name, so a request carrying
 * `user_id` or `commitment_id` fails validation rather than being quietly
```

with:

```ts
 * `z.strictObject` rejects any key it does not name, so a request carrying
 * `user_id`, `commitment_id` or `savings_goal_id` fails validation rather than being quietly
```

Replace:

```ts
    .select('id, amount_paise, category, note, spent_on, intent, commitment_id')
```

with:

```ts
    .select('id, amount_paise, category, note, spent_on, intent, commitment_id, savings_goal_id')
```

Replace:

```ts
    commitmentId: (row.commitment_id as string) ?? null,
  };
```

with:

```ts
    commitmentId: (row.commitment_id as string) ?? null,
    savingsGoalId: (row.savings_goal_id as string) ?? null,
  };
```

- [ ] **Step 6: Carry the link to the list**

In `src/lib/data/money.ts`, replace:

```ts
  commitmentId: string | null;
  intent: string | null;
}
```

with:

```ts
  commitmentId: string | null;
  intent: string | null;
  /** Set when this spend was money added to a savings goal. Always savings. */
  savingsGoalId: string | null;
}
```

Replace:

```ts
const SAMPLE_SPEND_ROWS: Omit<SpendRow, 'commitmentId' | 'intent'>[] = [
```

with:

```ts
const SAMPLE_SPEND_ROWS: Omit<SpendRow, 'commitmentId' | 'intent' | 'savingsGoalId'>[] = [
```

Replace:

```ts
  commitmentId: null,
  intent: null,
}));
```

with:

```ts
  commitmentId: null,
  intent: null,
  savingsGoalId: null,
}));
```

Replace:

```ts
    .select('id, amount_paise, category, note, spent_on, commitment_id, intent')
```

with:

```ts
    .select('id, amount_paise, category, note, spent_on, commitment_id, intent, savings_goal_id')
```

Replace:

```ts
    intent: (r.intent as string) ?? null,
  }));
```

with:

```ts
    intent: (r.intent as string) ?? null,
    savingsGoalId: (r.savings_goal_id as string) ?? null,
  }));
```

- [ ] **Step 7: Lock the category in the form**

In `src/components/spend-list.tsx`, replace:

```tsx
                        {s.commitmentId
                          ? 'Remove this payment? The bill it settled may show as unpaid again.'
                          : 'Remove this spend?'}
```

with:

```tsx
                        {s.commitmentId
                          ? 'Remove this payment? The bill it settled may show as unpaid again.'
                          : s.savingsGoalId
                            ? 'Remove this? It comes off the savings goal it was added to.'
                            : 'Remove this spend?'}
```

Replace:

```tsx
  const settled = spend.commitmentId !== null;
```

with:

```tsx
  const settled = spend.commitmentId !== null;
  const saved = spend.savingsGoalId !== null;
  const locked = settled || saved;
```

Replace:

```tsx
      // A bill payment's category follows the bill, and the database refuses
      // to change it — so it is not sent rather than sent and rejected.
      ...(settled ? {} : { category }),
```

with:

```tsx
      // A bill payment's category follows the bill, and money added to a goal
      // is always savings. The database refuses to change either — so it is
      // not sent rather than sent and rejected.
      ...(locked ? {} : { category }),
```

Replace:

```tsx
        description={settled ? 'This paid a recurring bill, so it stays filed with that bill.' : undefined}
```

with:

```tsx
        description={
          settled
            ? 'This paid a recurring bill, so it stays filed with that bill.'
            : saved
              ? 'This went into a savings goal, so it stays filed as savings.'
              : undefined
        }
```

Replace:

```tsx
          disabled={settled}
```

with:

```tsx
          disabled={locked}
```

- [ ] **Step 8: Verify statically**

Run: `npx tsc --noEmit && npx eslint src && npm test`
Expected: no type errors (every `ExistingSpend` and `SpendRow` literal now has `savingsGoalId`); lint clean; all unit tests pass.

- [ ] **Step 9: Commit**

```bash
git status
git add src/lib/engines/spend-edit.ts tests/spend-edit.test.ts src/lib/actions/money.ts src/lib/data/money.ts src/components/spend-list.tsx
git commit -m "Keep money added to a savings goal filed as savings when edited

The database already refuses the change; planSpendEdit now refuses it first
in words, and the edit form shows the category locked. Amount and date stay
correctable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Loading goals and writing through them

**Files:**
- Create: `src/lib/data/savings.ts`
- Create: `src/lib/actions/savings.ts`

**Interfaces:**
- Consumes: `goalProgress`, `Contribution`, `GoalProgress` (Task 2); `formatRupees`, `parseAmountToPaise` (`@/lib/engines/money`); `createClient` (`@/lib/supabase/server`); `supabaseConfigured` (`@/lib/config`).
- Produces:

```ts
// src/lib/data/savings.ts
export async function getSavingsGoals(): Promise<GoalProgress[] | null>; // null when signed out or unconfigured
// src/lib/actions/savings.ts
export type SavingsResult = { ok: true; message: string } | { ok: false; error: string };
export async function addSavingsGoal(input: unknown): Promise<SavingsResult>;
//   input: { label: string; target: string; saved?: string; targetDate?: 'YYYY-MM-DD' }
export async function contributeToSavingsGoal(input: unknown): Promise<SavingsResult>;
//   input: { id: uuid; amount: string }
export async function closeSavingsGoal(id: string): Promise<SavingsResult>;
```

- [ ] **Step 1: Write the loader**

Create `src/lib/data/savings.ts`:

```ts
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { goalProgress, type Contribution, type GoalProgress } from '@/lib/engines/savings';

/**
 * Open savings goals, each with its progress worked out from the ledger.
 *
 * What has been saved is never read from the goal: it is the opening balance
 * plus the spends carrying the goal's id, summed here every time. Null when
 * there is no signed-in user, so the panel is not shown on the sample screen.
 */
export async function getSavingsGoals(): Promise<GoalProgress[] | null> {
  if (!supabaseConfigured) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const userId = auth.user.id;

  const { data: goals } = await supabase
    .from('savings_goals')
    .select('id, label, target_paise, opening_paise, started_on, target_date')
    .eq('user_id', userId)
    .is('closed_on', null)
    .order('created_at', { ascending: true });

  if (!goals || goals.length === 0) return [];

  const { data: rows } = await supabase
    .from('spends')
    .select('savings_goal_id, amount_paise, spent_on')
    .eq('user_id', userId)
    .in(
      'savings_goal_id',
      goals.map((g) => g.id as string),
    );

  const byGoal = new Map<string, Contribution[]>();
  for (const row of rows ?? []) {
    const key = row.savings_goal_id as string;
    const list = byGoal.get(key) ?? [];
    // bigint arrives as a string from PostgREST.
    list.push({ amountPaise: Number(row.amount_paise), spentOn: row.spent_on as string });
    byGoal.set(key, list);
  }

  const today = new Date().toISOString().slice(0, 10);

  return goals.map((g) =>
    goalProgress(
      {
        id: g.id as string,
        label: g.label as string,
        targetPaise: Number(g.target_paise),
        openingPaise: Number(g.opening_paise),
        startedOn: g.started_on as string,
        targetDate: (g.target_date as string) ?? null,
      },
      byGoal.get(g.id as string) ?? [],
      today,
    ),
  );
}
```

- [ ] **Step 2: Write the actions**

Create `src/lib/actions/savings.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { formatRupees, parseAmountToPaise } from '@/lib/engines/money';

/**
 * Setting up, adding to and closing savings goals.
 *
 * Adding money writes an ordinary spend filed as savings and carrying
 * `savings_goal_id` — the same shape as paying a commitment. A goal's total is
 * read back from those spends, never stored, so it cannot disagree with them.
 */

export type SavingsResult = { ok: true; message: string } | { ok: false; error: string };

const MAX_PAISE = 100_000_000_000;

// UTC, like every other "today" on the money screen, so the loader and the
// database's started_on agree about which day it is.
const todayIso = () => new Date().toISOString().slice(0, 10);

const goalSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  /** Rupees as typed. Parsed to paise here; money never touches a float. */
  target: z.string().min(1).max(20),
  saved: z.string().max(20).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function addSavingsGoal(input: unknown): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that. Check the amounts.' };
  const { label, target, saved, targetDate } = parsed.data;

  const targetPaise = parseAmountToPaise(target);
  if (targetPaise === null || targetPaise > MAX_PAISE) {
    return { ok: false, error: 'Enter how much you are saving towards.' };
  }

  // Empty or zero means nothing saved yet. Anything else has to read as a real
  // amount: taking a typo as zero would understate the goal from its first day.
  const openingPaise = !saved || /^[₹\s,.0]*$/.test(saved) ? 0 : parseAmountToPaise(saved);
  if (openingPaise === null || openingPaise > MAX_PAISE) {
    return { ok: false, error: 'Check the amount already saved.' };
  }

  const startedOn = todayIso();
  if (targetDate !== undefined && targetDate <= startedOn) {
    return { ok: false, error: 'Pick a date after today, or leave it empty.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase.from('savings_goals').insert({
    user_id: auth.user.id,
    label,
    target_paise: targetPaise,
    opening_paise: openingPaise,
    started_on: startedOn,
    target_date: targetDate ?? null,
  });

  if (error) {
    console.error('savings goal insert failed', error);
    return { ok: false, error: 'We could not save that.' };
  }

  revalidatePath('/money');
  return { ok: true, message: `${label} added.` };
}

const contributionSchema = z.strictObject({
  id: z.string().uuid(),
  amount: z.string().min(1).max(20),
});

/**
 * Put money towards a goal.
 *
 * Writes a real spend. The goal is read back first rather than trusting the
 * request: this writes to the ledger, so the label and whether the goal is
 * still open come from the database.
 */
export async function contributeToSavingsGoal(input: unknown): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = contributionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that amount.' };

  const amountPaise = parseAmountToPaise(parsed.data.amount);
  if (amountPaise === null || amountPaise > MAX_PAISE) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { data: goal } = await supabase
    .from('savings_goals')
    .select('id, label, closed_on')
    .eq('id', parsed.data.id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!goal) return { ok: false, error: 'We could not find that goal.' };
  if (goal.closed_on !== null) return { ok: false, error: 'That goal is closed.' };

  const { error } = await supabase.from('spends').insert({
    user_id: auth.user.id,
    spent_on: todayIso(),
    amount_paise: amountPaise,
    category: 'savings',
    savings_goal_id: goal.id,
    note: goal.label,
  });

  if (error) {
    console.error('savings contribution failed', error);
    return { ok: false, error: 'We could not add that.' };
  }

  revalidatePath('/money');
  revalidatePath('/today');
  return { ok: true, message: `${formatRupees(amountPaise)} added to ${goal.label}.` };
}

/**
 * Stop tracking a goal without erasing anything.
 *
 * Closed rather than deleted: the money that went in was really set aside, and
 * its spends keep pointing at the goal they were for.
 */
export async function closeSavingsGoal(id: string): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: 'We could not find that goal.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { data, error } = await supabase
    .from('savings_goals')
    .update({ closed_on: todayIso() })
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .is('closed_on', null)
    .select('id');

  if (error || !data || data.length !== 1) {
    return { ok: false, error: 'We could not close that goal.' };
  }

  revalidatePath('/money');
  return { ok: true, message: 'Closed. What you added stays in your records.' };
}
```

- [ ] **Step 3: Verify statically**

Run: `npx tsc --noEmit && npx eslint src && npm test && npm run build`
Expected: no type errors; lint clean; all unit tests pass; `✓ Compiled successfully`. `MAX_PAISE`, `todayIso`, `goalSchema` and `contributionSchema` must stay unexported — the build fails if a `'use server'` file exports anything that is not an async function.

- [ ] **Step 4: Commit**

```bash
git status
git add src/lib/data/savings.ts src/lib/actions/savings.ts
git commit -m "Load savings goals from the ledger, and add, contribute and close

A goal's total is its opening balance plus the spends carrying its id,
summed on every load. Contributing reads the goal back and writes an
ordinary savings spend; a closed goal takes no more. Closing keeps
everything that went in.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The panel, verified end to end

**Files:**
- Create: `src/components/savings-panel.tsx`
- Modify: `src/app/(app)/money/page.tsx`
- Modify: `docs/STATUS.md`
- Create then delete: `.verify-savings-goals.mjs` (repository root, never committed)

**Interfaces:**
- Consumes: `addSavingsGoal`, `contributeToSavingsGoal`, `closeSavingsGoal`, `SavingsResult` (Task 4); `getSavingsGoals` (Task 4); `GoalProgress` (Task 2); `formatRupees` (`@/lib/engines/money`); `Alert`, `Button`, `Field`, `Section`, `Why`, `inputClass`, `inputStyle` (`@/components/ui`).
- Produces: `SavingsPanel({ goals: GoalProgress[]; canEdit: boolean })`.

- [ ] **Step 1: Write the panel**

Create `src/components/savings-panel.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Alert, Button, Field, Section, Why, inputClass, inputStyle } from '@/components/ui';
import { formatRupees } from '@/lib/engines/money';
import type { GoalProgress } from '@/lib/engines/savings';
import { addSavingsGoal, closeSavingsGoal, contributeToSavingsGoal } from '@/lib/actions/savings';

/**
 * What someone is saving towards, and how it is going.
 *
 * "₹5,000 saved this month" means little on its own. Against a ₹1,00,000
 * emergency fund due by March it becomes a position: how far along, what each
 * month needs, and — once there is enough history to say — whether the usual
 * pace gets there.
 */

type Notice = { ok: boolean; text: string };

export function SavingsPanel({ goals, canEdit }: { goals: GoalProgress[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <Section
      title="Saving towards"
      meta={goals.length > 0 ? `${goals.length} goal${goals.length === 1 ? '' : 's'}` : undefined}
    >
      {goals.length === 0 ? (
        <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          Nothing set up yet. A goal — an emergency fund, a deposit, a trip — turns money set aside
          into how far along you are.
        </p>
      ) : (
        <ul className="space-y-5">
          {goals.map((g) => (
            <GoalRow key={g.goal.id} progress={g} canEdit={canEdit} onNotice={setNotice} />
          ))}
        </ul>
      )}

      {notice ? (
        <div className="mt-3">
          <Alert tone={notice.ok ? 'success' : 'error'}>{notice.text}</Alert>
        </div>
      ) : null}

      {canEdit ? (
        adding ? (
          <AddGoalForm
            onCancel={() => setAdding(false)}
            onDone={(result) => {
              setNotice(result);
              if (result.ok) setAdding(false);
            }}
          />
        ) : (
          <Button
            className="mt-4"
            variant="ghost"
            fullWidth
            onClick={() => {
              setAdding(true);
              setNotice(null);
            }}
          >
            <Plus size={16} aria-hidden /> Add a savings goal
          </Button>
        )
      ) : null}

      <Why label="How is this worked out?">
        <p>
          Adding money to a goal records a normal spend filed as savings. It shows in “where your
          income went” as money set aside, and it counts in this month’s total like any money that
          leaves your account. There is no second set of books.
        </p>
        <p className="mt-2">
          The monthly amount spreads what is left over the months before your date, starting next
          month. Anything you added this month is already in the total.
        </p>
        <p className="mt-2">
          Your usual pace is the average over full calendar months since the goal began, counting
          months where nothing went in. The month you started and the current month are left out
          because they are only partly over. Until there are two full months, there is no pace to
          show — one deposit is not a habit.
        </p>
      </Why>
    </Section>
  );
}

function GoalRow({
  progress: p,
  canEdit,
  onNotice,
}: {
  progress: GoalProgress;
  canEdit: boolean;
  onNotice: (notice: Notice) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [amount, setAmount] = useState('');
  const [pending, startTransition] = useTransition();

  const { goal } = p;
  const pct = Math.round(p.share * 100);

  function contribute() {
    startTransition(async () => {
      const result = await contributeToSavingsGoal({ id: goal.id, amount });
      onNotice({ ok: result.ok, text: result.ok ? result.message : result.error });
      if (result.ok) {
        setAmount('');
        setAdding(false);
      }
    });
  }

  function close() {
    startTransition(async () => {
      const result = await closeSavingsGoal(goal.id);
      onNotice({ ok: result.ok, text: result.ok ? result.message : result.error });
      setConfirmingClose(false);
    });
  }

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{goal.label}</span>
        <span className="data shrink-0 text-sm">
          <span style={{ fontWeight: 600 }}>{formatRupees(p.savedPaise)}</span>
          <span style={{ color: 'var(--fg-subtle)' }}> of {formatRupees(goal.targetPaise)}</span>
        </span>
      </div>

      <div
        className="relative mt-1.5 w-full overflow-hidden"
        style={{ height: 8, background: 'var(--ground)', borderRadius: 8 }}
        role="img"
        aria-label={`${goal.label}: ${formatRupees(p.savedPaise)} of ${formatRupees(goal.targetPaise)}, ${pct} percent`}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${p.share * 100}%`,
            background: p.reached ? 'var(--confirm)' : 'var(--primary)',
            borderRadius: 8,
          }}
        />
      </div>

      <p className="measure mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {p.message}
      </p>

      {canEdit ? (
        adding ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label htmlFor={`goal-amount-${goal.id}`} className="sr-only">
              Amount to add to {goal.label}
            </label>
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id={`goal-amount-${goal.id}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
              className={`data ${inputClass} min-w-0 flex-1`}
              style={inputStyle}
            />
            {/* Full-size buttons throughout: 44px targets, used one-handed. */}
            <Button disabled={pending || !amount.trim()} onClick={contribute}>
              {pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : 'Add'}
            </Button>
            <Button variant="quiet" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : confirmingClose ? (
          <div
            className="mt-2.5 flex flex-wrap items-center gap-2 p-3"
            style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
          >
            <span className="flex-1 text-sm">Close this goal? What you added stays in your records.</span>
            <Button variant="ghost" disabled={pending} onClick={close}>
              {pending ? 'Closing…' : 'Close'}
            </Button>
            <Button variant="quiet" disabled={pending} onClick={() => setConfirmingClose(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <Button
              variant="ghost"
              aria-label={`Add money to ${goal.label}`}
              onClick={() => setAdding(true)}
            >
              Add money
            </Button>
            <Button
              variant="quiet"
              aria-label={`Close ${goal.label}`}
              onClick={() => setConfirmingClose(true)}
            >
              Close
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

function AddGoalForm({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (notice: Notice) => void;
}) {
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const result = await addSavingsGoal({
      label,
      target,
      ...(saved.trim() ? { saved } : {}),
      // An empty date input is "no deadline", not a malformed date.
      ...(targetDate ? { targetDate } : {}),
    });
    setSaving(false);
    onDone({ ok: result.ok, text: result.ok ? result.message : result.error });
  }

  return (
    <div
      className="mt-4 space-y-3 p-3.5"
      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
    >
      <Field label="What are you saving for?" htmlFor="goal-label">
        <input
          id="goal-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="Emergency fund, deposit, trip…"
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How much do you need?" htmlFor="goal-target">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id="goal-target"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="100000"
              className={`data ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field
          label="Already saved towards it"
          htmlFor="goal-saved"
          description="Money put aside before today. Leave empty if none."
        >
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id="goal-saved"
              inputMode="decimal"
              value={saved}
              onChange={(e) => setSaved(e.target.value)}
              placeholder="0"
              className={`data ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </Field>
      </div>

      <Field
        label="By when?"
        htmlFor="goal-date"
        description="Optional. Without a date we show when you are likely to get there instead."
      >
        <input
          id="goal-date"
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className={`data ${inputClass}`}
          style={inputStyle}
        />
      </Field>

      <div className="flex gap-2">
        <Button disabled={saving || !label.trim() || !target.trim()} onClick={submit}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            'Add it'
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

- [ ] **Step 2: Put it on the money page**

In `src/app/(app)/money/page.tsx`, replace:

```tsx
import { SalaryPanel } from '@/components/salary-panel';
```

with:

```tsx
import { SalaryPanel } from '@/components/salary-panel';
import { SavingsPanel } from '@/components/savings-panel';
```

Replace:

```tsx
import { getSalaryView } from '@/lib/data/salary';
```

with:

```tsx
import { getSalaryView } from '@/lib/data/salary';
import { getSavingsGoals } from '@/lib/data/savings';
```

Replace:

```tsx
  const [foodSpend, commitments, salary] = await Promise.all([
```

with:

```tsx
  const [foodSpend, commitments, salary, savings] = await Promise.all([
```

Replace:

```tsx
    getSalaryView(window.start, window.end),
  ]);
```

with:

```tsx
    getSalaryView(window.start, window.end),
    getSavingsGoals(),
  ]);
```

Replace:

```tsx
          {salary ? (
            <Panel>
              <SalaryPanel view={salary} canEdit={!view.isSample} />
            </Panel>
          ) : null}
```

with:

```tsx
          {salary ? (
            <Panel>
              <SalaryPanel view={salary} canEdit={!view.isSample} />
            </Panel>
          ) : null}

          {/* Beside the salary breakdown, which already counts what went into
              these as set aside. */}
          {savings ? (
            <Panel>
              <SavingsPanel goals={savings} canEdit={!view.isSample} />
            </Panel>
          ) : null}
```

- [ ] **Step 3: Verify statically**

Run: `npx tsc --noEmit && npx eslint src && npm test && npm run build`
Expected: no type errors; lint clean; all unit tests pass; `✓ Compiled successfully`.

- [ ] **Step 4: Start the dev server and confirm it is this app**

A dev server for this project may already be running on port 3000; `next dev` then exits with *"Another next dev server is already running"* and names it. Use that one. Otherwise run `npm run dev` in the background.

Run: `curl -s http://localhost:3000/login | grep -o "<title>[^<]*</title>"`
Expected: `<title>Sign in — FitCoach</title>`. If another project answers on 3000, use the port `next dev` reports and pass it as `BASE` below.

- [ ] **Step 5: Write the end-to-end check**

Create `.verify-savings-goals.mjs` in the repository root:

```js
/**
 * End-to-end check for savings goals. Creates a real user on the linked
 * project, drives /money in system Chrome, reads the database back, and
 * deletes the user. Not committed.
 */
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS;

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

/** First day of the month `offset` months from now, as YYYY-MM-DD (UTC). */
const monthStart = (offset) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 10);
};

const EMAIL = 'verify-savings-goals@example.com';
const PASSWORD = 'VerifySave!2026xyz';

const existing = await call('GET', '/auth/v1/admin/users?per_page=200');
for (const u of existing.users ?? []) {
  if (u.email === EMAIL) await call('DELETE', `/auth/v1/admin/users/${u.id}`);
}
const user = await call('POST', '/auth/v1/admin/users', { email: EMAIL, password: PASSWORD, email_confirm: true });
const uid = user.id;

try {
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

  // A goal with three full months of history, so the page has a pace to show.
  const [house] = await call('POST', '/rest/v1/savings_goals', {
    user_id: uid, label: 'House deposit', target_paise: 10_000_000, started_on: monthStart(-3),
  });
  for (const offset of [-3, -2, -1]) {
    await call('POST', '/rest/v1/spends', {
      user_id: uid, amount_paise: 2_000_000, category: 'savings', savings_goal_id: house.id,
      spent_on: `${monthStart(offset).slice(0, 8)}10`, note: 'House deposit',
    }, 'return=minimal');
  }

  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => check('no page errors', false, e.message));

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
  await page.goto(`${BASE}/money`, { waitUntil: 'networkidle' });

  // Locators use exact matching: Playwright matches names and text as
  // substrings by default, which would let a broken flow pass on this page.

  // 1. History produces a pace.
  const paceText = page.getByText(/You have been adding about ₹20,000 a month/);
  await paceText.waitFor({ timeout: 15_000 });
  check('a goal with three full months shows its pace', true);

  // 2. Add a goal.
  const inSixMonths = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 6); return d.toISOString().slice(0, 10); })();
  await page.getByRole('button', { name: 'Add a savings goal', exact: true }).click();
  await page.fill('#goal-label', 'Trip');
  await page.fill('#goal-target', '30000');
  await page.fill('#goal-saved', '5000');
  await page.fill('#goal-date', inSixMonths);
  await page.getByRole('button', { name: 'Add it', exact: true }).click();
  await page.getByText('Trip added.', { exact: true }).waitFor({ timeout: 15_000 });
  const [trip] = await call('GET', `/rest/v1/savings_goals?user_id=eq.${uid}&label=eq.Trip&select=id,target_paise,opening_paise,target_date`);
  check(
    'a goal is saved in paise with its date',
    trip && Number(trip.target_paise) === 3_000_000 && Number(trip.opening_paise) === 500_000 && trip.target_date === inSixMonths,
    JSON.stringify(trip),
  );
  check('a new goal says it has no pace yet', await page.getByText(/two full months/).first().isVisible());

  // 3. Add money to it.
  await page.getByRole('button', { name: 'Add money to Trip', exact: true }).click();
  await page.fill(`#goal-amount-${trip.id}`, '2500');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('₹2,500 added to Trip.', { exact: true }).waitFor({ timeout: 15_000 });
  const contributions = await call('GET', `/rest/v1/spends?savings_goal_id=eq.${trip.id}&select=id,amount_paise,category`);
  check(
    'adding money writes one savings spend linked to the goal',
    contributions.length === 1 && Number(contributions[0].amount_paise) === 250_000 && contributions[0].category === 'savings',
    JSON.stringify(contributions),
  );
  check('the goal total includes it', await page.getByRole('img', { name: 'Trip: ₹7,500 of ₹30,000, 25 percent', exact: true }).isVisible());

  // 4. In the Recent list, its category cannot be changed.
  await page.getByRole('button', { name: 'Edit Savings ₹2,500', exact: true }).click();
  check('a contribution’s category is locked', await page.locator('select[id^="edit-category-"]').isDisabled());
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/savings-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // 5. Close it.
  await page.getByRole('button', { name: 'Close Trip', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByText('Closed. What you added stays in your records.', { exact: true }).waitFor({ timeout: 15_000 });
  const [closed] = await call('GET', `/rest/v1/savings_goals?id=eq.${trip.id}&select=closed_on`);
  check('closing sets closed_on', closed.closed_on !== null, `closed_on=${closed.closed_on}`);
  const kept = await call('GET', `/rest/v1/spends?savings_goal_id=eq.${trip.id}&select=id`);
  check('closing keeps what went in', kept.length === 1);
  check('a closed goal leaves the panel', (await page.getByRole('img', { name: /^Trip:/ }).count()) === 0);

  // 6. Phone width.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await phone.addCookies(await context.cookies());
  const p = await phone.newPage();
  await p.goto(`${BASE}/money`, { waitUntil: 'networkidle' });
  const addMoney = p.getByRole('button', { name: 'Add money to House deposit', exact: true });
  const box = await addMoney.boundingBox();
  check('goal buttons are 44px targets on a phone', box !== null && box.height >= 44, box ? `${box.width}x${box.height}` : 'no box');
  await addMoney.click();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('the panel does not overflow a phone', overflow <= 0, `overflow=${overflow}px`);
  if (SHOTS) {
    await p.locator('li:has([role="img"][aria-label^="House deposit:"])').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${SHOTS}/savings-phone.png` });
  }
  await phone.close();

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

Run: `MSYS_NO_PATHCONV=1 SHOTS=<your scratchpad directory> node .verify-savings-goals.mjs`
Expected, in this order:

```text
PASS  a goal with three full months shows its pace
PASS  a goal is saved in paise with its date — {...}
PASS  a new goal says it has no pace yet
PASS  adding money writes one savings spend linked to the goal — [...]
PASS  the goal total includes it
PASS  a contribution’s category is locked
PASS  closing sets closed_on — closed_on=<today>
PASS  closing keeps what went in
PASS  a closed goal leaves the panel
PASS  goal buttons are 44px targets on a phone — <width>x44
PASS  the panel does not overflow a phone — overflow=0px

All checks passed
```

`MSYS_NO_PATHCONV=1` stops Git Bash on Windows from rewriting arguments that begin with `/`. Leave it in.

- [ ] **Step 7: Look at it**

Open both screenshots. Confirm: the progress bars and amounts line up; the message wraps inside the panel; on the phone, the amount input, Add and Cancel fit on one row or wrap cleanly, and nothing overlaps.

- [ ] **Step 8: Delete the verification script**

Run: `rm -f .verify-savings-goals.mjs && git status --short`
Expected: the script is not listed.

- [ ] **Step 9: Update STATUS.md**

In `docs/STATUS.md`, add this row directly beneath the row that starts `| Editing and removing a recorded spend |` (leave that row unchanged):

```markdown
| Savings goals | **Done** — `savings_goals` holds the plan (target, optional date, anything saved before starting). Adding money writes an ordinary spend filed as savings with `savings_goal_id`, so there is still one ledger, and it cannot be recategorised or linked to another user's goal. Shows what each month needs to meet the date and — only once there are two full calendar months of history — the actual pace, a likely finish month and the monthly gap. **Not built:** taking money back out, editing a goal. **Open question:** money filed as savings counts in the month's total against the monthly amount; whether it should is undecided |
```

- [ ] **Step 10: Commit**

```bash
git status
git add src/components/savings-panel.tsx "src/app/(app)/money/page.tsx" docs/STATUS.md
git commit -m "Show savings goals on the money screen

Each open goal shows how far along it is, what each month needs, and its
pace once there are two full months of history. Money is added from the
panel and appears in the Recent list as a savings spend with its category
locked. Closing a goal keeps everything that went in.

Verified end to end against the linked project: a pace shown from seeded
history, a goal saved in paise, a contribution written as one linked
savings spend, its category locked in the list, closing kept the money,
and no overflow at 390px.

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
