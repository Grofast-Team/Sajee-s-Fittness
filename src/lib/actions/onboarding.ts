'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { deriveActivityLevel, estimateBmr, estimateTdee } from '@/lib/engines/energy';
import { computeEnergyTarget, computeMacros, waterTargetMl } from '@/lib/engines/targets';
import { initialStepGoal } from '@/lib/engines/steps';
import { restrictionsFrom, screen } from '@/lib/engines/safety';
import type { BodyInput, Pace, Sex } from '@/lib/engines/types';

/**
 * Persist the onboarding interview and generate the first plan.
 *
 * The plan is computed **server-side** rather than trusting numbers posted from
 * the browser. A client that can post its own `energy_target_kcal` can post
 * 800, which would walk straight past every safety floor the engines exist to
 * enforce. So the client sends answers; the server derives the plan.
 */

const answersSchema = z.object({
  name: z.string().trim().max(80).optional(),
  age: z.coerce.number().int().min(13).max(100),
  sex: z.enum(['male', 'female', 'intersex', 'prefer_not_to_say']),
  heightCm: z.coerce.number().min(90).max(250),
  weightKg: z.coerce.number().min(25).max(400),

  pregnant: z.string().optional(),
  breastfeeding: z.string().optional(),
  eatingDisorderHistory: z.string().optional(),
  conditions: z.array(z.string()).default([]),

  goal: z.string().default('fat_loss'),
  targetWeightKg: z.coerce.number().min(25).max(400).optional(),
  targetWeeks: z.coerce.number().int().min(1).max(260).optional(),
  pace: z.enum(['gentle', 'steady', 'firm']).default('steady'),

  workPattern: z.string().optional(),
  sittingHours: z.coerce.number().min(0).max(24).optional(),
  nightShift: z.string().optional(),
  wakeTime: z.string().optional(),
  sleepTime: z.string().optional(),
  sleepHours: z.coerce.number().min(0).max(16).optional(),
  baselineSteps: z.coerce.number().int().min(0).max(60000).optional(),

  diet: z.string().default('non_vegetarian'),
  cuisines: z.array(z.string()).default([]),
  allergies: z.string().optional(),
  dislikes: z.string().optional(),
  favourites: z.string().optional(),
  mealsPerDay: z.coerce.number().int().min(1).max(8).optional(),

  cooksOwnFood: z.string().optional(),
  cookIdentity: z.string().optional(),
  cookMinutes: z.coerce.number().int().min(0).max(240).optional(),
  kitchenEquipment: z.array(z.string()).default([]),
  budgetPerDay: z.string().optional(),
  sharedHousehold: z.string().optional(),

  experience: z.string().default('none'),
  equipment: z.string().default('none'),
  trainingDays: z.coerce.number().int().min(0).max(7).optional(),
  sessionMinutes: z.coerce.number().int().min(0).max(240).optional(),
  activities: z.array(z.string()).default([]),
  injuries: z.string().optional(),

  previousAttempts: z.string().optional(),
  whatWentWrong: z.array(z.string()).default([]),
  stress: z.coerce.number().int().min(1).max(5).optional(),
  emotionalEating: z.string().optional(),
});

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Free-text lists arrive comma-separated; store them as clean arrays. */
function toList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40);
}

const isYes = (v: string | undefined) => v === 'yes';

