'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import { logSessionFeedback, type SessionResult } from '@/lib/actions/session';

/**
 * How did that go?
 *
 * This is the input the whole adaptive system runs on. Without it the app is
 * guessing at difficulty, and a plan built on a guess drifts steadily away from
 * the person following it.
 *
 * Two questions, kept deliberately separate:
 *
 * - **Difficulty** is the training signal. Hard is often correct.
 * - **Pain** is a safety signal, and it is never traded off against progress.
 *
 * Collapsing them into one "how was it?" scale is the common shortcut and it
 * loses the distinction that matters most: someone rating a session 5 because
 * their knee hurt needs a different response from someone rating it 5 because
 * it was genuinely demanding.
 */

const DIFFICULTY = [
  { value: 1, label: 'Easy', detail: 'Could have done a lot more' },
  { value: 2, label: 'Comfortable', detail: 'Finished with plenty left' },
  { value: 3, label: 'About right', detail: 'Worked for it, finished it' },
  { value: 4, label: 'Hard', detail: 'Only just got through it' },
  { value: 5, label: 'Too hard', detail: 'Could not finish it' },
] as const;

const PAIN = [
  { value: 'none', label: 'No pain' },
  { value: 'mild_discomfort', label: 'Some discomfort' },
  { value: 'pain', label: 'It hurt' },
] as const;

type Pain = (typeof PAIN)[number]['value'];

/** A row of choices that stays legible at 320px. */
function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className="min-h-11 flex-1 cursor-pointer border px-2 text-[13px] font-semibold transition-colors duration-200"
      style={{
        background: on ? 'var(--primary)' : 'var(--surface)',
        color: on ? 'var(--on-primary)' : 'var(--fg-muted)',
        borderColor: on ? 'var(--primary)' : 'var(--line-strong)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      {children}
    </button>
  );
}

export function SessionFeedback({
  workoutPlanId,
  canSave,
  plannedMinutes,
}: {
  workoutPlanId: string | null;
  canSave: boolean;
  plannedMinutes: number;
}) {
  const [difficulty, setDifficulty] = useState<number | null>(null);
  const [pain, setPain] = useState<Pain>('none');
  const [painLocation, setPainLocation] = useState('');
  const [completed, setCompleted] = useState(true);
  const [minutes, setMinutes] = useState('');
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<SessionResult | null>(null);

  async function submit() {
    if (difficulty === null) return;
    setSaving(true);
    setState(null);

    const result = await logSessionFeedback({
      workoutPlanId: workoutPlanId ?? undefined,
      difficulty,
      pain,
      painLocation: painLocation.trim() || undefined,
      completed,
      actualMinutes: minutes ? Number(minutes) : undefined,
    });

    setState(result);
    if (result.ok) {
      setDifficulty(null);
      setPain('none');
      setPainLocation('');
      setMinutes('');
    }
    setSaving(false);
  }

  return (
    <div>
      <fieldset>
        <legend className="text-sm font-medium">How hard was that?</legend>
        <p className="mt-0.5 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
          There is no right answer. This is what decides your next session.
        </p>
        {/* Stacked, not a five-across row: the descriptions are what make the
            scale mean the same thing to two different people. */}
        <div className="mt-2.5 space-y-2">
          {DIFFICULTY.map((d) => {
            const on = difficulty === d.value;
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={on}
                onClick={() => setDifficulty(on ? null : d.value)}
                className="flex min-h-11 w-full cursor-pointer items-baseline justify-between gap-3 border px-3.5 py-2 text-left transition-colors duration-200"
                style={{
                  background: on ? 'var(--primary-light)' : 'var(--surface)',
                  borderColor: on ? 'var(--primary)' : 'var(--line-strong)',
                  borderRadius: 'var(--radius-control)',
                }}
              >
                <span
                  className="text-sm font-semibold"
                  style={{ color: on ? 'var(--primary-dark)' : 'var(--fg)' }}
                >
                  {d.label}
                </span>
                <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                  {d.detail}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-sm font-medium">Any pain?</legend>
        <p className="mt-0.5 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
          Muscles working hard is normal. Joint pain, or anything sharp, is not.
        </p>
        <div className="mt-2.5 flex gap-2">
          {PAIN.map((p) => (
            <Choice key={p.value} on={pain === p.value} onClick={() => setPain(p.value)}>
              {p.label}
            </Choice>
          ))}
        </div>
      </fieldset>

      {/* Only asked when it is relevant. A "where did it hurt?" box on a screen
          where nothing hurt is noise, and noise is what stops forms getting
          filled in. */}
      {pain !== 'none' ? (
        <div className="mt-4">
          <Field
            label="Where?"
            htmlFor="pain-location"
            description="So we can avoid loading it next time."
          >
            <input
              id="pain-location"
              type="text"
              maxLength={120}
              value={painLocation}
              onChange={(e) => setPainLocation(e.target.value)}
              placeholder="e.g. left knee"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
        </div>
      ) : null}

      {pain === 'pain' ? (
        <div className="mt-4">
          <Alert tone="warning" title="We will keep the difficulty where it is">
            Nothing gets harder while pain is being reported. If it is sharp, or it does not settle
            in a couple of days, please have someone qualified look at it rather than training
            through it.
          </Alert>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field
          label="How long did it take?"
          htmlFor="actual-minutes"
          description="Optional."
        >
          <div className="flex items-center gap-2">
            <input
              id="actual-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={300}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder={String(plannedMinutes)}
              className={`data ${inputClass}`}
              style={inputStyle}
            />
            <span className="shrink-0 text-sm" style={{ color: 'var(--fg-subtle)' }}>
              min
            </span>
          </div>
        </Field>

        <fieldset>
          <legend className="text-sm font-medium">Did you finish it?</legend>
          <div className="mt-1.5 flex gap-2">
            <Choice on={completed} onClick={() => setCompleted(true)}>
              Finished
            </Choice>
            <Choice on={!completed} onClick={() => setCompleted(false)}>
              Part of it
            </Choice>
          </div>
        </fieldset>
      </div>

      {/* Doing part of a session is a result, not a failure, and the form says
          so at the moment someone is about to admit it. */}
      {!completed ? (
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
          Part of a session still counts, and it is more useful to us than a skipped one. If it
          keeps happening we will make the sessions shorter rather than assume you stopped caring.
        </p>
      ) : null}

      {state ? (
        <div className="mt-4">
          {state.ok ? (
            <Alert tone="success">{state.message}</Alert>
          ) : (
            <Alert tone="error">{state.error}</Alert>
          )}
        </div>
      ) : null}

      <Button
        className="mt-4"
        fullWidth
        disabled={saving || !canSave || difficulty === null}
        onClick={submit}
      >
        {saving ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          'Record how it went'
        )}
      </Button>

      {!canSave ? (
        <p className="mt-2 text-center text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Sign in and finish setup to record your sessions.
        </p>
      ) : null}
    </div>
  );
}
