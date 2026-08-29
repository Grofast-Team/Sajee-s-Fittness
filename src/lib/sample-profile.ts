import { deriveActivityLevel, estimateBmr, estimateTdee } from './engines/energy';
import { computeEnergyTarget, computeMacros, waterTargetMl } from './engines/targets';
import { initialStepGoal } from './engines/steps';
import { analyseTrend } from './engines/trend';
import { screen, restrictionsFrom } from './engines/safety';
import type { BodyInput, WeighIn } from './engines/types';

/**
 * A worked sample profile, used when Supabase is not yet configured.
 *
 * This exists so the app can be run and reviewed immediately. Every number
 * below is produced by the real engines from the real inputs - nothing is
 * hardcoded - so what you see is genuinely what this person would be shown.
 *
 * It is labelled as sample data everywhere it appears. That labelling is not
 * optional: a demo that is indistinguishable from real data is a lie.
 *
 * The persona is the one from the product brief: budget-conscious, South
 * Indian food, desk job, no gym, beginner.
 */

export const SAMPLE_BODY: BodyInput = {
  weightKg: 82.4,
  heightCm: 172,
  ageYears: 31,
  sex: 'male',
};

export const SAMPLE_CONTEXT = {
  displayName: 'Arun',
  goalWeightKg: 72,
  budgetPerDay: '₹150',
  diet: 'Non-vegetarian, eats eggs and dairy',
  cuisines: ['South Indian'],
  dislikes: ['oats'],
  favourites: ['dosa', 'curd rice'],
  allergies: [] as string[],
  equipment: 'No gym; nothing at home yet',
  cookMinutesWeekday: 20,
  workPattern: 'desk' as const,
  sittingHours: 9,
  baselineSteps: 3400,
  trainingDaysPerWeek: 0,
  sleepHours: 6.2,
  wakeTime: '07:00',
  sleepTime: '00:15',
};

/** Twenty-eight days of weigh-ins with realistic noise, so the trend engine has
 *  something honest to chew on rather than a clean straight line. */
export const SAMPLE_WEIGH_INS: WeighIn[] = (() => {
  const noise = [
    0.0, 0.35, -0.2, 0.5, -0.35, 0.15, 0.6, -0.1, 0.25, -0.45, 0.3, 0.05, -0.3, 0.4,
    0.1, -0.25, 0.55, -0.15, 0.2, 0.45, -0.4, 0.0, 0.3, -0.2, 0.35, -0.5, 0.15, 0.25,
  ];
  const start = Date.UTC(2026, 6, 2);
  return noise.map((n, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    // ~0.45 kg/week underlying loss, buried in day-to-day water noise.
    weightKg: Math.round((84.2 - i * 0.064 + n) * 10) / 10,
  }));
})();

/** What was actually eaten so far "today" in the sample. */
export const SAMPLE_TODAY_LOG = [
  { meal: 'Breakfast', description: '2 idli + sambar + 1 boiled egg', kcal: 336, proteinG: 17.1, basis: 'kitchen_scale' as const, confidence: 'high' as const },
  { meal: 'Mid-morning', description: 'Filter coffee', kcal: 105, proteinG: 2.4, basis: 'household_measure' as const, confidence: 'medium' as const },
  { meal: 'Lunch', description: 'Rice, dal, mixed veg sabzi, curd', kcal: 612, proteinG: 21.8, basis: 'kitchen_scale' as const, confidence: 'high' as const },
];

/** Run the sample inputs through the real engines. */
export function buildSamplePlan() {
  const flags = screen({
    ...SAMPLE_BODY,
    requestedTargetWeightKg: SAMPLE_CONTEXT.goalWeightKg,
    requestedWeeks: 20,
  });
  const restrictions = [...restrictionsFrom(flags)];

  const activity = deriveActivityLevel({
    workPattern: SAMPLE_CONTEXT.workPattern,
    sittingHours: SAMPLE_CONTEXT.sittingHours,
    baselineSteps: SAMPLE_CONTEXT.baselineSteps,
    trainingDaysPerWeek: SAMPLE_CONTEXT.trainingDaysPerWeek,
  });

  const bmr = estimateBmr(SAMPLE_BODY);
  const tdee = estimateTdee(bmr.kcal, activity.level);
  const energy = computeEnergyTarget(SAMPLE_BODY, bmr.kcal, tdee, 'steady', { restrictions });
  const macros = computeMacros(SAMPLE_BODY, energy.targetKcal, {
    goalWeightKg: SAMPLE_CONTEXT.goalWeightKg,
  });
  const steps = initialStepGoal({ baselineSteps: SAMPLE_CONTEXT.baselineSteps, restrictions });
  const water = waterTargetMl(SAMPLE_BODY);
  const trend = analyseTrend(SAMPLE_WEIGH_INS);

  return { flags, restrictions, activity, bmr, tdee, energy, macros, steps, water, trend };
}
