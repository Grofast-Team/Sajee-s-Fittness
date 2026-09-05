import { Panel, PageHeader, Ring, Section, Why } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { StepEntry } from '@/components/quick-entry';
import { WeekPlan } from '@/components/week-plan';
import { LevelPanel, NextStepCard } from '@/components/next-step';
import { SessionFeedback } from '@/components/session-feedback';
import { StepSync } from '@/components/step-sync';
import { StepTimeline } from '@/components/step-timeline';
import { getDayView } from '@/lib/data/day';
import { getWeekView } from '@/lib/data/week';
import { getNextStep } from '@/lib/data/next-step';
import { getStepValidity } from '@/lib/data/step-validity';
import { ensureWeekPlanned } from '@/lib/actions/training';
import { progressStepGoal, stepsToMinutes } from '@/lib/engines/steps';
import { activityKcal } from '@/lib/engines/energy';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Activity — FitCoach' };

/**
 * The activity screen.
 *
 * Steps lead because they are the part of the plan that moves every day and
 * costs nothing to do. The strength session sits beside them on desktop rather
 * than below, so the two halves of "movement" are visible at once instead of
 * one being buried under a scroll.
 *
 * Nothing here scolds. A missed target is stated as a distance still to cover,
 * never as a failure.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ mins?: string }>;
}) {
  const day = await getDayView();

  // Generate this week's sessions on first visit. `ensureWeekPlanned` is
  // idempotent — it leaves existing rows alone — so a completed session is
  // never overwritten by a page load.
  if (supabaseConfigured && !day.isSample) {
    await ensureWeekPlanned();
  }

  // How long someone has is a property of today, not of them, so it lives in
  // the URL rather than in the profile. Clamped because it comes from a query
  // string and anything can be typed there.
  const requested = Number((await searchParams).mins);
  const minutes = Number.isFinite(requested) ? Math.min(120, Math.max(5, requested)) : 30;

  const [week, step, stepValidity] = await Promise.all([
    getWeekView(),
    getNextStep(minutes),
    getStepValidity(),
  ]);

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
    <>
      <SampleBanner isSample={day.isSample} />

      <PageHeader title="Activity" lede="Where today's movement stands, and what is left." />

      {/*
       * The session runs full width and leads the page.
       *
       * It became the main event when it stopped being a fixed list and started
       * being chosen for the person, and it is by far the tallest thing here —
       * in a half-width column it left roughly 900px of dead space beside it on
       * a desktop monitor, and pushed itself below two step cards on a phone.
       * Full width fixes both, and gives the exercise rows and time picker room
       * to breathe.
       */}
      <div className="mb-4 lg:mb-5">
        <NextStepCard step={step} minutes={minutes} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
        {/* ---------------- After the session ---------------- */}
        <div className="space-y-4 lg:space-y-5">
          {!step.isRestDay ? (
            /* Anchor target: the week plan's "Record how it went" links here,
               so there is one route to completing today's session. */
            <div id="how-did-it-go" className="scroll-mt-6">
            <Panel>
              <Section title="How did it go?">
                <SessionFeedback
                  workoutPlanId={step.workoutPlanId}
                  canSave={!step.isSample}
                  plannedMinutes={step.sessionMinutes}
                />
              </Section>
            </Panel>
            </div>
          ) : null}

          <LevelPanel step={step} />
        </div>

        {/* ---------------- Steps ---------------- */}
        <div className="space-y-4 lg:space-y-5">
          <Panel feature className="sm:flex sm:items-center sm:gap-7">
            <div className="flex justify-center sm:shrink-0">
              <Ring
                label="Steps"
                value={stepsSoFar ?? 0}
                target={day.stepTarget}
                unit="steps"
                size="lg"
                hideCaption
                centre={
                  stepsSoFar === null ? (
                    <>
                      <span className="text-[15px]" style={{ color: 'var(--fg-subtle)' }}>
                        Not recorded
                      </span>
                      <span className="data mt-1 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                        target {day.stepTarget.toLocaleString()}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="data text-[36px] font-semibold leading-none">
                        {stepsSoFar.toLocaleString()}
                      </span>
                      <span className="mt-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
                        of {day.stepTarget.toLocaleString()}
                      </span>
                    </>
                  )
                }
              />
            </div>

            <div className="mt-5 min-w-0 flex-1 sm:mt-0">
              <h2 className="text-[17px] font-semibold">Steps today</h2>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                {stepsSoFar === null
                  ? `No steps recorded yet today. Your target is ${day.stepTarget.toLocaleString()}.`
                  : short !== null && short > 0
                    ? `${short.toLocaleString()} to go — roughly a ${stepsToMinutes(short)}-minute walk.`
                    : 'Step goal met.'}
              </p>

              <Why label="Why this number?">
                {day.rationale.steps ? <p>{day.rationale.steps}</p> : null}
                <p className="mt-2">
                  {nextWeek
                    ? nextWeek.explanation
                    : 'Once you have a week of step counts recorded, we will start adjusting this target up or down based on how often you actually hit it.'}
                </p>
              </Why>
            </div>
          </Panel>

          {/* Only shown once a phone has actually synced. Before that there is
              nothing to explain, and an empty timeline would be noise. */}
          {stepValidity ? (
            <Panel>
              <Section title="Today's steps">
                <StepTimeline view={stepValidity} target={day.stepTarget} />
              </Section>
            </Panel>
          ) : null}

          <Panel>
            <Section title="Record your steps">
              <StepEntry canSave={!day.isSample} current={day.stepsToday} />
              {/* Manual entry stays the working path on the web, where there is
                  no step counter to read. Sync is an addition, not a
                  replacement. */}
              <div className="mt-5">
                <StepSync />
              </div>
            </Section>
          </Panel>

          {walkBurn !== null ? (
            <Panel>
              <Section title="A 30-minute brisk walk">
                <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  Uses roughly <span className="data">{walkBurn}</span> kcal beyond what you would
                  have burned sitting. We show this but do not add it to your eating target —
                  exercise estimates carry large error, and eating them back is one of the most
                  reliable ways to stall.
                </p>
              </Section>
            </Panel>
          ) : null}
        </div>
      </div>

      {/* The week runs full width at every size: it is seven columns of its own
          and squeezing it into half a desktop grid makes the days unreadable. */}
      <div className="mt-4 lg:mt-5">
        <Panel>
          <WeekPlan week={week} canSave={!week.isSample} />
        </Panel>
      </div>
    </>
  );
}
