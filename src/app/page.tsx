import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { isCategoryVisible } from '@/lib/engines/categories';

/**
 * Root.
 *
 * Normally just a doorway to /today or /money, but it also has to catch auth codes.
 * Supabase falls back to the project's Site URL — this page — whenever a
 * redirect target is missing from the allow-list, so a confirmation link can
 * legitimately arrive here as `/?code=...`. Redirecting to /today without
 * forwarding that code silently throws the session away and leaves the user
 * staring at a login screen right after confirming their email.
 *
 * The final fallback checks whether Fitness is enabled rather than always
 * going to /today, which is gated - an unconditional redirect there would
 * dead-end every Fitness-disabled user in /onboarding, a page with no
 * navigation. /money is never gated and always has full nav.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const { code, next } = await searchParams;

  if (code) {
    const target = new URLSearchParams({ code });
    if (next && next.startsWith('/') && !next.startsWith('//')) target.set('next', next);
    redirect(`/auth/callback?${target.toString()}`);
  }

  if (!supabaseConfigured) redirect('/today');

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/today'); // Unauthenticated - (app)/layout.tsx's own gate handles this.

  const enabled = await getEnabledCategories(supabase, auth.user.id);
  redirect(isCategoryVisible('fitness', enabled) ? '/today' : '/money');
}
