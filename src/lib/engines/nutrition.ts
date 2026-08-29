import type { Confidence } from './types';
import type { PortionResult } from './portion';

/**
 * Turning grams into nutrition.
 *
 * This is the *only* place energy and macro values are produced. The AI layer
 * has no calorie field in its output schema, precisely so that every number the
 * user sees has to come through here, from a database row with a known source.
 */

/** Per-100 g figures as stored in `public.foods`. */
export interface FoodDensity {
  id?: string;
  name: string;
  kcalPer100g: number;
  proteinPer100g: number;
  carbPer100g: number;
  fatPer100g: number;
  fibrePer100g?: number | null;
  /** Never mix states: 100 g of raw rice is not 100 g of cooked rice. */
  foodState: 'raw' | 'cooked' | 'as_sold' | 'prepared' | 'dry';
}

export interface Nutrition {
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number | null;
}

export interface NutritionEstimate extends Nutrition {
  confidence: Confidence;
  /** Populated only when confidence is below high. The UI renders the range. */
  kcalLow: number | null;
  kcalHigh: number | null;
  grams: number | null;
  basis: string;
  /** Human-readable, e.g. "302 kcal" or "Estimated 550-700 kcal". */
  display: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function nutritionForGrams(food: FoodDensity, grams: number): Nutrition {
  const factor = grams / 100;
  return {
    kcal: Math.round(food.kcalPer100g * factor),
    proteinG: round1(food.proteinPer100g * factor),
    carbG: round1(food.carbPer100g * factor),
    fatG: round1(food.fatPer100g * factor),
    fibreG: food.fibrePer100g == null ? null : round1(food.fibrePer100g * factor),
  };
}

/**
 * Combine a resolved portion with a food's density.
 *
 * When the portion is a range, the energy figure is a range too. We never
 * collapse a range to its midpoint and present that as a value - "637 kcal"
 * from a photo with no scale in it is false precision, and false precision is
 * how users end up mistrusting the whole app when the scale disagrees.
 */
export function estimateNutrition(food: FoodDensity, portion: PortionResult): NutritionEstimate {
  if (portion.grams !== null && portion.confidence === 'high') {
    const n = nutritionForGrams(food, portion.grams);
    return {
      ...n,
      confidence: 'high',
      kcalLow: null,
      kcalHigh: null,
      grams: portion.grams,
      basis: portion.basis,
      display: `${n.kcal.toLocaleString()} kcal`,
    };
  }

  const low = portion.gramsLow ?? portion.grams;
  const high = portion.gramsHigh ?? portion.grams;

  if (low === null || high === null) {
    return {
      kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fibreG: null,
      confidence: 'low',
      kcalLow: null, kcalHigh: null,
      grams: null,
      basis: portion.basis,
      display: 'Not enough information yet',
    };
  }

  const midGrams = (low + high) / 2;
  const mid = nutritionForGrams(food, midGrams);
  const kcalLow = Math.round((food.kcalPer100g * low) / 100);
  const kcalHigh = Math.round((food.kcalPer100g * high) / 100);

  return {
    ...mid,
    confidence: portion.confidence,
    kcalLow,
    kcalHigh,
    grams: portion.grams,
    basis: portion.basis,
    display: `Estimated ${kcalLow.toLocaleString()}–${kcalHigh.toLocaleString()} kcal`,
  };
}

export function sumNutrition(items: Nutrition[]): Nutrition {
  return items.reduce<Nutrition>(
    (acc, n) => ({
      kcal: acc.kcal + n.kcal,
      proteinG: round1(acc.proteinG + n.proteinG),
      carbG: round1(acc.carbG + n.carbG),
      fatG: round1(acc.fatG + n.fatG),
      fibreG: n.fibreG == null && acc.fibreG == null ? null : round1((acc.fibreG ?? 0) + (n.fibreG ?? 0)),
    }),
    { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fibreG: null },
  );
}

export interface Remaining {
  kcalRemaining: number;
  proteinRemaining: number;
  kcalOver: boolean;
  message: string;
}

/**
 * What is left for the rest of the day.
 *
 * The tone here matters more than the arithmetic. Going over target is a normal
 * event in every successful fat-loss attempt; framing it as a failure is what
 * turns one heavy lunch into an abandoned week.
 */
export function remainingForDay(
  consumed: Nutrition,
  targetKcal: number,
  targetProteinG: number,
): Remaining {
  const kcalRemaining = targetKcal - consumed.kcal;
  const proteinRemaining = Math.max(0, round1(targetProteinG - consumed.proteinG));
  const over = kcalRemaining < 0;

  let message: string;
  if (over) {
    const overBy = Math.abs(kcalRemaining);
    message =
      `You are about ${overBy.toLocaleString()} kcal past today's target. One day above target does ` +
      `not undo your progress, and there is nothing to make up for. Eat normally tomorrow.`;
  } else if (proteinRemaining > 0) {
    message =
      `About ${kcalRemaining.toLocaleString()} kcal and ${proteinRemaining} g of protein left today.`;
  } else {
    message = `About ${kcalRemaining.toLocaleString()} kcal left, and you have already hit your protein target.`;
  }

  return { kcalRemaining, proteinRemaining, kcalOver: over, message };
}
