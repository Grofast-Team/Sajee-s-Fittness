import Link from 'next/link';
import { Panel, PageHeader, Section } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { getDayView } from '@/lib/data/day';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Fitness settings — FitCoach' };

/**
 * Fitness's own settings: the plan, the constraints, and what the coach
 * remembers.
 *
 * Split out of the general Settings page (design spec's Phase 4a) - this
 * used to render for every user regardless of category state, showing
 * sample fitness numbers behind a SampleBanner to someone who had never
 * enabled Fitness. Living inside (app)/(fitness)/ means it now inherits
 * that route group's guard automatically, the same way every other
 * fitness screen does.
 *
 * "What the coach remembers" moved here too, discovered only while
 * splitting this file: Coach is a Fitness sub-feature (see
 * src/lib/engines/categories.ts), so what it remembers is fitness-domain
 * content by the same principle that moved the plan and constraints -
 * not something the original plan for this task knew to mention, since
 * this section did not exist when that plan was written.
 */
export default async function FitnessSettingsPage() {
  const day = await getDayView();

  let memories: { id: string; kind: string; key: string; value: string; source: string }[] = [];

  if (supabaseConfigured && !day.isSample) {
    const supabase = await createClient();
    const { data } = await supabase
      .from('user_memory')
      .select('id, kind, key, value, source')
      .eq('active', true)
      .order('created_at', { ascending: false });
    memories = data ?? [];
  }

  return (
    <>
      <SampleBanner isSample={day.isSample} />

      <PageHeader title="Fitness settings" />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          <Panel>
            <Section title="Your plan">
              <dl className="space-y-2 text-sm">
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
                className="mt-5 inline-flex min-h-11 w-full items-center justify-center px-4 text-sm font-semibold transition-opacity duration-200 hover:opacity-90 sm:w-auto"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--primary-dark)',
                  boxShadow: 'inset 0 0 0 1px var(--primary-border)',
                  borderRadius: 'var(--radius-control)',
                }}
              >
                Redo setup
              </Link>
              <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                Changing your answers builds a new plan. Your logs and weight history are kept.
              </p>
            </Section>
          </Panel>

          <Panel>
            <Section title="Your constraints">
              <dl className="space-y-2 text-sm">
                {[
                  ['Budget', day.constraints.budgetPerDay ?? 'not set'],
                  ['Diet', day.constraints.diet],
                  ['Allergies', day.constraints.allergies.join(', ') || 'none recorded'],
                  ['Dislikes', day.constraints.dislikes.join(', ') || 'none recorded'],
                  ['Equipment', day.constraints.equipment],
                  [
                    'Cooking time',
                    day.constraints.cookMinutes !== null
                      ? `${day.constraints.cookMinutes} min`
                      : 'not set',
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
          </Panel>
        </div>

        <div className="space-y-4 lg:space-y-5">
          {/* The Coach screen promises this exists. It has to actually exist. */}
          <Panel>
            <Section
              title="What the coach remembers"
              meta={memories.length > 0 ? `${memories.length} stored` : undefined}
            >
              {memories.length > 0 ? (
                <ul className="divide-y">
                  {memories.map((m) => (
                    <li key={m.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-sm font-medium">{m.value}</p>
                      <p className="mt-0.5 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                        {m.kind} · {m.source === 'stated' ? 'you told us' : m.source}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  Nothing stored yet. As you use the coach it will remember things like foods you
                  dislike or times you cannot cook — and everything it remembers will be listed
                  here for you to remove.
                </p>
              )}
            </Section>
          </Panel>
        </div>
      </div>
    </>
  );
}
