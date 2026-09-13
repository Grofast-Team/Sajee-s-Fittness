import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import {
  salaryTrend,
  whereDidItGo,
  type Intent,
  type SalaryBreakdown,
  type SalaryTrend,
} from '@/lib/engines/salary';

export interface SalaryView {
  breakdown: SalaryBreakdown;
  trend: SalaryTrend;
  /** Existing sources, so the entry form can offer them. */
  sources: { id: string; label: string; kind: string }[];
  /** Spends that are still unclassified, largest first — the ones worth asking about. */
  unclassified: { id: string; category: string; amountPaise: number; note: string | null; spentOn: string }[];
}

/**
 * Where this money-month's income went.
 *
 * Uses the same window as the rest of the money screen. That matters more than
 * it looks: someone paid on the 28th should set their money month to start on
 * the 28th, and then "this month's salary" and "this month's spending" refer to
 * the same stretch of days rather than straddling a payday.
 */
export async function getSalaryView(windowStart: string, windowEnd: string): Promise<SalaryView | null> {
  if (!supabaseConfigured) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const userId = auth.user.id;

  // A year of income for the trend, independent of the current window.
  const yearAgo = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);

  const [incomeRes, historyRes, spendsRes, sourcesRes] = await Promise.all([
    supabase
      .from('incomes')
      .select('amount_paise')
      .eq('user_id', userId)
      .gte('received_on', windowStart)
      .lt('received_on', windowEnd),
    supabase
      .from('incomes')
      .select('amount_paise, received_on')
      .eq('user_id', userId)
      .gte('received_on', yearAgo),
    supabase
      .from('spends')
      .select('id, amount_paise, category, intent, note, spent_on')
      .eq('user_id', userId)
      .gte('spent_on', windowStart)
      .lt('spent_on', windowEnd),
    supabase
      .from('income_sources')
      .select('id, label, kind')
      .eq('user_id', userId)
      .is('ended_on', null)
      .order('created_at', { ascending: true }),
  ]);

  const incomes = incomeRes.data ?? [];
  const spends = spendsRes.data ?? [];

  const breakdown = whereDidItGo({
    incomePaise: incomes.reduce((s, i) => s + Number(i.amount_paise), 0),
    incomeCount: incomes.length,
    spends: spends.map((s) => ({
      amountPaise: Number(s.amount_paise),
      category: s.category as string,
      intent: (s.intent as Intent | null) ?? null,
    })),
  });

  const trend = salaryTrend(
    (historyRes.data ?? []).map((i) => ({
      receivedOn: i.received_on as string,
      amountPaise: Number(i.amount_paise),
    })),
    new Date().toISOString().slice(0, 10),
  );

  // The categories the engine refuses to guess about. Asking about the largest
  // few moves the wants figure furthest for the least effort.
  const AMBIGUOUS = new Set(['clothes', 'gifts', 'education', 'personal_care', 'family', 'other']);
  const unclassified = spends
    .filter((s) => s.intent == null && AMBIGUOUS.has(s.category as string))
    .map((s) => ({
      id: s.id as string,
      category: s.category as string,
      amountPaise: Number(s.amount_paise),
      note: (s.note as string) ?? null,
      spentOn: s.spent_on as string,
    }))
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .slice(0, 5);

  return {
    breakdown,
    trend,
    sources: (sourcesRes.data ?? []).map((s) => ({
      id: s.id as string,
      label: s.label as string,
      kind: s.kind as string,
    })),
    unclassified,
  };
}
