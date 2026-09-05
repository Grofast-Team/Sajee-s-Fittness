/**
 * Deciding which recorded steps to believe.
 *
 * ## What this can and cannot do
 *
 * The obvious design is "detect when the phone is in a car and drop those
 * steps". That is not buildable on this data, and it is worth being precise
 * about why, because the misunderstanding leads somewhere harmful.
 *
 * Health Connect and HealthKit do **not** hand out vehicle labels alongside
 * step data. Vehicle and transit classification lives in a different API
 * entirely — Android's Activity Recognition, part of Play Services — and it is
 * not joined to the step records. What we receive is a series of step samples
 * with a time range and the name of the app that recorded them, plus separately
 * recorded workout sessions with a type.
 *
 * More importantly: **the recording app has already filtered vehicle motion.**
 * That filtering is most of what Google Fit, Samsung Health and Apple's
 * pedometer do. If we take their output and subtract a second helping of
 * "suspicious" periods, we do not remove phantom steps — we delete real ones,
 * and we do it invisibly. Under-counting is not the safe direction of error
 * here: it makes someone's genuine effort disappear, which is precisely the
 * experience this product exists to avoid.
 *
 * So this engine does not re-detect walking. It looks for the three problems
 * that are actually visible in the data and actually cause wrong totals:
 *
 * 1. **Double counting across apps.** Two health apps writing the same walk to
 *    the same store is common and inflates totals badly — far more often, and
 *    by more, than car vibration does.
 * 2. **Physically impossible cadence.** A segment claiming 400 steps in a
 *    minute did not come from a person walking.
 * 3. **Wheel-based workouts.** Steps logged during a recorded cycling session
 *    are not walking steps.
 *
 * Everything else is left alone and counted. When we are unsure, the steps are
 * kept and the confidence is lowered — never silently dropped.
 */

export interface StepSegment {
  /** ISO 8601. */
  startDate: string;
  endDate: string;
  steps: number;
  /** The app that recorded it — "Google Fit", "Samsung Health", "Fitbit". */
  sourceName?: string;
}

export interface WorkoutSegment {
  startDate: string;
  endDate: string;
  workoutType: string;
}

export type ExclusionReason =
  | 'duplicate_source'
  | 'impossible_cadence'
  | 'wheel_based_workout';

export interface SegmentVerdict {
  startDate: string;
  endDate: string;
  steps: number;
  sourceName: string | null;
  counted: boolean;
  /** Steps per minute, where the segment was long enough to mean anything. */
  cadence: number | null;
  /** Shown to the user. Always phrased as possibility, never as fact. */
  note: string;
  reason: ExclusionReason | null;
}

export interface StepValidityResult {
  /** Everything the device reported, untouched. Never overwritten. */
  rawSteps: number;
  /** What we are willing to stand behind. */
  validatedSteps: number;
  excludedSteps: number;
  segments: SegmentVerdict[];
  confidence: 'high' | 'medium' | 'low';
  /** Why the confidence is what it is, in plain words. */
  confidenceReasons: string[];
  sources: string[];
}

/*
 * Cadence bounds.
 *
 * Ordinary walking sits near 100-130 steps a minute and running near 150-190.
 * Competitive sprinters reach roughly 300 for a few seconds. 240 sustained
 * across a full minute is therefore comfortably outside what a person does,
 * while leaving every real runner untouched — the threshold exists to catch
 * sensor noise, not fast people.
 */
const MAX_PLAUSIBLE_CADENCE = 240;

/**
 * Segments shorter than this are not judged on cadence at all.
 *
 * A ten-second record showing 30 steps is 180/min, which looks like running
 * but is just as likely to be bucket-boundary rounding. There is not enough
 * signal in a few seconds to accuse the data of anything.
 */
const MIN_SECONDS_FOR_CADENCE = 60;

/** Workouts where the legs are moving but no steps are being taken. */
const WHEEL_BASED = new Set([
  'cycling',
  'bikingStationary',
  'handCycling',
  'rowing',
  'rowingMachine',
  'wheelchair',
  'wheelchairRunPace',
  'wheelchairWalkPace',
]);

const seconds = (a: string, b: string) =>
  Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);

const overlaps = (a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) =>
  new Date(a.startDate) < new Date(b.endDate) && new Date(b.startDate) < new Date(a.endDate);

/**
 * Assess a day's step segments.
 *
 * Returns the device's own total alongside ours, because replacing the number
 * someone's phone shows them with a quieter one and no explanation is a good
 * way to lose their trust in both.
 */
