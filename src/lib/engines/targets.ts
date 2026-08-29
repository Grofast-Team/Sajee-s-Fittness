import type {
  BindingConstraint,
  BodyInput,
  EnergyTarget,
  MacroTargets,
  Pace,
  Sex,
} from './types';

/**
 * Energy and macronutrient targets.
 *
 * The safety floors in this module are the product's hard limits. They are
 * enforced here, in one place, rather than trusted to prompt wording - a
 * language model can be talked out of a guideline, but it cannot talk its way
 * past `Math.max`.
 */

/** Deficit as a share of maintenance. A percentage, not a fixed number: a
 *  500 kcal deficit is trivial at 3,200 kcal maintenance and dangerous at
 *  1,500. */
export const PACE_DEFICIT_PCT: Record<Pace, number> = {
  gentle: 0.10,
  steady: 0.18,
  firm: 0.25,
};

/** Absolute intake floors below which we will not plan without professional
 *  supervision. */
export const ABSOLUTE_FLOOR_KCAL: Record<'male' | 'female' | 'other', number> = {
  male: 1500,
  female: 1200,
  other: 1350,
};

export const MAX_DEFICIT_PCT = 0.25;
/** Fraction of bodyweight per week. Beyond this, lean-mass loss climbs sharply. */
export const MAX_WEEKLY_LOSS_FRACTION = 0.01;
/** kcal per kg of body-mass change. A modelling constant, not a law of physics. */
export const KCAL_PER_KG = 7700;

function floorForSex(sex: Sex): number {
  if (sex === 'male') return ABSOLUTE_FLOOR_KCAL.male;
  if (sex === 'female') return ABSOLUTE_FLOOR_KCAL.female;
  return ABSOLUTE_FLOOR_KCAL.other;
}

export interface TargetOptions {
  /** Capabilities withheld by an active safety flag, e.g. `aggressive_deficit`. */
  restrictions?: string[];
}

/**
 * Compute the daily energy target, applying every safety floor and reporting
 * which one bound the result.
 *
 * The order matters: we start from the requested pace and then raise the number
 * until it satisfies all constraints. The last constraint to raise it is the
 * one the user is told about, because that is the one actually limiting them.
 */
export function computeEnergyTarget(
  body: BodyInput,
  bmrKcal: number,
  tdeeKcal: number,
  pace: Pace,
  options: TargetOptions = {},
): EnergyTarget {
  const restrictions = new Set(options.restrictions ?? []);

  // A safety flag downgrades an aggressive request rather than refusing outright.
  let effectivePace = pace;
  let flagged = false;
  if (restrictions.has('aggressive_deficit') && pace !== 'gentle') {
    effectivePace = 'gentle';
    flagged = true;
  }

  const requestedPct = Math.min(PACE_DEFICIT_PCT[effectivePace], MAX_DEFICIT_PCT);
  let target = tdeeKcal * (1 - requestedPct);
  let binding: BindingConstraint = flagged ? 'safety_flag' : 'requested_pace';

  // Floor 1: never plan a sustained intake below resting expenditure.
  if (target < bmrKcal) {
    target = bmrKcal;
    binding = 'bmr_floor';
  }

  // Floor 2: absolute minimum intake.
  const absoluteFloor = floorForSex(body.sex);
  if (target < absoluteFloor) {
    target = absoluteFloor;
    binding = 'absolute_energy_floor';
  }

  // Floor 3: cap the rate of loss.
  const maxWeeklyLossKg = body.weightKg * MAX_WEEKLY_LOSS_FRACTION;
  const maxDailyDeficit = (maxWeeklyLossKg * KCAL_PER_KG) / 7;
  if (tdeeKcal - target > maxDailyDeficit) {
    target = tdeeKcal - maxDailyDeficit;
    binding = 'max_weekly_loss';
  }

  // A target above maintenance is not a fat-loss plan; clamp it.
  if (target > tdeeKcal) {
    target = tdeeKcal;
    binding = 'none';
  }

  const targetKcal = Math.round(target / 10) * 10;
  const deficitKcal = Math.max(0, tdeeKcal - targetKcal);
  const deficitPct = tdeeKcal > 0 ? deficitKcal / tdeeKcal : 0;
  const projectedWeeklyLossKg = (deficitKcal * 7) / KCAL_PER_KG;

  return {
    targetKcal,
    floorKcal: Math.max(absoluteFloor, Math.round(bmrKcal)),
    maintenanceKcal: tdeeKcal,
    deficitKcal,
    deficitPct,
    projectedWeeklyLossKg,
    bindingConstraint: binding,
    explanation: explainTarget(binding, targetKcal, tdeeKcal, deficitPct, projectedWeeklyLossKg),
  };
}

