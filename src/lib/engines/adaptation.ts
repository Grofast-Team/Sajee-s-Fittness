import type { TrendResult } from './types';

/**
 * Adaptive plan adjustment.
 *
 * The default behaviour of this engine is to do nothing, and that is
 * deliberate. Most apps that adjust targets do it too fast, on too little
 * evidence, and end up chasing noise downwards until the user is on 1,100 kcal
 * wondering why they feel terrible.
 *
 * Every change here has to pass a set of gates first, changes only one lever at
 * a time, and is hard-capped in size.
 */

export const MIN_DAYS_BETWEEN_CHANGES = 14;
export const MIN_WEIGH_INS = 10;
export const MIN_LOGGING_COMPLETENESS = 0.7;
/** No single adjustment may move the target by more than this fraction. */
export const MAX_ADJUSTMENT_FRACTION = 0.08;

export type AdaptationDecision =
  | 'hold'
  | 'increase_intake'
  | 'reduce_intake'
  | 'increase_steps'
  | 'reduce_activity'
  | 'fix_logging'
  | 'investigate_adherence'
  | 'refer_professional'
  | 'insufficient_data';

export interface AdaptationInput {
  trend: TrendResult;
  currentTargetKcal: number;
  currentStepTarget: number;
  /** Target rate as a fraction of bodyweight per week, e.g. 0.006 for 0.6%. */
  targetWeeklyLossFraction: number;
  weightKg: number;
  daysSinceLastChange: number;
  /** Share of days in the window the user marked as fully logged, 0-1. */
  loggingCompleteness: number;
  /** Share of planned workouts completed, 0-1. */
  workoutAdherence: number;
  stepAdherence: number;
  /** Subjective 1-5 readings; 5 is worst for hunger, best for energy. */
  hunger?: number;
  energy?: number;
  hasReferralFlag?: boolean;
}

export interface AdaptationResult {
  decision: AdaptationDecision;
  lever: 'energy' | 'steps' | 'behaviour' | null;
  newTargetKcal: number;
  newStepTarget: number;
  deltaKcal: number;
  deltaSteps: number;
  /** Shown to the user verbatim. Explains the decision, including "no change". */
  message: string;
  evidence: Record<string, unknown>;
}

function noChange(
  input: AdaptationInput,
  decision: AdaptationDecision,
  message: string,
  evidence: Record<string, unknown> = {},
): AdaptationResult {
  return {
    decision,
    lever: null,
    newTargetKcal: input.currentTargetKcal,
    newStepTarget: input.currentStepTarget,
    deltaKcal: 0,
    deltaSteps: 0,
    message,
    evidence,
  };
}

