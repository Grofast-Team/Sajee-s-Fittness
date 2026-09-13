import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import type { Commitment } from '@/lib/engines/commitments';
import type { Intent } from '@/lib/engines/salary';
import {
  moneyTrends,
  trendsFrom,
  TREND_MONTHS,
  type MoneyTrends,
  type TrendsInput,
} from '@/lib/engines/money-trends';

export interface MoneyTrendsView {
  isSample: boolean;
  trends: MoneyTrends;
}

type Client = Awaited<ReturnType<typeof createClient>>;

/** PostgREST returns at most 1,000 rows a request. */
const PAGE = 1000;

/**
 * Every row of a query, a page at a time.
 *
 * Seven months of someone recording bus fares passes a thousand spends, and a
 * silently truncated read would show the oldest months as quieter than they
 * were — a trend invented by a row limit.
 */
async function all<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error || !data) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

/**
 * The last few money-months, for the trends screen.
 *
 * Loads from the start of the oldest month the engine can show, and asks
 * separately whether anything was recorded before that — which is what tells
 * a quiet first month apart from one that was simply not yet being recorded.
 */
export async function getMoneyTrends(): Promise<MoneyTrendsView> {
  const today = new Date().toISOString().slice(0, 10);

  if (!supabaseConfigured) return sample(today);

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return sample(today);
  const userId = auth.user.id;

  const { data: settings } = await supabase
    .from('money_settings')
    .select('month_start_day')
    .eq('user_id', userId)
    .maybeSingle();
  const monthStartDay = settings?.month_start_day ?? 1;
  const from = trendsFrom(today, monthStartDay);

  const [spends, incomes, withdrawalsRes, commitmentsRes, earlierSpend, earlierIncome] = await Promise.all([
    all((lo, hi) =>
      supabase
        .from('spends')
        .select('amount_paise, category, intent, spent_on')
        .eq('user_id', userId)
        .gte('spent_on', from)
        .order('spent_on', { ascending: true })
        .order('id', { ascending: true })
        .range(lo, hi),
    ),
    all((lo, hi) =>
      supabase
        .from('incomes')
        .select('amount_paise, received_on')
        .eq('user_id', userId)
        .gte('received_on', from)
        .order('received_on', { ascending: true })
        .order('id', { ascending: true })
        .range(lo, hi),
    ),
    supabase
      .from('savings_withdrawals')
      .select('amount_paise, withdrawn_on')
      .eq('user_id', userId)
      .gte('withdrawn_on', from),
    supabase
      .from('commitments')
      .select('id, label, amount_paise, category, cadence, due_day, started_on, ended_on, note')
      .eq('user_id', userId),
    recordedBefore(supabase, 'spends', 'spent_on', userId, from),
    recordedBefore(supabase, 'incomes', 'received_on', userId, from),
  ]);

  const input: TrendsInput = {
    // bigint arrives as a string from PostgREST.
    spends: spends.map((s) => ({
      amountPaise: Number(s.amount_paise),
      category: s.category as string,
      intent: (s.intent as Intent | null) ?? null,
      spentOn: s.spent_on as string,
    })),
    incomes: incomes.map((i) => ({
      amountPaise: Number(i.amount_paise),
      receivedOn: i.received_on as string,
    })),
    withdrawals: (withdrawalsRes.data ?? []).map((w) => ({
      amountPaise: Number(w.amount_paise),
      withdrawnOn: w.withdrawn_on as string,
    })),
    commitments: (commitmentsRes.data ?? []).map((c) => ({
      id: c.id as string,
      label: c.label as string,
      amountPaise: Number(c.amount_paise),
      category: c.category as string,
      cadence: c.cadence as Commitment['cadence'],
      dueDay: Number(c.due_day),
      startedOn: c.started_on as string,
      endedOn: (c.ended_on as string) ?? null,
      note: (c.note as string) ?? null,
    })),
    monthStartDay,
    today,
    recordedBefore: earlierSpend || earlierIncome,
  };

  return { isSample: false, trends: moneyTrends(input) };
}

async function recordedBefore(
  supabase: Client,
  table: 'spends' | 'incomes',
  column: 'spent_on' | 'received_on',
  userId: string,
  before: string,
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .select('id')
    .eq('user_id', userId)
    .lt(column, before)
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * A made-up person's last few months, for a deployment with no database.
 * Labelled as a sample on screen; dates are relative to today so it never ages.
 */
function sample(today: string): MoneyTrendsView {
  const from = trendsFrom(today, 1);
  const month = (n: number, day: number) => {
    const index = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1 + TREND_MONTHS - n;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const spends: TrendsInput['spends'] = [];
  const incomes: TrendsInput['incomes'] = [];
  const add = (spentOn: string, rupees: number, category: string) =>
    spends.push({ spentOn, amountPaise: rupees * 100, category, intent: null });

  // Three full months back, then this month up to today.
  for (const [n, eatingOut, groceries] of [
    [3, 2400, 6100],
    [2, 2100, 6400],
    [1, 3800, 6000],
  ] as const) {
    incomes.push({ receivedOn: month(n, 1), amountPaise: 5_000_000 });
    add(month(n, 2), 12_000, 'rent');
    add(month(n, 6), 2_100, 'bills');
    add(month(n, 9), groceries, 'groceries');
    add(month(n, 14), eatingOut, 'eating_out');
    add(month(n, 18), 1_900, 'transport');
    add(month(n, 22), 5_000, 'savings');
  }
  incomes.push({ receivedOn: month(0, 1), amountPaise: 5_000_000 });
  for (const [day, rupees, category] of [
    [2, 12_000, 'rent'],
    [6, 2_100, 'bills'],
    [9, 3_200, 'groceries'],
  ] as const) {
    if (month(0, day) <= today) add(month(0, day), rupees, category);
  }

  const commitment = (label: string, rupees: number, category: string, cadence: Commitment['cadence']) => ({
    id: label,
    label,
    amountPaise: rupees * 100,
    category,
    cadence,
    dueDay: 2,
    startedOn: '2020-01-01',
    endedOn: null,
    note: null,
  });

  return {
    isSample: true,
    trends: moneyTrends({
      spends,
      incomes,
      withdrawals: [],
      commitments: [
        commitment('Rent', 12_000, 'rent', 'monthly'),
        commitment('Electricity', 2_100, 'bills', 'monthly'),
        commitment('Netflix', 649, 'entertainment', 'monthly'),
        commitment('Health insurance', 14_000, 'medical', 'yearly'),
      ],
      monthStartDay: 1,
      today,
      recordedBefore: true,
    }),
  };
}
