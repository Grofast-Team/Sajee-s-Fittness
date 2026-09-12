import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import {
  summariseCommitments,
  type Commitment,
  type CommitmentSummary,
} from '@/lib/engines/commitments';

/**
 * This month's recurring commitments, and what they leave free.
 *
 * Which ones are settled is read from the ledger — spends carrying a
 * `commitment_id` — rather than from a flag on the commitment itself. One
 * record of money going out, and the outstanding figure cannot drift away
 * from it.
 */
export async function getCommitments(
  windowStart: string,
  windowEnd: string,
  limitPaise: number | null,
  spentPaise: number,
  daysLeft: number,
): Promise<CommitmentSummary | null> {
  if (!supabaseConfigured) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const [commitmentsRes, paymentsRes] = await Promise.all([
    supabase
      .from('commitments')
      .select('id, label, amount_paise, category, cadence, due_day, started_on, ended_on, note')
      .eq('user_id', auth.user.id)
      // Ended commitments still matter for a window that overlaps their run,
      // so the engine decides — not the query.
      .order('due_day', { ascending: true }),
    supabase
      .from('spends')
      .select('commitment_id, amount_paise')
      .eq('user_id', auth.user.id)
      .not('commitment_id', 'is', null)
      .gte('spent_on', windowStart)
      .lt('spent_on', windowEnd),
  ]);

  const commitments: Commitment[] = (commitmentsRes.data ?? []).map((c) => ({
    id: c.id as string,
    label: c.label as string,
    amountPaise: Number(c.amount_paise),
    category: c.category as string,
    cadence: c.cadence as Commitment['cadence'],
    dueDay: Number(c.due_day),
    startedOn: c.started_on as string,
    endedOn: (c.ended_on as string) ?? null,
    note: (c.note as string) ?? null,
  }));

  // Several part-payments can settle one commitment, so sum rather than take
  // the first — paying rent in two halves is normal and must still read as paid.
  const paidByCommitment: Record<string, number> = {};
  for (const row of paymentsRes.data ?? []) {
    const key = row.commitment_id as string;
    paidByCommitment[key] = (paidByCommitment[key] ?? 0) + Number(row.amount_paise);
  }

  return summariseCommitments({
    commitments,
    paidByCommitment,
    windowStart,
    windowEnd,
    today: new Date().toISOString().slice(0, 10),
    limitPaise,
    spentPaise,
    daysLeft,
  });
}
