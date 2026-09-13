# Money roadmap: from recording to understanding

**Status:** Sequencing agreed 2026-09-13. Feature 1 shipped the same day
(`8697fd8`); Feature 2 has a full implementation plan. Each later feature gets
its own when its predecessor ships.

**Read first:** `docs/ARCHITECTURE.md` §8 records what was deliberately *not*
adopted from the "Life OS" proposal (Prisma, a duplicated `events` table, a
folder restructure) and why. This roadmap builds on the existing architecture.

---

## Why only one detailed plan

Five subsystems follow in sequence, and each one's interfaces depend on what
the previous one actually produced. Writing test-first code for Feature 4 now
would mean guessing at the shape Features 1–3 leave behind.

There is also a concrete precedent in this repository.
`plans/2026-09-03-phase-0-session-feedback.md` was **superseded while it was
being written**: parallel work landed its tasks concurrently, its migration
numbers were taken, and executing it as written would have duplicated a server
action. A second session is working in this repo on its own roadmap. Plans here
go stale fast, so they are written just before they are executed.

---

## What inspection found

Every item below was verified against the code or the live database on
2026-09-13, not inferred.

### 1. Spends can be added, and nothing else

`deleteSpend` exists in `src/lib/actions/money.ts` but **no component calls
it**. The Recent list on `/money` is a server-rendered `<ul>` with no controls.
STATUS.md said "you can add and delete but not correct"; in the product you can
only add. Feature 1 ships edit and delete together.

`deleteSpend` also accepts any string as `id` without validating it is a UUID.

### 2. Eight user-owned tables have policies but no cross-user test

`tests/rls/harness.ts` says of `OWNER_TABLES`: *"a table added without a policy
fails the build rather than leaking quietly."* That only holds for tables
someone remembers to add to the list. Computed against the schema:

| Missing from the sweep | Added in |
| --- | --- |
| `spends`, `money_settings` | `20260903120009_money.sql` |
| `commitments` | `20260903120010_commitments.sql` |
| `income_sources`, `incomes` | `20260903120013_income.sql` |
| `step_segments`, `step_validations` | `20260903120006_step_segments.sql` |
| `food_prices` | `20260829100004_food.sql` |

`food_prices` cannot join the generic sweep: its `user_id` is nullable, because
shared reference prices and private ones share the table. It needs a test
shaped like the existing custom-foods test. The other seven go in the sweep in
Feature 1, Task 1.

Baseline at time of writing: `npm run test:rls` → 19 passing.

### 3. A spend can settle another user's commitment

Postgres foreign-key checks run with the table owner's rights and ignore RLS.
Proven live with two test accounts on 2026-09-13:

```text
readable=0 link=ACCEPTED
```

Bob could not read Alice's commitment, but could insert a spend with
`commitment_id` set to it. Practical risk is low — commitment ids are random
UUIDs Bob cannot read — but it breaks the ownership rule the whole data model
relies on, and **`incomes.source_id` → `income_sources` has the same shape**.
Feature 1, Task 3 adds a `before insert or update` guard for both.

### 4. The category list is defined in four places

- the `CATEGORIES` tuple in `src/lib/actions/money.ts`
- `CATEGORIES` in `src/lib/engines/money.ts`
- the `check (category in (…))` constraint on `spends`
- the same constraint, retyped, on `commitments`

They currently agree. Nothing keeps them agreeing. Feature 1, Task 2 derives the
action's list from the engine and adds a test that fails if either database
constraint drifts from it.

### 5. Editing a bill payment can un-pay the bill

A spend carrying `commitment_id` is what marks a commitment paid, using a 95%
threshold hardcoded as `0.95` at `src/lib/engines/commitments.ts:159`. Editing
that spend's amount below the threshold, or its date into another month,
silently returns the bill to unpaid — and the daily job will then raise an
overdue notification about a bill the person paid. Changing its category would
file a rent payment under groceries while still counting towards rent.
Feature 1 locks the category in the database and warns, in words, before the
other two consequences land.

### 6. There is no edit history

`spends` has no `updated_at` and no audit table exists anywhere in the schema.

### 7. A known trap for any new delete trigger

`20260829100014_fix_rollup_on_user_delete.sql` exists because an AFTER DELETE
trigger wrote a row for a user who was mid-deletion, failing the foreign key and
aborting account deletion entirely. Any trigger that writes a user-owned row
while rows are being deleted must first check
`if not exists (select 1 from auth.users u where u.id = old.user_id)`. The edit
history trigger in Feature 1 is exactly that kind of trigger.

### 8. Grocery tables are a shopping list, not an inventory

`grocery_lists` and `grocery_items` model a planned list: `est_cost`, a
`purchased` flag, `meals_covered`. There is no quantity on hand, no purchase
event, no consumption, and **nothing in `src/` reads any of these tables**.

