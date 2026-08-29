import type { BodyInput } from './types';

/**
 * Safety screening.
 *
 * This app gives general wellness, nutrition and activity guidance. It is not a
 * doctor and does not diagnose anything. What this module does is notice when
 * someone's answers suggest that generic weight-loss advice is a bad fit, and
 * then narrow what the rest of the app is willing to do.
 *
 * The output is deliberately a *restriction list*, not a refusal. Someone who
 * is pregnant still deserves a useful app; they just should not be handed a
 * calorie deficit.
 */

export type Severity = 'info' | 'caution' | 'restrict' | 'refer';

export interface SafetyFlag {
  code: string;
  severity: Severity;
  reason: string;
  guidance: string;
  /** Capability names the app must withhold while this flag is open. */
  restricts: string[];
}

/** Capabilities that a flag can withhold. */
export const CAPABILITIES = {
  DEFICIT: 'calorie_deficit',
  AGGRESSIVE: 'aggressive_deficit',
  FASTING: 'fasting_protocols',
  HIGH_INTENSITY: 'high_intensity_training',
  WEIGHT_GAMIFICATION: 'weight_gamification',
} as const;

export interface ScreeningInput extends BodyInput {
  pregnant?: boolean;
  breastfeeding?: boolean;
  eatingDisorderHistory?: boolean;
  /** Self-reported symptoms such as purging, bingeing, or severe restriction. */
  disorderedEatingSymptoms?: boolean;
  unexplainedWeightLoss?: boolean;
  diabetesOnMedication?: boolean;
  kidneyDisease?: boolean;
  liverDisease?: boolean;
  cardiovascularCondition?: boolean;
  recentSurgery?: boolean;
  severeMobilityLimits?: boolean;
  exerciseIntolerance?: boolean;
  weightAffectingMedication?: boolean;
  otherChronicCondition?: string;
  /** What the user asked for, so we can catch unrealistic requests. */
  requestedTargetWeightKg?: number;
  requestedWeeks?: number;
}

export function bmi(body: BodyInput): number {
  const m = body.heightCm / 100;
  return body.weightKg / (m * m);
}

const REFER_TO_CLINICIAN =
  'Please talk to a doctor or a registered dietitian before starting a weight-loss plan. ' +
  'We will keep the tracking and habit features available, but we will not set you a calorie deficit.';

/**
 * Screen a user's answers and return every flag that applies.
 *
 * Multiple flags stack: their restrictions are unioned by
 * `restrictionsFrom()`, so the most protective rule always wins.
 */
