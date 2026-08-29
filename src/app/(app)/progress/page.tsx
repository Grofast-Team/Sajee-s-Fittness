import { Card, CardTitle, Unavailable, WhyPanel } from '@/components/ui';
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

  // Week-over-week comparison, taken from the smoothed series so it is not at
  // the mercy of which day someone happened to weigh in.
  const thisWeek = points.slice(-7);
  const lastWeek = points.slice(-14, -7);
  const avg = (xs: typeof points) =>
    xs.length === 0 ? null : xs.reduce((s, p) => s + p.raw, 0) / xs.length;
  const thisAvg = avg(thisWeek);
  const lastAvg = avg(lastWeek);
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
    <div className="space-y-4">
      <SampleBanner isSample={day.isSample} />

      <header>
        <h1 className="text-2xl font-semibold">Progress</h1>
      </header>

      <WeightEntry canSave={!day.isSample} lastWeightKg={day.weightKg} />

      <Card>
        <CardTitle hint={trend.readingCount > 0 ? `${trend.readingCount} weigh-ins` : undefined}>
          Weight
        </CardTitle>

        {trend.latestSmoothed !== null ? (
          <>
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="tabular text-3xl font-semibold">
                  {trend.latestSmoothed.toFixed(1)} kg
                </p>
                <p className="text-xs" style={{ color: 'var(--fg-subtle)' }}>
                  trend
                  {last ? ` · last reading ${last.raw.toFixed(1)} kg` : ''}
                </p>
              </div>
              {weekDelta !== null ? (
                <div className="text-right">
                  <p
                    className="tabular text-lg font-semibold"
                    style={{ color: weekDelta < 0 ? 'var(--accent)' : 'var(--fg-muted)' }}
                  >
                    {weekDelta > 0 ? '+' : ''}
                    {weekDelta.toFixed(2)} kg
                  </p>
                  <p className="text-xs" style={{ color: 'var(--fg-subtle)' }}>
                    vs last week&rsquo;s average
                  </p>
                </div>
              ) : null}
            </div>

            <TrendChart points={points} />

            <p className="mt-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
              {trend.message}
            </p>

            {explanation && dayDelta !== null && dayDelta !== 0 ? (
              <WhyPanel label={`Why did the scale ${dayDelta > 0 ? 'go up' : 'move'}?`}>
                <p className="font-medium" style={{ color: 'var(--fg)' }}>
                  {explanation.headline}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {explanation.causes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p className="mt-2">{explanation.reassurance}</p>
              </WhyPanel>
            ) : null}
          </>
        ) : (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            {trend.message}
          </p>
        )}
      </Card>

      {day.waist ? (
        <Card>
          <CardTitle>Waist</CardTitle>
          <div className="flex items-end justify-between">
            <p className="tabular text-3xl font-semibold">{day.waist.latestCm.toFixed(1)} cm</p>
            {day.waist.changeCm !== null ? (
              <p
                className="tabular text-lg font-semibold"
                style={{ color: day.waist.changeCm < 0 ? 'var(--accent)' : 'var(--fg-muted)' }}
              >
                {day.waist.changeCm > 0 ? '+' : ''}
                {day.waist.changeCm.toFixed(1)} cm
              </p>
            ) : null}
          </div>

          {day.waist.changeCm !== null && day.waist.overDays !== null ? (
            <p className="mt-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
              {day.waist.changeCm < 0
                ? `Down ${Math.abs(day.waist.changeCm).toFixed(1)} cm over ${day.waist.overDays} days. ` +
                  'If the scale has moved less than this, that usually means your body composition ' +
                  'is changing — though we cannot measure body fat directly, so we will not claim ' +
                  'more than the tape shows.'
                : `Up ${day.waist.changeCm.toFixed(1)} cm over ${day.waist.overDays} days. Tape ` +
                  'readings vary with how tightly you pull and exactly where you measure, so check ' +
                  'the next one before reading much into it.'}
            </p>
          ) : (
            // One reading is a starting point, not a trend.
            <p className="mt-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
              That is your first waist measurement, so there is nothing to compare it to yet. Take
              the next one in a week or two, in the same place and at the same time of day.
            </p>
          )}
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardTitle>Waist</CardTitle>
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            No waist measurements recorded yet. It is worth taking — waist often moves when the
            scale is being stubborn, and it tracks the fat that matters most for health.
          </p>
        </Card>
      )}

      <Card>
        <CardTitle>{plateau.isPlateau ? 'Plateau check' : 'Are you plateauing?'}</CardTitle>
        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
          {plateau.verdict}
        </p>
        {plateau.checks.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {plateau.checks.map((c) => (
              <li key={c.label}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      background: 'var(--surface-2)',
                      color: c.likelihood === 'high' ? 'var(--primary)' : 'var(--fg-subtle)',
                    }}
                  >
                    {c.likelihood} likelihood
                  </span>
                </div>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
                  {c.finding}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {adherence ? (
        <Card>
          <CardTitle hint="Last 7 days">How the week went</CardTitle>
          <p className="tabular text-3xl font-semibold">{adherence.score}%</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
            {adherence.summary}
          </p>
          <WhyPanel label="Show the breakdown">
            <ul className="space-y-1.5">
              {adherence.components.map((c) => (
                <li key={c.key} className="flex justify-between gap-3">
                  <span>{c.label}</span>
                  <span className="tabular shrink-0">{Math.round(c.score * 100)}%</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Weighted by how much each one actually affects fat loss — logging and calorie range
              carry a quarter each, sleep carries five percent.
            </p>
          </WhyPanel>
        </Card>
      ) : (
        <Unavailable
          title="Your weekly review is not generated yet"
          detail={
            'The adherence engine is built and tested, but nothing schedules the weekly rollup ' +
            'yet. It will appear here once that runs.'
          }
        />
      )}
    </div>
  );
}
