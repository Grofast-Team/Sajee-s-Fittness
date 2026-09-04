import { Barcode, Mic, Zap } from 'lucide-react';
import { Panel, PageHeader, Rail, Ring, Section, Unavailable } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { ScalePhotoLogger } from '@/components/scale-photo';
import { FoodSearch } from '@/components/food-search';
import { LoggedMeals } from '@/components/logged-meals';
import { getDayView } from '@/lib/data/day';
import { aiConfigured, supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Food — FitCoach' };

/**
 * The food screen.
 *
 * Logging has to be the easiest thing on the page, so on desktop the ways in —
 * photo, then search — take the wider left column and stay above the fold,
 * while the running total and the day's log sit to the right where they can be
 * glanced at without being in the way. On a phone the same blocks stack in that
 * order: how much is left, then how to add to it, then what has been added.
 */
export default async function FoodPage() {
  const day = await getDayView();
  const remaining = day.remaining.kcalRemaining;
  const over = remaining < 0;

  return (
    <>
      <SampleBanner isSample={day.isSample} />

      <PageHeader title="Food" lede={day.remaining.message} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
        {/* ---------------- Adding food ---------------- */}
        <div className="space-y-4 lg:space-y-5">
          {/* The photo path leads because it is the flagship, but search sits
              right beneath it and needs no AI — logging must never depend on a
              model being reachable. */}
          <Panel>
            <Section title="Add food">
              {aiConfigured ? (
                <ScalePhotoLogger />
              ) : (
                <Unavailable
                  title="Photo logging is switched off"
                  detail="No AI provider is configured on this deployment, so photo analysis is disabled rather than faked. Search below works without it."
                />
              )}

              <div className="mt-6 border-t pt-6" style={{ borderColor: 'var(--line)' }}>
                <FoodSearch canSave={supabaseConfigured && !day.isSample} />
              </div>
            </Section>
          </Panel>

          <Panel>
            <Section title="Not built yet">
              <ul className="space-y-3">
                {[
                  { Icon: Zap, label: 'Quick add', detail: 'Food, quantity, meal — ten seconds.' },
                  {
                    Icon: Mic,
                    label: 'Say what you ate',
                    detail: '"Two idli and a bowl of sambar."',
                  },
                  {
                    Icon: Barcode,
                    label: 'Scan a barcode',
                    detail: 'For packaged food with label data.',
                  },
                ].map(({ Icon, label, detail }) => (
                  <li key={label} className="flex items-start gap-3" style={{ opacity: 0.55 }}>
                    <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                        {detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          </Panel>
        </div>

        {/* ---------------- Where the day stands ---------------- */}
        <div className="space-y-4 lg:space-y-5">
          <Panel feature className="sm:flex sm:items-center sm:gap-6 lg:block">
            <div className="flex justify-center sm:shrink-0 lg:mb-5">
              <Ring
                label="Energy"
                value={day.consumedKcal}
                target={day.targetKcal}
                unit="kcal"
                size="md"
                hideCaption
                centre={
                  <>
                    <span
                      className="data text-[24px] font-semibold leading-none"
                      style={{ color: over ? 'var(--signal)' : 'var(--fg)' }}
                    >
                      {Math.abs(remaining).toLocaleString()}
                    </span>
                    <span className="mt-0.5 text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                      {over ? 'over' : 'left'}
                    </span>
                  </>
                }
              />
            </div>

            <div className="mt-5 min-w-0 flex-1 space-y-4 sm:mt-0 lg:mt-0">
              <Rail
                label="Energy"
                value={day.consumedKcal}
                target={day.targetKcal}
                unit="kcal"
              />
              <Rail
                label="Protein"
                value={day.consumedProteinG}
                target={day.proteinTargetG}
                unit="g"
              />
            </div>
          </Panel>

          <Panel>
            <Section
              title="Logged today"
              meta={day.items.length > 0 ? `${day.items.length} entries` : undefined}
            >
              <LoggedMeals items={day.items} canEdit={!day.isSample} />
            </Section>
          </Panel>
        </div>
      </div>
    </>
  );
}
