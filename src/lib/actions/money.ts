'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { formatRupees, monthWindow, SPEND_CATEGORY_IDS, type SpendCategory } from '@/lib/engines/money';
import {
  planSpendEdit,
  type ExistingSpend,
  type LinkedCommitment,
  type SpendIntent,
} from '@/lib/engines/spend-edit';

/**
 * Recording money.
 *
 * The amount arrives already converted to whole paise by the client, and is
 * re-validated here as an integer. Rupees never reach the database: a decimal
 * that survives into storage becomes a rounding error in every future total.
 */

export type MoneyResult =
  | { ok: true; message: string; warning?: string | null }
  | { ok: false; error: string };

const spendSchema = z.object({
  // Integer paise. `.int()` is the guard that stops a stray decimal becoming
  // a permanent rounding error in every total that follows.
  amountPaise: z.number().int().positive().max(100_000_000_000),
  category: z.enum(SPEND_CATEGORY_IDS),
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

  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: 'We could not find that spend.' };
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

/**
 * Correct a recorded spend.
 *
 * `z.strictObject` rejects any key it does not name, so a request carrying
 * `user_id`, `commitment_id` or `savings_goal_id` fails validation rather than being quietly
 * ignored — ownership and the bill a payment settled are never editable from
 * here. The database enforces both again underneath.
 */
const updateSchema = z.strictObject({
  id: z.string().uuid(),
  amountPaise: z.number().int().positive().max(100_000_000_000).optional(),
  category: z.enum(SPEND_CATEGORY_IDS).optional(),
  note: z.string().max(200).nullable().optional(),
  spentOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  intent: z.enum(['need', 'want', 'obligation', 'savings']).nullable().optional(),
});

export async function updateSpend(input: unknown): Promise<MoneyResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that change.' };
  const { id, ...change } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  const { data: row } = await supabase
    .from('spends')
    .select('id, amount_paise, category, note, spent_on, intent, commitment_id, savings_goal_id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!row) return { ok: false, error: 'We could not find that spend.' };

  const existing: ExistingSpend = {
    id: row.id as string,
    amountPaise: Number(row.amount_paise),
    category: row.category as SpendCategory,
    note: (row.note as string) ?? null,
    spentOn: row.spent_on as string,
    intent: (row.intent as SpendIntent) ?? null,
    commitmentId: (row.commitment_id as string) ?? null,
    savingsGoalId: (row.savings_goal_id as string) ?? null,
  };

  const linked = existing.commitmentId
    ? await loadLinkedCommitment(supabase, userId, existing)
    : null;

  const plan = planSpendEdit(existing, change, linked);
  if (!plan.ok) return { ok: false, error: plan.error };
  if (!plan.changed) return { ok: true, message: 'Nothing to change.' };

  const { patch } = plan;
  const { data: updated, error } = await supabase
    .from('spends')
    .update({
      ...(patch.amountPaise !== undefined ? { amount_paise: patch.amountPaise } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.spentOn !== undefined ? { spent_on: patch.spentOn } : {}),
      ...(patch.intent !== undefined ? { intent: patch.intent } : {}),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id');

  // Exactly one row, or the change did not happen — never report success on
  // an update that quietly matched nothing.
  if (error || !updated || updated.length !== 1) {
    console.error('spend update failed', error);
    return { ok: false, error: "We couldn't save that change." };
  }

  revalidatePath('/money');
  revalidatePath('/today');

  return { ok: true, message: 'Updated.', warning: plan.warning };
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The bill a payment settled, and what else has been paid towards it in the
 * same money-month. Not exported: a 'use server' module's exports are callable
 * from the browser, and this takes a database client.
 */
async function loadLinkedCommitment(
  supabase: Client,
  userId: string,
  spend: ExistingSpend,
): Promise<LinkedCommitment | null> {
  const [commitmentRes, settingsRes] = await Promise.all([
    supabase
      .from('commitments')
      .select('label, amount_paise')
      .eq('id', spend.commitmentId!)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('money_settings').select('month_start_day').eq('user_id', userId).maybeSingle(),
  ]);

  if (!commitmentRes.data) return null;

  const window = monthWindow(
    new Date(`${spend.spentOn}T12:00:00Z`),
    settingsRes.data?.month_start_day ?? 1,
  );

  const { data: others } = await supabase
    .from('spends')
    .select('amount_paise')
    .eq('user_id', userId)
    .eq('commitment_id', spend.commitmentId!)
    .neq('id', spend.id)
    .gte('spent_on', window.start)
    .lt('spent_on', window.end);

  return {
    label: commitmentRes.data.label as string,
    amountPaise: Number(commitmentRes.data.amount_paise),
    otherPaidPaise: (others ?? []).reduce((sum, r) => sum + Number(r.amount_paise), 0),
  };
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
