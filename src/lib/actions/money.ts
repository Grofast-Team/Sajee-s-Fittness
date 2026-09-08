'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { formatRupees } from '@/lib/engines/money';

/**
 * Recording money.
 *
 * The amount arrives already converted to whole paise by the client, and is
 * re-validated here as an integer. Rupees never reach the database: a decimal
 * that survives into storage becomes a rounding error in every future total.
 */

export type MoneyResult = { ok: true; message: string } | { ok: false; error: string };

const CATEGORIES = [
  'groceries',
  'eating_out',
  'transport',
  'rent',
  'bills',
  'phone_internet',
  'medical',
  'education',
  'family',
  'clothes',
  'household',
  'entertainment',
  'personal_care',
  'gifts',
  'savings',
  'other',
] as const;

const spendSchema = z.object({
  // Integer paise. `.int()` is the guard that stops a stray decimal becoming
  // a permanent rounding error in every total that follows.
  amountPaise: z.number().int().positive().max(100_000_000_000),
  category: z.enum(CATEGORIES),
  note: z.string().trim().max(200).optional(),
  spentOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function logSpend(input: unknown): Promise<MoneyResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = spendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that amount.' };
  const s = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase.from('spends').insert({
    user_id: auth.user.id,
    amount_paise: s.amountPaise,
    category: s.category,
    note: s.note || null,
    spent_on: s.spentOn ?? new Date().toISOString().slice(0, 10),
  });

  if (error) {
    console.error('spend insert failed', error);
    return { ok: false, error: "We couldn't save that. Please try again." };
  }

  revalidatePath('/money');
  revalidatePath('/today');

  return { ok: true, message: `${formatRupees(s.amountPaise)} recorded.` };
}

/**
 * Remove a spend.
 *
 * A wrong amount in a total is worse than no amount, because it looks correct.
 * Deleting has to be as easy as adding or people stop trusting the number and
 * quietly stop using it.
 */
export async function deleteSpend(id: string): Promise<MoneyResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // RLS would reject someone else's row anyway; the explicit filter keeps the
  // intent visible in the code rather than only in the policy.
  const { error } = await supabase
    .from('spends')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.user.id);

  if (error) return { ok: false, error: "We couldn't remove that." };

  revalidatePath('/money');
  revalidatePath('/today');
  return { ok: true, message: 'Removed.' };
}

const limitSchema = z.object({
  monthlyLimitPaise: z.number().int().min(0).max(100_000_000_000).nullable(),
  monthStartDay: z.number().int().min(1).max(28).optional(),
});

export async function setMoneySettings(input: unknown): Promise<MoneyResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = limitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that amount.' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase.from('money_settings').upsert(
    {
      user_id: auth.user.id,
      monthly_limit_paise: parsed.data.monthlyLimitPaise,
      ...(parsed.data.monthStartDay ? { month_start_day: parsed.data.monthStartDay } : {}),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    console.error('money settings failed', error);
    return { ok: false, error: "We couldn't save that." };
  }

  revalidatePath('/money');
  revalidatePath('/today');

  return {
    ok: true,
    message:
      parsed.data.monthlyLimitPaise === null
        ? 'Monthly amount cleared.'
        : `Monthly amount set to ${formatRupees(parsed.data.monthlyLimitPaise)}.`,
  };
}
