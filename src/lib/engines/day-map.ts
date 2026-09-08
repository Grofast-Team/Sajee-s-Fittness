/**
 * Working out how active someone is from what they actually did.
 *
 * ## Why not just ask
 *
 * "How active are you — sedentary, light, moderate, very?" is the standard
 * question and it produces the least reliable answer in the whole interview.
 * People answer it with their self-image, with what they think the app wants,
 * or with the one good week they had in March. Someone who walks 40 minutes to
 * a shop and back, cooks for an hour and stands all afternoon will call
 * themselves "not very active" because they do not go to a gym.
 *
 * So this asks a different question: **tell me what you do, from morning to
 * night.** Concrete blocks of a real day. The activity level then falls out of
 * the answers instead of being one of them.
 *
 * ## What the number means
 *
 * Each activity carries a MET value — a multiple of resting metabolic rate.
 * Sum MET × hours across a full 24 hours and divide by 24 and you have PAL,
 * the physical activity level, which is the actual physiological definition of
 * the multiplier applied to BMR. That is a far more defensible figure than a
 * points score, and it can be explained back to the user line by line.
 *
 * ## The honest caveat
 *
 * MET values are population averages. Two people doing "housework" for an hour
 * do not spend the same energy, and the published figures carry real spread.
 * So the result is returned with a range and is never presented as measured.
 * The values below are approximate, drawn from standard published MET tables.
 */

export type DaySlot = 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export const DAY_SLOTS: { id: DaySlot; label: string; hint: string }[] = [
  { id: 'early_morning', label: 'Early morning', hint: 'Waking up until you leave the house' },
  { id: 'morning', label: 'Morning', hint: 'Getting to work, or your morning at home' },
  { id: 'midday', label: 'Midday', hint: 'The middle of your day, and lunch' },
  { id: 'afternoon', label: 'Afternoon', hint: 'The second half of your working day' },
  { id: 'evening', label: 'Evening', hint: 'Getting home, cooking, family, going out' },
  { id: 'night', label: 'Night', hint: 'Winding down, and sleep' },
];

export interface ActivityOption {
  id: string;
  label: string;
  /** Multiple of resting metabolic rate. Approximate; population average. */
  met: number;
  /** Grouped so the picker does not present forty flat options. */
  group: 'rest' | 'work' | 'moving' | 'home' | 'travel' | 'exercise';
}

/*
 * The catalogue.
 *
 * Chosen for the audience this app is for rather than for a gym-goer: cooking,
 * household work, standing at a counter, riding a two-wheeler, and travelling
 * by bus or train are where most of these users' waking hours actually go, and
 * a list that omits them forces people into "other" and loses the signal.
 */
export const ACTIVITIES: ActivityOption[] = [
  { id: 'sleeping', label: 'Sleeping', met: 0.95, group: 'rest' },
  { id: 'lying_awake', label: 'Lying down, resting', met: 1.0, group: 'rest' },
  { id: 'sitting_screen', label: 'Sitting — phone, TV, reading', met: 1.3, group: 'rest' },
  { id: 'eating', label: 'Eating a meal', met: 1.5, group: 'rest' },

  { id: 'desk_work', label: 'Sitting at a desk or computer', met: 1.3, group: 'work' },
  { id: 'meetings', label: 'Sitting in class or meetings', met: 1.3, group: 'work' },
  { id: 'standing_work', label: 'Standing work — counter, shop, teaching', met: 2.0, group: 'work' },
  { id: 'light_manual', label: 'Light manual work — moving about, light lifting', met: 3.0, group: 'work' },
  { id: 'heavy_manual', label: 'Heavy manual work — construction, farming, loading', met: 5.5, group: 'work' },

  { id: 'cooking', label: 'Cooking', met: 2.0, group: 'home' },
  { id: 'dishes', label: 'Washing up, tidying', met: 1.8, group: 'home' },
  { id: 'cleaning', label: 'Cleaning, sweeping, mopping', met: 3.0, group: 'home' },
  { id: 'laundry', label: 'Washing clothes by hand', met: 3.3, group: 'home' },
  { id: 'childcare', label: 'Looking after children', met: 2.5, group: 'home' },
  { id: 'shopping', label: 'Shopping, running errands', met: 2.3, group: 'home' },

  { id: 'walking_slow', label: 'Walking slowly', met: 2.8, group: 'moving' },
  { id: 'walking_brisk', label: 'Walking briskly', met: 4.3, group: 'moving' },
  { id: 'stairs', label: 'Climbing stairs', met: 8.0, group: 'moving' },
  { id: 'carrying', label: 'Carrying shopping, water, a child', met: 4.0, group: 'moving' },

  { id: 'driving', label: 'Driving a car', met: 2.5, group: 'travel' },
  { id: 'two_wheeler', label: 'Riding a scooter or motorbike', met: 2.5, group: 'travel' },
  { id: 'passenger', label: 'Bus, train or car as a passenger', met: 1.3, group: 'travel' },
  { id: 'cycling_commute', label: 'Cycling to get somewhere', met: 6.8, group: 'travel' },

  { id: 'strength', label: 'Strength training', met: 5.0, group: 'exercise' },
  { id: 'yoga', label: 'Yoga or stretching', met: 2.8, group: 'exercise' },
  { id: 'running', label: 'Running or jogging', met: 8.3, group: 'exercise' },
  { id: 'sport', label: 'Playing a sport', met: 6.0, group: 'exercise' },
];

const BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));

export interface DayEntry {
  slot: DaySlot;
  activityId: string;
  minutes: number;
}

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export interface DayMapResult {
  /** Physical activity level: MET-hours over the day divided by 24. */
  pal: number;
  palLow: number;
  palHigh: number;
  level: ActivityLevel;
  levelLabel: string;
  /** Hours the user actually accounted for. */
  accountedHours: number;
  /** Hours we had to assume, and what we assumed. */
  unaccountedHours: number;
  /** Line-by-line, so the figure can be explained rather than asserted. */
  breakdown: { label: string; hours: number; met: number; metHours: number }[];
  reasons: string[];
  /** True when there is too little to work from. */
  insufficient: boolean;
}

/*
 * Bounds on the result.
 *
 * PAL below about 1.2 is not compatible with being awake and upright, and
 * above about 2.4 describes an endurance athlete or heavy labourer. A day map
 * that computes outside this has almost certainly been mis-entered — someone
 * claiming twelve hours of stair climbing — and clamping is safer than
 * building a calorie target on it.
 */
const PAL_MIN = 1.2;
const PAL_MAX = 2.4;

/** Anything under this and we do not pretend to know. */
const MIN_HOURS_TO_JUDGE = 12;

/**
 * What to assume for hours the user did not describe.
 *
 * Light sitting rather than zero. Unaccounted time is far more often "I forgot
 * to mention I was on my phone" than "I was doing nothing at all", and
 * assuming rest would bias every incomplete day downwards.
 */
const FILLER_MET = 1.4;

/*
 * The incidental-movement allowance.
 *
 * Adding up itemised MET blocks systematically *under*-estimates sedentary
 * days, and the reason is structural rather than a tuning problem. People
 * describe their day in large blocks — "eight hours at a desk" — and nobody
 * itemises standing up, walking to the kitchen, going to the toilet, carrying
 * a laptop to a meeting or fidgeting. That unlogged movement is real and, for
 * a desk worker, substantial.
 *
 * Without this correction a fully-seated day computes to about 1.27, which is
 * close to bed rest and clearly wrong: measured PAL for sedentary office
 * workers sits nearer 1.4-1.5.
 *
 * So a share of the *seated waking* hours is treated as light movement. It is
 * applied only to seated time, which is what makes it self-limiting: someone
 * already doing eight hours of manual work has almost no seated time to
 * uplift, so their figure barely moves. It corrects the case that is wrong
 * without inflating the cases that are right.
 */
const INCIDENTAL_FRACTION = 0.2;
const INCIDENTAL_MET = 2.5;
/** Above this, an entry is real movement and not "sitting still". */
const SEATED_MET_CEILING = 1.5;

export function derivePalFromDay(entries: DayEntry[]): DayMapResult {
  const usable = entries.filter((e) => e.minutes > 0 && BY_ID.has(e.activityId));

  const breakdown = usable.map((e) => {
    const activity = BY_ID.get(e.activityId) as ActivityOption;
    const hours = e.minutes / 60;
    return {
      label: activity.label,
      hours: Math.round(hours * 100) / 100,
      met: activity.met,
      metHours: Math.round(activity.met * hours * 100) / 100,
    };
  });

  const accountedHours = breakdown.reduce((sum, b) => sum + b.hours, 0);

  if (accountedHours < MIN_HOURS_TO_JUDGE) {
    return {
      pal: 1.4,
      palLow: 1.3,
      palHigh: 1.6,
      level: 'light',
      levelLabel: LEVEL_LABELS.light,
      accountedHours: Math.round(accountedHours * 10) / 10,
      unaccountedHours: Math.round((24 - accountedHours) * 10) / 10,
      breakdown,
      reasons: [
        `Only about ${Math.round(accountedHours)} hours of your day are described so far, which ` +
          `is not enough to work out how much you move. Add a few more blocks and this will sharpen up.`,
      ],
      insufficient: true,
    };
  }

  /*
   * More than 24 hours described.
   *
   * People double-count — "cooking" and "looking after children" genuinely
   * overlap. Rather than rejecting the day, scale it back to 24 hours, which
   * preserves the *proportions* they described. Their sense of how the day
   * splits is the useful signal; the absolute totals are not.
   */
  const overflow = accountedHours > 24;
  const scale = overflow ? 24 / accountedHours : 1;

  const metHours = breakdown.reduce((sum, b) => sum + b.metHours * scale, 0);
  const unaccounted = Math.max(0, 24 - accountedHours * scale);

  // Seated *waking* hours only — sleep is not time someone is failing to move.
  const seatedWakingHours = breakdown
    .filter((b) => b.met <= SEATED_MET_CEILING && b.label !== 'Sleeping')
    .reduce((sum, b) => sum + b.hours * scale, 0);

  const incidentalHours = seatedWakingHours * INCIDENTAL_FRACTION;
  const incidentalUplift = incidentalHours * (INCIDENTAL_MET - 1.3);

  const totalMetHours = metHours + unaccounted * FILLER_MET + incidentalUplift;

  const rawPal = totalMetHours / 24;
  const clamped = rawPal > PAL_MAX || rawPal < PAL_MIN;
  const pal = clamp(round2(rawPal), PAL_MIN, PAL_MAX);

  /*
   * The range.
   *
   * ±8% reflects that these are population-average MET values applied to one
   * person's description of a typical day, and that "typical" is itself an
   * approximation. It is a stated assumption, not a measurement.
   */
  const palLow = clamp(round2(pal * 0.92), PAL_MIN, PAL_MAX);
  const palHigh = clamp(round2(pal * 1.08), PAL_MIN, PAL_MAX);

  const level = levelFor(pal);
  const reasons = explain(breakdown, scale, unaccounted, overflow, pal, clamped);

  return {
    pal,
    palLow,
    palHigh,
    level,
    levelLabel: LEVEL_LABELS[level],
    accountedHours: Math.round(accountedHours * 10) / 10,
    unaccountedHours: Math.round(unaccounted * 10) / 10,
    breakdown,
    reasons,
    insufficient: false,
  };
}

