import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { goalProgress, type Contribution, type GoalProgress } from '@/lib/engines/savings';

/**
 * Open savings goals, each with its progress worked out from the ledger.
 *
 * What has been saved is never read from the goal: it is the opening balance
 * plus the spends carrying the goal's id, summed here every time. Null when
 * there is no signed-in user, so the panel is not shown on the sample screen.
 */
export async function getSavingsGoals(): Promise<GoalProgress[] | null> {
  if (!supabaseConfigured) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const userId = auth.user.id;

  const { data: goals } = await supabase
    .from('savings_goals')
    .select('id, label, target_paise, opening_paise, started_on, target_date')
    .eq('user_id', userId)
    .is('closed_on', null)
    .order('created_at', { ascending: true });

  if (!goals || goals.length === 0) return [];

  const { data: rows } = await supabase
    .from('spends')
    .select('savings_goal_id, amount_paise, spent_on')
    .eq('user_id', userId)
    .in(
      'savings_goal_id',
      goals.map((g) => g.id as string),
    );

  const byGoal = new Map<string, Contribution[]>();
  for (const row of rows ?? []) {
    const key = row.savings_goal_id as string;
    const list = byGoal.get(key) ?? [];
    // bigint arrives as a string from PostgREST.
    list.push({ amountPaise: Number(row.amount_paise), spentOn: row.spent_on as string });
    byGoal.set(key, list);
  }

  const today = new Date().toISOString().slice(0, 10);

  return goals.map((g) =>
    goalProgress(
      {
        id: g.id as string,
        label: g.label as string,
        targetPaise: Number(g.target_paise),
        openingPaise: Number(g.opening_paise),
        startedOn: g.started_on as string,
        targetDate: (g.target_date as string) ?? null,
      },
      byGoal.get(g.id as string) ?? [],
      today,
    ),
  );
}
