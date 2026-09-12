'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { CATEGORIES, parseAmountToPaise } from '@/lib/engines/money';

/**
 * Adding, changing and settling recurring commitments.
 *
 * A commitment is a plan. Settling one writes an ordinary `spends` row rather
 * than flipping a paid flag, so the ledger stays the single record of money
 * going out and "is the rent paid" is answered from it.
 */

export type CommitmentResult = { ok: true; message: string } | { ok: false; error: string };

const categoryIds = CATEGORIES.map((c) => c.id) as [string, ...string[]];

const commitmentSchema = z.object({
  label: z.string().trim().min(1).max(60),
  /** Rupees as typed. Parsed to paise here; money never touches a float. */
  amount: z.string().min(1).max(20),
  category: z.enum(categoryIds),
  cadence: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  dueDay: z.coerce.number().int().min(1).max(28).default(1),
  note: z.string().trim().max(200).optional(),
});

export async function addCommitment(input: unknown): Promise<CommitmentResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = commitmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that. Check the amount.' };

  const amountPaise = parseAmountToPaise(parsed.data.amount);
  if (amountPaise === null || amountPaise <= 0) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase.from('commitments').insert({
    user_id: auth.user.id,
    label: parsed.data.label,
    amount_paise: amountPaise,
    category: parsed.data.category,
    cadence: parsed.data.cadence,
    due_day: parsed.data.dueDay,
    note: parsed.data.note || null,
  });

  if (error) {
    console.error('commitment insert failed', error);
    return { ok: false, error: 'We could not save that.' };
  }

  revalidatePath('/money');
  return { ok: true, message: `${parsed.data.label} added.` };
}

/**
 * Record that a commitment has been paid.
 *
 * Writes a real spend carrying `commitment_id`. Nothing else marks it paid:
 * a separate flag could drift out of step with the ledger, and then the
 * outstanding figure — the one number this whole feature exists to make
 * trustworthy — would be quietly wrong.
 */
export async function markCommitmentPaid(input: unknown): Promise<CommitmentResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = z
    .object({
      id: z.string().uuid(),
      /** Defaults to the commitment's own amount when not overridden. */
      amount: z.string().max(20).optional(),
      paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .safeParse(input);

  if (!parsed.success) return { ok: false, error: 'We could not read that.' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // Read it back rather than trusting an amount from the client: this writes
  // to the ledger, and the ledger drives every other figure on the screen.
  const { data: commitment } = await supabase
    .from('commitments')
    .select('id, label, amount_paise, category')
    .eq('id', parsed.data.id)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (!commitment) return { ok: false, error: 'We could not find that commitment.' };

  const override = parsed.data.amount ? parseAmountToPaise(parsed.data.amount) : null;
  const amountPaise = override ?? Number(commitment.amount_paise);

  if (amountPaise <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };

  const { error } = await supabase.from('spends').insert({
    user_id: auth.user.id,
    spent_on: parsed.data.paidOn ?? new Date().toISOString().slice(0, 10),
    amount_paise: amountPaise,
    category: commitment.category,
    commitment_id: commitment.id,
    note: commitment.label,
  });

  if (error) {
    console.error('commitment payment failed', error);
    return { ok: false, error: 'We could not record that payment.' };
  }

  revalidatePath('/money');
  return { ok: true, message: `${commitment.label} recorded as paid.` };
}

/**
 * Stop a commitment without erasing it.
 *
 * Ended rather than deleted, so past months still explain themselves. A
 * subscription cancelled in June should not make May's figures change.
 */
export async function endCommitment(id: string): Promise<CommitmentResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Unknown commitment.' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase
    .from('commitments')
    .update({ ended_on: new Date().toISOString().slice(0, 10) })
    .eq('id', parsed.data)
    .eq('user_id', auth.user.id);

  if (error) return { ok: false, error: 'We could not stop that one.' };

  revalidatePath('/money');
  return { ok: true, message: 'Stopped. Past months are unchanged.' };
}
