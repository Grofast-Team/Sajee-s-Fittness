import type { TrendPoint, TrendResult, WeighIn } from './types';

/**
 * Weight trend analysis.
 *
 * Scale weight is a noisy signal with a slow trend underneath it. Day-to-day
 * movement is dominated by water, glycogen, sodium, gut content and cycle
 * phase - not fat. A system that reacts to a single reading will tell users
 * they gained fat overnight, which is both false and demoralising.
 *
 * So: smooth first, then fit, then only claim a direction when the statistics
 * actually support one.
 */

/** EWMA smoothing factor. 0.25 gives roughly a one-week half-life: responsive
 *  enough to catch a real change within a fortnight, damped enough to ignore a
 *  salty dinner. */
export const SMOOTHING_ALPHA = 0.25;

/** Two-sided 95% t critical values, indexed by degrees of freedom. Beyond 30
 *  the normal approximation is close enough. */
const T_TABLE: Record<number, number> = {
  1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145,
  15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086,
  21: 2.08, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056,
  27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
};

function tCritical(df: number): number {
  if (df <= 0) return Number.POSITIVE_INFINITY;
  if (df <= 30) return T_TABLE[df];
  return 1.96;
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(b) - Date.parse(a);
  return ms / 86_400_000;
}

/** Exponentially weighted moving average over chronologically sorted readings. */
export function smooth(readings: WeighIn[], alpha = SMOOTHING_ALPHA): TrendPoint[] {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendPoint[] = [];
  let ewma: number | null = null;

  for (const r of sorted) {
    ewma = ewma === null ? r.weightKg : alpha * r.weightKg + (1 - alpha) * ewma;
    out.push({ date: r.date, raw: r.weightKg, smoothed: Math.round(ewma * 100) / 100 });
  }
  return out;
}

/**
 * Ordinary least squares fit of weight against time, returning the slope in
 * kg/week together with the half-width of its 95% confidence interval.
 *
 * The confidence interval is the part that matters. Without it there is no
 * principled way to distinguish "you are losing 0.3 kg/week" from "the noise
 * happens to slope downwards this fortnight".
 */
export function fitRate(readings: WeighIn[]): { kgPerWeek: number; margin: number } | null {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  if (n < 3) return null;

  const origin = sorted[0].date;
  const xs = sorted.map((r) => daysBetween(origin, r.date));
  const ys = sorted.map((r) => r.weightKg);

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i] - meanY);
  }
  // All readings on the same day: no time span to fit against.
  if (sxx === 0) return null;

  const slopePerDay = sxy / sxx;
  const intercept = meanY - slopePerDay * meanX;

  let residualSS = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slopePerDay * xs[i];
    residualSS += (ys[i] - predicted) ** 2;
  }

  const df = n - 2;
  const residualSE = Math.sqrt(residualSS / df);
  const slopeSE = residualSE / Math.sqrt(sxx);
  const marginPerDay = tCritical(df) * slopeSE;

  return {
    kgPerWeek: slopePerDay * 7,
    margin: marginPerDay * 7,
  };
}

export interface TrendOptions {
  /** How far back the rate fit looks. Defaults to 28 days. */
  windowDays?: number;
  /** Reference "today" as `YYYY-MM-DD`. Passed in so the engine stays pure. */
  today?: string;
}

/**
 * Full trend read-out for the progress screen.
 *
 * When the confidence interval on the rate straddles zero, the honest answer is
 * "too early to tell", and that is what we say. Most apps will not say this,
 * which is why their users think a plateau began on Tuesday.
 */
