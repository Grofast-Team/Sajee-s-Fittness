import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { summariseFoodCost, type FoodCostDay, type FoodCostView } from '@/lib/engines/food-cost';

/**
 * What the meals you logged are worth, for the money month.
 *
 * Bridges two halves of the app that were computing useful things and never
 * showing them to each other: `food_logs.cost` has been written on every entry
 * since food logging existed and was read nowhere, and the daily food budget
 * collected at onboarding was only ever displayed back as a static string.
 *
 * The window is the user's *money* month — which may start on the 5th — rather
 * than the calendar month, so this lines up with the spending it sits beside.
 */

export async function getFoodSpend(
  startDate: string,
  endDate: string,
): Promise<FoodCostView | null> {
  if (!supabaseConfigured) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const [logsRes, budgetRes, planRes, dailyRes] = await Promise.all([
    supabase
      .from('food_logs')
      .select('log_date, cost')
      .eq('user_id', auth.user.id)
      .gte('log_date', startDate)
      .lte('log_date', endDate),
    /*
     * The daily food budget from onboarding.
     *
     * `budgets` is versioned by `effective_from`, so take the most recent one
     * that has already started rather than whichever row comes back first.
     */
    supabase
      .from('budgets')
      .select('amount, period, effective_from')
      .eq('user_id', auth.user.id)
      .eq('period', 'daily')
      .lte('effective_from', endDate)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('plans')
      .select('energy_target_kcal')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle(),
    /*
     * How much energy actually reached the log over the window.
     *
     * The cost estimate can only see food that was entered. Comparing a
     * partial log against a whole day's budget would report someone as
     * comfortably under when the truth is simply unknown, so the engine needs
     * to know what share of their eating it is actually looking at.
     */
    supabase
      .from('daily_logs')
      .select('kcal')
      .eq('user_id', auth.user.id)
      .gte('log_date', startDate)
      .lte('log_date', endDate),
  ]);

  const rows = logsRes.data ?? [];

  // Group by day, tracking how many entries we could price. Coverage is the
  // difference between "you eat cheaply" and "we only priced half your food",
  // and the engine needs to be able to tell those apart.
  const byDay = new Map<string, FoodCostDay>();

  for (const row of rows) {
    const date = row.log_date as string;
    const existing = byDay.get(date) ?? {
      date,
      costRupees: null,
      entriesPriced: 0,
      entriesTotal: 0,
    };

    existing.entriesTotal += 1;

    if (row.cost != null) {
      existing.entriesPriced += 1;
      existing.costRupees = (existing.costRupees ?? 0) + Number(row.cost);
    }

    byDay.set(date, existing);
  }

  const daysElapsed = Math.max(
    1,
    Math.round(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000,
    ) + 1,
  );

  const targetKcal = planRes.data?.energy_target_kcal ?? null;
  const loggedDays = dailyRes.data ?? [];
  const loggedKcal = loggedDays.reduce((s, d) => s + Number(d.kcal ?? 0), 0);

  // Measured against the days that actually have entries, not the whole month:
  // days someone did not open the app are not days they under-ate.
  const daysWithFood = byDay.size;
  const energyCoverage =
    targetKcal && daysWithFood > 0 ? loggedKcal / (targetKcal * daysWithFood) : null;

  return summariseFoodCost({
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    dailyBudgetRupees: budgetRes.data?.amount == null ? null : Number(budgetRes.data.amount),
    daysElapsed,
    energyCoverage,
  });
}
