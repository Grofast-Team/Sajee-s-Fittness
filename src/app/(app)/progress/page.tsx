import { Panel, PageHeader, Section, Stat, Unavailable, Why } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { WeightEntry } from '@/components/quick-entry';
import { TrendChart } from '@/components/trend-chart';
import { getDayView } from '@/lib/data/day';
import { explainShortTermChange } from '@/lib/engines/trend';
import { detectPlateau } from '@/lib/engines/adaptation';
import { scoreAdherence } from '@/lib/engines/adherence';

export const metadata = { title: 'Progress — FitCoach' };

/**
 * The progress screen.
 *
 * The hero is the *trend* figure, not this morning's reading, and that
 * distinction is the entire point of the screen: a scale number is mostly water
 * and yesterday's salt, while the trend is the thing actually changing.
 *
 * The chart takes the full width of the desktop grid because a squeezed line
 * chart is a misleading one — the same slope reads as steeper in a narrow box.
 */
export default async function ProgressPage() {
  const day = await getDayView();
  const { trend } = day;
  const points = trend.points;

  // Week-over-week from the smoothed series, so it does not depend on which day
  // someone happened to step on the scale.
  const avg = (xs: typeof points) =>
    xs.length === 0 ? null : xs.reduce((s, p) => s + p.raw, 0) / xs.length;
  const thisAvg = avg(points.slice(-7));
  const lastAvg = avg(points.slice(-14, -7));
  const weekDelta = thisAvg !== null && lastAvg !== null ? thisAvg - lastAvg : null;

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dayDelta = last && prev ? Math.round((last.raw - prev.raw) * 10) / 10 : null;
  const explanation = dayDelta !== null ? explainShortTermChange(dayDelta, 1) : null;

  const plateau = detectPlateau({
    trend,
    loggingCompleteness: day.isSample ? 0.82 : 1,
    stepTrendDown: false,
    sleepBelowTarget: false,
    cycleTracked: false,
    inLutealPhase: false,
    recentDietChange: false,
    waistChangedCm: day.waist?.changeCm ?? null,
  });

  const adherence = day.isSample
    ? scoreAdherence({
        daysInPeriod: 7,
        daysLogged: 6,
        daysWithinKcalRange: 5,
        daysProteinMet: 4,
        daysStepGoalMet: 4,
        workoutsPlanned: 3,
        workoutsCompleted: 2,
        daysSleepTargetMet: 2,
        weighIns: 6,
      })
    : null;

  return (
    <>
      <SampleBanner isSample={day.isSample} />

      <PageHeader title="Progress" />

      {/* The trend figure and the chart, together, as one feature block. */}
      <Panel feature className="mb-4 lg:mb-5">
        {trend.latestSmoothed !== null ? (
          <>
            {/* Grouped rather than pushed to opposite edges. On a 1440px monitor
                `justify-between` put the trend weight and the week's change
                1,300px apart, which stops them reading as one comparison. */}
            <div className="flex flex-wrap items-end gap-x-12 gap-y-4">
              <div className="flex items-end gap-3">
                <span
                  className="data leading-none"
                  style={{ fontSize: 'clamp(2.75rem, 11vw, 3.75rem)', fontWeight: 650 }}
                >
                  {trend.latestSmoothed.toFixed(1)}
                </span>
                <span className="pb-2 text-[15px]" style={{ color: 'var(--fg-muted)' }}>
                  kg trend
                </span>
              </div>

              {weekDelta !== null ? (
                <div className="pb-1">
                  <Stat
                    label="vs last week"
                    value={`${weekDelta > 0 ? '+' : ''}${weekDelta.toFixed(2)}`}
                    unit="kg"
                  />
                </div>
              ) : null}
            </div>

            <p
              className="measure mt-4 text-[15px] leading-relaxed"
              style={{ color: 'var(--fg-muted)' }}
            >
              {trend.message}
            </p>

            <div className="mt-6 border-t pt-5" style={{ borderColor: 'var(--line)' }}>
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <h2 className="text-[17px] font-semibold">Trend</h2>
                <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                  {trend.readingCount} weigh-ins
                </span>
              </div>
              <TrendChart points={points} />
              {explanation && dayDelta !== null && dayDelta !== 0 ? (
                <Why label={`Why the scale ${dayDelta > 0 ? 'went up' : 'moved'}`}>
                  <p style={{ color: 'var(--fg)' }}>{explanation.headline}</p>
                  <ul className="mt-2 space-y-1">
                    {explanation.causes.map((c) => (
                      <li key={c} className="flex gap-2">
                        <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
                          —
                        </span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3">{explanation.reassurance}</p>
                </Why>
              ) : null}
            </div>
          </>
        ) : (
          <p className="measure text-[15px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            {trend.message}
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          <Panel>
            <Section title="Record a weight">
              <WeightEntry canSave={!day.isSample} lastWeightKg={day.weightKg} />
            </Section>
          </Panel>

          <Panel>
            <Section title="Waist">
              {day.waist ? (
                <>
                  <div className="flex items-end justify-between gap-4">
                    <Stat label="Latest" value={day.waist.latestCm.toFixed(1)} unit="cm" />
                    {day.waist.changeCm !== null ? (
                      <Stat
                        label="Change"
                        value={`${day.waist.changeCm > 0 ? '+' : ''}${day.waist.changeCm.toFixed(1)}`}
                        unit="cm"
                      />
                    ) : null}
                  </div>
                  <p
                    className="mt-4 text-sm leading-relaxed"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    {day.waist.changeCm !== null && day.waist.overDays !== null
                      ? day.waist.changeCm < 0
                        ? `Down ${Math.abs(day.waist.changeCm).toFixed(1)} cm over ${day.waist.overDays} days. If the scale has moved less than this, your body composition is likely changing — though we cannot measure body fat directly, so we will not claim more than the tape shows.`
                        : `Up ${day.waist.changeCm.toFixed(1)} cm over ${day.waist.overDays} days. Tape readings vary with how tightly you pull, so check the next one before reading much into it.`
                      : 'That is your first waist measurement, so there is nothing to compare it to yet. Take the next one in a week or two, in the same place at the same time of day.'}
                  </p>
                </>
              ) : (
                <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  No waist measurements yet. Worth taking — waist often moves when the scale is
                  being stubborn, and it tracks the fat that matters most for health.
                </p>
              )}
            </Section>
          </Panel>
        </div>

        <div className="space-y-4 lg:space-y-5">
          <Panel>
            <Section title={plateau.isPlateau ? 'Plateau' : 'Plateau check'}>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                {plateau.verdict}
              </p>
              {plateau.checks.length > 0 ? (
                <ul className="mt-4 space-y-4">
                  {plateau.checks.map((c) => (
                    <li key={c.label}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-medium">{c.label}</span>
                        <span
                          className="text-[13px] font-medium"
                          style={{
                            color:
                              c.likelihood === 'high' ? 'var(--signal)' : 'var(--fg-subtle)',
                          }}
                        >
                          {c.likelihood}
                        </span>
                      </div>
                      <p
                        className="mt-1 text-sm leading-relaxed"
                        style={{ color: 'var(--fg-muted)' }}
                      >
                        {c.finding}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Section>
          </Panel>

          <Panel>
            <Section title="This week">
              {adherence ? (
                <>
                  <Stat label="Plan followed" value={adherence.score} unit="%" tone="primary" />
                  <p
                    className="mt-3 text-sm leading-relaxed"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    {adherence.summary}
                  </p>
                  <Why label="Breakdown">
                    <ul className="space-y-1.5">
                      {adherence.components.map((c) => (
                        <li key={c.key} className="flex justify-between gap-3">
                          <span>{c.label}</span>
                          <span className="data shrink-0">{Math.round(c.score * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-[13px]">
                      Weighted by real effect on fat loss — logging and calorie range carry a
                      quarter each, sleep carries five percent.
                    </p>
                  </Why>
                </>
              ) : (
                <Unavailable
                  title="No weekly review yet"
                  detail="The adherence engine is built and tested, but nothing schedules the weekly rollup yet. It will appear here once that runs."
                />
              )}
            </Section>
          </Panel>
        </div>
      </div>
    </>
  );
}