`food_logs.recipe_id` and `recipe_ingredients` exist, which is what
dish-to-ingredient depletion needs — but `logFood` never sets `recipe_id`, and
STATUS.md records that no recipes are seeded. See Feature 3.

### 9. Migration numbers are contested

Latest applied at time of writing: `20260903120013`. The other session allocates
from the same sequence. **Take the next free number at execution time**, from
`npx supabase migration list --linked`, never from a plan.

---

## The sequence

```text
1 EDIT EXPENSE ──▶ 2 SAVINGS GOALS ──▶ 3 GROCERY INVENTORY ──▶ 4 CSV IMPORT ──▶ 5 ANALYTICS ──▶ 6 ACCOUNT AGGREGATOR
```

No other large feature is added until 1–5 are complete.

### Feature 1 — Edit expense

**Plan:** `docs/superpowers/plans/2026-09-13-edit-expense.md` (written).

Correct or remove a recorded spend without being able to change who owns it,
break the category rules, or quietly un-pay a bill. Closes findings 1–7.

**Produces for later features:** an edit history (`spend_revisions`), a single
category source (`SPEND_CATEGORY_IDS`), an exported `PAID_THRESHOLD`, and money
tables that are actually covered by the isolation suite.

### Feature 2 — Savings goals

**Plan:** `docs/superpowers/plans/2026-09-13-savings-goals.md` (written after Feature 1 shipped in `8697fd8`).

**Depends on 1** because a contribution is a spend. It is not a separate ledger:
contributing to a goal records a `spends` row with `category = 'savings'` and a
new `savings_goal_id`, exactly as settling a bill records one with
`commitment_id`. A mistyped contribution therefore has to be correctable before
goals are built on top of it.

**Scope:** `savings_goals` (target, deadline, opening balance for money saved
before the app existed); required monthly contribution; actual average
contribution; projected completion date; the gap between required and actual.

**Honesty constraint:** "actual average contribution" needs at least two
complete months of contributions, and the partial current month is excluded —
the same rule `salaryTrend` already applies. With less history the projection
says it does not yet know, rather than extrapolating one deposit.

**Carry forward:** the ownership guard from Feature 1 Task 3 must also cover
`spends.savings_goal_id`.

### Feature 3 — Grocery inventory

**Depends on 2** only loosely (a grocery shop is a spend), and on finding 8
heavily.

**Scope:** stock on hand, purchase events that add stock, and consumption that
removes it — so the app can say "eggs will last about four days".

**The constraint this has to be honest about:** food is logged as dishes and
stocked as ingredients. Depletion is reliable only for foods eaten as they were
bought — eggs, milk, curd, bread, fruit — where the logged `food_id` *is* the
stocked item. Depleting rice and dal from a logged dosa needs recipe
decomposition, which needs `recipe_id` set on logs and recipes seeded, neither
of which is true today. Version 1 depletes directly-logged foods, reports days
remaining only for those, and states that mixed dishes do not yet reduce stock.
Food eaten outside the home must never deplete home stock.

Its detailed plan should begin by deciding whether to extend the unused
`grocery_items` table or add purpose-built stock tables beside it.

### Feature 4 — CSV bank import

**Depends on 1** (imported rows must be editable), **2** (a transfer to savings
should become a goal contribution) and **3** (a grocery shop can add stock).

The pipeline, as agreed, and never shortened:

```text
CSV → file validation → column mapping → raw imported row → normalization
    → duplicate detection → merchant recognition → category suggestion
    → preview → user confirmation → existing spend system → analytics
```

**Rules:** no CSV row is ever inserted into `spends` directly. Confirmation
writes through the same validated path a hand-entered spend uses, so imported
and manual spends cannot diverge in what they are allowed to contain. Duplicate
detection checks both within the file and against existing spends, because a
statement imported twice, or a spend typed by hand and then imported, is the
common case rather than the edge case. Merchant rules learn from the user's
corrections; an LLM is not the classifier.

**Why this is also the Account Aggregator pipeline:** build the raw-row →
normalize → dedupe → confirm path once, and Feature 6 becomes a new source
feeding it rather than a second ingestion system.

### Feature 5 — Financial analytics

**Depends on 1–4**, because the value of month-over-month comparison is bounded
by the quality of the data being compared.

**Scope:** salary allocation over time, month-over-month spending, needs/wants
trend, fixed-cost ratio (commitments against income), savings rate,
subscriptions (commitments of a subscription kind), and whether "not accounted
for" is shrinking — which is the most direct measure of whether recording is
improving.

Mostly pure engines over existing tables. The "where did my salary go" rule
from Feature 1's predecessor holds throughout: the analysis never depends on a
bank balance, and money with no recorded destination is never called
"remaining".

### Feature 6 — Account Aggregator

Only after 1–5. Consent-based sharing through a regulated partner under RBI's
framework; no bank credentials, ever; no assumption that UPI history is freely
readable. Arriving transactions enter Feature 4's raw import tables and go
through the same normalize, dedupe and confirm steps.
