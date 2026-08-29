'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * Weight, measurements, steps and water.
 *
 * These are the entries that make the trend and adaptation engines mean
 * something. Without a weigh-in path the trend line cannot move, and without a
 * step path the adaptation engine can never tell "the plan is wrong" from "the
 * plan was not run".
 */

export type TrackResult = { ok: true; message: string } | { ok: false; error: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}

function notConfigured(): TrackResult {
  return {
    ok: false,
    error: 'Supabase is not configured on this deployment, so there is nowhere to save this yet.',
  };
}

// ---------------------------------------------------------------------------
// Weight and body measurements
// ---------------------------------------------------------------------------

const measurementSchema = z.object({
  measuredOn: isoDate.optional(),
  // Bounds mirror the database check constraints, so a bad value is caught with
  // a readable message rather than a Postgres error.
  weightKg: z.number().min(25).max(400).optional(),
  waistCm: z.number().min(30).max(250).optional(),
  hipCm: z.number().min(30).max(250).optional(),
  chestCm: z.number().min(30).max(250).optional(),
  armCm: z.number().min(10).max(90).optional(),
  thighCm: z.number().min(20).max(150).optional(),
  notes: z.string().max(500).optional(),
});

export async function logMeasurement(input: unknown): Promise<TrackResult> {
  if (!supabaseConfigured) return notConfigured();

  const parsed = measurementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'That does not look like a plausible measurement. Check the number.' };
  }

  const m = parsed.data;
  const hasAnything = [m.weightKg, m.waistCm, m.hipCm, m.chestCm, m.armCm, m.thighCm].some(
    (v) => v !== undefined,
  );
  if (!hasAnything) return { ok: false, error: 'Enter at least one measurement.' };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: 'You need to be signed in to record this.' };

  const measuredOn = m.measuredOn ?? new Date().toISOString().slice(0, 10);

  // One row per day. Re-entering corrects the day rather than creating a second
  // reading, which would quietly weight that day double in the trend fit.
  const { error } = await supabase.from('measurements').upsert(
    {
      user_id: user.id,
      measured_on: measuredOn,
      weight_kg: m.weightKg ?? null,
      waist_cm: m.waistCm ?? null,
      hip_cm: m.hipCm ?? null,
      chest_cm: m.chestCm ?? null,
      arm_cm: m.armCm ?? null,
      thigh_cm: m.thighCm ?? null,
      notes: m.notes ?? null,
    },
    { onConflict: 'user_id,measured_on' },
  );

  if (error) {
    console.error('measurement save failed', error);
    return { ok: false, error: "We couldn't save that right now. Please try again." };
  }

  revalidatePath('/progress');
  revalidatePath('/today');

  return {
    ok: true,
    message: m.weightKg
      ? `Recorded ${m.weightKg} kg. Remember the trend matters, not today's number.`
      : 'Measurements recorded.',
  };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const stepsSchema = z.object({
  logDate: isoDate.optional(),
  steps: z.number().int().min(0).max(100000),
  activeMinutes: z.number().int().min(0).max(1440).optional(),
});

export async function logSteps(input: unknown): Promise<TrackResult> {
  if (!supabaseConfigured) return notConfigured();

  const parsed = stepsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'That step count does not look right.' };
  }

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: 'You need to be signed in to record this.' };

  const logDate = parsed.data.logDate ?? new Date().toISOString().slice(0, 10);

  // Source is recorded so provenance survives. A device reading beats a manual
  // one for the same day, and `private.steps_rollup()` applies that preference.
  const { error } = await supabase.from('step_logs').upsert(
    {
      user_id: user.id,
      log_date: logDate,
      steps: parsed.data.steps,
      active_minutes: parsed.data.activeMinutes ?? null,
      source: 'manual',
    },
    { onConflict: 'user_id,log_date,source' },
  );

  if (error) {
    console.error('step log failed', error);
    return { ok: false, error: "We couldn't save that right now. Please try again." };
  }

  revalidatePath('/activity');
  revalidatePath('/today');
  return { ok: true, message: `${parsed.data.steps.toLocaleString()} steps recorded.` };
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

const waterSchema = z.object({
  ml: z.number().int().min(1).max(3000),
  logDate: isoDate.optional(),
});

export async function logWater(input: unknown): Promise<TrackResult> {
  if (!supabaseConfigured) return notConfigured();

  const parsed = waterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That amount does not look right.' };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: 'You need to be signed in to record this.' };

  // Append-only: each glass is its own row, so the dashboard can show *when*
  // as well as how much.
  const { error } = await supabase.from('water_logs').insert({
    user_id: user.id,
    log_date: parsed.data.logDate ?? new Date().toISOString().slice(0, 10),
    ml: parsed.data.ml,
  });

  if (error) {
    console.error('water log failed', error);
    return { ok: false, error: "We couldn't save that right now." };
  }

  revalidatePath('/today');
  return { ok: true, message: `${parsed.data.ml} ml logged.` };
}

// ---------------------------------------------------------------------------
// Sleep
// ---------------------------------------------------------------------------

const sleepSchema = z.object({
  logDate: isoDate.optional(),
  minutes: z.number().int().min(0).max(1200),
  quality: z.number().int().min(1).max(5).optional(),
});

export async function logSleep(input: unknown): Promise<TrackResult> {
  if (!supabaseConfigured) return notConfigured();

  const parsed = sleepSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That does not look like a plausible night.' };

  const { supabase, user } = await requireUser();
  if (!user) return { ok: false, error: 'You need to be signed in to record this.' };

  const { error } = await supabase.from('sleep_logs').upsert(
    {
      user_id: user.id,
      log_date: parsed.data.logDate ?? new Date().toISOString().slice(0, 10),
      minutes: parsed.data.minutes,
      quality: parsed.data.quality ?? null,
      source: 'manual',
    },
    { onConflict: 'user_id,log_date' },
  );

  if (error) {
    console.error('sleep log failed', error);
    return { ok: false, error: "We couldn't save that right now." };
  }

  revalidatePath('/today');
  return { ok: true, message: 'Sleep recorded.' };
}
