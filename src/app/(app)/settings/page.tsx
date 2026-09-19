import Link from 'next/link';
import { Panel, PageHeader, Section, Unavailable } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { SignOutButton, DeleteAccountButton } from '@/components/settings-actions';
import { getDayView } from '@/lib/data/day';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Settings — FitCoach' };

/**
 * Settings.
 *
 * Account-level only, now: sign out, and see and delete what the app has
 * stored. Health data without an exit is not something to ship, and that
 * obligation must stay reachable regardless of which categories are
 * enabled - unlike everything that used to live here, which was
 * fitness-specific and has moved to /fitness-settings, inside the Fitness
 * route group where it is correctly gated (design spec's Phase 4a).
 */
export default async function SettingsPage() {
  const day = await getDayView();

  let email: string | null = null;

  if (supabaseConfigured && !day.isSample) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    email = auth.user?.email ?? null;
  }

  return (
    <>
      <SampleBanner isSample={day.isSample} />

      <PageHeader title="Settings" lede={email ? `Signed in as ${email}` : undefined} />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          <Panel>
            <Section title="Fitness">
              <Link
                href="/fitness-settings"
                className="text-sm font-medium"
                style={{ color: 'var(--primary-dark)' }}
              >
                Your plan and constraints →
              </Link>
            </Section>
          </Panel>
        </div>

        <div className="space-y-4 lg:space-y-5">
          <Panel>
            <Section title="Your data">
              <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                Your weight, measurements, food logs and plan are private to your account.
                Administrators cannot read them. Deleting your account removes all of it
                permanently.
              </p>

              {!day.isSample ? (
                <div className="mt-5 space-y-3 border-t pt-5" style={{ borderColor: 'var(--line)' }}>
                  <SignOutButton />
                  <DeleteAccountButton />
                </div>
              ) : (
                <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--line)' }}>
                  <Unavailable
                    title="Not signed in"
                    detail="You are viewing a sample profile. Sign in to see and manage your own data."
                    action={
                      <Link
                        href="/login"
                        className="inline-flex min-h-11 items-center px-4 text-sm font-semibold"
                        style={{
                          background: 'var(--primary)',
                          color: 'var(--on-primary)',
                          borderRadius: 'var(--radius-control)',
                        }}
                      >
                        Sign in
                      </Link>
                    }
                  />
                </div>
              )}
            </Section>
          </Panel>
        </div>
      </div>
    </>
  );
}