export function assessSteps(
  segments: StepSegment[],
  workouts: WorkoutSegment[] = [],
): StepValidityResult {
  const rawSteps = segments.reduce((sum, s) => sum + Math.max(0, s.steps), 0);
  const sources = [...new Set(segments.map((s) => s.sourceName).filter(Boolean))] as string[];

  if (segments.length === 0) {
    return {
      rawSteps: 0,
      validatedSteps: 0,
      excludedSteps: 0,
      segments: [],
      confidence: 'low',
      confidenceReasons: ['No step data was available for this day.'],
      sources: [],
    };
  }

  const primary = pickPrimarySource(segments);
  const wheelWorkouts = workouts.filter((w) => WHEEL_BASED.has(w.workoutType));

  const verdicts: SegmentVerdict[] = segments.map((segment) => {
    const durationSeconds = seconds(segment.startDate, segment.endDate);
    const cadence =
      durationSeconds >= MIN_SECONDS_FOR_CADENCE
        ? Math.round((segment.steps / durationSeconds) * 60)
        : null;

    const base = {
      startDate: segment.startDate,
      endDate: segment.endDate,
      steps: Math.max(0, segment.steps),
      sourceName: segment.sourceName ?? null,
      cadence,
    };

    // 1. Double counting. Only ever applies when more than one app is writing.
    if (primary !== null && segment.sourceName && segment.sourceName !== primary) {
      return {
        ...base,
        counted: false,
        reason: 'duplicate_source',
        note:
          `Also recorded by ${primary}, so this copy from ${segment.sourceName} is not counted ` +
          `again. Nothing was lost — the same walk is already included.`,
      };
    }

    // 2. Physically impossible cadence.
    if (cadence !== null && cadence > MAX_PLAUSIBLE_CADENCE) {
      return {
        ...base,
        counted: false,
        reason: 'impossible_cadence',
        note:
          `${cadence} steps a minute is faster than a person runs, so this stretch looks like ` +
          `sensor noise rather than walking.`,
      };
    }

    // 3. Steps recorded during a wheel-based workout.
    const wheel = wheelWorkouts.find((w) => overlaps(segment, w));
    if (wheel) {
      return {
        ...base,
        counted: false,
        reason: 'wheel_based_workout',
        note: `Recorded during a ${humanWorkout(wheel.workoutType)} session, so not counted as walking.`,
      };
    }

    return { ...base, counted: true, reason: null, note: 'Counted.' };
  });

  const validatedSteps = verdicts.filter((v) => v.counted).reduce((s, v) => s + v.steps, 0);
  const excludedSteps = rawSteps - validatedSteps;

  return {
    rawSteps,
    validatedSteps,
    excludedSteps,
    segments: verdicts,
    ...scoreConfidence(verdicts, sources, rawSteps, excludedSteps),
    sources,
  };
}

/**
 * Which app's records to treat as authoritative when several are writing.
 *
 * The one covering the most time wins, rather than the one reporting the most
 * steps — picking on step count would systematically favour whichever app
 * over-counts, which is exactly backwards.
 *
 * Returns null when there is nothing to disambiguate, so the duplicate rule
 * stays switched off for the ordinary single-app case.
 */
function pickPrimarySource(segments: StepSegment[]): string | null {
  const named = segments.filter((s) => s.sourceName);
  const distinct = new Set(named.map((s) => s.sourceName));
  if (distinct.size < 2) return null;

  const coverage = new Map<string, number>();
  for (const s of named) {
    const key = s.sourceName as string;
    coverage.set(key, (coverage.get(key) ?? 0) + seconds(s.startDate, s.endDate));
  }

  return [...coverage.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * How much to trust the total.
 *
 * Stated as a level with reasons rather than a percentage, because a
 * percentage implies a precision this does not have.
 */
function scoreConfidence(
  verdicts: SegmentVerdict[],
  sources: string[],
  rawSteps: number,
  excludedSteps: number,
): { confidence: 'high' | 'medium' | 'low'; confidenceReasons: string[] } {
  const reasons: string[] = [];
  const excludedShare = rawSteps > 0 ? excludedSteps / rawSteps : 0;

  if (sources.length > 1) {
    reasons.push(`${sources.length} apps were writing step data, so some records overlapped.`);
  }
  if (verdicts.some((v) => v.reason === 'impossible_cadence')) {
    reasons.push('Some stretches showed a step rate no person could produce.');
  }
  if (verdicts.some((v) => v.reason === 'wheel_based_workout')) {
    reasons.push('Some steps were recorded during a cycling or rowing session.');
  }

  // A large excluded share is the strongest signal that something is off.
  if (excludedShare > 0.35) {
    reasons.push('A large part of the day’s records could not be confirmed.');
    return { confidence: 'low', confidenceReasons: reasons };
  }

  if (reasons.length === 0) {
    return {
      confidence: 'high',
      confidenceReasons: ['One app recorded the whole day and nothing looked out of place.'],
    };
  }

  return { confidence: 'medium', confidenceReasons: reasons };
}

function humanWorkout(type: string): string {
  return (
    {
      cycling: 'cycling',
      bikingStationary: 'stationary bike',
      handCycling: 'hand cycling',
      rowing: 'rowing',
      rowingMachine: 'rowing machine',
      wheelchair: 'wheelchair',
      wheelchairRunPace: 'wheelchair',
      wheelchairWalkPace: 'wheelchair',
    }[type] ?? type
  );
}

/**
 * One line summarising the day, for the dashboard.
 *
 * Deliberately never claims the excluded steps were false — only that they
 * could not be confirmed. We do not have the evidence for the stronger claim
 * and should not imply it.
 */
export function summarise(result: StepValidityResult): string {
  if (result.rawSteps === 0) return 'No step data recorded for today.';
  if (result.excludedSteps === 0) {
    return `${result.validatedSteps.toLocaleString()} steps, all confirmed.`;
  }

  return (
    `${result.validatedSteps.toLocaleString()} steps confirmed. Your phone recorded ` +
    `${result.rawSteps.toLocaleString()}; we could not confirm ${result.excludedSteps.toLocaleString()} ` +
    `of them.`
  );
}
