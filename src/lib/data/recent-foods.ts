import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * The foods this person actually eats, with the portion they actually use.
 *
 * People eat the same things. Someone who logs "150 g dosa" on Monday will log
 * it again on Thursday, and making them search, pick a portion mode, type the
 * weight and choose a meal every time is the friction that ends food logging
 * for most people who try it. The whole plan depends on entries arriving, so
 * the cost of adding one is not a detail.
 *
 * Ordered by how often it has been logged rather than how recently: the point
 * is to surface staples, and a one-off restaurant meal from yesterday is not a
 * staple.
 */

export interface RecentFood {
  foodId: string;
  /** What the entry looked like, e.g. "150 g Dosa (plain)". */
  description: string;
  /** The portion as entered, ready to replay. */
  quantity: number;
  unitLabel: string;
  kcal: number;
  kcalLow: number | null;
  kcalHigh: number | null;
  timesLogged: number;
}

/** How far back to look, and how many rows to read to work it out. */
const WINDOW_DAYS = 45;
const SCAN_LIMIT = 200;

export async function getRecentFoods(limit = 6): Promise<RecentFood[]> {
  if (!supabaseConfigured) return [];

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from('food_logs')
    .select('food_id, description, quantity, unit_label, kcal, kcal_low, kcal_high, logged_at')
    .eq('user_id', auth.user.id)
    .gte('log_date', since)
    .not('food_id', 'is', null)
    .order('logged_at', { ascending: false })
    .limit(SCAN_LIMIT);

  if (!data || data.length === 0) return [];

  /*
   * Group in JS rather than SQL.
   *
   * PostgREST cannot express "distinct on (food_id) ordered by count", and this
   * is a couple of hundred rows for one user — small enough that a round trip
   * to a custom RPC would cost more than it saves.
   *
   * The key is food *and* portion: 100 g of rice and 250 g of rice are two
   * different things to re-log, and collapsing them would hand someone the
   * wrong amount with a single tap and no obvious way to notice.
   */
  const groups = new Map<string, RecentFood>();

  for (const row of data) {
    const key = `${row.food_id}:${row.unit_label}:${row.quantity}`;
    const existing = groups.get(key);

    if (existing) {
      existing.timesLogged += 1;
      continue;
    }

    groups.set(key, {
      foodId: row.food_id as string,
      description: row.description as string,
      quantity: Number(row.quantity),
      unitLabel: (row.unit_label as string) ?? 'g',
      kcal: Math.round(Number(row.kcal)),
      kcalLow: row.kcal_low == null ? null : Math.round(Number(row.kcal_low)),
      kcalHigh: row.kcal_high == null ? null : Math.round(Number(row.kcal_high)),
      timesLogged: 1,
    });
  }

  return [...groups.values()]
    // Most-logged first; the scan order already broke ties by recency.
    .sort((a, b) => b.timesLogged - a.timesLogged)
    .slice(0, limit);
}
