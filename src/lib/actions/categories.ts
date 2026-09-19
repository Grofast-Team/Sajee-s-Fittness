'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * Turning a category on or off, for every category except Fitness.
 *
 * Fitness has its own enable path - the nine-step interview in
 * saveOnboarding (src/lib/actions/onboarding.ts) - because enabling it
 * means computing a real plan, not just flipping a flag. Design spec
 * section 5 is explicit that Fitness can only become enabled through a
 * completed interview or an already-existing plan, never through this
 * generic action, so enabling 'fitness' here is refused outright.
 * Disabling it is fine - turning any category off is uniform, since there
 * is no equivalent invariant about the disabled state.
 */

export type ToggleResult = { ok: true } | { ok: false; error: string };

export async function toggleCategory(categoryKey: string, enabled: boolean): Promise<ToggleResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  if (enabled && categoryKey === 'fitness') {
    return { ok: false, error: 'Fitness turns on by completing setup, not with this switch.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase.from('user_categories').upsert(
    {
      user_id: auth.user.id,
      category_key: categoryKey,
      enabled,
      ...(enabled ? { enabled_at: new Date().toISOString() } : { disabled_at: new Date().toISOString() }),
    },
    { onConflict: 'user_id,category_key' },
  );

  if (error) {
    return { ok: false, error: 'We could not save that. Please try again.' };
  }

  // A toggle changes the nav and the dashboard shell, not one page - the
  // same shell-wide precedent as account.ts/auth.ts, not a single-path call.
  revalidatePath('/', 'layout');
  return { ok: true };
}
