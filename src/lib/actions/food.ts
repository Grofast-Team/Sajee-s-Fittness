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

/** What a portion request looks like, in either of the two accepted forms. */
type PortionSpec =
  | { grams: number; serving?: undefined }
  | { grams?: undefined; serving: { unitLabel: string; count: number } };

/** Everything a `food_logs` row needs, once a portion has been resolved. */
interface ComputedEntry {
  foodId: string;
  description: string;
  quantity: number;
  unitLabel: string;
  grams: number;
  kcal: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fibreG: number | null;
  kcalLow: number | null;
  kcalHigh: number | null;
  confidence: 'high' | 'medium' | 'low';
  portionBasis: string;
  cost: number | null;
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Turn a food id and a portion into the numbers we store.
 *
 * Shared by logging and editing so the two can never disagree. An edit that
 * recomputed nutrition by a different route than the original insert would let
 * the same portion of the same food produce two different calorie figures,
 * which is the sort of inconsistency users notice and cannot explain.
 *
 * The food is always looked up server-side: RLS limits it to public foods and
 * the user's own, so the read doubles as an authorisation check, and nothing
 * the client claims about density is trusted.
 */
async function computeEntry(
  supabase: Client,
  foodId: string,
  spec: PortionSpec,
): Promise<{ ok: true; entry: ComputedEntry } | { ok: false; error: string }> {
  const { data: foodRow, error: foodError } = await supabase
    .from('foods')
    .select(
      'id, name, kcal_per_100g, protein_per_100g, carb_per_100g, fat_per_100g, fibre_per_100g, food_state, typical_cost_per_100g, is_verified',
    )
    .eq('id', foodId)
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
    verified: foodRow.is_verified === true,
  };

  // Household measures are resolved against the database, not against whatever
  // gram figure the client believes a katori holds.
  let portionInput: Parameters<typeof resolvePortion>[0];
  let description = food.name;
  let quantity: number;
  let unitLabel: string;

  if (spec.grams !== undefined) {
    portionInput = { userGrams: spec.grams };
    description = `${spec.grams} g ${food.name}`;
    quantity = spec.grams;
    unitLabel = 'g';
  } else {
    const { data: servingRow } = await supabase
      .from('food_servings')
      .select('unit_label, grams, confidence')
      .eq('food_id', food.id)
      .eq('unit_label', spec.serving.unitLabel)
      .single();

    if (!servingRow) {
      return {
        ok: false,
        error: `We do not have a "${spec.serving.unitLabel}" measure for ${food.name}. Enter the weight instead.`,
      };
    }

    portionInput = {
      household: {
        unitLabel: servingRow.unit_label,
        grams: Number(servingRow.grams),
        count: spec.serving.count,
        confidence: servingRow.confidence,
      },
    };
    description = `${spec.serving.count} × ${servingRow.unit_label} ${food.name}`;
    quantity = spec.serving.count;
    unitLabel = servingRow.unit_label;
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
      : Math.round(((Number(foodRow.typical_cost_per_100g) * grams) / 100) * 100) / 100;

  return {
    ok: true,
    entry: {
      foodId,
      description,
      quantity,
      unitLabel,
      grams,
      kcal: nutrition.kcal,
      proteinG: nutrition.proteinG,
      carbG: nutrition.carbG,
      fatG: nutrition.fatG,
      fibreG: nutrition.fibreG,
      kcalLow: nutrition.kcalLow,
      kcalHigh: nutrition.kcalHigh,
      confidence: nutrition.confidence,
      portionBasis: portion.basis,
      cost,
    },
  };
}

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

  const computed = await computeEntry(
    supabase,
    entry.foodId,
    entry.grams !== undefined
      ? { grams: entry.grams }
      : { serving: entry.serving! },
  );
  if (!computed.ok) return { ok: false, error: computed.error };
  const e = computed.entry;

