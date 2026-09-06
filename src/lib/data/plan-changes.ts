import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * When the plan last changed, and why.
 *
 * The weekly review can move someone's calorie target while they are asleep.
 * Doing that without telling them would be the worst kind of silent
 * behaviour: they would open the app, see a different number from yesterday,
 * and have no way to find out what happened. A plan that adapts has to be a
 * plan that explains.
 */

export interface PlanChange {
  decision: string;
  lever: string | null;
  deltaKcal: number;
  deltaSteps: number;
  /** The engine's own wording, shown verbatim. */
  message: string;
  changedOn: string;
  /** True while it is recent enough to be worth announcing on Today. */
  isRecent: boolean;
}

/** How long a change stays worth announcing. */
const ANNOUNCE_DAYS = 7;

export async function getLastPlanChange(): Promise<PlanChange | null> {
  if (!supabaseConfigured) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  // Only applied adjustments. The holds are in the table for auditing, but
  // "we looked and changed nothing" is not news worth interrupting anyone for.
  const { data } = await supabase
    .from('plan_adjustments')
    .select('decision, lever, delta_kcal, delta_steps, created_at')
    .eq('user_id', auth.user.id)
    .eq('applied', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // The wording lives on the plan the adjustment produced, so the explanation
  // and the numbers can never drift apart.
  const { data: plan } = await supabase
    .from('plans')
    .select('rationale')
    .eq('user_id', auth.user.id)
    .eq('is_active', true)
    .maybeSingle();

  const rationale = (plan?.rationale as Record<string, unknown>) ?? {};
  const changedOn = (data.created_at as string).slice(0, 10);
  const ageDays = Math.floor(
    (Date.now() - new Date(data.created_at as string).getTime()) / 86_400_000,
  );

  return {
    decision: data.decision as string,
    lever: (data.lever as string) ?? null,
    deltaKcal: data.delta_kcal ?? 0,
    deltaSteps: data.delta_steps ?? 0,
    message:
      typeof rationale.adaptation === 'string'
        ? rationale.adaptation
        : 'Your plan was adjusted based on the last few weeks.',
    changedOn,
    isRecent: ageDays <= ANNOUNCE_DAYS,
  };
}