export function screen(input: ScreeningInput): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  const bodyMassIndex = bmi(input);

  if (input.pregnant) {
    flags.push({
      code: 'pregnancy',
      severity: 'refer',
      reason: 'You told us you are pregnant.',
      guidance:
        'Pregnancy is not a time for intentional weight loss. Your energy and nutrient needs are ' +
        'different, and they change through the pregnancy. Please work with your doctor or midwife. ' +
        'You are welcome to keep using the food, activity and habit tracking here.',
      restricts: [CAPABILITIES.DEFICIT, CAPABILITIES.AGGRESSIVE, CAPABILITIES.FASTING],
    });
  }

  if (input.breastfeeding) {
    flags.push({
      code: 'breastfeeding',
      severity: 'caution',
      reason: 'You told us you are breastfeeding.',
      guidance:
        'Breastfeeding raises your energy needs considerably, and a large deficit can affect milk ' +
        'supply. We will only plan a gentle pace, and we would suggest checking it with your doctor.',
      restricts: [CAPABILITIES.AGGRESSIVE, CAPABILITIES.FASTING],
    });
  }

  if (input.eatingDisorderHistory || input.disorderedEatingSymptoms) {
    flags.push({
      code: 'disordered_eating',
      severity: 'refer',
      reason: 'You mentioned a history of, or current difficulties with, disordered eating.',
      guidance:
        'Calorie targets, daily weighing and streaks can make things harder rather than easier. ' +
        'We will turn those off. Please consider speaking to a doctor or a therapist who works ' +
        'with eating disorders. We can still help with regular meals and gentle movement.',
      restricts: [
        CAPABILITIES.DEFICIT,
        CAPABILITIES.AGGRESSIVE,
        CAPABILITIES.FASTING,
        CAPABILITIES.WEIGHT_GAMIFICATION,
      ],
    });
  }

  if (bodyMassIndex < 18.5) {
    flags.push({
      code: 'underweight',
      severity: 'refer',
      reason: `Your height and weight put you at a BMI of about ${bodyMassIndex.toFixed(1)}, which is below the healthy range.`,
      guidance:
        'Losing more weight is unlikely to be the right goal here. Please check in with a doctor. ' +
        'If you want, we can help with building strength and eating more consistently instead.',
      restricts: [CAPABILITIES.DEFICIT, CAPABILITIES.AGGRESSIVE, CAPABILITIES.FASTING],
    });
  }

  if (input.unexplainedWeightLoss) {
    flags.push({
      code: 'unexplained_weight_loss',
      severity: 'refer',
      reason: 'You mentioned losing weight without trying to.',
      guidance:
        'Unintentional weight loss is worth having checked by a doctor before you start a plan ' +
        'that would make it faster.',
      restricts: [CAPABILITIES.DEFICIT, CAPABILITIES.AGGRESSIVE],
    });
  }

  if (input.diabetesOnMedication) {
    flags.push({
      code: 'diabetes_medicated',
      severity: 'caution',
      reason: 'You take medication for diabetes.',
      guidance:
        'Changing how much you eat can change how your medication affects your blood sugar, ' +
        'sometimes quickly. Please tell your doctor that you are starting this, so your doses ' +
        'can be reviewed. We will keep the pace gentle.',
      restricts: [CAPABILITIES.AGGRESSIVE, CAPABILITIES.FASTING],
    });
  }

  if (input.kidneyDisease) {
    flags.push({
      code: 'kidney_disease',
      severity: 'refer',
      reason: 'You mentioned a kidney condition.',
      guidance:
        'Protein and fluid targets often need to be set by a clinician in kidney disease, and our ' +
        'general targets may not suit you. Please get your plan reviewed before following it.',
      restricts: [CAPABILITIES.AGGRESSIVE, CAPABILITIES.FASTING],
    });
  }

  if (input.liverDisease) {
    flags.push({
      code: 'liver_disease',
      severity: 'caution',
      reason: 'You mentioned a liver condition.',
      guidance: 'Please have your nutrition plan reviewed by your doctor or dietitian.',
      restricts: [CAPABILITIES.AGGRESSIVE, CAPABILITIES.FASTING],
    });
  }

  if (input.cardiovascularCondition || input.exerciseIntolerance) {
    flags.push({
      code: 'cardiovascular',
      severity: 'caution',
      reason: 'You mentioned a heart condition or difficulty tolerating exercise.',
      guidance:
        'We will start with gentle walking rather than anything intense, and we will build up ' +
        'slowly. Please get clearance from your doctor for harder exercise. Stop and seek help ' +
        'if you get chest pain, unusual breathlessness or dizziness.',
      restricts: [CAPABILITIES.HIGH_INTENSITY],
    });
  }

  if (input.recentSurgery) {
    flags.push({
      code: 'recent_surgery',
      severity: 'caution',
      reason: 'You mentioned recent surgery.',
      guidance:
        'Healing needs energy and protein, so a deficit now can slow recovery. Follow your ' +
        'surgical team on when to return to exercise.',
      restricts: [CAPABILITIES.AGGRESSIVE, CAPABILITIES.HIGH_INTENSITY, CAPABILITIES.FASTING],
    });
  }

  if (input.severeMobilityLimits) {
    flags.push({
      code: 'mobility',
      severity: 'info',
      reason: 'You told us about significant mobility limits.',
      guidance:
        'We will build the plan around movement you can actually do, including seated options, ' +
        'and we will not set step goals that assume walking is easy for you.',
      restricts: [CAPABILITIES.HIGH_INTENSITY],
    });
  }

  if (input.weightAffectingMedication) {
    flags.push({
      code: 'medication_weight_effects',
      severity: 'info',
      reason: 'You mentioned medication that can affect weight or appetite.',
      guidance:
        'This can change how quickly your weight moves, in either direction. It does not mean the ' +
        'plan is failing. Worth mentioning to your prescriber if progress looks unusual.',
      restricts: [],
    });
  }

  if (input.otherChronicCondition && input.otherChronicCondition.trim().length > 0) {
    flags.push({
      code: 'other_condition',
      severity: 'info',
      reason: `You told us about: ${input.otherChronicCondition.trim()}.`,
      guidance:
        'We cannot assess this ourselves. If it affects what you eat or how you move, please have ' +
        'your plan looked over by a professional who knows your history.',
      restricts: [],
    });
  }

  const unrealistic = checkRequestedPace(input);
  if (unrealistic) flags.push(unrealistic);

  return flags;
}

/**
 * Catch goals that are arithmetically impossible to reach safely.
 *
 * We do not simply refuse. We say what the timeline would require, why that is
 * not something we will plan, and what date is achievable instead.
 */
function checkRequestedPace(input: ScreeningInput): SafetyFlag | null {
  const { requestedTargetWeightKg, requestedWeeks, weightKg } = input;
  if (!requestedTargetWeightKg || !requestedWeeks || requestedWeeks <= 0) return null;

  const toLose = weightKg - requestedTargetWeightKg;
  if (toLose <= 0) return null;

  const requiredWeekly = toLose / requestedWeeks;
  const safeWeekly = weightKg * 0.01;
  if (requiredWeekly <= safeWeekly) return null;

  const achievableWeeks = Math.ceil(toLose / safeWeekly);
  return {
    code: 'unrealistic_timeline',
    severity: 'info',
    reason:
      `Losing ${toLose.toFixed(1)} kg in ${requestedWeeks} weeks would mean about ` +
      `${requiredWeekly.toFixed(2)} kg a week, which is faster than we will plan for.`,
    guidance:
      `At a sustainable pace, that is closer to ${achievableWeeks} weeks. We have set your plan to ` +
      `the safer pace and kept your goal weight the same. The date moved; the destination did not.`,
    restricts: [],
  };
}

/** Union of every restriction across the open flags. */
export function restrictionsFrom(flags: SafetyFlag[]): Set<string> {
  const set = new Set<string>();
  for (const flag of flags) for (const r of flag.restricts) set.add(r);
  return set;
}

export function requiresReferral(flags: SafetyFlag[]): boolean {
  return flags.some((f) => f.severity === 'refer');
}

/** True when the app should not set a deficit at all. */
export function deficitBlocked(flags: SafetyFlag[]): boolean {
  return restrictionsFrom(flags).has(CAPABILITIES.DEFICIT);
}

export { REFER_TO_CLINICIAN };
