import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * Has this user finished setup?
 *
 * Kept deliberately tiny — one indexed lookup — because the app layout calls it
 * on every page load to decide whether to send someone to onboarding.
 */
export async function needsOnboarding(): Promise<boolean> {
  // Sample mode is a legitimate state, not an unfinished signup.
  if (!supabaseConfigured) return false;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;

  const { data } = await supabase
    .from('plans')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('is_active', true)
    .maybeSingle();

  return data === null;
}
