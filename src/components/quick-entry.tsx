'use client';

import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import {
  logMeasurement,
  logSleep,
  logSteps,
  logWater,
  type TrackResult,
} from '@/lib/actions/tracking';

/**
 * Quick entry forms for weight, measurements, steps, water and sleep.
 *
 * Deliberately small and always visible rather than hidden behind a floating
 * action button. The whole product depends on these numbers arriving regularly,
 * and every extra tap between "I am standing on the scale" and "it is recorded"
 * costs adherence.
 *
 * None of these draw their own card. The screen that places them supplies the
 * panel and the heading, so a form never ends up as a card inside a card.
 */

function Feedback({ state }: { state: TrackResult | null }) {
  if (!state) return null;

  return (
    <div className="mt-3">
      {state.ok ? (
        <Alert tone="success">{state.message}</Alert>
      ) : (
        <Alert tone="error">{state.error}</Alert>
      )}
    </div>
  );
}

/** The unit that sits inside the right-hand edge of a numeric field. */
function Unit({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-sm" style={{ color: 'var(--fg-subtle)' }}>
      {children}
    </span>
  );
}

export function WeightEntry({
  canSave,
  lastWeightKg,
}: {
  canSave: boolean;
  lastWeightKg: number | null;
}) {
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<TrackResult | null>(null);

  async function submit() {
    setSaving(true);
    setState(null);

    const result = await logMeasurement({
      weightKg: weight ? Number(weight) : undefined,
      waistCm: waist ? Number(waist) : undefined,
    });

    setState(result);
    if (result.ok) {
      setWeight('');
      setWaist('');
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Weight" htmlFor="weight">
          <div className="flex items-center gap-2">
            <input
              id="weight"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={25}
              max={400}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={lastWeightKg ? lastWeightKg.toFixed(1) : '—'}
              className={`data ${inputClass}`}
              style={inputStyle}
            />
            <Unit>kg</Unit>
          </div>
        </Field>

        <Field label="Waist (optional)" htmlFor="waist">
          <div className="flex items-center gap-2">
            <input
              id="waist"
              type="number"
              inputMode="decimal"
              step="0.5"
              min={30}
              max={250}
              value={waist}
              onChange={(e) => setWaist(e.target.value)}
              className={`data ${inputClass}`}
              style={inputStyle}
            />
            <Unit>cm</Unit>
          </div>
        </Field>
      </div>

      {/* Consistency beats frequency. A reading taken under the same conditions
          each time is worth more than three taken at random moments. */}
      <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        Weigh yourself the same way each time — same time of day, after the toilet, before eating.
        Comparable readings matter far more than frequent ones.
      </p>

      <Feedback state={state} />

      <Button
        className="mt-4"
        fullWidth
        disabled={saving || !canSave || (!weight && !waist)}
        onClick={submit}
      >
        {saving ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          'Record'
        )}
      </Button>

      {!canSave ? (
        <p className="mt-2 text-center text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Sign in and finish setup to record your own measurements.
        </p>
      ) : null}
    </div>
  );
}

