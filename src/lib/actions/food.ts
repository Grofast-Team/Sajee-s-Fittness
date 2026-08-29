'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { resolvePortion } from '@/lib/engines/portion';
import { estimateNutrition, type FoodDensity } from '@/lib/engines/nutrition';

/**
 * Writing a food log entry.
 *
 * As with onboarding, the client sends *what was eaten*, not what it thinks the
 * numbers are. The server looks the food up, resolves the portion and computes
 * the nutrition itself. A client that can post its own calorie figure can post
 * zero, and a tracker that accepts that is not a tracker.
 */

const MEALS = [
  'breakfast',
  'morning_snack',
  'lunch',
  'afternoon_snack',
  'dinner',
  'evening_snack',
  'other',
] as const;

const logInputSchema = z
  .object({
    foodId: z.string().uuid(),
    meal: z.enum(MEALS).default('other'),
    logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Exactly one of these two portion forms must be supplied. */
    grams: z.number().positive().max(5000).optional(),
    serving: z
      .object({
        unitLabel: z.string().min(1).max(40),
        count: z.number().positive().max(50),
      })
      .optional(),
    analysisId: z.string().uuid().optional(),
  })
  .refine((v) => v.grams !== undefined || v.serving !== undefined, {
    message: 'A portion is required.',
  });

export type LogResult =
  | { ok: true; kcal: number; proteinG: number }
  | { ok: false; error: string };

export async function logFood(input: unknown): Promise<LogResult> {
  if (!supabaseConfigured) {
    return {
      ok: false,
      error: 'Supabase is not configured on this deployment, so there is nowhere to save this yet.',
    };
  }

  const parsed = logInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'That entry was missing a quantity we could use.' };
  }
  const entry = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in to log food.' };

  // Look the food up server-side. RLS means a user can only reach public foods
  // and their own custom ones, so this doubles as an authorisation check.
  const { data: foodRow, error: foodError } = await supabase
    .from('foods')
    .select(
      'id, name, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, fibre_per_100g, food_state, typical_cost_per_100g',
    )
    .eq('id', entry.foodId)
    .single();

  if (foodError || !foodRow) {
    return { ok: false, error: 'We could not find that food. Try searching for it again.' };
  }

  const food: FoodDensity = {
    id: foodRow.id,
    name: foodRow.name,
    kcalPer100g: Number(foodRow.kcal_per_100g),
    proteinPer100g: Number(foodRow.protein_per_100g),
    carbPer100g: Number(foodRow.carb_per_100g),
    fatPer100g: Number(foodRow.fat_per_100g),
    fibrePer100g: foodRow.fibre_per_100g == null ? null : Number(foodRow.fibre_per_100g),
    foodState: foodRow.food_state,
  };

  // Household measures are resolved against the database, not against whatever
  // gram figure the client believes a katori holds.
  let portionInput: Parameters<typeof resolvePortion>[0];
  let description = food.name;

  if (entry.grams !== undefined) {
    portionInput = { userGrams: entry.grams };
    description = `${entry.grams} g ${food.name}`;
  } else {
    const { data: servingRow } = await supabase
      .from('food_servings')
      .select('unit_label, grams, confidence')
      .eq('food_id', food.id)
      .eq('unit_label', entry.serving!.unitLabel)
      .single();

    if (!servingRow) {
      return {
        ok: false,
        error: `We do not have a "${entry.serving!.unitLabel}" measure for ${food.name}. Enter the weight instead.`,
      };
    }

    portionInput = {
      household: {
        unitLabel: servingRow.unit_label,
        grams: Number(servingRow.grams),
        count: entry.serving!.count,
        confidence: servingRow.confidence,
      },
    };
    description = `${entry.serving!.count} × ${servingRow.unit_label} ${food.name}`;
  }

  const portion = resolvePortion(portionInput);
  const nutrition = estimateNutrition(food, portion);

  if (nutrition.kcal <= 0 && nutrition.kcalLow === null) {
    return { ok: false, error: 'We could not work out a quantity for that.' };
  }

  const grams = portion.grams ?? (portion.gramsLow! + portion.gramsHigh!) / 2;
  const cost =
    foodRow.typical_cost_per_100g == null
      ? null
      : Math.round((Number(foodRow.typical_cost_per_100g) * grams) / 100 * 100) / 100;

  const { error: insertError } = await supabase.from('food_logs').insert({
    user_id: auth.user.id,
    food_id: food.id,
    analysis_id: entry.analysisId ?? null,
    log_date: entry.logDate ?? new Date().toISOString().slice(0, 10),
    meal: entry.meal,
    description,
    quantity: entry.grams ?? entry.serving!.count,
    unit_label: entry.grams !== undefined ? 'g' : entry.serving!.unitLabel,
    grams,
    kcal: nutrition.kcal,
    protein_g: nutrition.proteinG,
    carb_g: nutrition.carbG,
    fat_g: nutrition.fatG,
    fibre_g: nutrition.fibreG,
    // A range is stored as a range. Collapsing it to its midpoint on save would
    // throw away the one piece of information that says "this was estimated".
    kcal_low: nutrition.kcalLow,
    kcal_high: nutrition.kcalHigh,
    source: entry.analysisId ? 'photo' : 'search',
    confidence: nutrition.confidence,
    portion_basis: portion.basis,
    cost,
  });

  if (insertError) {
    console.error('food log insert failed', insertError);
    return {
      ok: false,
      error: "We couldn't save that right now. Nothing has been lost — please try again.",
    };
  }

  // `food_logs_rollup_trigger` updates daily_logs; we just need the pages to
  // re-read.
  revalidatePath('/today');
  revalidatePath('/food');

  return { ok: true, kcal: nutrition.kcal, proteinG: nutrition.proteinG };
}

export async function deleteFoodLog(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseConfigured) return { ok: false, error: 'Not configured.' };

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Unknown entry.' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // The `user_id` filter is belt-and-braces: RLS already prevents deleting
  // someone else's row, and would reject this even without it.
  const { error } = await supabase
    .from('food_logs')
    .delete()
    .eq('id', parsed.data)
    .eq('user_id', auth.user.id);

  if (error) return { ok: false, error: 'We could not remove that entry.' };

  revalidatePath('/today');
  revalidatePath('/food');
  return { ok: true };
}
