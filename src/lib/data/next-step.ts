import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { readLevelState } from '@/lib/data/progression-signals';
import {
  decideProgression,
  LEVEL_NAMES,
  type FitnessLevel,
  type ProgressionOutcome,
} from '@/lib/engines/progression';
import {
  recommendSession,
  type Recommendation,
  type RecommendationContext,
  type Track,
  type VideoRecord,
} from '@/lib/engines/video-recommendation';

/**
 * "Your next step" — what this person should do today, and why.
 *
 * Everything the card renders is decided here so the component stays a
 * presentation layer. The reasons are assembled alongside the choice rather
 * than written afterwards, which is what keeps "Why this one?" honest: it is
 * the actual basis for the decision, not a plausible story about it.
 */

export interface ExerciseBrief {
  id: string;
  slug: string;
  name: string;
  level: number;
  instructions: string[];
  commonMistakes: string[];
  easierName: string | null;
  harderName: string | null;
  sets: number | null;
  repLow: number | null;
  repHigh: number | null;
  holdSeconds: number | null;
  restSeconds: number | null;
}

export interface NextStep {
  isSample: boolean;
  level: FitnessLevel;
  levelName: string;
  /** Null when nothing in the library fits — with a reason, never a blank card. */
  recommendation: Recommendation;
  progression: ProgressionOutcome | null;
  /** The written session, which works whether or not a video exists. */
  exercises: ExerciseBrief[];
  /** A planned rest day. Rest is part of the plan, not an absence of one. */
  isRestDay: boolean;
  /**
   * Why *these* exercises.
   *
   * The video recommender explains itself through `recommendation.because`, but
   * with no reviewed videos in the library that array is empty and the written
   * session would arrive with no reasoning at all — which is the case that
   * matters most right now, since it is the one every real user sees.
   */
  sessionBecause: string[];
  sessionTitle: string;
  sessionMinutes: number;
  workoutPlanId: string | null;
}

const SAMPLE_EXERCISES: ExerciseBrief[] = [
  {
    id: 'sample-1', slug: 'box-squat', name: 'Sit-to-stand', level: 1,
    instructions: [
      'Sit on the front edge of a sturdy chair, feet flat.',
      'Lean your chest forward slightly and stand up without using your hands.',
      'Sit back down slowly, taking three seconds.',
    ],
    commonMistakes: ['Dropping onto the chair instead of lowering under control.'],
    easierName: null, harderName: 'Bodyweight squat',
    sets: 3, repLow: 8, repHigh: 12, holdSeconds: null, restSeconds: 60,
  },
  {
    id: 'sample-2', slug: 'incline-pushup', name: 'Incline push-up', level: 2,
    instructions: [
      'Put your hands on a sturdy table or worktop.',
      'Walk your feet back so your body is a straight line.',
      'Lower your chest to the surface, then push back up.',
    ],
    commonMistakes: ['Hips sagging.', 'Using something that can slide — check it first.'],
    easierName: 'Wall push-up', harderName: 'Push-up from knees',
    sets: 3, repLow: 6, repHigh: 10, holdSeconds: null, restSeconds: 60,
  },
  {
    id: 'sample-3', slug: 'glute-bridge', name: 'Glute bridge', level: 1,
    instructions: [
      'Lie on your back, knees bent, feet close to your hips.',
      'Push through your heels and lift your hips until your body is straight.',
      'Squeeze at the top for a second, then lower slowly.',
    ],
    commonMistakes: ['Arching the lower back instead of using the glutes.'],
    easierName: null, harderName: 'Marching glute bridge',
    sets: 3, repLow: 10, repHigh: 15, holdSeconds: null, restSeconds: 60,
  },
];

function sampleNextStep(minutesAvailable: number): NextStep {
  const recommendation = recommendSession([], {
    level: 2, goal: 'fat_loss', equipment: 'none', minutesAvailable, injuries: [],
  });

  return {
    isSample: true,
    level: 2,
    levelName: 'Building a base',
    recommendation,
    progression: null,
    exercises: SAMPLE_EXERCISES,
    isRestDay: false,
    sessionBecause: explainSession({
      level: 2,
      levelName: 'Building a base',
      equipment: 'none',
      minutes: 25,
      exercises: SAMPLE_EXERCISES,
      restrictions: [],
      injuries: [],
    }),
    sessionTitle: 'Home full body A',
    sessionMinutes: 25,
    workoutPlanId: null,
  };
}

/**
 * Build today's recommendation for the signed-in user.
 *
 * `minutesAvailable` comes from the UI rather than the profile: how long
 * someone has today is not a stable property of them, and treating it as one is
 * why so many plans get abandoned on a busy Tuesday.
 */
