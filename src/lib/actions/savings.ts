'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { formatRupees, parseAmountToPaise } from '@/lib/engines/money';

/**
 * Setting up, adding to and closing savings goals.
 *
 * Adding money writes an ordinary spend filed as savings and carrying
 * `savings_goal_id` — the same shape as paying a commitment. A goal's total is
 * read back from those spends, never stored, so it cannot disagree with them.
 */

export type SavingsResult = { ok: true; message: string } | { ok: false; error: string };

const MAX_PAISE = 100_000_000_000;

// UTC, like every other "today" on the money screen, so the loader and the
// database's started_on agree about which day it is.
const todayIso = () => new Date().toISOString().slice(0, 10);

const goalSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  /** Rupees as typed. Parsed to paise here; money never touches a float. */
  target: z.string().min(1).max(20),
  saved: z.string().max(20).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function addSavingsGoal(input: unknown): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that. Check the amounts.' };
  const { label, target, saved, targetDate } = parsed.data;

  const targetPaise = parseAmountToPaise(target);
  if (targetPaise === null || targetPaise > MAX_PAISE) {
    return { ok: false, error: 'Enter how much you are saving towards.' };
  }

  // Empty or zero means nothing saved yet. Anything else has to read as a real
  // amount: taking a typo as zero would understate the goal from its first day.
  const openingPaise = !saved || /^[₹\s,.0]*$/.test(saved) ? 0 : parseAmountToPaise(saved);
  if (openingPaise === null || openingPaise > MAX_PAISE) {
    return { ok: false, error: 'Check the amount already saved.' };
  }

  const startedOn = todayIso();
  if (targetDate !== undefined && targetDate <= startedOn) {
    return { ok: false, error: 'Pick a date after today, or leave it empty.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase.from('savings_goals').insert({
    user_id: auth.user.id,
    label,
    target_paise: targetPaise,
    opening_paise: openingPaise,
    started_on: startedOn,
    target_date: targetDate ?? null,
  });

  if (error) {
    console.error('savings goal insert failed', error);
    return { ok: false, error: 'We could not save that.' };
  }

  revalidatePath('/money');
  return { ok: true, message: `${label} added.` };
}

const contributionSchema = z.strictObject({
  id: z.string().uuid(),
  amount: z.string().min(1).max(20),
});

/**
 * Put money towards a goal.
 *
 * Writes a real spend. The goal is read back first rather than trusting the
 * request: this writes to the ledger, so the label and whether the goal is
 * still open come from the database.
 */
export async function contributeToSavingsGoal(input: unknown): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = contributionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that amount.' };

  const amountPaise = parseAmountToPaise(parsed.data.amount);
  if (amountPaise === null || amountPaise > MAX_PAISE) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { data: goal } = await supabase
    .from('savings_goals')
    .select('id, label, closed_on')
    .eq('id', parsed.data.id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!goal) return { ok: false, error: 'We could not find that goal.' };
  if (goal.closed_on !== null) return { ok: false, error: 'That goal is closed.' };

  const { error } = await supabase.from('spends').insert({
    user_id: auth.user.id,
    spent_on: todayIso(),
    amount_paise: amountPaise,
    category: 'savings',
    savings_goal_id: goal.id,
    note: goal.label,
  });

  if (error) {
    console.error('savings contribution failed', error);
    return { ok: false, error: 'We could not add that.' };
  }

  revalidatePath('/money');
  revalidatePath('/today');
  return { ok: true, message: `${formatRupees(amountPaise)} added to ${goal.label}.` };
}

/**
 * Stop tracking a goal without erasing anything.
 *
 * Closed rather than deleted: the money that went in was really set aside, and
 * its spends keep pointing at the goal they were for.
 */
export async function closeSavingsGoal(id: string): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: 'We could not find that goal.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { data, error } = await supabase
    .from('savings_goals')
    .update({ closed_on: todayIso() })
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .is('closed_on', null)
    .select('id');

  if (error || !data || data.length !== 1) {
    return { ok: false, error: 'We could not close that goal.' };
  }

  revalidatePath('/money');
  return { ok: true, message: 'Closed. What you added stays in your records.' };
}