export function adapt(input: AdaptationInput): AdaptationResult {
  const { trend } = input;

  // ---- Gates. Each of these is a reason not to touch anything. -------------

  if (input.hasReferralFlag) {
    return noChange(
      input,
      'refer_professional',
      'We are not adjusting your targets automatically while there is an open safety note on your ' +
        'account. This is the point where a professional who knows your history should be involved.',
    );
  }

  if (input.daysSinceLastChange < MIN_DAYS_BETWEEN_CHANGES) {
    return noChange(
      input,
      'hold',
      `We last changed your plan ${input.daysSinceLastChange} days ago. Bodyweight needs about two ` +
        `weeks to show whether a change actually did anything, so we are leaving it alone until then.`,
      { daysSinceLastChange: input.daysSinceLastChange },
    );
  }

  if (trend.readingCount < MIN_WEIGH_INS || trend.kgPerWeek === null) {
    return noChange(
      input,
      'insufficient_data',
      `We have ${trend.readingCount} weigh-ins to work from. Below about ${MIN_WEIGH_INS} the noise ` +
        `is bigger than the signal, and changing your calories off that would be guesswork.`,
      { readingCount: trend.readingCount },
    );
  }

  // Incomplete logging is a measurement problem, and cutting calories in
  // response to a measurement problem is how people end up under-eating.
  if (input.loggingCompleteness < MIN_LOGGING_COMPLETENESS) {
    return {
      ...noChange(input, 'fix_logging', ''),
      lever: 'behaviour',
      message:
        `You logged fully on about ${Math.round(input.loggingCompleteness * 100)}% of days. Before we ` +
        `change any numbers, we need a clearer picture of what you are actually eating - otherwise we ` +
        `would be adjusting your target to fix a gap in the record. Nothing to feel bad about; it is ` +
        `just the wrong lever.`,
      evidence: { loggingCompleteness: input.loggingCompleteness },
    };
  }

  // ---- Decision --------------------------------------------------------------

  const actualWeeklyLossKg = -trend.kgPerWeek; // positive when losing
  const targetWeeklyLossKg = input.weightKg * input.targetWeeklyLossFraction;
  const maxSafeWeeklyLossKg = input.weightKg * 0.01;

  const evidence = {
    kgPerWeek: trend.kgPerWeek,
    margin: trend.kgPerWeekMargin,
    actualWeeklyLossKg: Math.round(actualWeeklyLossKg * 1000) / 1000,
    targetWeeklyLossKg: Math.round(targetWeeklyLossKg * 1000) / 1000,
    loggingCompleteness: input.loggingCompleteness,
    stepAdherence: input.stepAdherence,
    workoutAdherence: input.workoutAdherence,
  };

  // Losing too fast is a problem, not a win. Muscle loss and rebound both climb
  // sharply past ~1% of bodyweight per week.
  if (actualWeeklyLossKg > maxSafeWeeklyLossKg) {
    const bump = clampAdjustment(input.currentTargetKcal, 0.06);
    return {
      decision: 'increase_intake',
      lever: 'energy',
      newTargetKcal: input.currentTargetKcal + bump,
      newStepTarget: input.currentStepTarget,
      deltaKcal: bump,
      deltaSteps: 0,
      message:
        `You are losing about ${actualWeeklyLossKg.toFixed(2)} kg a week, which is faster than we want. ` +
        `That sounds like good news and mostly is not - at this rate you lose more muscle and it gets ` +
        `much harder to keep off. We are putting your target up by ${bump} kcal.`,
      evidence,
    };
  }

  // Within band: say so explicitly. "No change" is a real, useful answer.
  const withinBand =
    actualWeeklyLossKg >= targetWeeklyLossKg * 0.6 && actualWeeklyLossKg <= maxSafeWeeklyLossKg;
  if (withinBand) {
    return noChange(
      input,
      'hold',
      `Losing about ${actualWeeklyLossKg.toFixed(2)} kg a week, which is right where we want it. ` +
        `Nothing to change. Keep doing exactly what you are doing.`,
      evidence,
    );
  }

  // Below target, or gaining.
  const behaviourWeak = input.stepAdherence < 0.6 || input.workoutAdherence < 0.6;
  if (behaviourWeak) {
    return {
      ...noChange(input, 'investigate_adherence', ''),
      lever: 'behaviour',
      message:
        `Progress has slowed, but the plan has not been running as written - steps were met about ` +
        `${Math.round(input.stepAdherence * 100)}% of the time and workouts about ` +
        `${Math.round(input.workoutAdherence * 100)}%. Cutting your food now would be treating the ` +
        `wrong problem. What got in the way?`,
      evidence,
    };
  }

  // Adherence is good and progress has stalled. One lever only. We prefer
  // adding movement to removing food, because the floor on food is real and
  // hunger is the main reason plans get abandoned.
  const hungry = (input.hunger ?? 3) >= 4;
  const lowEnergy = (input.energy ?? 3) <= 2;

  if (hungry || lowEnergy) {
    const stepBump = 750;
    return {
      decision: 'increase_steps',
      lever: 'steps',
      newTargetKcal: input.currentTargetKcal,
      newStepTarget: input.currentStepTarget + stepBump,
      deltaKcal: 0,
      deltaSteps: stepBump,
      message:
        `Progress has slowed and you have been following the plan. You have also told us you are ` +
        `${hungry ? 'hungry' : 'low on energy'}, so cutting food further is the wrong move. We are ` +
        `adding ${stepBump} steps a day instead - roughly a ten-minute walk.`,
      evidence,
    };
  }

  const cut = clampAdjustment(input.currentTargetKcal, 0.05);
  return {
    decision: 'reduce_intake',
    lever: 'energy',
    newTargetKcal: input.currentTargetKcal - cut,
    newStepTarget: input.currentStepTarget,
    deltaKcal: -cut,
    deltaSteps: 0,
    message:
      `Your weight has been flat for a while and you have been following the plan closely, so this ` +
      `looks like a genuine slowdown rather than a logging gap. We are lowering your target by ` +
      `${cut} kcal - a small change on purpose. We will look again in two weeks.`,
    evidence,
  };
}

