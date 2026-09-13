'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { parseAmountToPaise } from '@/lib/engines/money';

/**
 * Recording money that came in, and saying what a spend was for.
 *
 * Amounts arrive as typed text and are parsed to paise here, as everywhere in
 * the money code: a float never touches a rupee.
 */

export type IncomeResult = { ok: true; message: string } | { ok: false; error: string };

const incomeSchema = z.object({
  amount: z.string().min(1).max(20),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** An existing source, or a label to create one on the fly. */
  sourceId: z.string().uuid().optional(),
  sourceLabel: z.string().trim().min(1).max(60).optional(),
  kind: z
    .enum(['salary', 'freelance', 'business', 'bonus', 'interest', 'rental', 'other'])
    .default('salary'),
  note: z.string().trim().max(200).optional(),
});

export async function recordIncome(input: unknown): Promise<IncomeResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = incomeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that. Check the amount.' };

  const amountPaise = parseAmountToPaise(parsed.data.amount);
  if (amountPaise === null || amountPaise <= 0) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  let sourceId = parsed.data.sourceId ?? null;

  /*
   * Reuse a source with the same label rather than creating a duplicate.
   *
   * Someone who types "Salary" every month should end up with one salary and
   * a history, not twelve sources of one payment each — which would make the
   * history, the entire point of keeping a ledger, impossible to read.
   */
  if (!sourceId && parsed.data.sourceLabel) {
    const { data: existing } = await supabase
      .from('income_sources')
      .select('id')
      .eq('user_id', userId)
      .ilike('label', parsed.data.sourceLabel)
      .is('ended_on', null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      sourceId = existing.id as string;
    } else {
      const { data: created, error: createError } = await supabase
        .from('income_sources')
        .insert({
          user_id: userId,
          label: parsed.data.sourceLabel,
          kind: parsed.data.kind,
          expected_paise: amountPaise,
        })
        .select('id')
        .single();

      if (createError || !created) {
        console.error('income source insert failed', createError);
        return { ok: false, error: 'We could not save that.' };
      }
      sourceId = created.id as string;
    }
  }

  const { error } = await supabase.from('incomes').insert({
    user_id: userId,
    source_id: sourceId,
    amount_paise: amountPaise,
    received_on: parsed.data.receivedOn ?? new Date().toISOString().slice(0, 10),
    note: parsed.data.note || null,
  });

  if (error) {
    console.error('income insert failed', error);
    return { ok: false, error: 'We could not save that.' };
  }

  revalidatePath('/money');
  return { ok: true, message: 'Recorded.' };
}

/**
 * Say what a spend was for.
 *
 * Only needed for the categories that could honestly be either — clothes,
 * gifts, education. Passing null returns it to the category's default, so a
 * mistaken classification is always undoable.
 */
export async function classifySpend(input: unknown): Promise<IncomeResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = z
    .object({
      id: z.string().uuid(),
      intent: z.enum(['need', 'want', 'obligation', 'savings']).nullable(),
    })
    .safeParse(input);

  if (!parsed.success) return { ok: false, error: 'We could not read that.' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase
    .from('spends')
    .update({ intent: parsed.data.intent })
    .eq('id', parsed.data.id)
    .eq('user_id', auth.user.id);

  if (error) return { ok: false, error: 'We could not save that.' };

  revalidatePath('/money');
  return { ok: true, message: 'Updated.' };
}
