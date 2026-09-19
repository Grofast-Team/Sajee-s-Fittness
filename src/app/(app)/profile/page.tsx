import Link from 'next/link';
import { Panel, PageHeader, Section, Unavailable } from '@/components/ui';
import { ProfileToggle } from '@/components/profile-toggle';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { CATEGORIES } from '@/lib/engines/categories';

export const metadata = { title: 'Profile — FitCoach' };

/**
 * Where every category is turned on or off.
 *
 * Sub-features (Coach) do not appear here - they have no independent
 * toggle, per design spec section 11; their visibility is computed from
 * their parent everywhere else in the app.
 *
 * Reminders, Checklist and Cycle are listed - the registry says they
 * exist - but rendered as Unavailable rather than a working switch, since
 * their pages do not exist until later sub-phases. A switch with nowhere
 * to go would be worse than not listing them at all.
 */
export default async function ProfilePage() {
  let enabled = new Set<string>();
  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) enabled = new Set(await getEnabledCategories(supabase, auth.user.id));
  }

  const topLevel = CATEGORIES.filter((c) => !c.parentKey);

  return (
    <>
      <PageHeader title="Profile" />

      <Panel>
        <Section title="Your categories">
          <ul className="space-y-4">
            {topLevel.map((c) => {
              const isEnabled = enabled.has(c.key);

              if (c.requiresSetup) {
                // Fitness: no switch. Enabling it means computing a real
                // plan, which this screen does not do - it links to the
                // interview instead, exactly as toggleCategory's own
                // refusal to enable Fitness expects.
                return (
                  <li key={c.key} className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{c.label}</span>
                    {isEnabled ? (
                      <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                        Enabled
                      </span>
                    ) : (
                      <Link
                        href="/onboarding"
                        className="text-[13px] font-semibold"
                        style={{ color: 'var(--primary-dark)' }}
                      >
                        Set up →
                      </Link>
                    )}
                  </li>
                );
              }

              const hasPage = c.key === 'money';
              if (!hasPage) {
                return (
                  <li key={c.key}>
                    <Unavailable title={c.label} detail="Not available yet." />
                  </li>
                );
              }

              return (
                <li key={c.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{c.label}</span>
                  <ProfileToggle categoryKey={c.key} label={c.label} initialEnabled={isEnabled} />
                </li>
              );
            })}
          </ul>
        </Section>
      </Panel>
    </>
  );
}