/** Round an adjustment to the nearest 10 kcal and cap it. */
function clampAdjustment(currentKcal: number, fraction: number): number {
  const capped = Math.min(fraction, MAX_ADJUSTMENT_FRACTION);
  return Math.round((currentKcal * capped) / 10) * 10;
}

// ---------------------------------------------------------------------------
// Plateau detection
// ---------------------------------------------------------------------------

export const MIN_PLATEAU_DAYS = 21;

export interface PlateauInput {
  trend: TrendResult;
  loggingCompleteness: number;
  stepTrendDown: boolean;
  sleepBelowTarget: boolean;
  cycleTracked: boolean;
  inLutealPhase: boolean;
  recentDietChange: boolean;
  waistChangedCm: number | null;
}

export interface PlateauResult {
  isPlateau: boolean;
  verdict: string;
  /** Candidate explanations, most likely first. */
  checks: { label: string; finding: string; likelihood: 'high' | 'medium' | 'low' }[];
}

/**
 * A plateau is not three flat days.
 *
 * Requires three weeks of data whose rate-of-change interval includes zero.
 * Then, before recommending any change, it ranks likely explanations roughly by
 * real-world frequency - logging drift is far more common than metabolic
 * adaptation, though users almost always suspect the latter first.
 */
export function detectPlateau(input: PlateauInput): PlateauResult {
  const { trend } = input;
  const checks: PlateauResult['checks'] = [];

  if (trend.daysOfData < MIN_PLATEAU_DAYS) {
    return {
      isPlateau: false,
      verdict:
        `It has been ${trend.daysOfData} days. A plateau means at least three weeks of no movement - ` +
        `anything shorter is just normal variation, and treating it as a plateau leads to changing ` +
        `things that were working.`,
      checks,
    };
  }

  const flat = trend.direction === 'holding' || trend.direction === 'unclear';
  if (!flat) {
    return {
      isPlateau: false,
      verdict: `Your weight is still moving (${trend.message.toLowerCase()}), so this is not a plateau.`,
      checks,
    };
  }

  if (input.waistChangedCm !== null && input.waistChangedCm <= -1) {
    checks.push({
      label: 'Waist is still going down',
      finding:
        `Your waist is down ${Math.abs(input.waistChangedCm).toFixed(1)} cm while the scale has not ` +
        `moved. That pattern usually means your body composition is changing even though weight is ` +
        `not. This is the single best reason not to cut anything yet.`,
      likelihood: 'high',
    });
  }

  if (input.loggingCompleteness < 0.85) {
    checks.push({
      label: 'Logging gaps',
      finding:
        `You fully logged about ${Math.round(input.loggingCompleteness * 100)}% of days. Unlogged ` +
        `food is the most common cause of a stall, by a wide margin, and it is rarely deliberate - ` +
        `it is the oil, the tastes while cooking, the second helping.`,
      likelihood: 'high',
    });
  }

  checks.push({
    label: 'Portion drift',
    finding:
      'Portions tend to grow slowly over weeks without anyone noticing. Weighing your usual foods ' +
      'for a few days is the fastest way to check this, and it is often the whole answer.',
    likelihood: input.loggingCompleteness >= 0.85 ? 'high' : 'medium',
  });

  if (input.stepTrendDown) {
    checks.push({
      label: 'Daily movement has dropped',
      finding:
        'Your step count has drifted down. Non-exercise movement falls quietly during a deficit, ' +
        'and it can cancel out a large part of it.',
      likelihood: 'high',
    });
  }

  if (input.sleepBelowTarget) {
    checks.push({
      label: 'Short sleep',
      finding:
        'You have been sleeping less than your target. Short sleep raises appetite and lowers ' +
        'spontaneous movement, so it works against you twice.',
      likelihood: 'medium',
    });
  }

  if (input.cycleTracked && input.inLutealPhase) {
    checks.push({
      label: 'Cycle phase',
      finding:
        'You are in the part of your cycle where water retention commonly masks fat loss on the ' +
        'scale. This often resolves on its own within a week.',
      likelihood: 'medium',
    });
  }

  checks.push({
    label: 'Metabolic adaptation',
    finding:
      'Energy expenditure does fall somewhat as you lose weight. It is real, but it is smaller than ' +
      'people expect and it is the last thing to check, not the first.',
    likelihood: 'low',
  });

  return {
    isPlateau: true,
    verdict:
      `Your weight has genuinely been flat for ${trend.daysOfData} days, so this counts as a plateau. ` +
      `Before changing your calories, let us work through what is most likely causing it.`,
    checks,
  };
}
