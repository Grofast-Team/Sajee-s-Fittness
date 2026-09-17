/**
 * When this person eats, and which meal they have not logged yet.
 *
 * ## Why a schedule at all
 *
 * "Log your food" is a request the app makes at the wrong moment. Asked at
 * 3pm, someone has to reconstruct breakfast from memory; asked at 1:30pm, they
 * are remembering the plate they just put down. The schedule exists so the
 * prompt can arrive while the answer is still easy.
 *
 * ## Clock time is the wrong unit
 *
 * The obvious implementation compares the current clock time against the meal
 * time and calls anything earlier "due". That breaks for the people this app
 * explicitly supports: `lifestyle.night_shift` is a column, and onboarding asks
 * when a shift starts and ends. Someone who wakes at 20:00 might eat their
 * first meal at 21:00 and their last at 05:00. At 02:00 a clock comparison says
 * breakfast is sixteen hours away, when in fact it was five hours ago.
 *
 * So everything here is measured in **minutes since waking**, wrapped at
 * twenty-four hours. A day starts when the person gets up, not at midnight.
 *
 * Pure, like the rest of `src/lib/engines`: the current time is passed in and
 * never read from a clock, which is what makes the night-shift cases testable.
 */

export type ScheduledMeal = 'breakfast' | 'lunch' | 'dinner';

/** The three meals that carry a scheduled time, in the order they are eaten.
 *  Snacks deliberately have no schedule — they are not missed, they are had. */
export const SCHEDULED_MEALS: ScheduledMeal[] = ['breakfast', 'lunch', 'dinner'];

/** `HH:MM` as stored in a Postgres `time` column, or null when never set. */
export interface MealSchedule {
  breakfast: string | null;
  lunch: string | null;
  dinner: string | null;
}

/**
 * Where each meal falls when the user has not told us, expressed as minutes
 * after waking rather than as clock times.
 *
 * Deriving from wake time beats a fixed 08:00 / 13:00 / 20:00: someone who
 * gets up at 05:00 and someone who gets up at 11:00 do not eat breakfast at
 * the same hour, and the app already knows which they are.
 */
export const DEFAULT_OFFSET_MINUTES: Record<ScheduledMeal, number> = {
  breakfast: 60,
  lunch: 6 * 60,
  dinner: 12 * 60,
};

/** Used only when wake time was never answered. */
export const FALLBACK_WAKE = '07:00';

/**
 * How long after the scheduled time to wait before saying anything.
 *
 * Prompting at exactly 13:00 interrupts the meal it is asking about.
 */
export const GRACE_MINUTES = 30;

const MINUTES_PER_DAY = 24 * 60;

/** `HH:MM` or `HH:MM:SS` to minutes past midnight. Null if unparseable, so a
 *  malformed column value degrades to "not set" instead of throwing. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClock(minutes: number): string {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutes from waking to the given clock time, wrapped into a single day.
 *  This is the function that makes night shifts work. */
export function minutesSinceWake(clockMinutes: number, wakeMinutes: number): number {
  return (((clockMinutes - wakeMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export interface ResolvedMeal {
  meal: ScheduledMeal;
  /** Clock time, minutes past midnight. */
  atMinutes: number;
  /** Position within the person's waking day. */
  sinceWake: number;
  /** True when this came from the default offset rather than from the user. */
  isDefault: boolean;
}

/**
 * Fill in whatever the user did not set, and place every meal on the
 * since-waking axis.
 */
export function resolveSchedule(
  schedule: Partial<MealSchedule> | null | undefined,
  wakeTime: string | null | undefined,
): ResolvedMeal[] {
  const wake = parseClock(wakeTime) ?? parseClock(FALLBACK_WAKE)!;

  return SCHEDULED_MEALS.map((meal) => {
    const set = parseClock(schedule?.[meal] ?? null);
    const atMinutes = set ?? (wake + DEFAULT_OFFSET_MINUTES[meal]) % MINUTES_PER_DAY;
    return {
      meal,
      atMinutes,
      sinceWake: minutesSinceWake(atMinutes, wake),
      isDefault: set === null,
    };
  });
}

export interface PendingMealInput {
  /** Current local time as `HH:MM`, in the user's timezone. Passed in. */
  now: string;
  schedule: Partial<MealSchedule> | null | undefined;
  wakeTime: string | null | undefined;
  /** `food_logs.meal` values already recorded today. Snacks are ignored. */
  logged: string[];
}

export interface PendingMeal {
  meal: ScheduledMeal;
  /** When it was expected, for display: "around 13:00". */
  atClock: string;
  minutesLate: number;
  /** True when the time was assumed rather than chosen, so the UI can offer
   *  to correct it instead of asserting a time the user never gave. */
  isDefault: boolean;
}

/**
 * The one meal worth asking about, or null.
 *
 * Returns **the most recently due** unlogged meal, not the earliest. At 9pm
 * with both lunch and dinner missing, dinner is the one still fresh enough to
 * recall accurately — and leading with the oldest failure is how an app turns
 * a thin day into a reason to stop opening it. Earlier meals stay loggable
 * from the food screen; they simply are not what the app leads with.
 */
export function pendingMeal(input: PendingMealInput): PendingMeal | null {
  const nowMinutes = parseClock(input.now);
  if (nowMinutes === null) return null;

  const wake = parseClock(input.wakeTime) ?? parseClock(FALLBACK_WAKE)!;
  const nowSinceWake = minutesSinceWake(nowMinutes, wake);
  const logged = new Set(input.logged);

  const due = resolveSchedule(input.schedule, input.wakeTime)
    .filter((entry) => !logged.has(entry.meal))
    .filter((entry) => nowSinceWake >= entry.sinceWake + GRACE_MINUTES)
    // Latest position in the waking day wins.
    .sort((a, b) => b.sinceWake - a.sinceWake);

  const next = due[0];
  if (!next) return null;

  return {
    meal: next.meal,
    atClock: formatClock(next.atMinutes),
    minutesLate: nowSinceWake - next.sinceWake,
    isDefault: next.isDefault,
  };
}
