import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { buildSamplePlan, SAMPLE_BODY, SAMPLE_CONTEXT, SAMPLE_TODAY_LOG } from '@/lib/sample-profile';
import { analyseTrend } from '@/lib/engines/trend';
import { remainingForDay } from '@/lib/engines/nutrition';
import type { Confidence, TrendResult, WeighIn } from '@/lib/engines/types';

/**
 * The read model for the app's day-to-day screens.
 *
 * One function assembles everything the dashboard needs, so a page render is a
 * bounded number of queries rather than a component tree each fetching its own
 * slice. It also means there is exactly one place that decides whether we are
 * looking at real data or the sample profile.
 *
 * `isSample` is threaded all the way to the UI on purpose. A demo the user
 * cannot distinguish from their own data is a lie, so the banner is driven by
 * this flag rather than by a build-time constant.
 */

export interface LoggedItem {
  id: string;
  meal: string;
  description: string;
  kcal: number;
  proteinG: number;
  kcalLow: number | null;
  kcalHigh: number | null;
  confidence: Confidence;
  portionBasis: string;
}

export interface Constraints {
  budgetPerDay: string | null;
  diet: string;
  dislikes: string[];
  allergies: string[];
  equipment: string;
  cookMinutes: number | null;
}

export interface WaistView {
  latestCm: number;
  changeCm: number | null;
  overDays: number | null;
}

export interface DayView {
  isSample: boolean;
  displayName: string;
  weightKg: number | null;
  waist: WaistView | null;
  constraints: Constraints;
  targetKcal: number;
  floorKcal: number;
  proteinTargetG: number;
  fibreTargetG: number;
  stepTarget: number;
  waterMl: number;
  consumedKcal: number;
  consumedProteinG: number;
  remaining: ReturnType<typeof remainingForDay>;
  stepsToday: number | null;
  waterToday: number;
  sleepMinutes: number | null;
  sleepTargetHours: number;
  items: LoggedItem[];
  trend: TrendResult;
  /** Why the energy target is what it is. Rendered by the "Why?" panels. */
  rationale: {
    energy: string;
    activityReasons: string[];
    steps: string;
    bmrKcal: number;
    bmrLowKcal: number;
    bmrHighKcal: number;
  };
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  morning_snack: 'Mid-morning',
  lunch: 'Lunch',
  afternoon_snack: 'Afternoon',
  dinner: 'Dinner',
  evening_snack: 'Evening',
  other: 'Other',
};

export function mealLabel(slot: string): string {
  return MEAL_LABELS[slot] ?? 'Other';
}

/** The sample day, computed by the real engines from the sample person. */
function sampleDay(): DayView {
  const plan = buildSamplePlan();
  const consumedKcal = SAMPLE_TODAY_LOG.reduce((sum, e) => sum + e.kcal, 0);
  const consumedProteinG =
    Math.round(SAMPLE_TODAY_LOG.reduce((sum, e) => sum + e.proteinG, 0) * 10) / 10;

  return {
    isSample: true,
    displayName: SAMPLE_CONTEXT.displayName,
    weightKg: SAMPLE_BODY.weightKg,
    waist: { latestCm: 94.5, changeCm: -1.5, overDays: 28 },
    constraints: {
      budgetPerDay: SAMPLE_CONTEXT.budgetPerDay,
      diet: SAMPLE_CONTEXT.diet,
      dislikes: SAMPLE_CONTEXT.dislikes,
      allergies: SAMPLE_CONTEXT.allergies,
      equipment: SAMPLE_CONTEXT.equipment,
      cookMinutes: SAMPLE_CONTEXT.cookMinutesWeekday,
    },
    targetKcal: plan.energy.targetKcal,
    floorKcal: plan.energy.floorKcal,
    proteinTargetG: plan.macros.proteinG,
    fibreTargetG: plan.macros.fibreG,
    stepTarget: plan.steps.target,
    waterMl: plan.water,
    consumedKcal,
    consumedProteinG,
    remaining: remainingForDay(
      { kcal: consumedKcal, proteinG: consumedProteinG, carbG: 0, fatG: 0, fibreG: null },
      plan.energy.targetKcal,
      plan.macros.proteinG,
    ),
    stepsToday: 4120,
    waterToday: 1400,
    sleepMinutes: 372,
    sleepTargetHours: 7.5,
    items: SAMPLE_TODAY_LOG.map((e, i) => ({
      id: `sample-${i}`,
      meal: e.meal,
      description: e.description,
      kcal: e.kcal,
      proteinG: e.proteinG,
      kcalLow: null,
      kcalHigh: null,
      confidence: e.confidence,
      portionBasis: e.basis,
    })),
    trend: plan.trend,
    rationale: {
      energy: plan.energy.explanation,
      activityReasons: plan.activity.reasons,
      steps: plan.steps.explanation,
      bmrKcal: plan.bmr.kcal,
      bmrLowKcal: plan.bmr.lowKcal,
      bmrHighKcal: plan.bmr.highKcal,
    },
  };
}

/**
 * Load the signed-in user's day.
 *
 * Falls back to the sample profile whenever there is no Supabase, no session,
 * or no active plan yet — the last case being a user who signed up but has not
 * finished setup.
 */
