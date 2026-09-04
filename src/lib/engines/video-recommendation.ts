import type { FitnessLevel } from './progression';

/**
 * Choosing today's session.
 *
 * "Don't choose a workout — the app chooses the right one for you." The whole
 * value is in that sentence, and it only holds if the choice is defensible, so
 * every recommendation carries the reasons it was picked and the app can show
 * them on request.
 *
 * A hard rule: nothing unreviewed is ever recommended. A library assembled from
 * whatever a search returned will eventually hand a beginner with a bad back a
 * jumping burpee video, and the metadata that would have caught it is exactly
 * the metadata nobody fills in for scraped content.
 */

export type Track =
  | 'strength'
  | 'mobility'
  | 'walking'
  | 'low_impact_cardio'
  | 'yoga'
  | 'dance'
  | 'sport'
  | 'stretching'
  | 'recovery';

export type Equipment = 'none' | 'bands' | 'dumbbells' | 'home_basic' | 'machines' | 'full_gym';
export type Impact = 'none' | 'low' | 'moderate' | 'high';

export interface VideoRecord {
  id: string;
  slug: string;
  title: string;
  durationMinutes: number;
  track: Track;
  goalFit: string[];
  levelMin: FitnessLevel;
  levelMax: FitnessLevel;
  equipment: Equipment;
  impactLevel: Impact;
  apartmentFriendly: boolean;
  contraindications: string[];
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'retired';
}

export interface RecommendationContext {
  level: FitnessLevel;
  goal: string;
  /** What the user actually has. */
  equipment: Equipment;
  /** Minutes available today. The single most useful filter there is. */
  minutesAvailable: number;
  /** Joints or conditions to avoid loading, from the safety layer. */
  injuries: string[];
  restrictions?: string[];
  /** Upstairs flat, thin floors, sleeping baby — no jumping. */
  apartmentOnly?: boolean;
  /** Tracks done in the last week, so the same session is not served daily. */
  recentTracks?: Track[];
  /** "I don't feel like it." Switches to the smallest thing that still counts. */
  lowMotivation?: boolean;
}

export interface Recommendation {
  video: VideoRecord | null;
  /** Shown under "Why this one?" — the app's argument, in plain words. */
  because: string[];
  /** Offered alongside, so the choice is never take-it-or-leave-it. */
  alternatives: { label: string; video: VideoRecord }[];
  /** Set when nothing in the library fits, explaining what is missing. */
  shortfall: string | null;
}

/** What equipment implies about what else is usable. A full gym can do a
 *  bodyweight session; the reverse is not true. */
const EQUIPMENT_IMPLIES: Record<Equipment, Equipment[]> = {
  none: ['none'],
  bands: ['none', 'bands'],
  dumbbells: ['none', 'dumbbells'],
  home_basic: ['none', 'bands', 'dumbbells', 'home_basic'],
  machines: ['none', 'bands', 'dumbbells', 'home_basic', 'machines'],
  full_gym: ['none', 'bands', 'dumbbells', 'home_basic', 'machines', 'full_gym'],
};

const IMPACT_ORDER: Impact[] = ['none', 'low', 'moderate', 'high'];

/** Which tracks suit which goal. Fat loss is not "do HIIT" — strength plus
 *  walking retains more muscle and is far easier to keep doing. */
const GOAL_TRACKS: Record<string, Track[]> = {
  fat_loss: ['strength', 'walking', 'low_impact_cardio'],
  weight_loss: ['strength', 'walking', 'low_impact_cardio'],
  recomposition: ['strength', 'mobility'],
  waist_reduction: ['strength', 'walking'],
  fitness: ['low_impact_cardio', 'strength', 'walking'],
  strength: ['strength'],
  stamina: ['low_impact_cardio', 'walking'],
  health_habits: ['walking', 'mobility', 'strength'],
  mobility: ['mobility', 'stretching', 'yoga'],
};

/**
 * Pick a session.
 *
 * Filters are applied hardest-first: safety, then equipment, then the time the
 * person actually has. Time is a hard filter, not a preference — a 30-minute
 * session offered to someone with 12 minutes does not get done at all, and a
 * skipped session is worse than an easy one.
 */