export function analyseTrend(readings: WeighIn[], options: TrendOptions = {}): TrendResult {
  const windowDays = options.windowDays ?? 28;
  const points = smooth(readings);

  if (points.length === 0) {
    return {
      points: [],
      latestSmoothed: null,
      kgPerWeek: null,
      kgPerWeekMargin: null,
      direction: 'unclear',
      daysOfData: 0,
      readingCount: 0,
      message: 'Log a few weigh-ins and we will start showing your trend.',
    };
  }

  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const anchor = options.today ?? sorted[sorted.length - 1].date;
  const windowed = sorted.filter((r) => daysBetween(r.date, anchor) <= windowDays);

  const daysOfData = Math.round(daysBetween(sorted[0].date, anchor));
  const latestSmoothed = points[points.length - 1].smoothed;
  const fit = fitRate(windowed.length >= 3 ? windowed : sorted);

  if (!fit) {
    return {
      points,
      latestSmoothed,
      kgPerWeek: null,
      kgPerWeekMargin: null,
      direction: 'unclear',
      daysOfData,
      readingCount: sorted.length,
      message:
        'We need at least three weigh-ins across a few days before a trend means anything. ' +
        'Right now this is just individual readings.',
    };
  }

  const { kgPerWeek, margin } = fit;
  const significant = Math.abs(kgPerWeek) > margin;

  let direction: TrendResult['direction'];
  let message: string;

  if (!significant) {
    // Distinguish "genuinely flat" from "not enough data to tell" - they feel
    // the same to a user but call for completely different advice.
    if (margin < 0.15 && daysOfData >= 21) {
      direction = 'holding';
      message =
        'Your weight is holding steady over this window. That is a real reading, not noise - ' +
        'the numbers are consistent enough for us to say it.';
    } else {
      direction = 'unclear';
      message =
        'Too early to call. The day-to-day movement is still larger than the underlying change, ' +
        'so any trend line right now would be reading tea leaves. Keep logging.';
    }
  } else if (kgPerWeek < 0) {
    direction = 'losing';
    message =
      `You are losing about ${Math.abs(kgPerWeek).toFixed(2)} kg a week ` +
      `(somewhere between ${Math.abs(kgPerWeek + margin).toFixed(2)} and ${Math.abs(kgPerWeek - margin).toFixed(2)}).`;
  } else {
    direction = 'gaining';
    message =
      `Your trend is up by about ${kgPerWeek.toFixed(2)} kg a week. ` +
      `That is worth looking at together - it does not automatically mean fat gain.`;
  }

  return {
    points,
    latestSmoothed,
    kgPerWeek: Math.round(kgPerWeek * 1000) / 1000,
    kgPerWeekMargin: Math.round(margin * 1000) / 1000,
    direction,
    daysOfData,
    readingCount: sorted.length,
    message,
  };
}

/** Mean of the most recent `days` of readings, for week-over-week comparison. */
export function windowAverage(readings: WeighIn[], anchorDate: string, days: number): number | null {
  const inWindow = readings.filter((r) => {
    const age = daysBetween(r.date, anchorDate);
    return age >= 0 && age < days;
  });
  if (inWindow.length === 0) return null;
  const sum = inWindow.reduce((a, r) => a + r.weightKg, 0);
  return Math.round((sum / inWindow.length) * 100) / 100;
}

export interface FluctuationContext {
  sodiumHeavyMeal?: boolean;
  carbIncrease?: boolean;
  newTraining?: boolean;
  poorSleep?: boolean;
  menstrualPhase?: boolean;
  missedBowelMovement?: boolean;
  alcohol?: boolean;
  travel?: boolean;
}

/**
 * "Why did my weight change?"
 *
 * Returns candidate explanations for a short-term move, ordered by how likely
 * they are. Deliberately never asserts a cause - it offers possibilities and
 * says plainly that a two-day rise cannot be fat.
 */
export function explainShortTermChange(
  deltaKg: number,
  daysApart: number,
  context: FluctuationContext = {},
): { headline: string; causes: string[]; reassurance: string } {
  const causes: string[] = [];
  const rising = deltaKg > 0;

  if (context.sodiumHeavyMeal) causes.push('A saltier meal than usual makes your body hold extra water for a day or two.');
  if (context.carbIncrease) causes.push('Eating more carbohydrate stores more glycogen, and every gram of glycogen holds around three grams of water with it.');
  if (context.newTraining) causes.push('New or harder training causes temporary fluid retention in the muscles you worked. This is repair, not fat.');
  if (context.menstrualPhase) causes.push('Water retention around your cycle can easily move the scale by one to two kilos, and it passes on its own.');
  if (context.poorSleep) causes.push('Short sleep raises cortisol, which tends to hold onto water.');
  if (context.alcohol) causes.push('Alcohol shifts fluid balance, often up a day later.');
  if (context.travel) causes.push('Travel changes salt intake, hydration, sleep and bathroom timing all at once.');
  if (context.missedBowelMovement) causes.push('Simply not having been to the toilet yet accounts for a surprising amount.');

  if (causes.length === 0) {
    causes.push(
      'Normal day-to-day variation. Food still in your digestive system, hydration and salt alone ' +
      'move most people by up to two kilos across a week.',
    );
  }

  // The arithmetic check that makes this convincing rather than reassuring noise.
  const impliedKcal = Math.abs(deltaKg) * 7700;
  const perDay = Math.round(impliedKcal / Math.max(1, daysApart));

  const reassurance =
    `For ${Math.abs(deltaKg).toFixed(1)} kg of actual body fat to ${rising ? 'appear' : 'disappear'} in ` +
    `${daysApart} day${daysApart === 1 ? '' : 's'}, you would have had to ${rising ? 'eat' : 'be short'} ` +
    `about ${perDay.toLocaleString()} kcal a day beyond your usual - on top of everything else you ate. ` +
    `That almost certainly did not happen, which is how we know this is water and gut content rather than fat.`;

  return {
    headline: rising
      ? 'The scale is up, and this is very unlikely to be fat.'
      : 'The scale is down. Some of this is real and some is fluid.',
    causes,
    reassurance,
  };
}
