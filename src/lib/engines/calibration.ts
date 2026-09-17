import type { Confidence } from './types';

/**
 * Learning what *this person's* portions actually weigh.
 *
 * ## The problem with a shared serving table
 *
 * `food_servings` says a dosa is 60 g. That figure is a population guess, and
 * it has to be: dosas vary by household, by pan, by who is cooking. For a user
 * whose dosas are consistently 85 g, every household-measure log is wrong by
 * 40%, and the error is systematic rather than random — it never averages out
 * across a week, it accumulates.
 *
 * ## What this does instead
 *
 * Once someone has weighed a dosa, we know what *their* dosa weighs. From then
 * on "2 dosa" resolves against their own measurement rather than the shared
 * one. The point is that a single weighing pays off permanently instead of
 * once — which is the only honest way to ask people to use a kitchen scale.
 *
 * ## Why the median
 *
 * One mis-tared weighing — a plate left on the scale — lands far from the
 * truth and would drag a mean with it. The median ignores it. Three
 * measurements of 84, 86 and 210 give 86, which is the right answer.
 *
 * ## Why spread matters as much as count
 *
 * Three consistent measurements mean the portion is predictable. Three that
 * disagree wildly mean this person's dosas genuinely vary, and the number we
 * return should say so rather than claiming precision it has not earned.
 * Confidence therefore comes from count *and* agreement, not count alone.
 *
 * Pure, like the rest of `src/lib/engines`: samples are handed in.
 */

/** Below this many agreeing samples, a calibrated figure stays `medium`. */
export const MIN_SAMPLES_FOR_HIGH = 3;

/**
 * Relative spread — (max - min) / median — under which samples are treated as
 * agreeing. A quarter is deliberately generous: home portions are not
 * laboratory repeats, and demanding tighter agreement would leave almost
 * everything at `medium` forever.
 */
export const TIGHT_SPREAD = 0.25;

export interface CalibrationInput {
  /** Grams for a *single* unit, from this user's own weighed entries. */
  samples: number[];
  /** The shared `food_servings` figure, when one exists for this unit. */
  populationGrams: number | null;
}

export interface CalibrationResult {
  grams: number | null;
  confidence: Confidence;
  sampleCount: number;
  /** (max - min) / median. Null below two samples, where spread is undefined. */
  spread: number | null;
  source: 'yours' | 'population' | 'unknown';
  /** Shown to the user, so the number can account for itself. */
  explanation: string;
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(grams: number): number {
  return Math.round(grams * 10) / 10;
}

/**
 * Resolve one household unit to grams, preferring what this person has
 * actually measured.
 *
 * A single weighed sample beats the shared table. That looks aggressive for
 * one data point, and it is the right call: the population figure is a guess
 * about everybody, while one measurement is a fact about this person's own
 * kitchen. It is reported as `medium`, not `high`, so the interface can say
 * how much to trust it.
 */
export function calibrateServing(input: CalibrationInput): CalibrationResult {
  const clean = input.samples.filter((v) => Number.isFinite(v) && v > 0);
  const mid = median(clean);

  if (mid === null) {
    if (input.populationGrams !== null && input.populationGrams > 0) {
      return {
        grams: round(input.populationGrams),
        confidence: 'medium',
        sampleCount: 0,
        spread: null,
        source: 'population',
        explanation:
          'A typical figure, not yours. Weigh this once and we will use your own from then on.',
      };
    }
    return {
      grams: null,
      confidence: 'low',
      sampleCount: 0,
      spread: null,
      source: 'unknown',
      explanation: 'We have no weight for this measure yet.',
    };
  }

  const spread = clean.length >= 2 ? (Math.max(...clean) - Math.min(...clean)) / mid : null;

  const agrees = spread !== null && spread <= TIGHT_SPREAD;
  const confidence: Confidence =
    clean.length >= MIN_SAMPLES_FOR_HIGH && agrees ? 'high' : 'medium';

  return {
    grams: round(mid),
    confidence,
    sampleCount: clean.length,
    spread,
    source: 'yours',
    explanation: explain(clean.length, confidence, spread),
  };
}

function explain(count: number, confidence: Confidence, spread: number | null): string {
  if (count === 1) {
    return 'Based on the one time you weighed this. Weigh it again and it gets steadier.';
  }
  if (confidence === 'high') {
    return `Based on ${count} weighings of your own, which agree closely.`;
  }
  if (spread !== null && spread > TIGHT_SPREAD) {
    // Naming the variation is more useful than hiding it: the person knows
    // their own kitchen and can tell us the portion changed.
    return `Based on ${count} of your weighings, which vary a fair bit — so this is an average of a portion that genuinely changes.`;
  }
  return `Based on ${count} weighings of your own.`;
}
