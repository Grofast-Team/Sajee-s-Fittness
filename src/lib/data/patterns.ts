import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { findCorrelations, type CorrelationResult, type Series } from '@/lib/engines/correlate';

/**
 * Build one aligned row per day, then look for patterns across them.
 *
 * Alignment is the whole job. Every series is indexed by the same day offset,
 * with a null wherever there was no reading, so the engine can pair days
 * honestly rather than comparing the fourteenth sleep entry against the
 * fourteenth weigh-in — which would be a different day and a spurious result.
 */

const WINDOW_DAYS = 90;

export async function getPatterns(): Promise<CorrelationResult | null> {
  if (!supabaseConfigured) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const userId = auth.user.id;
  const start = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const startIso = start.toISOString().slice(0, 10);

  const [dailyRes, sleepRes, feedbackRes, weightRes, spendRes] = await Promise.all([
    supabase
      .from('daily_logs')
      .select('log_date, kcal, steps, water_ml')
      .eq('user_id', userId)
      .gte('log_date', startIso),
    supabase
      .from('sleep_logs')
      .select('log_date, minutes')
      .eq('user_id', userId)
      .gte('log_date', startIso),
    supabase
      .from('session_feedback')
      .select('performed_on, difficulty')
      .eq('user_id', userId)
      .gte('performed_on', startIso),
    supabase
      .from('measurements')
      .select('measured_on, weight_kg')
      .eq('user_id', userId)
      .gte('measured_on', startIso)
      .not('weight_kg', 'is', null)
      .order('measured_on', { ascending: true }),
    supabase
      .from('spends')
      .select('spent_on, amount_paise')
      .eq('user_id', userId)
      .eq('category', 'eating_out')
      .gte('spent_on', startIso),
  ]);

  // A fixed calendar spine. Every series is written onto it by date, so index
  // i means the same day in all of them.
  const dates: string[] = [];
  for (let d = 0; d < WINDOW_DAYS; d += 1) {
    dates.push(new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10));
  }
  const indexOf = new Map(dates.map((date, i) => [date, i]));

  const blank = () => new Array<number | null>(WINDOW_DAYS).fill(null);

  const kcal = blank();
  const steps = blank();
  const waterMl = blank();
  const sleepHours = blank();
  const sessionDifficulty = blank();
  const weightChange = blank();
  const eatingOutSpend = blank();

  for (const row of dailyRes.data ?? []) {
    const i = indexOf.get(row.log_date as string);
    if (i === undefined) continue;
    // Zero kcal means "nothing logged", not "ate nothing". Treating it as a
    // real reading would drag every food correlation towards a floor of days
    // the user simply did not open the app.
    if (row.kcal != null && Number(row.kcal) > 0) kcal[i] = Number(row.kcal);
    if (row.steps != null) steps[i] = Number(row.steps);
    if (row.water_ml != null && Number(row.water_ml) > 0) waterMl[i] = Number(row.water_ml);
  }

  for (const row of sleepRes.data ?? []) {
    const i = indexOf.get(row.log_date as string);
    if (i !== undefined && row.minutes != null) sleepHours[i] = Number(row.minutes) / 60;
  }

  for (const row of feedbackRes.data ?? []) {
    const i = indexOf.get(row.performed_on as string);
    if (i !== undefined) sessionDifficulty[i] = Number(row.difficulty);
  }

  /*
   * Weight as a day-to-day *change*, not a level.
   *
   * Correlating intake against absolute weight would mostly measure the fact
   * that both drift over months, and would report a strong relationship for
   * anyone steadily losing weight regardless of what they ate on any given
   * day. The change between consecutive weigh-ins is the quantity a daily
   * behaviour could plausibly move.
   */
  const weights = (weightRes.data ?? []).map((w) => ({
    date: w.measured_on as string,
    kg: Number(w.weight_kg),
  }));

  for (let k = 1; k < weights.length; k += 1) {
    const previous = weights[k - 1];
    const current = weights[k];
    const gapDays =
      (Date.parse(current.date) - Date.parse(previous.date)) / 86_400_000;

    // Only consecutive-ish readings. A three-week gap says nothing about any
    // single day inside it.
    if (gapDays < 1 || gapDays > 3) continue;

    const i = indexOf.get(current.date);
    if (i !== undefined) weightChange[i] = (current.kg - previous.kg) / gapDays;
  }

  for (const row of spendRes.data ?? []) {
    const i = indexOf.get(row.spent_on as string);
    if (i === undefined) continue;
    eatingOutSpend[i] = (eatingOutSpend[i] ?? 0) + Number(row.amount_paise) / 100;
  }

  const series: Series[] = [
    { key: 'kcal', label: 'what you ate', values: kcal },
    { key: 'steps', label: 'your steps', values: steps },
    { key: 'waterMl', label: 'water', values: waterMl },
    { key: 'sleepHours', label: 'sleep', values: sleepHours },
    { key: 'sessionDifficulty', label: 'how hard sessions felt', values: sessionDifficulty },
    { key: 'weightChange', label: 'day-to-day weight change', values: weightChange },
    { key: 'eatingOutSpend', label: 'spending on eating out', values: eatingOutSpend },
  ];

  return findCorrelations(series);
}
