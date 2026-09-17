import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { calibrateServing } from '@/lib/engines/calibration';
import type { CalibrationResult } from '@/lib/engines/calibration';

/**
 * What one of this person's household measures actually weighs.
 *
 * ## Which rows count as evidence
 *
 * A `food_logs` row is a measurement of "one dosa" when it has a household
 * `unit_label` *and* a weight that did not come from the shared serving table.
 * That second condition is the important one: a `household_measure` row's
 * grams were computed *from* `food_servings`, so treating it as evidence would
 * teach the app the population figure it already had, with a false air of
 * having learned something.
 *
 * So the filter is: a unit label that is not grams, and a basis that is not
 * `household_measure`.
 *
 * ## Why this reads logs rather than a calibration table
 *
 * Every weighed entry is already a `food_logs` row. A separate table of
 * learned portions would be a second copy of the same fact, free to drift from
 * the log it was derived from, and would need its own RLS surface. Deriving on
 * read costs one indexed query and cannot disagree with the underlying data.
 */

/** Grams entries above this are a mis-tared scale or a typo, not a portion. */
const MAX_PLAUSIBLE_UNIT_GRAMS = 2000;

export async function getCalibratedServing(
  foodId: string,
  unitLabel: string,
  populationGrams: number | null,
): Promise<CalibrationResult> {
  if (!supabaseConfigured) {
    return calibrateServing({ samples: [], populationGrams });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return calibrateServing({ samples: [], populationGrams });

  const { data, error } = await supabase
    .from('food_logs')
    .select('quantity, grams, portion_basis')
    .eq('user_id', auth.user.id)
    .eq('food_id', foodId)
    .eq('unit_label', unitLabel)
    .neq('portion_basis', 'household_measure')
    .not('grams', 'is', null)
    .order('log_date', { ascending: false })
    // Recent portions describe how they cook now. An older habit that has
    // changed should age out rather than hold the median forever.
    .limit(20);

  if (error || !data) {
    // A failed read must not invent a portion; fall back to the shared figure.
    return calibrateServing({ samples: [], populationGrams });
  }

  const samples = data
    .map((row) => {
      const quantity = Number(row.quantity);
      const grams = Number(row.grams);
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      if (!Number.isFinite(grams) || grams <= 0) return null;
      const perUnit = grams / quantity;
      return perUnit > MAX_PLAUSIBLE_UNIT_GRAMS ? null : perUnit;
    })
    .filter((v): v is number => v !== null);

  return calibrateServing({ samples, populationGrams });
}
