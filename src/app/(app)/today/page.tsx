import Link from 'next/link';
import { Card, CardTitle, ConfidenceBadge, Meter, WhyPanel } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { SleepEntry, WaterEntry } from '@/components/quick-entry';
import { getDayView } from '@/lib/data/day';
import { stepsToMinutes } from '@/lib/engines/steps';

export const metadata = { title: 'Today — FitCoach' };

/**
 * The home screen.
 *
 * It has one job: answer "what do I need to do today?" within about five
 * seconds. So the order is priorities first, numbers second, and everything
 * else is collapsed behind a "Why?" until asked for.
 */
export default async function TodayPage() {
  const day = await getDayView();

  const stepsShort =
    day.stepsToday === null ? null : Math.max(0, day.stepTarget - day.stepsToday);

  const priorities = [
    day.remaining.proteinRemaining > 0
      ? `Get another ${Math.round(day.remaining.proteinRemaining)} g of protein — dinner is the easy place for it.`
      : 'Protein target already met. Nice.',
    stepsShort === null
      ? `Record your steps — your target today is ${day.stepTarget.toLocaleString()}.`
      : stepsShort > 0
        ? `Walk ${stepsShort.toLocaleString()} more steps — about ${stepsToMinutes(stepsShort)} minutes.`
        : 'Step goal already met today.',
    'Do your strength session, or move it to tomorrow if today is gone.',
    'Wind down in time to hit your sleep target.',
  ];

  return (
    <div className="space-y-4">
      <SampleBanner isSample={day.isSample} />

      <header>
        {day.displayName ? (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Hello, {day.displayName}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold">Today</h1>
      </header>

      {/* Priorities come before the dashboard. A beginner opening the app needs
          instructions, not telemetry. */}
      <Card>
        <CardTitle>What matters today</CardTitle>
        <ol className="space-y-2.5">
          {priorities.map((p, i) => (
            <li key={p} className="flex gap-3 text-sm">
              <span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: 'var(--surface-2)', color: 'var(--primary)' }}
              >
                {i + 1}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardTitle hint={`${day.targetKcal.toLocaleString()} kcal target`}>Nutrition</CardTitle>
        <div className="space-y-3.5">
          <Meter
            label="Energy"
            value={day.consumedKcal}
            target={day.targetKcal}
            unit="kcal"
            note={day.remaining.message}
          />
          <Meter
            label="Protein"
            value={day.consumedProteinG}
            target={day.proteinTargetG}
            unit="g"
            tone="grow"
          />
        </div>

        {day.rationale.energy ? (
          <WhyPanel label="Why this calorie target?">
            <p>{day.rationale.energy}</p>
            <p className="mt-2">
              We estimated your resting energy at about {day.rationale.bmrKcal.toLocaleString()} kcal
              (realistically somewhere between {day.rationale.bmrLowKcal.toLocaleString()} and{' '}
              {day.rationale.bmrHighKcal.toLocaleString()}), then adjusted for your activity:
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {day.rationale.activityReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-2">
              That is a prediction, not a measurement. We will correct it from what your weight
              actually does over the next few weeks.
            </p>
          </WhyPanel>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Movement</CardTitle>
        <div className="space-y-3.5">
          {day.stepsToday === null ? (
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Steps</span>
              {/* Never invent a step count. Missing means missing. */}
              <span style={{ color: 'var(--fg-muted)' }}>
                Not recorded · target {day.stepTarget.toLocaleString()}
              </span>
            </div>
          ) : (
            <Meter label="Steps" value={day.stepsToday} target={day.stepTarget} unit="steps" />
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Strength session</span>
            <span style={{ color: 'var(--fg-muted)' }}>not done yet</span>
          </div>
        </div>
        {day.rationale.steps ? (
          <WhyPanel label="Why this step goal?">{day.rationale.steps}</WhyPanel>
        ) : null}
      </Card>

      <Card>
        <CardTitle hint={day.items.length > 0 ? `${day.items.length} logged` : undefined}>
          Meals so far
        </CardTitle>

        {day.items.length > 0 ? (
          <ul className="divide-y">
            {day.items.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.meal}</p>
                  <p className="truncate text-sm" style={{ color: 'var(--fg-muted)' }}>
                    {entry.description}
                  </p>
                  <div className="mt-1">
                    <ConfidenceBadge level={entry.confidence} />
                  </div>
                </div>
                <p className="tabular shrink-0 text-sm font-semibold">
                  {/* An entry saved as a range is shown as a range. */}
                  {entry.kcalLow !== null && entry.kcalHigh !== null
                    ? `${entry.kcalLow}–${entry.kcalHigh} kcal`
                    : `${entry.kcal} kcal`}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Nothing logged yet today. Start with whatever you ate last — it does not have to be
            perfect.
          </p>
        )}

        <Link
          href="/food"
          className="mt-3 flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold"
          style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
        >
          Log a meal
        </Link>
      </Card>

      <WaterEntry canSave={!day.isSample} consumedMl={day.waterToday} targetMl={day.waterMl} />

      <SleepEntry
        canSave={!day.isSample}
        currentMinutes={day.sleepMinutes}
        targetHours={day.sleepTargetHours}
      />

      <Card>
        <CardTitle>Weight</CardTitle>
        {day.trend.latestSmoothed !== null ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="tabular text-3xl font-semibold">
                {day.trend.latestSmoothed.toFixed(1)}
              </span>
              <span className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                kg trend
              </span>
            </div>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
              {day.trend.message}
            </p>
            <WhyPanel label="Why is this different from the scale this morning?">
              Your most recent reading was{' '}
              {day.trend.points[day.trend.points.length - 1]?.raw.toFixed(1)} kg. The number above
              is a smoothed trend across all {day.trend.readingCount} of your weigh-ins. Day-to-day
              readings move mostly with water, salt and food still in your system, so the trend is
              a far better description of what your body is actually doing.
            </WhyPanel>
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            {day.trend.message}
          </p>
        )}
      </Card>
    </div>
  );
}