export async function getDayView(date?: string): Promise<DayView> {
  if (!supabaseConfigured) return sampleDay();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return sampleDay();

  const userId = auth.user.id;
  const logDate = date ?? new Date().toISOString().slice(0, 10);

  const [planRes, profileRes, dailyRes, logsRes, weighInsRes, foodProfileRes, lifestyleRes, budgetRes] =
    await Promise.all([
    supabase
      .from('plans')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase.from('profiles').select('display_name').eq('user_id', userId).maybeSingle(),
    supabase
      .from('daily_logs')
      .select('kcal, protein_g, steps, water_ml, sleep_minutes')
      .eq('user_id', userId)
      .eq('log_date', logDate)
      .maybeSingle(),
    supabase
      .from('food_logs')
      .select('id, meal, description, kcal, protein_g, kcal_low, kcal_high, confidence, portion_basis, logged_at')
      .eq('user_id', userId)
      .eq('log_date', logDate)
      .order('logged_at', { ascending: true }),
    // Enough history for the trend engine's 28-day window, plus headroom.
    supabase
      .from('measurements')
      .select('measured_on, weight_kg, waist_cm')
      .eq('user_id', userId)
      .order('measured_on', { ascending: false })
      .limit(120),
    supabase
      .from('food_profile')
      .select('diet, allergies, disliked_foods, cook_minutes_weekday')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('lifestyle').select('equipment').eq('user_id', userId).maybeSingle(),
    supabase
      .from('budgets')
      .select('amount, period, currency_code')
      .eq('user_id', userId)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // No finished setup means no plan to show. The sample profile is a more
  // useful landing state than a screen of zeroes and dashes.
  if (!planRes.data) return sampleDay();

  const plan = planRes.data;
  const daily = dailyRes.data;

  const consumedKcal = Math.round(Number(daily?.kcal ?? 0));
  const consumedProteinG = Math.round(Number(daily?.protein_g ?? 0) * 10) / 10;

  const rows = (weighInsRes.data ?? []).slice().reverse();

  const weighIns: WeighIn[] = rows
    .filter((row) => row.weight_kg !== null)
    .map((row) => ({ date: row.measured_on as string, weightKg: Number(row.weight_kg) }));

  // Waist is compared oldest-in-window to newest, and only when there are two
  // readings far enough apart to mean anything. A single measurement gets shown
  // with no change figure rather than an implied trend of zero.
  const waistRows = rows.filter((row) => row.waist_cm !== null);
  let waist: WaistView | null = null;
  if (waistRows.length > 0) {
    const newest = waistRows[waistRows.length - 1];
    const oldest = waistRows[0];
    const spanDays = Math.round(
      (Date.parse(newest.measured_on as string) - Date.parse(oldest.measured_on as string)) /
        86_400_000,
    );
    waist = {
      latestCm: Number(newest.waist_cm),
      changeCm:
        waistRows.length > 1 && spanDays >= 7
          ? Math.round((Number(newest.waist_cm) - Number(oldest.waist_cm)) * 10) / 10
          : null,
      overDays: waistRows.length > 1 && spanDays >= 7 ? spanDays : null,
    };
  }

  const rationale = (plan.rationale ?? {}) as Record<string, unknown>;
  const bmrRange = Array.isArray(rationale.bmrRange) ? (rationale.bmrRange as number[]) : null;

  const budget = budgetRes.data;
  const foodProfile = foodProfileRes.data;

  return {
    isSample: false,
    displayName: profileRes.data?.display_name || '',
    weightKg: weighIns.length > 0 ? weighIns[weighIns.length - 1].weightKg : null,
    waist,
    constraints: {
      // No budget recorded means no budget shown. We never guess a figure the
      // user did not give us.
      budgetPerDay: budget
        ? `${budget.currency_code === 'INR' ? '₹' : ''}${Number(budget.amount)} ${budget.period === 'daily' ? 'a day' : `per ${budget.period.replace('ly', '')}`}`
        : null,
      diet: foodProfile?.diet ?? 'not set',
      dislikes: foodProfile?.disliked_foods ?? [],
      allergies: foodProfile?.allergies ?? [],
      equipment: lifestyleRes.data?.equipment ?? 'none',
      cookMinutes: foodProfile?.cook_minutes_weekday ?? null,
    },
    targetKcal: plan.energy_target_kcal,
    floorKcal: plan.energy_floor_kcal,
    proteinTargetG: plan.protein_g,
    fibreTargetG: plan.fibre_g,
    stepTarget: plan.step_target,
    waterMl: plan.water_ml,
    consumedKcal,
    consumedProteinG,
    remaining: remainingForDay(
      { kcal: consumedKcal, proteinG: consumedProteinG, carbG: 0, fatG: 0, fibreG: null },
      plan.energy_target_kcal,
      plan.protein_g,
    ),
    stepsToday: daily?.steps ?? null,
    waterToday: daily?.water_ml ?? 0,
    sleepMinutes: daily?.sleep_minutes ?? null,
    sleepTargetHours: Number(plan.sleep_target_hours ?? 7.5),
    items: (logsRes.data ?? []).map((row) => ({
      id: row.id as string,
      meal: mealLabel(row.meal as string),
      description: row.description as string,
      kcal: Math.round(Number(row.kcal)),
      proteinG: Math.round(Number(row.protein_g) * 10) / 10,
      kcalLow: row.kcal_low == null ? null : Math.round(Number(row.kcal_low)),
      kcalHigh: row.kcal_high == null ? null : Math.round(Number(row.kcal_high)),
      confidence: row.confidence as Confidence,
      portionBasis: row.portion_basis as string,
    })),
    trend: analyseTrend(weighIns),
    rationale: {
      energy: typeof rationale.energy === 'string' ? rationale.energy : '',
      activityReasons: Array.isArray(rationale.activityReasons)
        ? (rationale.activityReasons as string[])
        : [],
      steps: typeof rationale.steps === 'string' ? rationale.steps : '',
      bmrKcal: plan.bmr_kcal,
      bmrLowKcal: bmrRange?.[0] ?? Math.round(plan.bmr_kcal * 0.9),
      bmrHighKcal: bmrRange?.[1] ?? Math.round(plan.bmr_kcal * 1.1),
    },
  };
}
