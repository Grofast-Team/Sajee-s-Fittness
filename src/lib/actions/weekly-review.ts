'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { supabaseConfigured } from '@/lib/config';
import { adapt, type AdaptationResult } from '@/lib/engines/adaptation';
import { analyseTrend } from '@/lib/engines/trend';

/**
 * The weekly review: the thing that makes the plan adaptive.
 *
 * The adaptation engine has been built and tested since early on and nothing
 * ever called it, so intake and step targets were fixed forever at whatever
 * onboarding first computed. A plan that never changes is not a coaching
 * system — it is a calculator with a nice interface, and the difference is the
 * entire premise of the product.
 *
 * Two properties this has to have, because it runs unattended:
 *
 * **Idempotent.** Safe to run twice on the same day, from a cron and from a
 * page load, without applying an adjustment twice. `MIN_DAYS_BETWEEN_CHANGES`
 * does most of that work; the explicit "already reviewed today" check does the
 * rest.
 *
 * **Never silently destructive.** Every run writes a `plan_adjustments` row,
 * including the ones that change nothing, so there is an auditable record of
 * why a target moved — or why it did not.
 */

export type ReviewResult =
  | { ok: true; changed: boolean; decision: string; message: string }
  | { ok: false; error: string };

type Client = Awaited<ReturnType<typeof createClient>>;

const DAY_MS = 86_400_000;
/** How far back to look for weigh-ins and adherence. */
const WINDOW_DAYS = 28;

/**
 * Run the review for one user.
 *
 * Takes an explicit client so the cron path can pass a service-role client and
 * process every user, while the interactive path passes the request-scoped one
 * and stays inside RLS.
 *
 * Deliberately not exported. A `'use server'` module's exports become callable
 * RPC endpoints, and this one takes a database client — including, on the cron
 * path, a service-role client. Exporting it would publish a
 * "review any user id you like" endpoint to the browser.
 */
async function reviewUser(supabase: Client, userId: string): Promise<ReviewResult> {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [planRes, measurementsRes, logsRes, plansRes, lastAdjRes, goalRes, flagsRes] =
    await Promise.all([
      supabase
        .from('plans')
        .select('id, energy_target_kcal, step_target, created_at')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle(),
      supabase
        .from('measurements')
        .select('measured_on, weight_kg')
        .eq('user_id', userId)
        .gte('measured_on', since)
        .not('weight_kg', 'is', null)
        .order('measured_on', { ascending: true }),
      supabase
        .from('daily_logs')
        .select('log_date, logging_complete, steps')
        .eq('user_id', userId)
        .gte('log_date', since),
      supabase
        .from('workout_plans')
        .select('status')
        .eq('user_id', userId)
        .gte('plan_date', since)
        .lte('plan_date', today)
        .neq('status', 'rest'),
      // Enough history to find the last *applied* change, not merely the last
      // review — a run that held must not reset the clock.
      supabase
        .from('plan_adjustments')
        .select('created_at, applied')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('goals')
        .select('pace')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle(),
      supabase
        .from('safety_flags')
        .select('severity')
        .eq('user_id', userId)
        .is('resolved_at', null),
    ]);

  const plan = planRes.data;
  if (!plan) return { ok: false, error: 'No active plan to review.' };

  /*
   * Idempotence.
   *
   * The cron and the on-demand button can both land on the same day, and this
   * will eventually be called from a page load too. Re-running is harmless to
   * the targets — `MIN_DAYS_BETWEEN_CHANGES` sees to that — but it would file
   * a fresh audit row every time, and an adjustment log full of duplicate
   * holds is a log nobody can read.
   */
  const adjustments = lastAdjRes.data ?? [];
  const reviewedToday = adjustments.some(
    (a) => (a.created_at as string).slice(0, 10) === today,
  );
  if (reviewedToday) {
    return {
      ok: true,
      changed: false,
      decision: 'already_reviewed',
      message: 'Your plan has already been reviewed today.',
    };
  }

  const measurements = measurementsRes.data ?? [];
  const latestWeight = measurements.length > 0 ? Number(measurements[measurements.length - 1].weight_kg) : null;

  if (latestWeight === null) {
    return {
      ok: true,
      changed: false,
      decision: 'insufficient_data',
      message: 'No weigh-ins recorded yet, so there is nothing to adapt from.',
    };
  }

  const trend = analyseTrend(
    measurements.map((m) => ({ date: m.measured_on as string, weightKg: Number(m.weight_kg) })),
  );

  const logs = logsRes.data ?? [];
  const loggingCompleteness =
    logs.length === 0 ? 0 : logs.filter((l) => l.logging_complete).length / logs.length;

  /*
   * Step adherence measured against the target, not against a guess.
   *
   * Days with no recorded steps are excluded rather than counted as zero. A
   * day someone forgot to enter is not a day they did not walk, and treating
   * it as failure would drag the target down for a logging lapse.
   */
  const stepDays = logs.filter((l) => l.steps != null);
  const stepAdherence =
    stepDays.length === 0
      ? 0
      : stepDays.filter((l) => (l.steps as number) >= plan.step_target).length / stepDays.length;

  const workouts = plansRes.data ?? [];
  const workoutAdherence =
    workouts.length === 0
      ? 0
      : workouts.filter((w) => w.status === 'completed' || w.status === 'partial').length /
        workouts.length;

  // Days since the last *applied* change, not since the last review — a run
  // that decided to hold must not reset the clock.
  const lastApplied = adjustments.find((a) => a.applied);
  const daysSinceLastChange = lastApplied
    ? Math.floor((Date.now() - new Date(lastApplied.created_at as string).getTime()) / DAY_MS)
    : Math.floor((Date.now() - new Date(plan.created_at as string).getTime()) / DAY_MS);

  const result = adapt({
    trend,
    currentTargetKcal: plan.energy_target_kcal,
    currentStepTarget: plan.step_target,
    targetWeeklyLossFraction: paceToFraction(goalRes.data?.pace),
    weightKg: latestWeight,
    daysSinceLastChange,
    loggingCompleteness,
    workoutAdherence,
    stepAdherence,
    hasReferralFlag: (flagsRes.data ?? []).some((f) => f.severity === 'refer'),
  });

  const changed = result.deltaKcal !== 0 || result.deltaSteps !== 0;

  // Every run is recorded, including the holds. "Why did nothing change?" is a
  // question the user is entitled to an answer to.
  await supabase.from('plan_adjustments').insert({
    user_id: userId,
    plan_id: plan.id,
    decision: result.decision,
    lever: result.lever,
    delta_kcal: result.deltaKcal,
    delta_steps: result.deltaSteps,
    evidence: result.evidence,
    applied: changed,
  });

  if (changed) {
    await applyAdjustment(supabase, userId, plan.id, result);
  }

  return { ok: true, changed, decision: result.decision, message: result.message };
}

