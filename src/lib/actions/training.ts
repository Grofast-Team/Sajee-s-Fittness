'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { buildWeek, dateForDay, weekStart } from '@/lib/engines/training';
import { restrictionsFrom, type SafetyFlag } from '@/lib/engines/safety';

/**
 * Scheduling and completing training sessions.
 *
 * The week is generated server-side from the user's stored profile, so the
 * experience cap and the safety restrictions in `buildWeek` cannot be bypassed
 * by a crafted request.
 */

export type TrainingResult = { ok: true; message: string } | { ok: false; error: string };

function notConfigured(): TrainingResult {
  return { ok: false, error: 'Supabase is not configured on this deployment.' };
}

/**
 * Create this week's sessions if they do not already exist.
 *
 * Idempotent: existing rows are left alone, so calling it twice does not wipe a
 * completed session. That matters because it is called on page load.
 */
export async function ensureWeekPlanned(forDate?: string): Promise<TrainingResult> {
  if (!supabaseConfigured) return notConfigured();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  const monday = weekStart(forDate ? new Date(`${forDate}T00:00:00Z`) : new Date());
  const sunday = dateForDay(monday, 6);

  const { data: existing } = await supabase
    .from('workout_plans')
    .select('plan_date')
    .eq('user_id', userId)
    .gte('plan_date', monday)
    .lte('plan_date', sunday);

  if (existing && existing.length > 0) {
    return { ok: true, message: 'This week is already planned.' };
  }

  const [lifestyleRes, profileRes, flagsRes, workoutsRes] = await Promise.all([
    supabase
      .from('lifestyle')
      .select('training_days_per_week, equipment, session_minutes_available')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('profiles').select('experience').eq('user_id', userId).maybeSingle(),
    supabase
      .from('safety_flags')
      .select('code, severity, reason, guidance, restricts')
      .eq('user_id', userId)
      .is('resolved_at', null),
    supabase.from('workouts').select('id, slug'),
  ]);

  const restrictions = [...restrictionsFrom((flagsRes.data ?? []) as SafetyFlag[])];

  const plan = buildWeek({
    requestedDays: lifestyleRes.data?.training_days_per_week ?? 2,
    experience: (profileRes.data?.experience ?? 'none') as never,
    equipment: (lifestyleRes.data?.equipment ?? 'none') as never,
    sessionMinutes: lifestyleRes.data?.session_minutes_available ?? undefined,
    restrictions,
  });

  const workoutIdBySlug = new Map(
    (workoutsRes.data ?? []).map((w) => [w.slug as string, w.id as string]),
  );

  // Only schedule from today onwards.
  //
  // Someone who signs up on a Saturday should not open the app to five sessions
  // marked "missed" from days when they had no plan. Those days genuinely did
  // not exist for them, and opening with a wall of failure is the worst
  // possible first impression for a product about not feeling like a failure.
  const today = forDate ?? new Date().toISOString().slice(0, 10);

  const rows = plan.sessions
    .map((s) => ({ ...s, date: dateForDay(monday, s.dayIndex) }))
    .filter((s) => s.date >= today)
    .map((s) => ({
      user_id: userId,
      plan_date: s.date,
      workout_id: s.workoutSlug ? (workoutIdBySlug.get(s.workoutSlug) ?? null) : null,
      activity_kind: s.kind === 'sport' ? 'sport' : s.kind,
      label: s.label,
      planned_minutes: s.minutes,
      status: s.kind === 'rest' ? 'rest' : 'planned',
    }));

  if (rows.length === 0) {
    return { ok: true, message: 'Nothing left to schedule this week.' };
  }

  const { error } = await supabase.from('workout_plans').insert(rows);
  if (error) {
    console.error('week planning failed', error);
    return { ok: false, error: 'We could not build your week just now.' };
  }

  revalidatePath('/activity');
  revalidatePath('/today');
  return { ok: true, message: plan.explanation };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['completed', 'partial', 'skipped', 'moved', 'planned']),
  actualMinutes: z.number().int().min(0).max(300).optional(),
  movedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rpe: z.number().int().min(1).max(10).optional(),
});

/**
 * Mark a session done, skipped or moved.
 *
 * Moving is a first-class outcome rather than a failure state, and there is
 * deliberately no way to schedule a "double session to catch up" — compensation
 * behaviour is what turns one missed day into an abandoned month.
 */
export async function updateSession(input: unknown): Promise<TrainingResult> {
  if (!supabaseConfigured) return notConfigured();

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not update that session.' };
  const { id, status, actualMinutes, movedTo, rpe } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase
    .from('workout_plans')
    .update({
      status,
      actual_minutes: actualMinutes ?? null,
      moved_to: movedTo ?? null,
      rpe: rpe ?? null,
    })
    .eq('id', id)
    .eq('user_id', auth.user.id);

  if (error) {
    console.error('session update failed', error);
    return { ok: false, error: "We couldn't save that. Please try again." };
  }

  // Keep the day rollup in step, so the dashboard and the adherence engine see
  // the same thing.
  if (status === 'completed' || status === 'partial') {
    const { data: session } = await supabase
      .from('workout_plans')
      .select('plan_date')
      .eq('id', id)
      .single();

    if (session) {
      await supabase.from('daily_logs').upsert(
        { user_id: auth.user.id, log_date: session.plan_date, workout_done: true },
        { onConflict: 'user_id,log_date' },
      );
    }
  }

  // If it was moved, create the session on its new date rather than leaving the
  // user with a plan that says "moved" and nothing to actually do.
  if (status === 'moved' && movedTo) {
    const { data: original } = await supabase
      .from('workout_plans')
      .select('workout_id, activity_kind, label, planned_minutes')
      .eq('id', id)
      .single();

    if (original) {
      await supabase.from('workout_plans').insert({
        user_id: auth.user.id,
        plan_date: movedTo,
        workout_id: original.workout_id,
        activity_kind: original.activity_kind,
        label: original.label,
        planned_minutes: original.planned_minutes,
        status: 'planned',
      });
    }
  }

  revalidatePath('/activity');
  revalidatePath('/today');

  const messages: Record<typeof status, string> = {
    completed: 'Session logged. Well done.',
    partial: 'Logged as a partial session. Something is better than nothing.',
    skipped: 'Skipped — no problem. Back to normal tomorrow.',
    moved: 'Moved. Your week has been adjusted.',
    planned: 'Marked as still to do.',
  };

  return { ok: true, message: messages[status] };
}
