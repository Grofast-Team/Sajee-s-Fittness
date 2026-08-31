import Link from 'next/link';
import { Section, Unavailable } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { SignOutButton, DeleteAccountButton } from '@/components/settings-actions';
import { getDayView } from '@/lib/data/day';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Settings — FitCoach' };

/**
 * Settings.
 *
 * Two things here are obligations rather than features: a person must be able
 * to leave (sign out), and a person must be able to see and delete what the app
 * has stored about them. Health data without an exit is not something to ship.
 */
export default async function SettingsPage() {
  const day = await getDayView();

  let memories: { id: string; kind: string; key: string; value: string; source: string }[] = [];
  let email: string | null = null;

  if (supabaseConfigured && !day.isSample) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    email = auth.user?.email ?? null;

    const { data } = await supabase
      .from('user_memory')
      .select('id, kind, key, value, source')
      .eq('active', true)
      .order('created_at', { ascending: false });
    memories = data ?? [];
  }

  return (
    <div className="space-y-4">
      <SampleBanner isSample={day.isSample} />

      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        {email ? (
          <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
            Signed in as {email}
          </p>
        ) : null}
      </header>

      <Section title="Your plan">
        <dl className="space-y-1.5 text-sm">
          {[
            ['Energy target', `${day.targetKcal.toLocaleString()} kcal`],
            ['Floor', `${day.floorKcal.toLocaleString()} kcal`],
            ['Protein', `${day.proteinTargetG} g`],
            ['Fibre', `${day.fibreTargetG} g`],
            ['Steps', day.stepTarget.toLocaleString()],
            ['Water', `${(day.waterMl / 1000).toFixed(1)} L`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt style={{ color: 'var(--fg-subtle)' }}>{k}</dt>
              <dd className="data font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <Link
          href="/onboarding"
          className="mt-4 flex min-h-11 items-center justify-center rounded-md text-sm font-semibold"
          style={{ background: 'var(--ground)', color: 'var(--fg)' }}
        >
          Redo setup
        </Link>
        <p className="mt-2 text-xs" style={{ color: 'var(--fg-subtle)' }}>
          Changing your answers builds a new plan. Your logs and weight history are kept.
        </p>
      </Section>
      <Section title="Your constraints">
        <dl className="space-y-1.5 text-sm">
          {[
            ['Budget', day.constraints.budgetPerDay ?? 'not set'],
            ['Diet', day.constraints.diet],
            ['Allergies', day.constraints.allergies.join(', ') || 'none recorded'],
            ['Dislikes', day.constraints.dislikes.join(', ') || 'none recorded'],
            ['Equipment', day.constraints.equipment],
            [
              'Cooking time',
              day.constraints.cookMinutes !== null ? `${day.constraints.cookMinutes} min` : 'not set',
            ],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className="shrink-0" style={{ color: 'var(--fg-subtle)' }}>
                {k}
              </dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* The Coach screen promises this exists. It has to actually exist. */}
      <Section
        title="What the coach remembers"
        meta={memories.length > 0 ? `${memories.length} stored` : undefined}
      >
        {memories.length > 0 ? (
          <ul className="divide-y">
            {memories.map((m) => (
              <li key={m.id} className="py-2.5 first:pt-0">
                <p className="text-sm font-medium">{m.value}</p>
                <p className="text-xs" style={{ color: 'var(--fg-subtle)' }}>
                  {m.kind} · {m.source === 'stated' ? 'you told us' : m.source}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Nothing stored yet. As you use the coach it will remember things like foods you dislike
            or times you cannot cook — and everything it remembers will be listed here for you to
            remove.
          </p>
        )}
      </Section>
      <Section title="Your data">
        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
          Your weight, measurements, food logs and plan are private to your account. Administrators
          cannot read them. Deleting your account removes all of it permanently.
        </p>
      </Section>

      {!day.isSample ? (
        <div className="space-y-3">
          <SignOutButton />
          <DeleteAccountButton />
        </div>
      ) : (
        <Unavailable
          title="Not signed in"
          detail="You are viewing a sample profile. Sign in to see and manage your own data."
          action={
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold"
              style={{ background: 'var(--fg)', color: 'var(--bg)' }}
            >
              Sign in
            </Link>
          }
        />
      )}
    </div>
  );
}
