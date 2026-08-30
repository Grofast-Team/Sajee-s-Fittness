import { Onboarding } from '@/components/onboarding';
import { SignOutButton } from '@/components/settings-actions';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Set up — FitCoach' };

export default async function OnboardingPage() {
  let email: string | null = null;
  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    email = data.user?.email ?? null;
  }

  return (
    <main id="main" className="mx-auto min-h-dvh max-w-lg px-4 py-6">
      <Onboarding />

      {/* Someone who has not finished setup is redirected here from every app
          screen, which means this is the only page they can reach. Without a way
          out they would be stuck signed in with no way to leave or switch
          accounts. */}
      {email ? (
        <div className="mt-8 border-t pt-5">
          <p className="mb-3 text-center text-xs" style={{ color: 'var(--fg-subtle)' }}>
            Signed in as {email}
          </p>
          <SignOutButton />
        </div>
      ) : null}
    </main>
  );
}
