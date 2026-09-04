import Link from 'next/link';
import { ArrowRight, UtensilsCrossed } from 'lucide-react';
import { ConfidenceTag, EmptyState, Panel, Rail, Ring, Section, Stat, Why } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { SleepEntry, WaterEntry } from '@/components/quick-entry';
import { NextStepCard } from '@/components/next-step';
import { getDayView } from '@/lib/data/day';
import { getNextStep } from '@/lib/data/next-step';
import { greeting } from '@/lib/greeting';
import { stepsToMinutes } from '@/lib/engines/steps';

export const metadata = { title: 'Today — FitCoach' };

/**
 * The home screen.
 *
 * One job: answer "what do I do today?" in about five seconds.
 *
 * So it opens with the single number that decides the rest of the day — what is
 * left to eat — drawn as the ring, at a size nothing competes with. Everything
 * after that is quieter, and the reasoning stays folded away behind "Why?"
 * until it is asked for.
 *
 * On a phone this reads as one column in priority order. From 1024px it becomes
 * two, with the day's decisions on the left and the slower-moving picture —
 * weight, hydration, sleep — on the right. The desktop layout is not the phone
 * layout with wider cards.
 */
export default async function TodayPage() {
  const [day, step] = await Promise.all([getDayView(), getNextStep()]);

  const stepsShort = day.stepsToday === null ? null : Math.max(0, day.stepTarget - day.stepsToday);

  const remaining = day.remaining.kcalRemaining;
  const over = remaining < 0;

  const brief = [
    day.remaining.proteinRemaining > 0
      ? `${Math.round(day.remaining.proteinRemaining)} g more protein. Dinner is the easy place for it.`
      : 'Protein target met.',
    stepsShort === null
      ? `Record your steps. Target is ${day.stepTarget.toLocaleString()}.`
      : stepsShort > 0
        ? `${stepsShort.toLocaleString()} more steps — about ${stepsToMinutes(stepsShort)} minutes of walking.`
        : 'Step goal met.',
    step.isRestDay
      ? 'Rest day. Adaptation happens between sessions, so this one is on the plan.'
      : `${step.sessionTitle} — or move it to tomorrow if today has gone.`,
    'Wind down in time to hit your sleep target.',
  ];

  return (
    <>
      <SampleBanner isSample={day.isSample} />

      <header className="pb-6 pt-6">
        <h1 className="display text-[1.75rem] md:text-[2rem]">
          {greeting(day.displayName, day.timezone)}
        </h1>
        <p className="mt-1.5 text-[15px]" style={{ color: 'var(--fg-muted)' }}>
          Here&rsquo;s your plan for today.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
        {/* ---------------- Left column: today's decisions ---------------- */}
        <div className="space-y-4 lg:space-y-5">
          {/* The feature card. The ring is the app's signature and this is the
              one place it runs at full size. */}
          <Panel feature tone="plain" className="sm:flex sm:items-center sm:gap-7">
            <div className="flex justify-center sm:shrink-0">
              <Ring
                label="Energy"
                value={day.consumedKcal}
                target={day.targetKcal}
                unit="kcal"
                size="lg"
                hideCaption
                centre={
                  <>
                    <span
                      className="data text-[40px] font-semibold leading-none"
                      style={{ color: over ? 'var(--signal)' : 'var(--fg)' }}
                    >
                      {Math.abs(remaining).toLocaleString()}
                    </span>
                    <span className="mt-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
                      kcal {over ? 'over' : 'left'}
                    </span>
                  </>
                }
              />
            </div>

            <div className="mt-5 min-w-0 flex-1 sm:mt-0">
              <p className="text-[15px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                {day.remaining.message}
              </p>
              <Link
                href="/food"
                className="mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-sm font-medium transition-opacity duration-200 hover:opacity-90"
                style={{
                  background: 'var(--primary)',
                  color: 'var(--on-primary)',
                  borderRadius: 'var(--radius-control)',
                }}
              >
                Log a meal <ArrowRight size={15} aria-hidden />
              </Link>
            </div>
          </Panel>

          <Panel>
            <Section title="Today's targets">
              <div className="space-y-4">
                <Rail
                  label="Protein"
                  value={day.consumedProteinG}
                  target={day.proteinTargetG}
                  unit="g"
                />

                {day.stepsToday === null ? (
                  /* Never invent a step count. Missing stays missing, and says
                     what to do about it. */
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm font-medium">Steps</span>
                    <span className="text-sm" style={{ color: 'var(--fg-subtle)' }}>
                      not recorded · target{' '}
                      <span className="data">{day.stepTarget.toLocaleString()}</span>
                    </span>
                  </div>
                ) : (
                  <Rail
                    label="Steps"
                    value={day.stepsToday}
                    target={day.stepTarget}
                    unit="steps"
                  />
                )}
              </div>

              {day.rationale.energy ? (
                <Why label="Why these targets">
                  <p>{day.rationale.energy}</p>
                  <p className="mt-3">
                    Resting energy is estimated at{' '}
                    <span className="data">{day.rationale.bmrKcal.toLocaleString()}</span> kcal —
                    realistically between{' '}
                    <span className="data">{day.rationale.bmrLowKcal.toLocaleString()}</span> and{' '}
                    <span className="data">{day.rationale.bmrHighKcal.toLocaleString()}</span>. Then
                    adjusted for how you actually spend your day:
                  </p>
                  <ul className="mt-2 space-y-1">
                    {day.rationale.activityReasons.map((r) => (
                      <li key={r} className="flex gap-2">
                        <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
                          —
                        </span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3">
                    That is a prediction, not a measurement. We correct it from what your weight
                    actually does over the coming weeks.
                  </p>
                </Why>
              ) : null}
            </Section>
          </Panel>

          {/* Today's movement, chosen rather than fixed. Compact here — the
              full session, with demonstrations, lives on Activity. */}
          <NextStepCard step={step} minutes={step.sessionMinutes} compact />

          {/* Numbering is justified here: this is a genuine priority order, not
              decoration. Item one matters more than item four. */}
          <Panel>
            <Section title="What to do next">
              <ol className="space-y-0">
                {brief.map((item, i) => (
                  <li
                    key={item}
                    className="flex gap-3.5 border-b py-3 first:pt-0 last:border-0 last:pb-0"
                  >
                    <span
                      className="data flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                      style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)' }}
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                    <span className="text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ol>
            </Section>
          </Panel>
        </div>

        {/* ---------------- Right column: the slower picture ---------------- */}
        <div className="space-y-4 lg:space-y-5">
          <Panel>
            <Section
              title="Meals"
              meta={day.items.length > 0 ? `${day.items.length} logged` : undefined}
            >
              {day.items.length > 0 ? (
                <ul>
                  {day.items.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start justify-between gap-4 border-b py-3 first:pt-0 last:border-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm">{entry.description}</p>
                        <p className="eyebrow mt-0.5">{entry.meal}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="data text-sm font-semibold">
                          {/* A range stays a range. */}
                          {entry.kcalLow !== null && entry.kcalHigh !== null
                            ? `${entry.kcalLow}–${entry.kcalHigh}`
                            : entry.kcal}
                        </p>
                        <div className="mt-1">
                          <ConfidenceTag level={entry.confidence} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<UtensilsCrossed size={22} aria-hidden />}
                  title="Nothing logged yet"
                  detail="Start with whatever you ate last. A rough entry beats no entry."
                  action={
                    <Link
                      href="/food"
                      className="inline-flex min-h-11 items-center gap-2 px-4 text-sm font-medium"
                      style={{
                        background: 'var(--primary)',
                        color: 'var(--on-primary)',
                        borderRadius: 'var(--radius-control)',
                      }}
                    >
                      Add food
                    </Link>
                  }
                />
              )}
            </Section>
          </Panel>

          <Panel>
            <Section title="Weight">
              {day.trend.latestSmoothed !== null ? (
                <>
                  <Stat
                    label="Trend weight"
                    value={day.trend.latestSmoothed.toFixed(1)}
                    unit="kg"
                  />
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                    {day.trend.message}
                  </p>
                  <Why label="Why this differs from the scale">
                    Your most recent reading was{' '}
                    <span className="data">
                      {day.trend.points[day.trend.points.length - 1]?.raw.toFixed(1)}
                    </span>{' '}
                    kg. The figure above is smoothed across all{' '}
                    <span className="data">{day.trend.readingCount}</span> of your weigh-ins.
                    Day-to-day readings move mostly with water, salt and food still in your system,
                    so the trend describes your body far better than this morning did.
                  </Why>
                </>
              ) : (
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  {day.trend.message}
                </p>
              )}
            </Section>
          </Panel>

          <Panel>
            <Section title="Hydration">
              <WaterEntry
                canSave={!day.isSample}
                consumedMl={day.waterToday}
                targetMl={day.waterMl}
              />
            </Section>
          </Panel>

          <Panel>
            <Section title="Sleep">
              <SleepEntry
                canSave={!day.isSample}
                currentMinutes={day.sleepMinutes}
                targetHours={day.sleepTargetHours}
              />
            </Section>
          </Panel>
        </div>
      </div>
    </>
  );
}
