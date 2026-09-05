import { Badge, Rail, Why } from '@/components/ui';
import type { StepValidityView } from '@/lib/data/step-validity';

/**
 * How today's step number was arrived at.
 *
 * The point of this panel is not to show a smaller number than the phone does.
 * It is to make the difference between the two explainable, line by line, so
 * that a user who notices the discrepancy gets an answer instead of a reason
 * to distrust both figures.
 *
 * Nothing here claims an excluded stretch was false. We do not have the
 * evidence for that, and the wording never pretends otherwise.
 */

const CONFIDENCE_COPY = {
  high: { label: 'High confidence', tone: 'confirm' as const },
  medium: { label: 'Some uncertainty', tone: 'signal' as const },
  low: { label: 'Low confidence', tone: 'signal' as const },
};

const REASON_LABEL: Record<string, string> = {
  duplicate_source: 'Counted once',
  impossible_cadence: 'Not confirmed',
  wheel_based_workout: 'Wheels, not steps',
};

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function StepTimeline({ view, target }: { view: StepValidityView; target: number }) {
  const confidence = CONFIDENCE_COPY[view.confidence];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={confidence.tone}>{confidence.label}</Badge>
        {view.sources.map((s) => (
          <Badge key={s}>{s}</Badge>
        ))}
      </div>

      <Rail
        label="Confirmed steps"
        value={view.validatedSteps}
        target={target}
        unit="steps"
        size="lg"
        // Only claim these were measured when nothing was set aside.
        measured={view.excludedSteps === 0}
      />

      {/*
       * The device's own figure, kept visible.
       *
       * If our number is lower than the one on their phone and we never show
       * theirs, the difference looks like a bug. Showing both makes it a
       * explanation instead of a discrepancy.
       */}
      {view.excludedSteps > 0 ? (
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          Your phone recorded <span className="data">{view.rawSteps.toLocaleString()}</span>. We
          could not confirm <span className="data">{view.excludedSteps.toLocaleString()}</span> of
          those — see below for which stretches and why.
        </p>
      ) : null}

      {view.segments.length > 0 ? (
        <Why label="How we got this number">
          <ul className="space-y-2.5">
            {view.segments.map((s, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span className="shrink-0">
                  <span className="data text-[13px]">
                    {clockTime(s.startedAt)}–{clockTime(s.endedAt)}
                  </span>
                  {s.reason ? (
                    <span className="ml-2 text-[12px]" style={{ color: 'var(--signal)' }}>
                      {REASON_LABEL[s.reason] ?? 'Not counted'}
                    </span>
                  ) : null}
                </span>
                <span
                  className="data shrink-0 text-[13px]"
                  style={{
                    color: s.counted ? 'var(--fg)' : 'var(--fg-subtle)',
                    textDecoration: s.counted ? undefined : 'line-through',
                  }}
                >
                  {s.steps.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>

          {view.reasons.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-4">
              {view.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}

          {/* The limit of the claim, stated where the claim is made. */}
          <p className="mt-3">
            Your phone has already filtered out most travel movement before we see it. We do not
            try to detect that again — we only set aside records that were counted twice, that
            show a step rate no person could produce, or that happened during a cycling session.
          </p>
        </Why>
      ) : null}
    </div>
  );
}
