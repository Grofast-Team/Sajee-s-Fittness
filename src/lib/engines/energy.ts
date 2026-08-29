import type { ActivityLevel, BodyInput, EnergyEstimate } from './types';

/**
 * Resting and total energy expenditure.
 *
 * Every value here is a population regression with roughly +/-10% individual
 * error. That band is returned alongside the point estimate and surfaced in the
 * UI, because a user who believes "my BMR is exactly 1,612" will draw wrong
 * conclusions when the scale disagrees with the arithmetic.
 */

/** Body-fat methods accurate enough to justify switching equations. A user
 *  guessing "I'm about 25%" is not one of them. */
const RELIABLE_BF_METHODS = new Set(['dexa', 'bodpod', 'bia_clinical']);

export function hasReliableBodyFat(body: BodyInput): boolean {
  return (
    typeof body.bodyFatPct === 'number' &&
    body.bodyFatPct > 3 &&
    body.bodyFatPct < 70 &&
    !!body.bodyFatMethod &&
    RELIABLE_BF_METHODS.has(body.bodyFatMethod)
  );
}

/**
 * Mifflin-St Jeor, the best-validated predictive equation for the general
 * population.
 *
 * The equation only has male and female forms. For intersex users and those who
 * prefer not to say, we average the two rather than silently assuming one -
 * and the UI says that is what we did.
 */
function mifflinStJeor(body: BodyInput): number {
  const base = 10 * body.weightKg + 6.25 * body.heightCm - 5 * body.ageYears;
  switch (body.sex) {
    case 'male':
      return base + 5;
    case 'female':
      return base - 161;
    default:
      return base + (5 + -161) / 2;
  }
}

/** Katch-McArdle: more accurate at body-composition extremes, but only usable
 *  when fat-free mass is actually known. */
function katchMcArdle(weightKg: number, bodyFatPct: number): number {
  const fatFreeMass = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * fatFreeMass;
}

export function estimateBmr(body: BodyInput): EnergyEstimate {
  const useKatch = hasReliableBodyFat(body);
  const kcal = useKatch
    ? katchMcArdle(body.weightKg, body.bodyFatPct as number)
    : mifflinStJeor(body);

  const rounded = Math.round(kcal);
  const margin = Math.round(rounded * 0.1);

  return {
    kcal: rounded,
    lowKcal: rounded - margin,
    highKcal: rounded + margin,
    equation: useKatch ? 'katch_mcardle' : 'mifflin_st_jeor',
    note: useKatch
      ? 'Estimated from your fat-free mass, using a measured body-fat percentage.'
      : 'Estimated from your height, weight, age and sex. Individual results vary by about 10%.',
  };
}

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export interface ActivitySignals {
  workPattern?: 'desk' | 'mixed' | 'standing' | 'physical' | 'shift' | 'unemployed' | 'student' | 'home';
  sittingHours?: number;
  baselineSteps?: number;
  trainingDaysPerWeek?: number;
  commuteMinutes?: number;
  commuteMode?: string;
}

/**
 * Derive the activity multiplier from lifestyle answers rather than asking
 * "how active are you?" directly.
 *
 * People systematically overestimate their own activity when asked to
 * self-classify, and an inflated multiplier produces an inflated maintenance
 * estimate, which produces a deficit that isn't one, which produces a user who
 * concludes the app doesn't work. Deriving it from concrete behaviours - steps,
 * job type, training frequency - is meaningfully more honest.
 */
export function deriveActivityLevel(signals: ActivitySignals): {
  level: ActivityLevel;
  factor: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  const steps = signals.baselineSteps;
  if (typeof steps === 'number') {
    if (steps < 4000) {
      score += 0;
      reasons.push(`About ${steps.toLocaleString()} steps a day is a low daily movement baseline.`);
    } else if (steps < 7000) {
      score += 1;
      reasons.push(`About ${steps.toLocaleString()} steps a day is a light movement baseline.`);
    } else if (steps < 10000) {
      score += 2;
      reasons.push(`About ${steps.toLocaleString()} steps a day is a moderate movement baseline.`);
    } else {
      score += 3;
      reasons.push(`About ${steps.toLocaleString()} steps a day is an active movement baseline.`);
    }
  }

  switch (signals.workPattern) {
    case 'physical':
      score += 3;
      reasons.push('Physically demanding work adds a large amount of daily energy use.');
      break;
    case 'standing':
      score += 2;
      reasons.push('Work spent mostly on your feet adds meaningful daily energy use.');
      break;
    case 'mixed':
      score += 1;
      reasons.push('Work that mixes sitting and moving adds some daily energy use.');
      break;
    case 'desk':
      reasons.push('Desk-based work contributes little daily energy use on its own.');
      break;
    default:
      break;
  }

  if (typeof signals.sittingHours === 'number' && signals.sittingHours >= 10) {
    score -= 1;
    reasons.push(`Around ${signals.sittingHours} hours of sitting a day pulls the estimate down.`);
  }

  const trainingDays = signals.trainingDaysPerWeek ?? 0;
  if (trainingDays >= 5) {
    score += 2;
    reasons.push(`Training ${trainingDays} days a week adds a substantial amount.`);
  } else if (trainingDays >= 3) {
    score += 1;
    reasons.push(`Training ${trainingDays} days a week adds a moderate amount.`);
  } else if (trainingDays > 0) {
    reasons.push(`Training ${trainingDays} day(s) a week adds a small amount.`);
  }

  if (
    typeof signals.commuteMinutes === 'number' &&
    signals.commuteMinutes >= 30 &&
    (signals.commuteMode === 'walk' || signals.commuteMode === 'cycle')
  ) {
    score += 1;
    reasons.push('An active commute counts towards your daily total.');
  }

  const level: ActivityLevel =
    score <= 0 ? 'sedentary'
    : score <= 2 ? 'light'
    : score <= 4 ? 'moderate'
    : score <= 6 ? 'active'
    : 'very_active';

  return { level, factor: ACTIVITY_FACTORS[level], reasons };
}

export function estimateTdee(bmrKcal: number, level: ActivityLevel): number {
  return Math.round(bmrKcal * ACTIVITY_FACTORS[level]);
}

/**
 * Net energy cost of an activity, in kcal.
 *
 * The `MET - 1` term removes the resting energy the user would have burned
 * anyway during that time. Most apps skip this and consequently overstate
 * exercise burn by 15-25%, which matters a lot when someone is "eating back"
 * what they think they earned.
 */
export function activityKcal(metValue: number, weightKg: number, minutes: number): number {
  if (metValue <= 1 || minutes <= 0 || weightKg <= 0) return 0;
  return Math.round((((metValue - 1) * 3.5 * weightKg) / 200) * minutes);
}
