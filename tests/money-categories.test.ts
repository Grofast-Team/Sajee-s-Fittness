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
function allConstraintCategories(migration: string): string[][] {
  const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', migration), 'utf8');
  const matches = [...sql.matchAll(/check\s*\(\s*category\s+in\s*\(([\s\S]*?)\)\s*\)/gi)];
  if (matches.length === 0) throw new Error(`No category check constraint found in ${migration}`);
  return matches.map((match) => [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

const constraintCategories = (migration: string) => allConstraintCategories(migration)[0];

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

  it('matches both constraints in the statement import, on import rows and merchant rules', () => {
    const lists = allConstraintCategories('20260903120018_bank_import.sql');
    expect(lists).toHaveLength(2);
    for (const list of lists) expect([...list].sort()).toEqual([...SPEND_CATEGORY_IDS].sort());
  });
});
