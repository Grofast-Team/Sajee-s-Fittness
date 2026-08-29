/**
 * Step goals.
 *
 * Nobody gets 10,000 steps by default. That number came from a 1960s Japanese
 * pedometer marketing campaign, not from evidence, and handing it to someone
 * currently walking 2,800 steps sets them up to fail on day one.
 *
 * We start from their measured baseline and progress from there.
 */

export interface StepGoalInput {
  baselineSteps: number;
  /** Withheld capabilities, e.g. `high_intensity_training` for mobility limits. */
  restrictions?: string[];
}

export interface StepGoal {
  target: number;
  baseline: number;
  increase: number;
  explanation: string;
}

export const MAX_INITIAL_INCREASE = 2000;

export function initialStepGoal(input: StepGoalInput): StepGoal {
  const baseline = Math.max(0, Math.round(input.baselineSteps));
  const restricted = new Set(input.restrictions ?? []);

  // A gentler ramp when mobility is limited: 10% rather than 25%.
  const growth = restricted.has('high_intensity_training') ? 0.1 : 0.25;
  const rawIncrease = Math.min(baseline * growth, MAX_INITIAL_INCREASE);
  const target = Math.max(2000, Math.round((baseline + rawIncrease) / 500) * 500);
  const increase = target - baseline;

  return {
    target,
    baseline,
    increase,
    explanation:
      `You are currently averaging about ${baseline.toLocaleString()} steps a day. We set your first ` +
      `target at ${target.toLocaleString()} - roughly ${increase.toLocaleString()} more, which is ` +
      `about ${Math.max(1, Math.round(increase / 100))} minutes of extra walking. We did not give you ` +
      `10,000 because a target you miss every day stops being a target.`,
  };
}

export interface ProgressionInput {
  currentTarget: number;
  baseline: number;
  /** How many of the last seven days the target was met. */
  daysMetLastWeek: number;
  restrictions?: string[];
}

/**
 * Weekly progression.
 *
 * Targets step *down* after a bad week rather than accumulating an impossible
 * debt. A goal that only ever ratchets upwards becomes a monument to failure.
 */
export function progressStepGoal(input: ProgressionInput): StepGoal {
  const restricted = new Set(input.restrictions ?? []);
  const increment = restricted.has('high_intensity_training') ? 250 : 500;

  if (input.daysMetLastWeek >= 5) {
    const target = input.currentTarget + increment;
    return {
      target,
      baseline: input.baseline,
      increase: increment,
      explanation:
        `You hit your step goal on ${input.daysMetLastWeek} of 7 days, so we are nudging it up to ` +
        `${target.toLocaleString()}.`,
    };
  }

  if (input.daysMetLastWeek <= 2) {
    const target = Math.max(
      Math.max(2000, input.baseline),
      input.currentTarget - increment,
    );
    return {
      target,
      baseline: input.baseline,
      increase: target - input.currentTarget,
      explanation:
        `You hit the goal on ${input.daysMetLastWeek} of 7 days, so we have brought it down to ` +
        `${target.toLocaleString()}. A target you can actually hit is worth more than an ambitious ` +
        `one you cannot. We will build back up.`,
    };
  }

  return {
    target: input.currentTarget,
    baseline: input.baseline,
    increase: 0,
    explanation:
      `You hit the goal on ${input.daysMetLastWeek} of 7 days. Holding at ` +
      `${input.currentTarget.toLocaleString()} for another week to let it settle before we add more.`,
  };
}

/** Rough conversion for "you are 1,800 steps short" style nudges. */
export function stepsToMinutes(steps: number, stepsPerMinute = 100): number {
  return Math.max(1, Math.round(steps / stepsPerMinute));
}