  const { error: insertError } = await supabase.from('food_logs').insert({
    user_id: auth.user.id,
    food_id: e.foodId,
    analysis_id: entry.analysisId ?? null,
    log_date: entry.logDate ?? new Date().toISOString().slice(0, 10),
    meal: entry.meal,
    description: e.description,
    quantity: e.quantity,
    unit_label: e.unitLabel,
    grams: e.grams,
    kcal: e.kcal,
    protein_g: e.proteinG,
    carb_g: e.carbG,
    fat_g: e.fatG,
    fibre_g: e.fibreG,
    // A range is stored as a range. Collapsing it to its midpoint on save would
    // throw away the one piece of information that says "this was estimated".
    kcal_low: e.kcalLow,
    kcal_high: e.kcalHigh,
    source: entry.analysisId ? 'photo' : 'search',
    confidence: e.confidence,
    portion_basis: e.portionBasis,
    cost: e.cost,
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

  return { ok: true, kcal: e.kcal, proteinG: e.proteinG };
}

const updateInputSchema = z
  .object({
    id: z.string().uuid(),
    meal: z.enum(MEALS).optional(),
    grams: z.number().positive().max(5000).optional(),
    serving: z
      .object({
        unitLabel: z.string().min(1).max(40),
        count: z.number().positive().max(50),
      })
      .optional(),
  })
  .refine((v) => v.meal !== undefined || v.grams !== undefined || v.serving !== undefined, {
    message: 'Nothing to change.',
  });

/**
 * Correct an entry that is already logged.
 *
 * You could add one and delete one, but not fix one, so mistyping 180 g as
 * 1800 g meant deleting and starting again — in the flow people touch most
 * often, several times a day.
 *
 * The quantity and the meal can change; the food cannot. Swapping the food is
 * a different entry, and letting an edit do it would quietly turn "correct the
 * weight" into "replace this with something else" while keeping the original
 * timestamp.
 *
 * Nutrition is recomputed here, never taken from the client, and through the
 * same `computeEntry` the original insert used. `food_logs_rollup_trigger`
 * already fires on UPDATE and recalculates the day — including both days if an
 * entry ever moves between them — so the totals follow without extra work.
 */
export async function updateFoodLog(input: unknown): Promise<LogResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = updateInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that change.' };
  const change = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // Read the row first, both to find the food and to confirm it is theirs.
  // RLS would refuse the update anyway; failing here gives a better message
  // than a silent no-op affecting zero rows.
  const { data: existing } = await supabase
    .from('food_logs')
    .select('id, food_id, meal, quantity, unit_label')
    .eq('id', change.id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!existing) return { ok: false, error: 'We could not find that entry.' };

  const patch: Record<string, unknown> = {};
  if (change.meal !== undefined) patch.meal = change.meal;

  // Only recompute when the portion actually changed. A meal-only edit should
  // not rewrite the nutrition, which would silently re-resolve the portion
  // against today's serving data and could move the figure for no reason.
  if (change.grams !== undefined || change.serving !== undefined) {
    if (!existing.food_id) {
      return {
        ok: false,
        error: 'This entry is not linked to a food, so its quantity cannot be recalculated.',
      };
    }

    const computed = await computeEntry(
      supabase,
      existing.food_id as string,
      change.grams !== undefined ? { grams: change.grams } : { serving: change.serving! },
    );
    if (!computed.ok) return { ok: false, error: computed.error };
    const e = computed.entry;

    Object.assign(patch, {
      description: e.description,
      quantity: e.quantity,
      unit_label: e.unitLabel,
      grams: e.grams,
      kcal: e.kcal,
      protein_g: e.proteinG,
      carb_g: e.carbG,
      fat_g: e.fatG,
      fibre_g: e.fibreG,
      kcal_low: e.kcalLow,
      kcal_high: e.kcalHigh,
      confidence: e.confidence,
      portion_basis: e.portionBasis,
      cost: e.cost,
    });
  }

  const { data: updated, error } = await supabase
    .from('food_logs')
    .update(patch)
    .eq('id', change.id)
    .eq('user_id', auth.user.id)
    .select('kcal, protein_g')
    .maybeSingle();

  if (error || !updated) {
    console.error('food log update failed', error);
    return { ok: false, error: 'We could not save that change.' };
  }

  revalidatePath('/today');
  revalidatePath('/food');

  return { ok: true, kcal: Number(updated.kcal), proteinG: Number(updated.protein_g) };
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
