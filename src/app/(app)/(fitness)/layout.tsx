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
 * Interim redirect target: /onboarding for both failure cases below.
 * Design spec section 6 says "not enabled -> /profile", but /profile does
 * not exist until Phase 4 - running the interview is currently the only
 * working way to enable Fitness, so both cases land there for now. This
 * gets corrected to the exact section 6 table once /profile ships.
 */
export default async function FitnessLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfigured) return children;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return children; // (app)/layout.tsx already handles this case.

  const enabled = await getEnabledCategories(supabase, auth.user.id);
  if (!isCategoryVisible('fitness', enabled)) {
    redirect('/onboarding');
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
