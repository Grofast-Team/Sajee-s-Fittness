import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ConfidenceTag, Rail, Section, Why } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { SleepEntry, WaterEntry } from '@/components/quick-entry';
import { getDayView } from '@/lib/data/day';
import { stepsToMinutes } from '@/lib/engines/steps';

export const metadata = { title: 'Today — FitCoach' };

/**
 * The home screen.
 *
 * One job: answer "what do I do today?" in about five seconds.
 *
 * So it opens with the single number that decides the rest of the day — what is
 * left to eat — at a size nothing competes with. Everything after that is
 * quieter, and the reasoning is folded away behind "Why?" until asked for.
 */
export default async function TodayPage() {
  const day = await getDayView();

  const stepsShort =
    day.stepsToday === null ? null : Math.max(0, day.stepTarget - day.stepsToday);

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
    'Your strength session, or move it to tomorrow if today has gone.',
    'Wind down in time to hit your sleep target.',
  ];

  return (
    <>
      <SampleBanner isSample={day.isSample} />

      {/* Hero. Full bleed, no card — the number the screen exists for. */}
      <header className="pb-7 pt-6">
        {day.displayName ? <p className="eyebrow mb-5">{day.displayName}&rsquo;s day</p> : null}

        <div className="flex items-end gap-3">
          <span
            className="data leading-none"
            style={{
              fontSize: 'clamp(3.6rem, 19vw, 5.5rem)',
              fontWeight: 500,
              color: over ? 'var(--signal)' : 'var(--fg)',
            }}
          >
            {Math.abs(remaining).toLocaleString()}
          </span>
          <span className="pb-2">
            <span className="eyebrow block">kcal</span>
            <span className="block text-sm" style={{ color: 'var(--fg-muted)' }}>
              {over ? 'over' : 'left'}
            </span>
          </span>
        </div>

        <p className="mt-4 max-w-md text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          {day.remaining.message}
        </p>
      </header>
      {/* Numbering is justified here: this is a genuine priority order, not
          decoration. Item one matters more than item four. */}
      <Section title="Today's brief">
        <ol>
          {brief.map((item, i) => (
            <li key={item} className="flex gap-4 border-b py-3 last:border-0">
              <span className="data pt-0.5 text-xs" style={{ color: 'var(--fg-subtle)' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-sm leading-relaxed">{item}</span>
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Intake" meta={`${day.targetKcal.toLocaleString()} kcal target`}>
        <div className="space-y-5">
          <Rail
            label="Energy"
            value={day.consumedKcal}
            target={day.targetKcal}
            unit="kcal"
            size="lg"
          />
          <Rail
            label="Protein"
            value={day.consumedProteinG}
            target={day.proteinTargetG}
            unit="g"
          />
        </div>

        {day.rationale.energy ? (
          <Why label="Why this target">
            <p>{day.rationale.energy}</p>
            <p className="mt-3">
              Resting energy is estimated at{' '}
              <span className="data">{day.rationale.bmrKcal.toLocaleString()}</span> kcal —
              realistically between <span className="data">{day.rationale.bmrLowKcal.toLocaleString()}</span>{' '}
              and <span className="data">{day.rationale.bmrHighKcal.toLocaleString()}</span>. Then
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
              That is a prediction, not a measurement. We correct it from what your weight actually
              does over the coming weeks.
            </p>
          </Why>
        ) : null}
      </Section>
      <Section title="Movement">
        {day.stepsToday === null ? (
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm">Steps</span>
            {/* Never invent a step count. Missing stays missing. */}
            <span className="text-sm" style={{ color: 'var(--fg-subtle)' }}>
              not recorded · target{' '}
              <span className="data">{day.stepTarget.toLocaleString()}</span>
            </span>
          </div>
        ) : (
          <Rail label="Steps" value={day.stepsToday} target={day.stepTarget} unit="steps" />
        )}

        {day.rationale.steps ? <Why label="Why this number">{day.rationale.steps}</Why> : null}
      </Section>
      <Section title="Meals" meta={day.items.length > 0 ? `${day.items.length} logged` : undefined}>
        {day.items.length > 0 ? (
          <ul>
            {day.items.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-4 border-b py-3">
                <div className="min-w-0">
                  <p className="text-sm">{entry.description}</p>
                  <p className="eyebrow mt-1">{entry.meal}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="data text-sm">
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
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Nothing logged yet. Start with whatever you ate last — a rough entry beats no entry.
          </p>
        )}

        <Link
          href="/food"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md px-4 text-sm font-medium"
          style={{ background: 'var(--fg)', color: 'var(--bg)' }}
        >
          Log a meal <ArrowRight size={15} aria-hidden />
        </Link>
      </Section>
      <Section title="Weight">
        {day.trend.latestSmoothed !== null ? (
          <>
            <div className="flex items-end gap-2.5">
              <span className="data text-4xl" style={{ fontWeight: 500 }}>
                {day.trend.latestSmoothed.toFixed(1)}
              </span>
              <span className="eyebrow pb-1.5">kg trend</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              {day.trend.message}
            </p>
            <Why label="Why this differs from the scale">
              Your most recent reading was{' '}
              <span className="data">
                {day.trend.points[day.trend.points.length - 1]?.raw.toFixed(1)}
              </span>{' '}
              kg. The figure above is smoothed across all{' '}
              <span className="data">{day.trend.readingCount}</span> of your weigh-ins. Day-to-day
              readings move mostly with water, salt and food still in your system, so the trend
              describes your body far better than this morning did.
            </Why>
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            {day.trend.message}
          </p>
        )}
      </Section>
      <Section title="Hydration">
        <WaterEntry canSave={!day.isSample} consumedMl={day.waterToday} targetMl={day.waterMl} />
      </Section>

      <Section title="Sleep">
        <SleepEntry
          canSave={!day.isSample}
          currentMinutes={day.sleepMinutes}
          targetHours={day.sleepTargetHours}
        />
      </Section>
    </>
  );
}
