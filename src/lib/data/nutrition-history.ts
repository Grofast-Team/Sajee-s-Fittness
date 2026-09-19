import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * The last several days of logged nutrition, for the weekly chart on Progress.
 *
 * Deliberately reads `daily_logs`, not `food_logs` — the rollup table already
 * has one row per day with a summed kcal and protein figure, written by the
 * same triggers `getDayView()` relies on for today's numbers. Recomputing the
 * sum from individual food entries here would be a second, parallel place for
 * that arithmetic to disagree with itself.
 *
 * No smoothing, no trend fit: `src/lib/engines/trend.ts`'s EWMA/OLS machinery
 * exists because a single weigh-in is dominated by water and salt, not the
 * real signal. A day's *logged* calorie total has no equivalent noise problem
 * — it is not an estimate of something else, it is the number itself — so
 * this is a plain read, not an engine.
 */

export interface DayNutrition {
  /** YYYY-MM-DD */
  date: string;
  kcal: number;
  proteinG: number;
}

const SAMPLE_HISTORY: DayNutrition[] = [
  { date: '', kcal: 1980, proteinG: 88 },
  { date: '', kcal: 2140, proteinG: 95 },
  { date: '', kcal: 1870, proteinG: 79 },
  { date: '', kcal: 2050, proteinG: 91 },
  { date: '', kcal: 2210, proteinG: 84 },
  { date: '', kcal: 1690, proteinG: 72 },
  { date: '', kcal: 1960, proteinG: 90 },
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getNutritionHistory(days = 7): Promise<DayNutrition[]> {
  if (!supabaseConfigured) {
    // Dated relative to today so the chart's day labels line up, exactly as
    // sampleDay() does for the weight trend.
    const today = new Date();
    return SAMPLE_HISTORY.map((day, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (SAMPLE_HISTORY.length - 1 - i));
      return { ...day, date: isoDate(d) };
    });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));

  const { data } = await supabase
    .from('daily_logs')
    .select('log_date, kcal, protein_g')
    .eq('user_id', auth.user.id)
    .gte('log_date', isoDate(start))
    .lte('log_date', isoDate(today))
    .order('log_date', { ascending: true });

  const byDate = new Map((data ?? []).map((row) => [row.log_date as string, row]));

  // Fill every day in the window, not just the ones with a row - a day with
  // nothing logged is a real zero, not a gap to skip silently.
  const result: DayNutrition[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const date = isoDate(d);
    const row = byDate.get(date);
    result.push({
      date,
      kcal: row ? Number(row.kcal) : 0,
      proteinG: row ? Number(row.protein_g) : 0,
    });
  }
  return result;
}
