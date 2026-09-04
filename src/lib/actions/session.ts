'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { readLevelState } from '@/lib/data/progression-signals';
import {
  assessFitnessLevel,
  decideProgression,
  type AssessmentAnswers,
} from '@/lib/engines/progression';

/**
 * Recording how a session went, and acting on it.
 *
 * This is the half of the loop that makes the other half worth having: without
 * feedback the progression engine is guessing, and a system that guesses about
 * difficulty will keep prescribing sessions someone has already stopped doing.
 */

export type SessionResult = { ok: true; message: string } | { ok: false; error: string };

const feedbackSchema = z.object({
  workoutPlanId: z.string().uuid().optional(),
  videoId: z.string().uuid().optional(),
  /** 1 easy → 5 too difficult. */
  difficulty: z.number().int().min(1).max(5),
  pain: z.enum(['none', 'mild_discomfort', 'pain']).default('none'),
  painLocation: z.string().max(120).optional(),
  completed: z.boolean().default(true),
  completedRatio: z.number().min(0).max(1).optional(),
  actualMinutes: z.number().int().min(0).max(300).optional(),
  notes: z.string().max(500).optional(),
});

/**
 * Save how a session felt, then decide whether the level should move.
 *
 * The decision is made server-side from stored history, not from anything the
 * client sends — a client that can post its own level could hand a beginner an
 * advanced session, which is the one outcome this whole system exists to
 * prevent.
 */
export async function logSessionFeedback(input: unknown): Promise<SessionResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that feedback.' };
  const f = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  const { error } = await supabase.from('session_feedback').insert({
    user_id: userId,
    workout_plan_id: f.workoutPlanId ?? null,
    video_id: f.videoId ?? null,
    difficulty: f.difficulty,
    pain: f.pain,
    pain_location: f.painLocation ?? null,
    completed: f.completed,
    completed_ratio: f.completedRatio ?? null,
    actual_minutes: f.actualMinutes ?? null,
    notes: f.notes ?? null,
  });

  if (error) {
    console.error('session feedback failed', error);
    return { ok: false, error: "We couldn't save that. Please try again." };
  }

  // Mark the session done, so adherence and the week grid agree with reality.
  if (f.workoutPlanId) {
    await supabase
      .from('workout_plans')
      .update({
        status: f.completed ? 'completed' : 'partial',
        actual_minutes: f.actualMinutes ?? null,
      })
      .eq('id', f.workoutPlanId)
      .eq('user_id', userId);
  }

  const outcome = await reevaluateLevel(supabase, userId);

  revalidatePath('/activity');
  revalidatePath('/today');

  // Pain is surfaced above everything else, including a level change.
  if (f.pain === 'pain') {
    return {
      ok: true,
      message:
        'Logged, and noted that it hurt. We will not add difficulty while that is the case. If it ' +
        'is sharp or it persists, please get it looked at rather than training through it.',
    };
  }

  return { ok: true, message: outcome ?? 'Logged. Thanks — that is what tunes the next session.' };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Re-run the progression decision and apply it.
 *
 * Returns the message to show, or null when nothing changed and there is
 * nothing worth saying about it.
 */
async function reevaluateLevel(supabase: Client, userId: string): Promise<string | null> {
  const { level, signals } = await readLevelState(supabase, userId);
  if (signals.sessionsAtLevel === 0) return null;

  const outcome = decideProgression(level, signals);

  if (outcome.toLevel !== level) {
    // `fitness_level_set_at` is maintained by a trigger, so the evidence window
    // resets here without this code having to remember to do it.
    await supabase
      .from('profiles')
      .update({ fitness_level: outcome.toLevel })
      .eq('user_id', userId);
    return outcome.message;
  }

  // Only speak up on a hold if there is something useful to say.
  return outcome.decision === 'hold_for_pain' ? outcome.message : null;
}

/* ------------------------------------------------------------------ */
/* Assessment                                                          */
/* ------------------------------------------------------------------ */

const assessmentSchema = z.object({
  recentTraining: z.enum(['never', 'occasional', 'two_three', 'four_plus']).optional(),
  squats10: z.enum(['yes', 'no', 'unsure']).optional(),
  plank20: z.enum(['yes', 'no', 'unsure']).optional(),
  liftedBefore: z.enum(['yes', 'no']).optional(),
});

/**
 * Store an assessment and set the starting level.
 *
 * The raw answers are kept alongside the derived level so it can be recomputed
 * if the rubric changes — otherwise a tweak to the scoring would strand every
 * existing user on a number nobody can explain.
 */
export async function saveFitnessAssessment(input: unknown): Promise<SessionResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = assessmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read those answers.' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const result = assessFitnessLevel(parsed.data as AssessmentAnswers);

  const { error } = await supabase.from('fitness_assessments').insert({
    user_id: auth.user.id,
    answers: parsed.data,
    assessed_level: result.level,
    score: result.score,
    reasons: result.reasons,
  });

  if (error) {
    console.error('assessment save failed', error);
    return { ok: false, error: "We couldn't save that. Please try again." };
  }

  await supabase
    .from('profiles')
    .update({ fitness_level: result.level })
    .eq('user_id', auth.user.id);

  revalidatePath('/activity');
  revalidatePath('/today');

  return { ok: true, message: `${result.name}. ${result.message}` };
}
