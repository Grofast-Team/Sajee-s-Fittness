'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { formatRupees, parseAmountToPaise } from '@/lib/engines/money';

/**
 * Setting up, changing, adding to, taking from and closing savings goals.
 *
 * Adding money writes an ordinary spend filed as savings and carrying
 * `savings_goal_id` — the same shape as paying a commitment. Taking it back
 * out writes a `savings_withdrawals` row, because that is neither spending nor
 * income. A goal's total is read back from both, never stored, so it cannot
 * disagree with them.
 */

export type SavingsResult = { ok: true; message: string } | { ok: false; error: string };

const MAX_PAISE = 100_000_000_000;

// UTC, like every other "today" on the money screen, so the loader and the
// database's started_on agree about which day it is.
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * What was saved before the goal existed, as typed. Empty or zero is nothing
 * saved; anything else has to read as a real amount, or null — taking a typo as
 * zero would understate the goal from its first day.
 */
function openingFrom(saved: string | undefined): number | null {
  if (!saved || /^[₹\s,.0]*$/.test(saved)) return 0;
  const paise = parseAmountToPaise(saved);
  return paise === null || paise > MAX_PAISE ? null : paise;
}

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

  const openingPaise = openingFrom(saved);
  if (openingPaise === null) {
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

const goalEditSchema = z.strictObject({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(60).optional(),
  target: z.string().min(1).max(20).optional(),
  saved: z.string().max(20).optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

/**
 * Change what a goal is: its name, target, date, or what was saved before it.
 *
 * Only what is sent changes, and `targetDate: null` removes the date. A date
 * that is not being changed is not re-checked, so a goal whose date has passed
 * can still be renamed without being made to pick a new one.
 */
export async function updateSavingsGoal(input: unknown): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = goalEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that. Check the amounts.' };
  const { id, label, target, saved, targetDate } = parsed.data;

  const patch: { label?: string; target_paise?: number; opening_paise?: number; target_date?: string | null } =
    {};

  if (label !== undefined) patch.label = label;

  if (target !== undefined) {
    const targetPaise = parseAmountToPaise(target);
    if (targetPaise === null || targetPaise > MAX_PAISE) {
      return { ok: false, error: 'Enter how much you are saving towards.' };
    }
    patch.target_paise = targetPaise;
  }

  if (saved !== undefined) {
    const openingPaise = openingFrom(saved);
    if (openingPaise === null) return { ok: false, error: 'Check the amount already saved.' };
    patch.opening_paise = openingPaise;
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { data: goal } = await supabase
    .from('savings_goals')
    .select('id, label, target_date, closed_on')
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!goal) return { ok: false, error: 'We could not find that goal.' };
  if (goal.closed_on !== null) return { ok: false, error: 'That goal is closed.' };

  if (targetDate !== undefined && targetDate !== goal.target_date) {
    if (targetDate !== null && targetDate <= todayIso()) {
      return { ok: false, error: 'Pick a date after today, or leave it empty.' };
    }
    patch.target_date = targetDate;
  }

  if (Object.keys(patch).length === 0) return { ok: true, message: 'Nothing to change.' };

  const { data, error } = await supabase
    .from('savings_goals')
    .update(patch)
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .select('id');

  // Exactly one row, or it did not happen.
  if (error || !data || data.length !== 1) {
    console.error('savings goal update failed', error);
    return { ok: false, error: 'We could not save that change.' };
  }

  revalidatePath('/money');
  return { ok: true, message: `${patch.label ?? goal.label} updated.` };
}

const withdrawalSchema = z.strictObject({
  id: z.string().uuid(),
  amount: z.string().min(1).max(20),
  note: z.string().trim().max(200).optional(),
});

/**
 * Take money back out of a goal.
 *
 * Checked against what the goal holds here, so a refusal can say how much that
 * is — and again in the database, which locks the goal while it checks, so a
 * double tap cannot take the same money out twice.
 */
export async function withdrawFromSavingsGoal(input: unknown): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = withdrawalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that amount.' };

  const amountPaise = parseAmountToPaise(parsed.data.amount);
  if (amountPaise === null || amountPaise > MAX_PAISE) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  const { data: goal } = await supabase
    .from('savings_goals')
    .select('id, label, opening_paise, closed_on')
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!goal) return { ok: false, error: 'We could not find that goal.' };
  if (goal.closed_on !== null) return { ok: false, error: 'That goal is closed.' };

  const [inRes, outRes] = await Promise.all([
    supabase.from('spends').select('amount_paise').eq('user_id', userId).eq('savings_goal_id', goal.id),
    supabase
      .from('savings_withdrawals')
      .select('amount_paise')
      .eq('user_id', userId)
      .eq('savings_goal_id', goal.id),
  ]);
  // bigint arrives as a string from PostgREST.
  const sum = (rows: { amount_paise: unknown }[] | null) =>
    (rows ?? []).reduce((total, r) => total + Number(r.amount_paise), 0);
  const heldPaise = Math.max(0, Number(goal.opening_paise) + sum(inRes.data) - sum(outRes.data));

  if (amountPaise > heldPaise) {
    return {
      ok: false,
      error:
        heldPaise === 0
          ? `Nothing is recorded in ${goal.label} to take out.`
          : `${goal.label} holds ${formatRupees(heldPaise)}, so that is the most you can take out.`,
    };
  }

  const { error } = await supabase.from('savings_withdrawals').insert({
    user_id: userId,
    savings_goal_id: goal.id,
    amount_paise: amountPaise,
    withdrawn_on: todayIso(),
    note: parsed.data.note || null,
  });

  if (error) {
    console.error('savings withdrawal failed', error);
    return {
      ok: false,
      error: error.code === '23514' ? 'That is more than this goal holds.' : 'We could not record that.',
    };
  }

  revalidatePath('/money');
  return { ok: true, message: `${formatRupees(amountPaise)} taken out of ${goal.label}.` };
}

/** Undo a withdrawal recorded by mistake. The money counts as saved again. */
export async function removeSavingsWithdrawal(id: string): Promise<SavingsResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: 'We could not find that.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { data, error } = await supabase
    .from('savings_withdrawals')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.user.id)
    .select('id');

  if (error || !data || data.length !== 1) {
    return { ok: false, error: 'We could not remove that.' };
  }

  revalidatePath('/money');
  return { ok: true, message: 'Removed. That money counts as saved again.' };
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
