import 'server-only';
import { z } from 'zod';
import { SPEND_CATEGORY_IDS } from '@/lib/engines/money';
import type { createClient } from '@/lib/supabase/server';

/**
 * The one way a new spend reaches the ledger.
 *
 * "Add a spend" and a confirmed statement import both write through here, so
 * an imported spend cannot contain anything a typed one could not: the same
 * integer paise, the same categories, the same note length. Not a 'use server'
 * module — it takes a database client, and nothing a browser can call should.
 */

export const spendInputSchema = z.object({
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

export type SpendInput = z.infer<typeof spendInputSchema>;

type Client = Awaited<ReturnType<typeof createClient>>;

/** Inserts are sent in chunks this size; a statement can hold thousands of lines. */
const CHUNK = 500;

/**
 * Validate and insert spends. Ids are chosen here, so a caller can link each
 * spend back to where it came from without relying on the order rows return.
 * All-or-nothing validation: one invalid input and nothing is written.
 */
export async function insertSpends(
  supabase: Client,
  userId: string,
  inputs: SpendInput[],
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const parsed = inputs.map((input) => spendInputSchema.safeParse(input));
  if (parsed.some((p) => !p.success)) return { ok: false, error: 'We could not read that amount.' };

  const today = new Date().toISOString().slice(0, 10);
  const rows = parsed.map((p) => {
    const s = p.data!;
    return {
      id: crypto.randomUUID(),
      user_id: userId,
      amount_paise: s.amountPaise,
      category: s.category,
      note: s.note || null,
      spent_on: s.spentOn ?? today,
    };
  });

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('spends').insert(rows.slice(i, i + CHUNK));
    if (error) {
      console.error('spend insert failed', error);
      // Take back what this call already wrote, so a retry does not double it.
      const written = rows.slice(0, i).map((r) => r.id);
      if (written.length > 0) await supabase.from('spends').delete().in('id', written).eq('user_id', userId);
      return { ok: false, error: "We couldn't save that. Please try again." };
    }
  }

  return { ok: true, ids: rows.map((r) => r.id) };
}