const LEVEL_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Mostly seated',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Active',
  very_active: 'Very active',
};

/*
 * PAL bands.
 *
 * These follow the conventional physiological ranges: around 1.4 for a
 * sedentary desk-based day, 1.6 for light activity, 1.8 for moderate, 2.0 and
 * above for physically demanding work or serious training.
 */
function levelFor(pal: number): ActivityLevel {
  if (pal < 1.45) return 'sedentary';
  if (pal < 1.65) return 'light';
  if (pal < 1.85) return 'moderate';
  if (pal < 2.05) return 'active';
  return 'very_active';
}

function explain(
  breakdown: { label: string; hours: number; met: number; metHours: number }[],
  scale: number,
  unaccounted: number,
  overflow: boolean,
  pal: number,
  clamped: boolean,
): string[] {
  const reasons: string[] = [];

  /*
   * Lead with whatever actually drives the number.
   *
   * Ranked by MET-hours *above rest* — (MET - 1) x hours — not by raw
   * MET-hours. Raw totals rank by duration, so seven hours of sleep outranks
   * an hour of brisk walking and the sentence ends up telling someone their
   * movement comes mainly from sleeping. Subtracting the resting baseline is
   * the same correction the energy engine makes when costing activity, and it
   * leaves the ranking measuring what it claims to.
   */
  const ranked = [...breakdown]
    .map((b) => ({ ...b, aboveRest: Math.max(0, (b.met - 1) * b.hours) }))
    .filter((b) => b.aboveRest > 0.15)
    .sort((a, b) => b.aboveRest - a.aboveRest);
  const top = ranked.slice(0, 2).filter((b) => b.hours > 0);
  if (top.length > 0) {
    reasons.push(
      `Most of your day's movement comes from ${top
        .map((b) => `${b.label.toLowerCase()} (${formatHours(b.hours)})`)
        .join(' and ')}.`,
    );
  }

  const seated = breakdown
    .filter((b) => b.met <= 1.5)
    .reduce((sum, b) => sum + b.hours, 0);
  if (seated >= 8) {
    reasons.push(
      `About ${formatHours(seated)} of your day is seated or lying down. That is normal for a lot ` +
        `of jobs, and it is why the walking blocks matter so much.`,
    );
  }

  if (overflow) {
    reasons.push(
      `The blocks you described add up to more than 24 hours, which usually means some of them ` +
        `overlap. We have kept the proportions and scaled them to a real day.`,
    );
  } else if (unaccounted >= 2) {
    reasons.push(
      `About ${formatHours(unaccounted)} of the day is not described, so we have assumed it was ` +
        `spent sitting or pottering about rather than assuming nothing at all.`,
    );
  }

  if (clamped) {
    // A capped figure must not be presented as a computed one.
    reasons.push(
      'The day you described works out higher than we are willing to assume for anyone, so we ' +
        'have capped it. If that looks wrong, check whether any blocks overlap or run longer ' +
        'than they really do.',
    );
  }

  reasons.push(
    `That works out to an activity factor of about ${pal.toFixed(2)} times your resting energy ` +
      `use. This is an estimate from typical values, not a measurement, and we correct it from ` +
      `what your weight actually does.`,
  );

  return reasons;
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  const rounded = Math.round(hours * 2) / 2;
  return `${rounded} hour${rounded === 1 ? '' : 's'}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Activities grouped for the picker. */
export function activitiesByGroup(): Record<string, ActivityOption[]> {
  return ACTIVITIES.reduce<Record<string, ActivityOption[]>>((acc, a) => {
    (acc[a.group] ??= []).push(a);
    return acc;
  }, {});
}

export const GROUP_LABELS: Record<ActivityOption['group'], string> = {
  rest: 'Resting',
  work: 'Work',
  home: 'Home and family',
  moving: 'Getting about on foot',
  travel: 'Travelling',
  exercise: 'Exercise',
};
