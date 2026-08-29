import type { Confidence } from './types';

/**
 * Portion resolution.
 *
 * Portion size is the largest error source in food logging - larger than
 * misidentifying the food. A model looking at a plate of rice genuinely cannot
 * tell 90 g from 210 g, and any app that returns a confident number from that
 * photo is fabricating data.
 *
 * So the primary flow asks the user to photograph the food **on a kitchen
 * weighing scale with the display visible**. Then grams are measured rather
 * than guessed, and the whole downstream calculation inherits that accuracy.
 *
 * This module decides which evidence to trust and how much confidence the
 * result deserves.
 */

export type PortionBasis =
  | 'kitchen_scale'
  | 'user_input'
  | 'household_measure'
  | 'visual_estimate'
  | 'label';

export type ScaleUnit = 'g' | 'kg' | 'oz' | 'lb';

/** What the vision model could actually *see*. It is instructed to report
 *  unreadable digits as unreadable rather than guessing, because a guessed
 *  digit is worse than no digit - it arrives with unearned confidence. */
export interface ScaleReading {
  present: boolean;
  displayReadable: boolean;
  value: number | null;
  unit: ScaleUnit | null;
  containerOnScale: boolean;
  notes?: string | null;
}

export interface HouseholdMeasure {
  unitLabel: string;
  grams: number;
  count: number;
  confidence?: Confidence;
}

export interface VisualEstimate {
  /** Model's rough gram estimate. Treated as a midpoint, never a value. */
  grams: number;
}

export interface PortionInput {
  scale?: ScaleReading;
  /** Grams the user typed directly. Beats everything except a confirmed scale. */
  userGrams?: number;
  /** Has the user confirmed the scale was tared (zeroed) with the empty vessel? */
  tareConfirmed?: boolean;
  /** A user-supplied vessel weight, in grams. Never guessed by us. */
  vesselGrams?: number;
  household?: HouseholdMeasure;
  visual?: VisualEstimate;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  options?: string[];
  /** Why we are asking, shown as helper text so the question feels purposeful. */
  because: string;
}

export interface PortionResult {
  grams: number | null;
  gramsLow: number | null;
  gramsHigh: number | null;
  basis: PortionBasis;
  confidence: Confidence;
  /** Must be answered before the estimate can be treated as settled. */
  questions: ClarifyingQuestion[];
  explanation: string;
}

const TO_GRAMS: Record<ScaleUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
};

/** Uncertainty band applied to a purely visual estimate. Wide on purpose. */
export const VISUAL_ERROR_FRACTION = 0.35;

export function scaleToGrams(reading: ScaleReading): number | null {
  if (!reading.displayReadable || reading.value === null || !reading.unit) return null;
  if (reading.value <= 0) return null;
  const grams = reading.value * TO_GRAMS[reading.unit];
  // Sanity bound: a single logged portion above 5 kg is a misread display, not
  // a meal. Better to fall through to the estimation path than to log 1,800 g
  // of rice because the model read "0.18" as "1.8".
  if (grams > 5000) return null;
  return Math.round(grams * 10) / 10;
}

/**
 * Resolve a portion from whatever evidence is available.
 *
 * Precedence, strongest first:
 *   1. a readable scale display with a confirmed tare  -> measured
 *   2. grams typed by the user                         -> measured
 *   3. a readable scale display, tare unknown          -> ask before trusting
 *   4. a household measure mapped through the database -> estimated
 *   5. a purely visual estimate                        -> range only
 */