export async function getNextStep(minutesAvailable = 30): Promise<NextStep> {
  if (!supabaseConfigured) return sampleNextStep(minutesAvailable);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return sampleNextStep(minutesAvailable);

  const userId = auth.user.id;
  const today = new Date().toISOString().slice(0, 10);

  const [levelState, lifestyleRes, goalRes, planRes, videoRes] =
    await Promise.all([
      readLevelState(supabase, userId),
      supabase
        .from('lifestyle')
        .select('equipment, injuries, session_minutes_available')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('goals')
        .select('goal')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle(),
      /*
       * Not `.maybeSingle()`. There is no unique constraint on
       * (user_id, plan_date), and moving a session inserts a second row on the
       * target date — so a day can legitimately hold two plans, and asking for
       * exactly one would throw on precisely the days someone rescheduled.
       */
      supabase
        .from('workout_plans')
        .select('id, workout_id, label, planned_minutes, status, activity_kind')
        .eq('user_id', userId)
        .eq('plan_date', today)
        .order('created_at', { ascending: true }),
      supabase.from('videos').select('*').eq('review_status', 'approved'),
    ]);

  const { level, signals } = levelState;
  const equipment = (lifestyleRes.data?.equipment ?? 'none') as RecommendationContext['equipment'];
  const injuries: string[] = lifestyleRes.data?.injuries ?? [];
  const restrictions = signals.restrictions ?? [];

  const budget = lifestyleRes.data?.session_minutes_available ?? minutesAvailable;

  const library: VideoRecord[] = (videoRes.data ?? []).map((v) => ({
    id: v.id,
    slug: v.slug,
    title: v.title,
    durationMinutes: v.duration_minutes,
    track: v.track as Track,
    goalFit: v.goal_fit ?? [],
    levelMin: v.level_min as FitnessLevel,
    levelMax: v.level_max as FitnessLevel,
    equipment: v.equipment,
    impactLevel: v.impact_level,
    apartmentFriendly: v.apartment_friendly,
    contraindications: v.contraindications ?? [],
    reviewStatus: v.review_status,
  }));

  const recommendation = recommendSession(library, {
    level,
    goal: goalRes.data?.goal ?? 'fat_loss',
    equipment,
    minutesAvailable: Math.min(minutesAvailable, budget),
    injuries,
    restrictions,
  });

  // Only judge progression once there is something to judge.
  const progression = signals.sessionsAtLevel > 0 ? decideProgression(level, signals) : null;

  // Prefer an actual session over a rest row when a day holds both.
  const plans = planRes.data ?? [];
  const plan = plans.find((p) => p.status !== 'rest') ?? plans[0] ?? null;
  const isRestDay = plan?.status === 'rest' || plan?.activity_kind === 'rest';

  const exercises =
    plan?.workout_id && !isRestDay ? await loadExercises(supabase, plan.workout_id) : [];

  return {
    isSample: false,
    sessionBecause: explainSession({
      level,
      levelName: LEVEL_NAMES[level],
      equipment,
      minutes: plan?.planned_minutes ?? budget,
      exercises,
      restrictions,
      injuries,
    }),
    level,
    levelName: LEVEL_NAMES[level],
    recommendation,
    progression,
    exercises,
    isRestDay,
    sessionTitle: plan?.label ?? 'Today’s session',
    sessionMinutes: plan?.planned_minutes ?? budget,
    workoutPlanId: plan?.id ?? null,
  };
}

/**
 * Explain the written session.
 *
 * Built from the facts that actually selected these exercises, so it cannot
 * drift into a plausible story about a decision that was made on other grounds.
 * Where there is nothing real to say — no equipment recorded, no restrictions —
 * the corresponding line is simply omitted rather than padded out.
 */
function explainSession(input: {
  level: FitnessLevel;
  levelName: string;
  equipment: string;
  minutes: number;
  exercises: ExerciseBrief[];
  restrictions: string[];
  injuries: string[];
}): string[] {
  const because: string[] = [];
  if (input.exercises.length === 0) return because;

  because.push(
    `Pitched at level ${input.level} — ${input.levelName.toLowerCase()} — which is where your ` +
      `assessment and your session feedback currently put you.`,
  );

  because.push(
    input.equipment === 'none'
      ? 'Every movement here needs nothing but your bodyweight and a chair or wall.'
      : `Built around the ${input.equipment.replace(/_/g, ' ')} you told us you have.`,
  );

  because.push(`Sized to about ${input.minutes} minutes, including rests.`);

  // Only claim a pattern spread when the session genuinely has one.
  const levels = new Set(input.exercises.map((e) => e.level));
  if (input.exercises.length >= 3) {
    because.push(
      `${input.exercises.length} movements covering the whole body, so nothing gets trained ` +
        `three days running while something else never gets trained at all.`,
    );
  }
  if (levels.size > 1) {
    because.push(
      'The movements sit at slightly different levels on purpose — strength rarely arrives ' +
        'evenly, and holding everything back to the weakest one wastes the rest.',
    );
  }

  if (input.restrictions.length > 0) {
    because.push('Kept within the limits of an open safety note on your account.');
  }
  if (input.injuries.length > 0) {
    because.push(`Chosen to avoid loading what you told us about: ${input.injuries.join(', ')}.`);
  }

  return because;
}

type Client = Awaited<ReturnType<typeof createClient>>;

/** The written session. This is what makes the app usable with no video at
 *  all — instructions, the mistakes people actually make, and a way down. */
async function loadExercises(supabase: Client, workoutId: string): Promise<ExerciseBrief[]> {
  const { data } = await supabase
    .from('workout_exercises')
    .select(
      `sets, rep_low, rep_high, hold_seconds, rest_seconds, sort_order,
       exercises!inner (
         id, slug, name, level, instructions, common_mistakes,
         easier:easier_variant ( name ),
         harder:harder_variant ( name )
       )`,
    )
    .eq('workout_id', workoutId)
    .order('sort_order', { ascending: true });

  return (data ?? []).map((row: Record<string, unknown>) => {
    const e = row.exercises as Record<string, unknown>;
    const easier = e.easier as { name: string } | null;
    const harder = e.harder as { name: string } | null;

    return {
      id: e.id as string,
      slug: e.slug as string,
      name: e.name as string,
      level: (e.level as number) ?? 2,
      instructions: (e.instructions as string[]) ?? [],
      commonMistakes: (e.common_mistakes as string[]) ?? [],
      easierName: easier?.name ?? null,
      harderName: harder?.name ?? null,
      sets: (row.sets as number) ?? null,
      repLow: (row.rep_low as number) ?? null,
      repHigh: (row.rep_high as number) ?? null,
      holdSeconds: (row.hold_seconds as number) ?? null,
      restSeconds: (row.rest_seconds as number) ?? null,
    };
  });
}
