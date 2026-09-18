import type { SupabaseClient } from '@supabase/supabase-js';
import { isCategoryVisible } from '@/lib/engines/categories';

/**
 * Which top-level categories this user has enabled, as the set
 * isCategoryVisible expects.
 *
 * Takes an already-authenticated client and user id rather than creating
 * its own. Every real caller - a route guard, a server action - already
 * has both from its own auth check by the time it needs this, and a
 * second createClient()/auth.getUser() round trip per call site would be
 * pure waste repeated across every guarded action in this phase.
 */
export async function getEnabledCategories(
  supabase: SupabaseClient,
  userId: string,
): Promise<ReadonlySet<string>> {
  const { data } = await supabase
    .from('user_categories')
    .select('category_key')
    .eq('user_id', userId)
    .eq('enabled', true);

  return new Set((data ?? []).map((row) => row.category_key as string));
}

/**
 * The write-path half of category gating (design spec section 8).
 *
 * A route-group layout blocks the UI path once a category is off, but not
 * a page left open in another tab from before it was disabled - that tab
 * can still submit its form after. This is the guard for that gap: called
 * at the top of a server action, before any write, on every category
 * whose actions create or extend that category's state.
 */
export async function requireCategoryEnabled(
  supabase: SupabaseClient,
  userId: string,
  categoryKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const enabled = await getEnabledCategories(supabase, userId);
  if (!isCategoryVisible(categoryKey, enabled)) {
    return { ok: false, error: 'That category is not turned on for your account.' };
  }
  return { ok: true };
}
