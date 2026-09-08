import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import {
  monthWindow,
  summariseMonth,
  type MonthSummary,
  type MonthWindow,
} from '@/lib/engines/money';

/**
 * This money month: what was spent, and what is left.
 *
 * Like the food side, signed-out visitors get a clearly-labelled sample so the
 * screen can be understood before committing to anything — and `isSample` is
 * threaded through so the UI can say so plainly rather than letting invented
 * figures pass as someone's real spending.
 */

export interface SpendRow {
  id: string;
  amountPaise: number;
  category: string;
  note: string | null;
  spentOn: string;
}

export interface MoneyMonthView {
  isSample: boolean;
  window: MonthWindow;
  summary: MonthSummary;
  recent: SpendRow[];
  monthStartDay: number;
}

const SAMPLE_SPENDS: SpendRow[] = [
  { id: 's1', amountPaise: 1250000, category: 'rent', note: null, spentOn: '2026-09-01' },
  { id: 's2', amountPaise: 34000, category: 'groceries', note: 'Weekly vegetables', spentOn: '2026-09-03' },
  { id: 's3', amountPaise: 18000, category: 'eating_out', note: null, spentOn: '2026-09-04' },
  { id: 's4', amountPaise: 6000, category: 'transport', note: 'Bus pass', spentOn: '2026-09-04' },
  { id: 's5', amountPaise: 79900, category: 'phone_internet', note: null, spentOn: '2026-09-05' },
  { id: 's6', amountPaise: 22000, category: 'groceries', note: null, spentOn: '2026-09-06' },
];

export async function getMoneyMonth(): Promise<MoneyMonthView> {
  const today = new Date();

  if (!supabaseConfigured) return sample(today);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return sample(today);

  const { data: settings } = await supabase
    .from('money_settings')
    .select('monthly_limit_paise, month_start_day')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  const monthStartDay = settings?.month_start_day ?? 1;
  const window = monthWindow(today, monthStartDay);

  const { data: rows } = await supabase
    .from('spends')
    .select('id, amount_paise, category, note, spent_on')
    .eq('user_id', auth.user.id)
    .gte('spent_on', window.start)
    .lt('spent_on', window.end)
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false });

  const spends: SpendRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    // bigint arrives as a string from PostgREST; Number is exact well beyond
    // any personal spend, but the conversion has to be explicit.
    amountPaise: Number(r.amount_paise),
    category: r.category as string,
    note: (r.note as string) ?? null,
    spentOn: r.spent_on as string,
  }));

  return {
    isSample: false,
    window,
    monthStartDay,
    summary: summariseMonth(
      spends.map((s) => ({ amountPaise: s.amountPaise, category: s.category, spentOn: s.spentOn })),
      window,
      settings?.monthly_limit_paise == null ? null : Number(settings.monthly_limit_paise),
    ),
    recent: spends,
  };
}

function sample(today: Date): MoneyMonthView {
  const window = monthWindow(today, 1);
  return {
    isSample: true,
    window,
    monthStartDay: 1,
    summary: summariseMonth(
      SAMPLE_SPENDS.map((s) => ({
        amountPaise: s.amountPaise,
        category: s.category,
        spentOn: s.spentOn,
      })),
      window,
      2000000,
    ),
    recent: SAMPLE_SPENDS,
  };
}
