import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-level regression guard, not a behavioural test.
 *
 * requireCategoryEnabled's actual behaviour is covered by
 * src/lib/engines/categories.test.ts (the pure visibility algorithm) and by
 * live verification against a real project (this codebase's established
 * convention for I/O-heavy server actions - see docs/superpowers/plans/
 * 2026-09-18-fitness-guard-phase3.md). What nothing else protects is someone
 * later touching one of these six files during an unrelated change and
 * silently dropping a guard call. This test reads each file as text and
 * confirms every required export still has one - it will not catch a wrong
 * argument or a guard in the wrong position, only its outright absence.
 */

const GUARDED_SITES: { file: string; exportName: string }[] = [
  { file: 'src/lib/actions/tracking.ts', exportName: 'logMeasurement' },
  { file: 'src/lib/actions/tracking.ts', exportName: 'logSteps' },
  { file: 'src/lib/actions/tracking.ts', exportName: 'logWater' },
  { file: 'src/lib/actions/tracking.ts', exportName: 'logSleep' },
  { file: 'src/lib/actions/training.ts', exportName: 'ensureWeekPlanned' },
  { file: 'src/lib/actions/training.ts', exportName: 'updateSession' },
  { file: 'src/lib/actions/food.ts', exportName: 'logFood' },
  { file: 'src/lib/actions/session.ts', exportName: 'logSessionFeedback' },
  { file: 'src/lib/actions/session.ts', exportName: 'saveFitnessAssessment' },
  { file: 'src/lib/actions/steps-sync.ts', exportName: 'syncStepSegments' },
  { file: 'src/lib/actions/weekly-review.ts', exportName: 'reviewMyPlan' },
];

/** Extracts one exported async function's body, from its `export async
 *  function <name>(` line to the next top-level `export` (or end of file). */
function functionBody(source: string, exportName: string): string {
  const start = source.indexOf(`export async function ${exportName}(`);
  if (start === -1) {
    throw new Error(`Could not find "export async function ${exportName}(" in source`);
  }
  const rest = source.slice(start + 1);
  const nextExport = rest.indexOf('\nexport ');
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

describe('guarded fitness actions', () => {
  for (const { file, exportName } of GUARDED_SITES) {
    it(`${exportName} in ${file} still calls requireCategoryEnabled`, () => {
      const source = readFileSync(file, 'utf-8');
      const body = functionBody(source, exportName);
      expect(body).toContain('requireCategoryEnabled(');
    });
  }

  it('updateFoodLog stays ungated - editing an existing entry must not require an enabled category', () => {
    const source = readFileSync('src/lib/actions/food.ts', 'utf-8');
    const body = functionBody(source, 'updateFoodLog');
    expect(body).not.toContain('requireCategoryEnabled(');
  });

  it('deleteFoodLog stays ungated - deleting an existing entry must not require an enabled category', () => {
    const source = readFileSync('src/lib/actions/food.ts', 'utf-8');
    const body = functionBody(source, 'deleteFoodLog');
    expect(body).not.toContain('requireCategoryEnabled(');
  });
});