export function StepEntry({ canSave, current }: { canSave: boolean; current: number | null }) {
  const [steps, setSteps] = useState(current !== null ? String(current) : '');
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<TrackResult | null>(null);

  async function submit(value: number) {
    setSaving(true);
    setState(null);
    setState(await logSteps({ steps: value }));
    setSaving(false);
  }

  return (
    <div>
      <Field
        label="Steps so far"
        htmlFor="steps"
        // Was "we do not sync with devices yet", which stopped being true the
        // moment the Android app could read Health Connect — and it sat
        // directly above the sync control, contradicting it.
        description="Read it off your phone's health app. We would rather you enter a real number than have us invent one."
      >
        <input
          id="steps"
          type="number"
          inputMode="numeric"
          min={0}
          max={100000}
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          placeholder="e.g. 4200"
          className={`data ${inputClass}`}
          style={inputStyle}
        />
      </Field>

      <Feedback state={state} />

      <Button
        className="mt-4"
        fullWidth
        disabled={saving || !canSave || steps === ''}
        onClick={() => submit(Number(steps))}
      >
        {saving ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          'Record'
        )}
      </Button>

      {!canSave ? (
        <p className="mt-2 text-center text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Sign in and finish setup to record your steps.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Water.
 *
 * One tap per glass, because anything more elaborate does not get used. The
 * target comes from the plan rather than a flat "eight glasses" — hydration
 * needs scale with bodyweight and activity, and more is not better.
 */
export function WaterEntry({
  canSave,
  consumedMl,
  targetMl,
}: {
  canSave: boolean;
  consumedMl: number;
  targetMl: number;
}) {
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<TrackResult | null>(null);
  const [optimistic, setOptimistic] = useState(consumedMl);

  const glasses = Math.round(targetMl / 250);
  const filled = Math.floor(optimistic / 250);

  async function addGlass() {
    setSaving(true);
    setState(null);
    setOptimistic((ml) => ml + 250);

    const result = await logWater({ ml: 250 });
    setState(result);
    // Roll the optimistic update back if the write did not land.
    if (!result.ok) setOptimistic((ml) => ml - 250);
    setSaving(false);
  }

  return (
    <div>
      {/*
       * A single bar rather than a grid of empty glass outlines. Ten outlined
       * squares took a third of the screen to communicate one number, and read
       * as decoration rather than data.
       */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Water</span>
        <span className="data text-sm">
          <span style={{ color: 'var(--fg)', fontWeight: 600 }}>
            {optimistic.toLocaleString()}
          </span>
          <span style={{ color: 'var(--fg-subtle)' }}> / {targetMl.toLocaleString()} ml</span>
        </span>
      </div>

      <div
        className="relative mt-2 w-full overflow-hidden"
        style={{ height: 8, background: 'var(--ground)', borderRadius: 8 }}
        role="progressbar"
        aria-label={`Water: ${optimistic} of ${targetMl} millilitres`}
        aria-valuenow={optimistic}
        aria-valuemin={0}
        aria-valuemax={targetMl}
      >
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-300"
          style={{
            width: `${Math.min(100, (optimistic / targetMl) * 100)}%`,
            background: 'var(--primary)',
            borderRadius: 8,
          }}
        />
      </div>

      <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
        {glasses - filled > 0
          ? `${glasses - filled} more glasses to target.`
          : 'Target reached. More is not better.'}
      </p>

      <Feedback state={state} />

      <Button className="mt-4" fullWidth variant="ghost" disabled={saving || !canSave} onClick={addGlass}>
        {saving ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          'Add a glass (250 ml)'
        )}
      </Button>
    </div>
  );
}

/**
 * Sleep.
 *
 * Recorded in hours and half-hours because nobody knows their sleep to the
 * minute, and a field that demands precision people do not have just goes
 * unfilled. Quality is optional — it is the more useful of the two for
 * explaining a hard day, but making it mandatory would cost us the duration.
 */
export function SleepEntry({
  canSave,
  currentMinutes,
  targetHours,
}: {
  canSave: boolean;
  currentMinutes: number | null;
  targetHours: number;
}) {
  const [hours, setHours] = useState(
    currentMinutes !== null ? (currentMinutes / 60).toFixed(1) : '',
  );
  const [quality, setQuality] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<TrackResult | null>(null);

  async function submit() {
    setSaving(true);
    setState(null);
    setState(
      await logSleep({
        minutes: Math.round(Number(hours) * 60),
        quality: quality ?? undefined,
      }),
    );
    setSaving(false);
  }

  return (
    /*
     * Collapsed by default. Sleep is the least consequential thing on the
     * dashboard and was visually the heaviest — a full form with five buttons
     * anchoring the bottom of the page. As a disclosure it costs one line until
     * someone actually wants it.
     */
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
        <span className="data text-sm" style={{ color: 'var(--fg-muted)' }}>
          {currentMinutes !== null ? `${(currentMinutes / 60).toFixed(1)} h recorded` : 'Not recorded'}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[13px] font-medium"
          style={{ color: 'var(--primary-dark)' }}
        >
          Record
          <ChevronDown
            size={14}
            aria-hidden
            className="transition-transform duration-200 group-open:rotate-180"
          />
        </span>
      </summary>

      <div className="pt-4">
        <Field label="How long did you sleep?" htmlFor="sleep-hours">
          <div className="flex items-center gap-2">
            <input
              id="sleep-hours"
              type="number"
              inputMode="decimal"
              step="0.5"
              min={0}
              max={20}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder={`e.g. ${targetHours}`}
              className={`data ${inputClass}`}
              style={inputStyle}
            />
            <Unit>hours</Unit>
          </div>
        </Field>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">
            How did it feel?{' '}
            <span className="font-normal" style={{ color: 'var(--fg-subtle)' }}>
              (optional)
            </span>
          </legend>
          <div className="mt-2 flex gap-2">
            {[
              { value: 1, label: 'Awful' },
              { value: 2, label: 'Poor' },
              { value: 3, label: 'OK' },
              { value: 4, label: 'Good' },
              { value: 5, label: 'Great' },
            ].map((q) => {
              const on = quality === q.value;
              return (
                <button
                  key={q.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setQuality(on ? null : q.value)}
                  className="min-h-11 flex-1 cursor-pointer border text-[12px] font-semibold transition-colors duration-200"
                  style={{
                    background: on ? 'var(--primary)' : 'var(--surface)',
                    color: on ? 'var(--on-primary)' : 'var(--fg-muted)',
                    borderColor: on ? 'var(--primary)' : 'var(--line-strong)',
                    borderRadius: 'var(--radius-control)',
                  }}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Correlation, stated as correlation. Short sleep makes a hard day more
            likely; it does not cause a specific outcome, and we do not claim it. */}
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
          Short nights tend to go with more hunger and less spontaneous movement. Worth recording so
          a difficult day has an explanation rather than feeling like a personal failure.
        </p>

        <Feedback state={state} />

        <Button
          className="mt-4"
          fullWidth
          disabled={saving || !canSave || hours === ''}
          onClick={submit}
        >
          {saving ? (
            <>
              <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            'Record'
          )}
        </Button>
      </div>
    </details>
  );
}