function explainTarget(
  binding: BindingConstraint,
  target: number,
  maintenance: number,
  deficitPct: number,
  weeklyLoss: number,
): string {
  const pct = Math.round(deficitPct * 100);
  const loss = weeklyLoss.toFixed(2);
  const base =
    `We estimate you burn about ${maintenance.toLocaleString()} kcal on a typical day. ` +
    `Your starting target is ${target.toLocaleString()} kcal, which is about ${pct}% below that ` +
    `and works out to roughly ${loss} kg a week if the estimate is close.`;

  switch (binding) {
    case 'bmr_floor':
      return `${base} We stopped there because going lower would put you under the energy your body uses at complete rest, which is not something we will plan for.`;
    case 'absolute_energy_floor':
      return `${base} We stopped there because it is our minimum daily intake. Eating less than this reliably is hard to do without losing nutrition quality, and it needs professional supervision.`;
    case 'max_weekly_loss':
      return `${base} We capped the rate at about 1% of your bodyweight per week. Faster than that costs more muscle and is harder to sustain.`;
    case 'max_deficit_pct':
      return `${base} We capped the size of the gap at 25% of what you burn.`;
    case 'safety_flag':
      return `${base} We used a gentler pace than you asked for because of something you told us during setup. You can see the reason on your safety notes.`;
    case 'none':
      return `${base} This is a maintenance-level intake rather than a deficit.`;
    default:
      return `${base} This matches the pace you chose.`;
  }
}

export interface MacroOptions {
  /**
   * g/kg of reference weight. Default 1.6.
   *
   * The evidence range for a deficit is roughly 1.6-2.2 g/kg, and we sit at the
   * bottom of it on purpose. The upper end is for lifters chasing the last few
   * percent of lean-mass retention; for a beginner on a tight food budget, a
   * 148 g target instead of a 132 g one is not better science, it is just a
   * target they cannot afford to hit. An adherable plan beats an optimal one.
   */
  proteinPerKg?: number;
  /** Share of energy from fat. Default 0.25. */
  fatPct?: number;
  goalWeightKg?: number;
}

/**
 * Protein is dosed against a *reference* weight, not scale weight.
 *
 * At a BMI above 30, dosing protein to actual bodyweight overshoots badly - it
 * would put a 130 kg person on 234 g/day, which is neither necessary nor
 * affordable. Using goal weight (or a BMI-27 equivalent) keeps the number both
 * evidence-aligned and practical.
 */
export function referenceWeightKg(body: BodyInput, goalWeightKg?: number): number {
  const heightM = body.heightCm / 100;
  const bmi = body.weightKg / (heightM * heightM);
  if (bmi <= 30) return body.weightKg;
  const bmi27Equivalent = 27 * heightM * heightM;
  return Math.max(goalWeightKg ?? bmi27Equivalent, bmi27Equivalent);
}

export function computeMacros(
  body: BodyInput,
  targetKcal: number,
  options: MacroOptions = {},
): MacroTargets {
  const refWeight = referenceWeightKg(body, options.goalWeightKg);
  const proteinPerKg = options.proteinPerKg ?? 1.6;

  // Protein: high enough to protect lean mass and satiety, capped so it never
  // crowds out the rest of the diet.
  let proteinG = Math.round(refWeight * proteinPerKg);
  const proteinCapG = Math.floor((targetKcal * 0.4) / 4);
  proteinG = Math.min(proteinG, proteinCapG);

  // Fat: a floor for hormonal and fat-soluble vitamin adequacy.
  const fatFloorG = Math.round(refWeight * 0.6);
  const fatPct = options.fatPct ?? 0.25;
  let fatG = Math.max(Math.round((targetKcal * fatPct) / 9), fatFloorG);

  // Carbohydrate takes the remainder. Carbs are the flexible macro, and they
  // are what makes a plan culturally feasible - an Indian plan is rice- and
  // millet-shaped, and that is fine.
  let carbKcal = targetKcal - proteinG * 4 - fatG * 9;

  // If the floors collide at a low target, shave fat back towards its floor
  // before touching protein, and never let carbs go negative.
  if (carbKcal < 0) {
    const overshootG = Math.ceil(-carbKcal / 9);
    fatG = Math.max(fatFloorG, fatG - overshootG);
    carbKcal = targetKcal - proteinG * 4 - fatG * 9;
  }
  const carbG = Math.max(0, Math.round(carbKcal / 4));

  // Fibre on the standard adequacy basis, capped so we never ask for a jump
  // that causes real GI distress.
  const fibreG = Math.min(40, Math.round((targetKcal / 1000) * 14));

  return { proteinG, fatG, carbG, fibreG };
}

/** Personalised starting hydration target. Not a flat "8 glasses for everyone",
 *  and deliberately not pushed higher - more water is not better. */
export function waterTargetMl(body: BodyInput, activityMinutes = 0, hotClimate = false): number {
  const base = Math.round(body.weightKg * 33);
  const activityBonus = Math.round((activityMinutes / 30) * 350);
  const climateBonus = hotClimate ? 500 : 0;
  const total = base + activityBonus + climateBonus;
  return Math.min(4000, Math.max(1500, Math.round(total / 100) * 100));
}
