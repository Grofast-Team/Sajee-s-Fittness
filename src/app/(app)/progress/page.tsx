import { Section, Unavailable, Why } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { WeightEntry } from '@/components/quick-entry';
import { TrendChart } from '@/components/trend-chart';
import { getDayView } from '@/lib/data/day';
import { explainShortTermChange } from '@/lib/engines/trend';
import { detectPlateau } from '@/lib/engines/adaptation';
import { scoreAdherence } from '@/lib/engines/adherence';

export const metadata = { title: 'Progress — FitCoach' };

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
        daysInPeriod: 7, daysLogged: 6, daysWithinKcalRange: 5, daysProteinMet: 4,
        daysStepGoalMet: 4, workoutsPlanned: 3, workoutsCompleted: 2,
        daysSleepTargetMet: 2, weighIns: 6,
      })
    : null;

  return (
    <>
      <SampleBanner isSample={day.isSample} />

      {/* Hero: the trend figure, not today's reading. That distinction is the
          entire point of this screen. */}
      <header className="pb-7 pt-6">
        <p className="eyebrow mb-5">Progress</p>
        {trend.latestSmoothed !== null ? (
          <>
            <div className="flex items-end justify-between gap-4">
              <div className="flex items-end gap-3">
                <span
                  className="data leading-none"
                  style={{ fontSize: 'clamp(3rem, 15vw, 4.2rem)', fontWeight: 500 }}
                >
                  {trend.latestSmoothed.toFixed(1)}
                </span>
                <span className="eyebrow pb-2">kg trend</span>
              </div>
              {weekDelta !== null ? (
                <div className="pb-2 text-right">
                  <p
                    className="data text-lg"
                    style={{ color: weekDelta < 0 ? 'var(--confirm)' : 'var(--fg-muted)' }}
                  >
                    {weekDelta > 0 ? '+' : ''}
                    {weekDelta.toFixed(2)}
                  </p>
                  <p className="eyebrow">vs last week</p>
                </div>
              ) : null}
            </div>
            <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              {trend.message}
            </p>
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            {trend.message}
          </p>
        )}
      </header>
      {trend.latestSmoothed !== null ? (
        <>
          <Section title="Trend" meta={`${trend.readingCount} weigh-ins`}>
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
          </Section>
        </>
      ) : null}

      <Section title="Record">
        <WeightEntry canSave={!day.isSample} lastWeightKg={day.weightKg} />
      </Section>
      <Section title="Waist">
        {day.waist ? (
          <>
            <div className="flex items-end gap-3">
              <span className="data text-3xl" style={{ fontWeight: 500 }}>
                {day.waist.latestCm.toFixed(1)}
              </span>
              <span className="eyebrow pb-1">cm</span>
              {day.waist.changeCm !== null ? (
                <span
                  className="data ml-auto pb-1 text-lg"
                  style={{ color: day.waist.changeCm < 0 ? 'var(--confirm)' : 'var(--fg-muted)' }}
                >
                  {day.waist.changeCm > 0 ? '+' : ''}
                  {day.waist.changeCm.toFixed(1)}
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              {day.waist.changeCm !== null && day.waist.overDays !== null
                ? day.waist.changeCm < 0
                  ? `Down ${Math.abs(day.waist.changeCm).toFixed(1)} cm over ${day.waist.overDays} days. If the scale has moved less than this, your body composition is likely changing — though we cannot measure body fat directly, so we will not claim more than the tape shows.`
                  : `Up ${day.waist.changeCm.toFixed(1)} cm over ${day.waist.overDays} days. Tape readings vary with how tightly you pull, so check the next one before reading much into it.`
                : 'That is your first waist measurement, so there is nothing to compare it to yet. Take the next one in a week or two, in the same place at the same time of day.'}
            </p>
          </>
        ) : (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            No waist measurements yet. Worth taking — waist often moves when the scale is being
            stubborn, and it tracks the fat that matters most for health.
          </p>
        )}
      </Section>
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
                    className="eyebrow"
                    style={{ color: c.likelihood === 'high' ? 'var(--signal)' : 'var(--fg-subtle)' }}
                  >
                    {c.likelihood}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  {c.finding}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section title="This week">
        {adherence ? (
          <>
            <div className="flex items-end gap-2">
              <span className="data text-3xl" style={{ fontWeight: 500 }}>
                {adherence.score}
              </span>
              <span className="eyebrow pb-1">% followed</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
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
              <p className="mt-3 text-xs">
                Weighted by real effect on fat loss — logging and calorie range carry a quarter
                each, sleep carries five percent.
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
    </>
  );
}
