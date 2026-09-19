import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { isCategoryVisible } from '@/lib/engines/categories';

/**
 * The Fitness category's own gate.
 *
 * (app)/layout.tsx only checks that minimal signup is done - it has no
 * opinion on Fitness specifically, deliberately, so that check stays true
 * for every category. This layout is where "is Fitness actually usable"
 * lives, wrapping only the five routes that need it: today, activity,
 * food, progress, coach.
 *
 * Redirect targets match design spec section 6 exactly now that /profile
 * exists: not enabled -> /profile, enabled but no active plan ->
 * /onboarding (the interview is still the only way to create one).
 *
 * One more thing worth knowing if you're ever debugging this: the
 * redirect() calls below do not always produce a raw HTTP 307. The parent
 * route's loading.tsx creates a Suspense boundary, and if this layout's
 * own async work here (the two Supabase calls above) hasn't resolved by
 * the time Next.js starts streaming the response, the initial response
 * already committed a 200 before redirect() ever threw - so Next.js falls
 * back to a client-side meta-refresh/script redirect instead. This is
 * normal, accepted behaviour, not a bug: the gated page component below
 * this layout never executes either way, so no fitness data - real or
 * placeholder - is ever rendered during that brief window.
 */
export default async function FitnessLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured) return children;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return children; // (app)/layout.tsx already handles this case.

  const enabled = await getEnabledCategories(supabase, auth.user.id);
  if (!isCategoryVisible('fitness', enabled)) {
    redirect('/profile');
  }

  const { data: plan } = await supabase
    .from('plans')
    .select('id')
    .eq('user_id', auth.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!plan) {
    redirect('/onboarding');
  }

  return children;
}
