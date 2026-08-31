import { Rail, Section, Why } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { StepEntry } from '@/components/quick-entry';
import { WeekPlan } from '@/components/week-plan';
import { getDayView } from '@/lib/data/day';
import { getWeekView } from '@/lib/data/week';
import { ensureWeekPlanned } from '@/lib/actions/training';
import { progressStepGoal, stepsToMinutes } from '@/lib/engines/steps';
import { activityKcal } from '@/lib/engines/energy';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Activity — FitCoach' };

export default async function ActivityPage() {
  const day = await getDayView();

  // Generate this week's sessions on first visit. `ensureWeekPlanned` is
  // idempotent — it leaves existing rows alone — so a completed session is
  // never overwritten by a page load.
  if (supabaseConfigured && !day.isSample) {
    await ensureWeekPlanned();
  }

  const week = await getWeekView();

  const stepsSoFar = day.stepsToday;
  const short = stepsSoFar === null ? null : Math.max(0, day.stepTarget - stepsSoFar);
  // Only project next week's goal once we have real adherence to base it on.
  // A projection built on an invented "4 of 7" is worse than no projection.
  const nextWeek =
    week.stepDaysMet === null
      ? null
      : progressStepGoal({
          currentTarget: day.stepTarget,
          baseline: Math.round(day.stepTarget * 0.8),
          daysMetLastWeek: week.stepDaysMet,
        });

  const walkBurn = day.weightKg === null ? null : activityKcal(4.3, day.weightKg, 30);

  return (
    <div className="space-y-4">
      <SampleBanner isSample={day.isSample} />

      <header>
        <h1 className="text-2xl font-semibold">Activity</h1>
      </header>

      <Section title="Steps" meta="Today">
        {stepsSoFar === null ? (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            No steps recorded today. Your target is {day.stepTarget.toLocaleString()}.
          </p>
        ) : (
          <Rail label="Steps" value={stepsSoFar} target={day.stepTarget} unit="steps" />
        )}
        {short !== null && short > 0 ? (
          <p className="mt-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
            {short.toLocaleString()} to go — roughly a {stepsToMinutes(short)}-minute walk.
          </p>
        ) : null}
        <Why label="Why this number?">
          {day.rationale.steps ? <p>{day.rationale.steps}</p> : null}
          <p className="mt-2">
            {nextWeek
              ? nextWeek.explanation
              : 'Once you have a week of step counts recorded, we will start adjusting this target up or down based on how often you actually hit it.'}
          </p>
        </Why>
      </Section>

      <StepEntry canSave={!day.isSample} current={day.stepsToday} />

      <WeekPlan week={week} canSave={!week.isSample} />
      <Section title="Your strength session" meta="No equipment">
        <ul className="space-y-2 text-sm">
          {[
            ['Bodyweight squat', '3 × 8–12', '75s rest'],
            ['Push-up from knees', '3 × 6–10', '75s rest'],
            ['Glute bridge', '3 × 10–15', '60s rest'],
            ['Plank', '3 × 20s hold', '60s rest'],
          ].map(([name, sets, rest]) => (
            <li key={name} className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{name}</span>
              <span className="data shrink-0" style={{ color: 'var(--fg-muted)' }}>
                {sets} · {rest}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs" style={{ color: 'var(--fg-subtle)' }}>
          Every movement has an easier version if it hurts or you cannot finish the reps. Stop if
          anything is genuinely painful — that is information, not weakness.
        </p>
      </Section>

      {walkBurn !== null ? (
        <Section title="A 30-minute brisk walk">
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Uses roughly {walkBurn} kcal beyond what you would have burned sitting. We show this but
            do not add it to your eating target — exercise estimates carry large error, and eating
            them back is one of the most reliable ways to stall.
          </p>
        </Section>
      ) : null}
    </div>
  );
}
