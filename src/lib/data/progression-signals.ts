import type { createClient } from '@/lib/supabase/server';
import type { FitnessLevel, ProgressionSignals } from '@/lib/engines/progression';

/**
 * Read the evidence the progression decision runs on.
 *
 * Shared by the page that displays the decision and the action that applies it.
 * They have to agree: a checklist that says "two more sessions" while the
 * server has already promoted someone is worse than either behaviour on its
 * own, and the only reliable way to keep two copies of this logic in step is to
 * not have two copies.
 *
 * Every figure here is measured. Nothing is inferred from a session count.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

export interface LevelState {
  level: FitnessLevel;
  signals: ProgressionSignals;
  /** Feedback since the level changed, oldest first — for the recommender. */
  history: { difficulty: number; pain: 'none' | 'mild_discomfort' | 'pain' }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function readLevelState(supabase: Client, userId: string): Promise<LevelState> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('fitness_level, fitness_level_set_at')
    .eq('user_id', userId)
    .maybeSingle();

  const level = (profile?.fitness_level ?? 2) as FitnessLevel;

  const setAt = profile?.fitness_level_set_at
    ? new Date(profile.fitness_level_set_at as string)
    : new Date();
  const since = setAt.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [feedbackRes, plansRes, flagsRes] = await Promise.all([
    /*
     * Only sessions performed *at this level* count towards leaving it.
     *
     * Counting everything means the sessions that earned a promotion are still
     * on the books afterwards and immediately earn the next one.
     */
    supabase
      .from('session_feedback')
      .select('difficulty, pain')
      .eq('user_id', userId)
      .gte('performed_on', since)
      .order('performed_on', { ascending: true })
      .limit(20),
    supabase
      .from('workout_plans')
      .select('status')
      .eq('user_id', userId)
      .gte('plan_date', since)
      .lte('plan_date', today)
      .neq('status', 'rest'),
    supabase
      .from('safety_flags')
      .select('restricts')
      .eq('user_id', userId)
      .is('resolved_at', null),
  ]);

  const history = (feedbackRes.data ?? []).map((r) => ({
    difficulty: Number(r.difficulty),
    pain: r.pain as 'none' | 'mild_discomfort' | 'pain',
  }));

  // Adherence, measured. A rest day is not something to adhere to, so those
  // rows are excluded rather than counted as free credit.
  const planned = plansRes.data ?? [];
  const done = planned.filter((p) => p.status === 'completed' || p.status === 'partial').length;
  const consistency = planned.length === 0 ? 0 : done / planned.length;

  const daysAtLevel = Math.max(
    0,
    Math.floor((Date.now() - setAt.getTime()) / DAY_MS),
  );

  return {
    level,
    history,
    signals: {
      sessionsAtLevel: history.length,
      recentDifficulty: history.map((h) => h.difficulty),
      recentPain: history.map((h) => h.pain),
      consistency,
      plannedSessions: planned.length,
      daysAtLevel,
      restrictions: (flagsRes.data ?? []).flatMap((f) => (f.restricts as string[]) ?? []),
    },
  };
}
