import Link from 'next/link';
import { ChevronDown, Clock, Play, TrendingUp } from 'lucide-react';
import { Alert, Badge, Panel, Section, Unavailable, Why } from '@/components/ui';
import { TIME_OPTIONS, trackName } from '@/lib/engines/video-recommendation';
import type { ExerciseBrief, NextStep } from '@/lib/data/next-step';

/**
 * "Your next step" — the app choosing today's session so the user does not
 * have to.
 *
 * The promise is "don't choose a workout, the app chooses the right one for
 * you", and a promise like that only survives contact with a real user if the
 * app can say why. So every part of the choice is legible: the level it is
 * pitched at, the time it fits, and the reasoning behind it, one tap away.
 */

/* ------------------------------------------------------------------ */
/* How long have you got?                                              */
/* ------------------------------------------------------------------ */

/**
 * The time control.
 *
 * Plain links carrying a query parameter rather than client state — the whole
 * card re-renders from the server with a genuinely different recommendation,
 * and it works before any JavaScript arrives. On a cheap phone on 4G, that
 * difference is the feature.
 */
export function TimePicker({ selected, basePath }: { selected: number; basePath: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">How long have you got today?</legend>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {TIME_OPTIONS.map((option) => {
          const on = option.minutes === selected;
          return (
            <Link
              key={option.minutes}
              href={`${basePath}?mins=${option.minutes}`}
              scroll={false}
              aria-current={on ? 'true' : undefined}
              className="inline-flex min-h-11 items-center border px-3.5 text-[13px] font-semibold transition-colors duration-200"
              style={{
                background: on ? 'var(--primary)' : 'var(--surface)',
                color: on ? 'var(--on-primary)' : 'var(--fg-muted)',
                borderColor: on ? 'var(--primary)' : 'var(--line-strong)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              {option.label}
            </Link>
          );
        })}
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        Ten minutes you actually do beats forty you skip. Pick the honest number.
      </p>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* One exercise                                                        */
/* ------------------------------------------------------------------ */

function dose(e: ExerciseBrief): string {
  if (e.holdSeconds) return `${e.sets ?? 3} × ${e.holdSeconds}s hold`;
  if (e.repLow && e.repHigh) return `${e.sets ?? 3} × ${e.repLow}–${e.repHigh}`;
  if (e.repLow) return `${e.sets ?? 3} × ${e.repLow}`;
  return `${e.sets ?? 3} sets`;
}

/**
 * An exercise, with its demonstration folded away until wanted.
 *
 * A `<details>` rather than a modal: it works without JavaScript, it is
 * keyboard accessible for free, and someone mid-session can leave three of them
 * open while they work. The easier variant is given equal billing to the harder
 * one — the way down has to be as visible as the way up, or people who need it
 * quietly stop instead.
 */
export function ExerciseRow({ exercise }: { exercise: ExerciseBrief }) {
  const hasDetail =
    exercise.instructions.length > 0 ||
    exercise.commonMistakes.length > 0 ||
    exercise.easierName !== null ||
    exercise.harderName !== null;

  return (
    <li className="border-b py-3 first:pt-0 last:border-0 last:pb-0" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{exercise.name}</span>
        <span className="data shrink-0 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
          {dose(exercise)}
          {exercise.restSeconds ? ` · ${exercise.restSeconds}s rest` : ''}
        </span>
      </div>

      {hasDetail ? (
        <details className="group mt-1.5">
          <summary
            className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 text-[13px] font-medium"
            style={{ color: 'var(--primary-dark)' }}
          >
            How to do it
            <ChevronDown
              size={14}
              aria-hidden
              className="transition-transform duration-200 group-open:rotate-180"
            />
          </summary>

          <div
            className="measure mt-2 border-l-2 pl-3 text-sm leading-relaxed"
            style={{ borderColor: 'var(--primary-border)', color: 'var(--fg-muted)' }}
          >
            {exercise.instructions.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-4">
                {exercise.instructions.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            ) : null}

            {exercise.commonMistakes.length > 0 ? (
              <div className="mt-3">
                <p className="text-[13px] font-semibold" style={{ color: 'var(--fg)' }}>
                  Watch out for
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {exercise.commonMistakes.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {exercise.easierName || exercise.harderName ? (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                {exercise.easierName ? (
                  <span>
                    Too hard? <span style={{ color: 'var(--fg)' }}>{exercise.easierName}</span>
                  </span>
                ) : null}
                {exercise.harderName ? (
                  <span>
                    Too easy? <span style={{ color: 'var(--fg)' }}>{exercise.harderName}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

/**
 * The full recommendation, for the Activity screen.
 *
 * `compact` drops the exercise list and the time control for the Today screen,
 * where this is one card among several and the job is only to say what is next
 * and get someone into it.
 */
export function NextStepCard({
  step,
  minutes,
  compact = false,
}: {
  step: NextStep;
  minutes: number;
  compact?: boolean;
}) {
  const { recommendation: rec } = step;
  const reasons = rec.because.length > 0 ? rec.because : step.sessionBecause;

  /* No video and no written session: an unplanned day. The card has to say
     that plainly rather than announce a session it cannot show. */
  const nothingScheduled = !rec.video && step.exercises.length === 0;

  /*
   * Rest is prescribed, not merely absent.
   *
   * Showing a recommendation on a scheduled rest day quietly teaches people
   * that the plan is optional and more is always better — which is how a
   * beginner ends up training seven days a week for a fortnight and then
   * stopping for a month.
   */
  if (step.isRestDay) {
    return (
      <Panel feature>
        <Badge tone="primary">Level {step.level} · {step.levelName}</Badge>
        <h2 className="display mt-2.5 text-[1.375rem]">Rest day</h2>
        <p className="measure mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          Today is a scheduled rest day. Adaptation happens between sessions, not during them, so
          this is part of the plan rather than a gap in it. A walk is fine if you want to move.
        </p>
        {!compact ? (
          <div className="mt-6">
            <TimePicker selected={minutes} basePath="/activity" />
          </div>
        ) : null}
      </Panel>
    );
  }

  return (
    <Panel feature>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">Level {step.level} · {step.levelName}</Badge>
        {rec.video ? <Badge>{trackName(rec.video.track)}</Badge> : null}
        <span
          className="data inline-flex items-center gap-1 text-[13px]"
          style={{ color: 'var(--fg-subtle)' }}
        >
          <Clock size={13} aria-hidden />
          {rec.video ? rec.video.durationMinutes : step.sessionMinutes} min
        </span>
      </div>

      <h2 className="display mt-2.5 text-[1.375rem]">
        {rec.video ? rec.video.title : nothingScheduled ? 'No session planned' : step.sessionTitle}
      </h2>

      <p className="measure mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {rec.video
          ? 'Chosen for today from your level, your equipment and the time you have.'
          : nothingScheduled
            ? 'Nothing is scheduled for today. If you want to train anyway, do the movements you ' +
              'know and record how it went — it still counts, and it still tunes what comes next.'
            : 'Your session for today, written out. Work through it at your own pace.'}
      </p>

      {/*
       * The honest gap. There are no reviewed videos yet, and rather than
       * embedding whatever a search returned we say so and hand over the
       * written session.
       *
       * Suppressed when there is no written session either — pointing someone
       * at "the instructions on the session itself" when the session is empty
       * sends them looking for something that is not on the page.
       */}
      {rec.shortfall && !nothingScheduled ? (
        <div className="mt-4">
          <Unavailable title="No video for this one yet" detail={rec.shortfall} />
        </div>
      ) : null}

      {/* A level change is news, and it is delivered as an adjustment rather
          than as a verdict on the person. */}
      {step.progression && step.progression.decision !== 'hold' ? (
        <div className="mt-4">
          <Alert
            tone={step.progression.decision === 'hold_for_pain' ? 'warning' : 'info'}
            title={
              step.progression.decision === 'progress'
                ? 'You have moved up a level'
                : step.progression.decision === 'regress'
                  ? 'We have eased this back'
                  : 'Holding steady while that settles'
            }
          >
            {step.progression.message}
          </Alert>
        </div>
      ) : null}

      {!compact && step.exercises.length > 0 ? (
        <Section title="The session" className="pt-6">
          <ul>
            {step.exercises.map((e) => (
              <ExerciseRow key={e.id} exercise={e} />
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
            Every movement has an easier version — open “How to do it” to find it. Stop if anything
            is genuinely painful. That is information, not weakness.
          </p>
        </Section>
      ) : null}

      {/*
       * The video's reasoning when there is a video, the session's reasoning
       * otherwise. With an empty library the first list is always empty, so
       * without the fallback the one thing every real user currently sees — the
       * written session — would be the one thing that never explains itself.
       */}
      {reasons.length > 0 ? (
        <Why label={rec.video ? 'Why this one?' : 'Why these exercises?'}>
          <ul className="list-disc space-y-1 pl-4">
            {reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </Why>
      ) : null}

      {rec.alternatives.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {rec.alternatives.map((alt) => (
            <span
              key={alt.video.id}
              className="inline-flex items-center border px-3 py-1.5 text-[13px]"
              style={{
                borderColor: 'var(--line-strong)',
                borderRadius: 'var(--radius-control)',
                color: 'var(--fg-muted)',
              }}
            >
              {alt.label}
            </span>
          ))}
        </div>
      ) : null}

      {compact ? (
        /* Styled as a link rather than a <Button> inside a <Link>. Nesting a
           button in an anchor is invalid HTML, and screen readers and keyboards
           disagree about what the resulting control even is. */
        <Link
          href="/activity"
          className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium transition-opacity duration-200 hover:opacity-90"
          style={{
            background: 'var(--primary)',
            color: 'var(--on-primary)',
            borderRadius: 'var(--radius-control)',
          }}
        >
          <Play size={16} aria-hidden /> Open today&rsquo;s session
        </Link>
      ) : (
        <div className="mt-6">
          <TimePicker selected={minutes} basePath="/activity" />
        </div>
      )}
    </Panel>
  );
}

/**
 * The level, and what it would take to move up.
 *
 * Shown as a checklist rather than a percentage, because "not yet" is only
 * tolerable when you can see exactly what it is waiting for.
 */
export function LevelPanel({ step }: { step: NextStep }) {
  const checks = step.progression?.readiness.checks ?? [];

  return (
    <Panel>
      <Section title="Where you are">
        <div className="flex items-baseline gap-2">
          <span className="data text-[26px] font-semibold leading-none" style={{ color: 'var(--primary)' }}>
            {step.level}
          </span>
          <span className="text-sm font-medium">{step.levelName}</span>
        </div>

        {checks.length > 0 ? (
          <>
            <p className="mt-3 flex items-center gap-1.5 text-[13px] font-medium">
              <TrendingUp size={14} aria-hidden style={{ color: 'var(--fg-subtle)' }} />
              To move up
            </p>
            <ul className="mt-2 space-y-1.5">
              {checks.map((check) => (
                <li key={check.label} className="flex items-baseline gap-2 text-[13px]">
                  {/* The tick carries pass/fail in colour and shape, so it also
                      has to carry it in words. Hidden from assistive tech, this
                      list read as an undifferentiated set of requirements with
                      no indication of which were already met. */}
                  <span className="sr-only">{check.passed ? 'Done:' : 'Not yet:'}</span>
                  <span
                    aria-hidden
                    style={{ color: check.passed ? 'var(--confirm)' : 'var(--fg-subtle)' }}
                  >
                    {check.passed ? '✓' : '○'}
                  </span>
                  <span style={{ color: 'var(--fg-muted)' }}>
                    <span style={{ color: 'var(--fg)' }}>{check.label}</span> — {check.detail}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            Once you have finished a few sessions and told us how they felt, this will show exactly
            what stands between you and the next level.
          </p>
        )}
      </Section>
    </Panel>
  );
}
