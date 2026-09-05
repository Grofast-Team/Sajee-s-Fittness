'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { assessSteps } from '@/lib/engines/step-validity';

/**
 * Ingest step segments read from the platform health store.
 *
 * The device sends **observations**, never conclusions. It reports the
 * segments Health Connect gave it; the server decides which ones count. That
 * split matters for the same reason the energy target is computed server-side:
 * a client that can post its own validated total can post any number it likes,
 * and step goals feed the adaptive plan.
 */

const segmentSchema = z.object({
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  steps: z.number().int().min(0).max(100_000),
  sourceName: z.string().max(120).optional(),
  platformId: z.string().max(200).optional(),
});

const workoutSchema = z.object({
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  workoutType: z.string().max(60),
});

const syncSchema = z.object({
  /** The local calendar date these segments belong to, from the device. */
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // A day of Health Connect segments is tens of records, not thousands. The
  // cap stops a malformed or hostile client from posting an unbounded payload.
  segments: z.array(segmentSchema).max(500),
  workouts: z.array(workoutSchema).max(100).default([]),
});

export type StepSyncResult =
  | { ok: true; validatedSteps: number; rawSteps: number; confidence: string; message: string }
  | { ok: false; error: string };

export async function syncStepSegments(input: unknown): Promise<StepSyncResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = syncSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'We could not read the step data from your phone.' };
  }
  const { logDate, segments, workouts } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  // The verdict is reached here, from the raw segments, every time.
  const result = assessSteps(segments, workouts);

  /*
   * Match verdicts back to their platform ids.
   *
   * `assessSteps` returns verdicts in input order and does not reorder, so the
   * index is a safe join. Asserting it here rather than assuming it means a
   * future change to the engine fails loudly instead of silently attaching
   * every verdict to the wrong segment.
   */
  if (result.segments.length !== segments.length) {
    console.error('step verdict count mismatch', result.segments.length, segments.length);
    return { ok: false, error: 'We could not process that step data.' };
  }

  const rows = segments.map((segment, i) => {
    const verdict = result.segments[i];
    return {
      user_id: userId,
      log_date: logDate,
      started_at: segment.startDate,
      ended_at: segment.endDate,
      steps: segment.steps,
      source_name: segment.sourceName ?? null,
      // Without a platform id we cannot dedupe on re-sync, so synthesise a
      // stable one from the segment's own identity rather than inventing a
      // random value that would duplicate on every sync.
      platform_id:
        segment.platformId ??
        `${logDate}:${segment.startDate}:${segment.sourceName ?? 'unknown'}`,
      counted: verdict.counted,
      exclusion_reason: verdict.reason,
      cadence: verdict.cadence,
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from('step_segments')
      .upsert(rows, { onConflict: 'user_id,platform_id' });

    if (error) {
      console.error('step segment sync failed', error);
      return { ok: false, error: 'We could not save that step data.' };
    }
  }

  const { error: validationError } = await supabase.from('step_validations').upsert(
    {
      user_id: userId,
      log_date: logDate,
      raw_steps: result.rawSteps,
      validated_steps: result.validatedSteps,
      excluded_steps: result.excludedSteps,
      confidence: result.confidence,
      reasons: result.confidenceReasons,
      sources: result.sources,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,log_date' },
  );

  if (validationError) {
    console.error('step validation write failed', validationError);
    return { ok: false, error: 'We could not save that step data.' };
  }

  /*
   * Write the device's own total to `step_logs` under its real source.
   *
   * Not the validated figure. `step_logs` records what each source reported,
   * and overwriting it with our opinion would destroy the only baseline we
   * could ever reconcile against.
   */
  await supabase.from('step_logs').upsert(
    {
      user_id: userId,
      log_date: logDate,
      steps: result.rawSteps,
      source: 'health_connect',
    },
    { onConflict: 'user_id,log_date,source' },
  );

  revalidatePath('/today');
  revalidatePath('/activity');

  return {
    ok: true,
    rawSteps: result.rawSteps,
    validatedSteps: result.validatedSteps,
    confidence: result.confidence,
    message:
      result.excludedSteps === 0
        ? `${result.validatedSteps.toLocaleString()} steps synced.`
        : `${result.validatedSteps.toLocaleString()} steps confirmed of ` +
          `${result.rawSteps.toLocaleString()} recorded.`,
  };
}
