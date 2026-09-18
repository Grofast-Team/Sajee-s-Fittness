import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * Has this user finished the one thing required before reaching the app at
 * all?
 *
 * This used to mean "has an active Fitness plan" - the whole app was gated
 * behind the nine-step interview, so a user who wanted nothing but expense
 * tracking could not reach /money without answering "Sex at birth" first.
 *
 * It now means the much smaller thing the function's name implies: has
 * profiles.onboarding_done_at been stamped. Fitness is an opt-in category
 * like any other (see src/lib/engines/categories.ts) and is gated
 * separately, by its own route group - not here. See design spec section 3.
 *
 * Kept deliberately tiny - one indexed lookup - because the app layout calls
 * it on every page load to decide whether to send someone to
 * /onboarding-name.
 */
export async function needsOnboarding(): Promise<boolean> {
  // Sample mode is a legitimate state, not an unfinished signup.
  if (!supabaseConfigured) return false;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return false;

  const { data } = await supabase
    .from('profiles')
    .select('onboarding_done_at')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  return data?.onboarding_done_at == null;
}
