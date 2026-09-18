import { OnboardingName } from '@/components/onboarding-name';
import { SignOutButton } from '@/components/settings-actions';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Welcome — FitCoach' };

/**
 * The one screen between confirming an account and reaching the app.
 *
 * Reachable from every other route via (app)/layout.tsx's gate until
 * profiles.onboarding_done_at is set - so, like /onboarding, this needs its
 * own way out for someone who wants to sign out instead of continuing.
 */
export default async function OnboardingNamePage() {
  let email: string | null = null;
  let initialName = '';

  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    email = auth.user?.email ?? null;

    if (auth.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', auth.user.id)
        .maybeSingle();
      initialName = profile?.display_name ?? '';
    }
  }

  return (
    <main id="main" className="gutter mx-auto min-h-dvh max-w-xl py-6 md:py-12">
      <OnboardingName initialName={initialName} />

      {email ? (
        <div className="mt-10 border-t pt-6" style={{ borderColor: 'var(--line)' }}>
          <p className="mb-3 text-center text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
            Signed in as {email}
          </p>
          <SignOutButton />
        </div>
      ) : null}
    </main>
  );
}