export function recommendSession(
  library: VideoRecord[],
  context: RecommendationContext,
): Recommendation {
  const because: string[] = [];
  const restricted = new Set(context.restrictions ?? []);

  // --- Hard gate: nothing unreviewed reaches a user. ----------------------
  let pool = library.filter((v) => v.reviewStatus === 'approved');
  if (pool.length === 0) {
    return {
      video: null,
      because: [],
      alternatives: [],
      shortfall:
        'No reviewed videos are available yet. Written instructions for every exercise are on ' +
        'the session itself — we would rather show you those than link to a video nobody here ' +
        'has checked.',
    };
  }

  // --- Safety. Contraindications and withheld capabilities. ---------------
  const injuries = new Set(context.injuries.map((i) => i.toLowerCase().trim()));
  pool = pool.filter((v) => !v.contraindications.some((c) => injuries.has(c.toLowerCase())));

  if (restricted.has('high_intensity_training')) {
    pool = pool.filter((v) => v.impactLevel === 'none' || v.impactLevel === 'low');
    because.push('Kept to low impact because of a safety note on your account.');
  }

  if (context.apartmentOnly) {
    pool = pool.filter((v) => v.apartmentFriendly);
    because.push('No jumping — this works in a flat with neighbours below.');
  }

  // --- Motivation floor. The smallest thing that still counts. ------------
  if (context.lowMotivation) {
    const gentle = pool
      .filter((v) => v.durationMinutes <= 12)
      .filter((v) => ['mobility', 'walking', 'stretching', 'recovery'].includes(v.track))
      .sort((a, b) => a.durationMinutes - b.durationMinutes);

    if (gentle.length > 0) {
      return {
        video: gentle[0],
        because: [
          'You said you are not feeling it today, so this is the smallest version that still counts.',
          `${gentle[0].durationMinutes} minutes. Doing this beats skipping, and it keeps the habit intact.`,
        ],
        alternatives: gentle.slice(1, 3).map((v) => ({ label: `${v.durationMinutes} min`, video: v })),
        shortfall: null,
      };
    }
  }

  // --- Equipment. -----------------------------------------------------------
  const usable = new Set(EQUIPMENT_IMPLIES[context.equipment]);
  pool = pool.filter((v) => usable.has(v.equipment));

  // --- Level. The session should sit at the level, not near it. -----------
  pool = pool.filter((v) => context.level >= v.levelMin && context.level <= v.levelMax);

  // --- Time. Hard filter, with a small tolerance. -------------------------
  const budget = Math.max(5, context.minutesAvailable);
  pool = pool.filter((v) => v.durationMinutes <= budget);

  if (pool.length === 0) {
    return {
      video: null,
      because,
      alternatives: [],
      shortfall:
        `Nothing in the library fits ${budget} minutes at your level with the equipment you have. ` +
        `That is a gap in our library, not a problem with your setup — the written session on ` +
        `your plan still works.`,
    };
  }

  // --- Rank what is left. --------------------------------------------------
  const preferred = GOAL_TRACKS[context.goal] ?? GOAL_TRACKS.fat_loss;
  const recent = context.recentTracks ?? [];

  const scored = pool
    .map((video) => {
      let score = 0;

      const goalRank = preferred.indexOf(video.track);
      if (goalRank === 0) score += 3;
      else if (goalRank > 0) score += 2;

      if (video.goalFit.includes(context.goal)) score += 1;

      // Prefer using most of the time available — but never exceeding it.
      score += (video.durationMinutes / budget) * 2;

      // Nudge away from whatever was done most recently. Same session every day
      // is how people get bored, and boredom ends more plans than difficulty.
      const timesRecently = recent.filter((t) => t === video.track).length;
      score -= timesRecently * 0.75;

      // At the lowest level, prefer the gentlest option available.
      if (context.level === 1) score -= IMPACT_ORDER.indexOf(video.impactLevel) * 0.5;

      return { video, score };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = scored[0].video;

  because.push(
    `${chosen.durationMinutes} minutes, which fits the ${budget} you said you had.`,
    `Matched to ${context.equipment === 'none' ? 'no equipment' : context.equipment.replace('_', ' ')}.`,
    `Sits at your current level rather than above it.`,
  );
  if (preferred.indexOf(chosen.track) === 0) {
    because.push(`${trackName(chosen.track)} is the highest-value track for your goal.`);
  }

  return {
    video: chosen,
    because,
    // Always offer a shorter and an easier way out. A single take-it-or-leave-it
    // recommendation gets left far more often than it gets taken.
    alternatives: buildAlternatives(scored.map((s) => s.video), chosen),
    shortfall: null,
  };
}

function buildAlternatives(
  ranked: VideoRecord[],
  chosen: VideoRecord,
): { label: string; video: VideoRecord }[] {
  const out: { label: string; video: VideoRecord }[] = [];

  const shorter = ranked.find((v) => v.id !== chosen.id && v.durationMinutes < chosen.durationMinutes);
  if (shorter) out.push({ label: `Shorter — ${shorter.durationMinutes} min`, video: shorter });

  const gentler = ranked.find(
    (v) =>
      v.id !== chosen.id &&
      IMPACT_ORDER.indexOf(v.impactLevel) < IMPACT_ORDER.indexOf(chosen.impactLevel),
  );
  if (gentler) out.push({ label: 'Easier on the joints', video: gentler });

  const different = ranked.find((v) => v.id !== chosen.id && v.track !== chosen.track);
  if (different && out.length < 3) {
    out.push({ label: `Something else — ${trackName(different.track)}`, video: different });
  }

  return out.slice(0, 3);
}

export function trackName(track: Track): string {
  return {
    strength: 'Strength',
    mobility: 'Mobility',
    walking: 'Walking',
    low_impact_cardio: 'Low-impact cardio',
    yoga: 'Yoga',
    dance: 'Dance',
    sport: 'Sport',
    stretching: 'Stretching',
    recovery: 'Recovery',
  }[track];
}

/** The time options offered on the "how long have you got?" control. */
export const TIME_OPTIONS = [
  { minutes: 5, label: '5 min', detail: 'Quick mobility' },
  { minutes: 10, label: '10 min', detail: 'Mini session' },
  { minutes: 15, label: '15 min', detail: 'Short full body' },
  { minutes: 20, label: '20 min', detail: 'Strength' },
  { minutes: 30, label: '30 min', detail: 'Full session' },
  { minutes: 45, label: '45 min', detail: 'Complete training' },
] as const;