/**
 * Write the new targets as a new plan version.
 *
 * The old plan is retired rather than edited, so the history of what someone
 * was actually asked to do survives. `plans_one_active_idx` is a partial unique
 * index on `is_active`, so the old row has to be stood down before the new one
 * goes in.
 */
async function applyAdjustment(
  supabase: Client,
  userId: string,
  planId: string,
  result: AdaptationResult,
) {
  const { data: current } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  if (!current) return;

  await supabase.from('plans').update({ is_active: false }).eq('id', planId);

  const { id: _id, created_at: _createdAt, ...rest } = current as Record<string, unknown>;
  void _id;
  void _createdAt;

  await supabase.from('plans').insert({
    ...rest,
    user_id: userId,
    version: (current.version as number) + 1,
    is_active: true,
    energy_target_kcal: result.newTargetKcal,
    step_target: result.newStepTarget,
    rationale: {
      ...((current.rationale as Record<string, unknown>) ?? {}),
      adaptation: result.message,
      adapted_on: new Date().toISOString().slice(0, 10),
    },
  });
}

/** The pace someone chose, as a fraction of bodyweight per week. */
function paceToFraction(pace: string | null | undefined): number {
  return { gentle: 0.004, steady: 0.006, firm: 0.0075 }[pace ?? 'steady'] ?? 0.006;
}

/**
 * Run the review for the signed-in user, on demand.
 *
 * Exposed so someone can ask "check my plan now" rather than waiting for the
 * scheduled run. The engine's own gates mean pressing it repeatedly cannot
 * force a change through.
 */
export async function reviewMyPlan(): Promise<ReviewResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const result = await reviewUser(supabase, auth.user.id);

  revalidatePath('/today');
  revalidatePath('/progress');
  return result;
}

/**
 * Review every user who is due one.
 *
 * Called by the scheduled job. Uses a service-role client, which is why it
 * lives behind a secret-checked route rather than being callable from a page.
 */
export async function reviewAllDueUsers(): Promise<{ reviewed: number; changed: number }> {
  const supabase = createServiceClient();

  const { data: plans } = await supabase
    .from('plans')
    .select('user_id')
    .eq('is_active', true);

  let reviewed = 0;
  let changed = 0;

  for (const row of plans ?? []) {
    const result = await reviewUser(supabase as unknown as Client, row.user_id as string);
    if (result.ok) {
      reviewed += 1;
      if (result.changed) changed += 1;
    }
  }

  return { reviewed, changed };
}