export function resolvePortion(input: PortionInput): PortionResult {
  const questions: ClarifyingQuestion[] = [];
  const scaleGrams = input.scale ? scaleToGrams(input.scale) : null;

  // --- 1 & 3: scale display -------------------------------------------------
  if (scaleGrams !== null) {
    const needsTareAnswer =
      input.scale?.containerOnScale === true &&
      input.tareConfirmed !== true &&
      input.vesselGrams === undefined;

    if (needsTareAnswer) {
      // We will not silently subtract a guessed vessel weight. A steel plate is
      // 250 g, which is a 40% error on a 600 g meal - an invented tare is
      // fabricated data with extra steps.
      questions.push({
        id: 'tare',
        question: 'Was the scale zeroed with the empty plate or bowl on it?',
        options: ['Yes, I zeroed it first', 'No, the plate is included', 'I am not sure'],
        because:
          'If the plate is included in that reading, the food weighs less than the display shows.',
      });

      return {
        grams: scaleGrams,
        gramsLow: Math.round(scaleGrams * 0.6),
        gramsHigh: scaleGrams,
        basis: 'kitchen_scale',
        confidence: 'medium',
        questions,
        explanation:
          `The scale reads ${scaleGrams} g. We just need to know whether that includes the ` +
          `plate - once you tell us, this becomes an exact number rather than an estimate.`,
      };
    }

    const vessel = input.tareConfirmed ? 0 : input.vesselGrams ?? 0;
    const net = Math.max(0, Math.round((scaleGrams - vessel) * 10) / 10);

    return {
      grams: net,
      gramsLow: net,
      gramsHigh: net,
      basis: 'kitchen_scale',
      confidence: 'high',
      questions,
      explanation:
        vessel > 0
          ? `Weighed: ${scaleGrams} g on the scale, less the ${vessel} g vessel you told us about, so ${net} g of food.`
          : `Weighed on your kitchen scale: ${net} g. This is measured, not estimated - it is the most accurate way to log.`,
    };
  }

  // --- 2: user typed grams --------------------------------------------------
  if (typeof input.userGrams === 'number' && input.userGrams > 0) {
    const g = Math.round(input.userGrams * 10) / 10;
    return {
      grams: g,
      gramsLow: g,
      gramsHigh: g,
      basis: 'user_input',
      confidence: 'high',
      questions,
      explanation: `Using the ${g} g you entered.`,
    };
  }

  // --- 4: household measure -------------------------------------------------
  if (input.household && input.household.grams > 0 && input.household.count > 0) {
    const g = Math.round(input.household.grams * input.household.count * 10) / 10;
    const spread = 0.2;
    return {
      grams: g,
      gramsLow: Math.round(g * (1 - spread)),
      gramsHigh: Math.round(g * (1 + spread)),
      basis: 'household_measure',
      confidence: input.household.confidence ?? 'medium',
      questions,
      explanation:
        `${input.household.count} × ${input.household.unitLabel} works out to about ${g} g. ` +
        `Household measures vary between kitchens, so treat this as close rather than exact.`,
    };
  }

  // --- 5: visual estimate only ---------------------------------------------
  if (input.visual && input.visual.grams > 0) {
    const mid = input.visual.grams;
    const low = Math.round(mid * (1 - VISUAL_ERROR_FRACTION));
    const high = Math.round(mid * (1 + VISUAL_ERROR_FRACTION));

    questions.push({
      id: 'portion_size',
      question: 'Roughly how much was it?',
      options: ['Smaller than usual', 'About a usual portion', 'Larger than usual'],
      because: 'Photos alone cannot show weight, so your answer narrows this down a lot.',
    });
    questions.push({
      id: 'scale_tip',
      question: 'Want more accurate numbers next time?',
      options: ['Show me how', 'Not now'],
      because:
        'Photographing the food on a kitchen scale with the display visible turns this estimate ' +
        'into an exact measurement.',
    });

    return {
      grams: null,
      gramsLow: low,
      gramsHigh: high,
      basis: 'visual_estimate',
      confidence: 'low',
      questions,
      explanation:
        `Somewhere between ${low} g and ${high} g. We are not going to pretend a photo can tell us ` +
        `the weight - it cannot. This is a range, and it will stay a range until you weigh it or ` +
        `tell us the portion size.`,
    };
  }

  return {
    grams: null,
    gramsLow: null,
    gramsHigh: null,
    basis: 'visual_estimate',
    confidence: 'low',
    questions: [
      {
        id: 'quantity',
        question: 'How much of this did you have?',
        because: 'We could not work out the portion from what we have so far.',
      },
    ],
    explanation: 'We need a quantity before we can work out anything useful.',
  };
}

/** Guidance shown on the camera screen. Short, concrete, and the reason why. */
export const SCALE_PHOTO_TIPS = [
  'Put the empty plate or bowl on the scale and press tare (zero) before serving.',
  'Serve the food, then take the photo from slightly above.',
  'Make sure the numbers on the display are in the frame and in focus.',
  'Avoid glare on the display - that is the usual reason we cannot read it.',
] as const;

export const WHY_THE_SCALE_HELPS =
  'A photo can tell us what you ate. It cannot tell us how much, and portion size is where almost ' +
  'all the error in food tracking comes from. With the scale in the frame we read the actual weight, ' +
  'so your numbers stop being a guess.';