export async function saveOnboarding(rawAnswers: unknown): Promise<SaveResult> {
  if (!supabaseConfigured) {
    return {
      ok: false,
      error: 'Supabase is not configured on this deployment, so there is nowhere to save this yet.',
    };
  }

  const parsed = answersSchema.safeParse(rawAnswers);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: `We could not read one of your answers (${first?.path.join('.')}).` };
  }
  const a = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in to save your plan.' };
  const userId = auth.user.id;

  // ---- Derive everything server-side --------------------------------------
  const body: BodyInput = {
    weightKg: a.weightKg,
    heightCm: a.heightCm,
    ageYears: a.age,
    sex: a.sex as Sex,
  };

  const conditions = new Set(a.conditions);
  const flags = screen({
    ...body,
    pregnant: isYes(a.pregnant),
    breastfeeding: isYes(a.breastfeeding),
    eatingDisorderHistory: isYes(a.eatingDisorderHistory),
    diabetesOnMedication: conditions.has('diabetesOnMedication'),
    kidneyDisease: conditions.has('kidneyDisease'),
    liverDisease: conditions.has('liverDisease'),
    cardiovascularCondition: conditions.has('cardiovascularCondition'),
    recentSurgery: conditions.has('recentSurgery'),
    severeMobilityLimits: conditions.has('severeMobilityLimits'),
    weightAffectingMedication: conditions.has('weightAffectingMedication'),
    unexplainedWeightLoss: conditions.has('unexplainedWeightLoss'),
    requestedTargetWeightKg: a.targetWeightKg,
    requestedWeeks: a.targetWeeks,
  });
  const restrictions = [...restrictionsFrom(flags)];

  const activity = deriveActivityLevel({
    workPattern: a.workPattern as never,
    sittingHours: a.sittingHours,
    baselineSteps: a.baselineSteps,
    trainingDaysPerWeek: a.trainingDays ?? 0,
  });
  const bmr = estimateBmr(body);
  const tdee = estimateTdee(bmr.kcal, activity.level);
  const energy = computeEnergyTarget(body, bmr.kcal, tdee, a.pace as Pace, { restrictions });
  const macros = computeMacros(body, energy.targetKcal, { goalWeightKg: a.targetWeightKg });
  const steps = initialStepGoal({ baselineSteps: a.baselineSteps ?? 3000, restrictions });

  // If the requested date was faster than we will plan for, keep the goal and
  // move the date. The destination is the user's; the pace is ours.
  const safeWeeks =
    a.targetWeightKg && a.targetWeightKg < a.weightKg && energy.projectedWeeklyLossKg > 0
      ? Math.ceil((a.weightKg - a.targetWeightKg) / energy.projectedWeeklyLossKg)
      : null;
  const agreedDate = safeWeeks
    ? new Date(Date.now() + safeWeeks * 7 * 86_400_000).toISOString().slice(0, 10)
    : null;
  const requestedDate = a.targetWeeks
    ? new Date(Date.now() + a.targetWeeks * 7 * 86_400_000).toISOString().slice(0, 10)
    : null;

  // ---- Write ---------------------------------------------------------------
  // Each upsert is keyed on user_id, so re-running onboarding updates rather
  // than duplicating. RLS means a wrong user_id here would be rejected by the
  // database, not merely by this code.
  try {
    const writes = await Promise.all([
      supabase.from('profiles').upsert(
        {
          user_id: userId,
          display_name: a.name ?? '',
          age_years: a.age,
          sex: a.sex,
          height_cm: a.heightCm,
          experience: a.experience,
          onboarding_step: 8,
          onboarding_done_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      ),

      supabase.from('lifestyle').upsert(
        {
          user_id: userId,
          work_pattern: a.workPattern ?? null,
          sitting_hours: a.sittingHours ?? null,
          night_shift: isYes(a.nightShift),
          wake_time: a.wakeTime || null,
          sleep_time: a.sleepTime || null,
          typical_sleep_hours: a.sleepHours ?? null,
          stress_level: a.stress ?? null,
          emotional_eating: a.emotionalEating ? isYes(a.emotionalEating) : null,
          baseline_steps: a.baselineSteps ?? null,
          training_days_per_week: a.trainingDays ?? null,
          equipment: a.equipment,
          session_minutes_available: a.sessionMinutes ?? null,
          injuries: toList(a.injuries),
        },
        { onConflict: 'user_id' },
      ),

      supabase.from('food_profile').upsert(
        {
          user_id: userId,
          diet: a.diet,
          eats_eggs: a.diet !== 'vegetarian' && a.diet !== 'vegan' && a.diet !== 'jain',
          eats_dairy: a.diet !== 'vegan',
          cuisines: a.cuisines,
          allergies: toList(a.allergies),
          disliked_foods: toList(a.dislikes),
          favourite_foods: toList(a.favourites),
          cooks_own_food: a.cooksOwnFood ? isYes(a.cooksOwnFood) : true,
          cook_identity: a.cookIdentity || null,
          cook_minutes_weekday: a.cookMinutes ?? null,
          kitchen_equipment: a.kitchenEquipment,
          has_refrigerator: a.kitchenEquipment.includes('fridge'),
          meals_per_day: a.mealsPerDay ?? 3,
          shared_household_food: a.sharedHousehold ? isYes(a.sharedHousehold) : true,
        },
        { onConflict: 'user_id' },
      ),
    ]);

    const failed = writes.find((w) => w.error);
    if (failed?.error) throw failed.error;

    // Retire any previous goal before opening a new one, so "active" stays
    // meaningful.
    await supabase
      .from('goals')
      .update({ status: 'superseded' })
      .eq('user_id', userId)
      .eq('status', 'active');

    await supabase.from('goals').insert({
      user_id: userId,
      goal: a.goal,
      starting_weight_kg: a.weightKg,
      target_weight_kg: a.targetWeightKg ?? null,
      requested_date: requestedDate,
      agreed_date: agreedDate,
      pace: a.pace,
      status: 'active',
    });

    await supabase.from('measurements').upsert(
      {
        user_id: userId,
        measured_on: new Date().toISOString().slice(0, 10),
        weight_kg: a.weightKg,
        notes: 'Starting weight, from setup.',
      },
      { onConflict: 'user_id,measured_on' },
    );

    if (a.budgetPerDay && a.budgetPerDay !== 'unsure') {
      await supabase.from('budgets').insert({
        user_id: userId,
        period: 'daily',
        amount: Number(a.budgetPerDay),
        covers_household: a.sharedHousehold ? isYes(a.sharedHousehold) : false,
      });
    }

    // Safety flags are replaced wholesale: re-running setup with a condition
    // removed should not leave a stale restriction in force.
    await supabase
      .from('safety_flags')
      .update({ resolved_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('resolved_at', null);

    if (flags.length > 0) {
      await supabase.from('safety_flags').insert(
        flags.map((f) => ({
          user_id: userId,
          code: f.code,
          severity: f.severity,
          reason: f.reason,
          guidance: f.guidance,
          restricts: f.restricts,
        })),
      );
    }

    // The active-plan trigger (`plans_retire_previous`) handles versioning.
    const { error: planError } = await supabase.from('plans').insert({
      user_id: userId,
      is_active: true,
      bmr_kcal: bmr.kcal,
      tdee_kcal: tdee,
      activity: activity.level,
      energy_target_kcal: energy.targetKcal,
      energy_floor_kcal: energy.floorKcal,
      protein_g: macros.proteinG,
      fat_g: macros.fatG,
      carb_g: macros.carbG,
      fibre_g: macros.fibreG,
      water_ml: waterTargetMl(body),
      step_target: steps.target,
      training_days: a.trainingDays ?? 2,
      sleep_target_hours: 7.5,
      binding_constraint: energy.bindingConstraint,
      rationale: {
        energy: energy.explanation,
        activityReasons: activity.reasons,
        steps: steps.explanation,
        bmrRange: [bmr.lowKcal, bmr.highKcal],
        bmrEquation: bmr.equation,
      },
    });
    if (planError) throw planError;
  } catch (error) {
    console.error('onboarding save failed', error);
    return {
      ok: false,
      error:
        "We could not save that right now. Your answers have not been lost — they are still on " +
        'this device, so you can try again in a moment.',
    };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}
