import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import {
  goalProgress,
  type Contribution,
  type GoalProgress,
  type Withdrawal,
} from '@/lib/engines/savings';

/** One movement of money into or out of a goal, for its history list. */
export interface GoalEntry {
  id: string;
  kind: 'in' | 'out';
  amountPaise: number;
  /** YYYY-MM-DD. */
  on: string;
  note: string | null;
}

export interface GoalView extends GoalProgress {
  /** Newest first. Money in is a spend id; money out is a withdrawal id. */
  history: GoalEntry[];
}

/**
 * Open savings goals, each with its progress worked out from the ledger.
 *
 * What has been saved is never read from the goal: it is the opening balance,
 * plus the spends carrying the goal's id, minus the withdrawals carrying it,
 * summed here every time. Null when there is no signed-in user, so the panel is
 * not shown on the sample screen.
 */
export async function getSavingsGoals(): Promise<GoalView[] | null> {
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

  const ids = goals.map((g) => g.id as string);

  const [inRes, outRes] = await Promise.all([
    supabase
      .from('spends')
      .select('id, savings_goal_id, amount_paise, spent_on, note')
      .eq('user_id', userId)
      .in('savings_goal_id', ids),
    supabase
      .from('savings_withdrawals')
      .select('id, savings_goal_id, amount_paise, withdrawn_on, note')
      .eq('user_id', userId)
      .in('savings_goal_id', ids),
  ]);

  const contributions = new Map<string, Contribution[]>();
  const withdrawals = new Map<string, Withdrawal[]>();
  const history = new Map<string, GoalEntry[]>();

  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };

  for (const row of inRes.data ?? []) {
    const key = row.savings_goal_id as string;
    // bigint arrives as a string from PostgREST.
    const amountPaise = Number(row.amount_paise);
    push(contributions, key, { amountPaise, spentOn: row.spent_on as string });
    push(history, key, {
      id: row.id as string,
      kind: 'in',
      amountPaise,
      on: row.spent_on as string,
      note: (row.note as string) ?? null,
    });
  }

  for (const row of outRes.data ?? []) {
    const key = row.savings_goal_id as string;
    const amountPaise = Number(row.amount_paise);
    push(withdrawals, key, { amountPaise, withdrawnOn: row.withdrawn_on as string });
    push(history, key, {
      id: row.id as string,
      kind: 'out',
      amountPaise,
      on: row.withdrawn_on as string,
      note: (row.note as string) ?? null,
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  return goals.map((g) => {
    const id = g.id as string;
    return {
      ...goalProgress(
        {
          id,
          label: g.label as string,
          targetPaise: Number(g.target_paise),
          openingPaise: Number(g.opening_paise),
          startedOn: g.started_on as string,
          targetDate: (g.target_date as string) ?? null,
        },
        contributions.get(id) ?? [],
        today,
        withdrawals.get(id) ?? [],
      ),
      history: (history.get(id) ?? []).sort((a, b) => b.on.localeCompare(a.on)),
    };
  });
}
