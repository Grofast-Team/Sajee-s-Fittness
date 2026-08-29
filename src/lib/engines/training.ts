/**
 * Weekly training plan generation.
 *
 * Two ideas drive the layout:
 *
 * 1. **Spacing beats volume for a beginner.** Three sessions spread Monday,
 *    Wednesday, Friday produce better adherence and better recovery than three
 *    crammed into a weekend. So sessions are distributed, not stacked.
 *
 * 2. **The plan is capped below what the user asks for when experience does not
 *    support it.** Someone who has never trained saying "six days a week" is
 *    describing motivation, not capacity. We give them what they will still be
 *    doing in week five.
 */

export type SessionKind = 'strength' | 'walk' | 'sport' | 'mobility' | 'rest';

export interface PlannedSession {
  /** 0 = Monday. Weeks start Monday because most people's do. */
  dayIndex: number;
  kind: SessionKind;
  label: string;
  workoutSlug: string | null;
  minutes: number;
}

export interface TrainingPlanInput {
  /** What the user said they can do. May be reduced. */
  requestedDays: number;
  experience: 'none' | 'beginner' | 'returning' | 'intermediate' | 'advanced';
  equipment: 'none' | 'bands' | 'dumbbells' | 'home_basic' | 'machines' | 'full_gym';
  sessionMinutes?: number;
  /** Withheld capabilities from the safety layer. */
  restrictions?: string[];
  /** Activities the user said they enjoy. Enjoyment predicts adherence better
   *  than almost anything else we could ask about. */
  enjoys?: string[];
}

export interface TrainingPlan {
  sessions: PlannedSession[];
  strengthDays: number;
  wasReduced: boolean;
  explanation: string;
}

/** Ceiling on strength days by experience. Not a judgement — a survival rate. */
export const STRENGTH_DAY_CAP: Record<TrainingPlanInput['experience'], number> = {
  none: 3,
  beginner: 3,
  returning: 4,
  intermediate: 5,
  advanced: 6,
};

/**
 * Which weekdays get the strength sessions.
 *
 * Hand-written rather than computed, because the good answers are not evenly
 * spaced — three days is Mon/Wed/Fri, not Mon/Wed/Sat — and a formula that
 * produced the latter would be worse for the sake of being clever.
 */
const STRENGTH_LAYOUT: Record<number, number[]> = {
  0: [],
  1: [2],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
};

function workoutFor(equipment: TrainingPlanInput['equipment'], index: number): string {
  if (equipment === 'dumbbells' || equipment === 'home_basic' || equipment === 'machines' || equipment === 'full_gym') {
    return 'dumbbell-full-body';
  }
  // Alternating A/B keeps a two- or three-day week from becoming monotonous.
  return index % 2 === 0 ? 'home-full-body-a' : 'home-full-body-b';
}

export function buildWeek(input: TrainingPlanInput): TrainingPlan {
  const restricted = new Set(input.restrictions ?? []);
  const cap = STRENGTH_DAY_CAP[input.experience];
  const requested = Math.max(0, Math.min(7, Math.round(input.requestedDays)));

  // A cardiovascular or post-surgical restriction removes loaded strength work
  // entirely until a clinician says otherwise.
  const strengthAllowed = !restricted.has('high_intensity_training');
  const strengthDays = strengthAllowed ? Math.min(requested, cap) : 0;
  const wasReduced = strengthDays < requested;

  const minutes =
    input.sessionMinutes && input.sessionMinutes >= 15
      ? Math.min(input.sessionMinutes, 60)
      : 25;

  const strengthOn = new Set(STRENGTH_LAYOUT[strengthDays] ?? []);
  const sessions: PlannedSession[] = [];

  // Sport goes on Saturday when the user named one they enjoy — it is the day
  // people actually have time, and enjoyment is the point.
  const sport = (input.enjoys ?? []).find((a) =>
    ['badminton', 'cricket', 'football', 'swimming', 'cycling', 'dancing', 'running'].includes(a),
  );

  for (let day = 0; day < 7; day++) {
    if (strengthOn.has(day)) {
      const index = [...strengthOn].indexOf(day);
      sessions.push({
        dayIndex: day,
        kind: 'strength',
        label: 'Strength session',
        workoutSlug: workoutFor(input.equipment, index),
        minutes,
      });
      continue;
    }

    if (day === 5 && sport) {
      sessions.push({
        dayIndex: day,
        kind: 'sport',
        label: sport.charAt(0).toUpperCase() + sport.slice(1),
        workoutSlug: null,
        minutes: 45,
      });
      continue;
    }

    // Sunday is rest. Rest is part of the plan, not an absence of one.
    if (day === 6) {
      sessions.push({ dayIndex: day, kind: 'rest', label: 'Rest', workoutSlug: null, minutes: 0 });
      continue;
    }

    sessions.push({
      dayIndex: day,
      kind: 'walk',
      label: strengthDays === 0 ? 'Walk' : 'Recovery walk',
      workoutSlug: null,
      minutes: 25,
    });
  }

  return {
    sessions,
    strengthDays,
    wasReduced,
    explanation: explain(strengthDays, requested, wasReduced, strengthAllowed, input.experience),
  };
}

function explain(
  strengthDays: number,
  requested: number,
  wasReduced: boolean,
  strengthAllowed: boolean,
  experience: TrainingPlanInput['experience'],
): string {
  if (!strengthAllowed) {
    return (
      'We have built this week around walking and gentle movement rather than strength training, ' +
      'because of something you told us during setup. Once you have clearance from your doctor we ' +
      'can add resistance work back in.'
    );
  }

  if (strengthDays === 0) {
    return (
      'No strength sessions this week — just walking. That is a perfectly good place to start, and ' +
      'you can add a session whenever you want one.'
    );
  }

  const base =
    `${strengthDays} strength session${strengthDays === 1 ? '' : 's'}, spread out across the week ` +
    `with walking on the days between. The spacing is deliberate: your muscles adapt during the ` +
    `rest, not during the session.`;

  if (!wasReduced) return base;

  return (
    `${base} You asked for ${requested} days and we have set ${strengthDays}. ` +
    (experience === 'none' || experience === 'beginner'
      ? 'Starting below what you think you can manage is the single most reliable way to still be ' +
        'training in two months. We will add days as this gets easy.'
      : 'We would rather build up from here than have you stop in three weeks.')
  );
}

/** Monday-based day names, matching `dayIndex`. */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** The Monday of the week containing `date`, as `YYYY-MM-DD`. */
export function weekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay() is 0 for Sunday; shift so Monday is 0.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

/** The date of `dayIndex` within the week beginning `weekStartIso`. */
export function dateForDay(weekStartIso: string, dayIndex: number): string {
  const d = new Date(`${weekStartIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toISOString().slice(0, 10);
}
