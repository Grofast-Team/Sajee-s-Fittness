'use client';

import { useState } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { Button, Panel } from '@/components/ui';
import { logMeasurement, logSleep, logSteps, logWater, type TrackResult } from '@/lib/actions/tracking';

/**
 * Quick entry forms for weight, measurements and steps.
 *
 * Deliberately small and always visible rather than hidden behind a floating
 * action button. The whole product depends on these numbers arriving regularly,
 * and every extra tap between "I am standing on the scale" and "it is recorded"
 * costs adherence.
 */

const inputStyle = {
  background: 'var(--ground)',
  color: 'var(--fg)',
  borderColor: 'var(--line)',
};

function Feedback({ state }: { state: TrackResult | null }) {
  if (!state) return null;

  return state.ok ? (
    <p role="status" className="mt-3 flex items-start gap-2 text-sm" style={{ color: 'var(--confirm)' }}>
      <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
      {state.message}
    </p>
  ) : (
    <p role="alert" className="mt-3 flex items-start gap-2 text-sm" style={{ color: 'var(--alarm)' }}>
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      {state.error}
    </p>
  );
}

export function WeightEntry({ canSave, lastWeightKg }: { canSave: boolean; lastWeightKg: number | null }) {
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
    <Panel>
      <h3 className="eyebrow mb-4">Record a weigh-in</h3>

      <div className="flex gap-2">
        <div className="flex-1">
          <label htmlFor="weight" className="block text-sm font-medium">
            Weight
          </label>
          <div className="mt-1.5 flex items-center gap-2">
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
              className="data min-h-11 w-full rounded-md border px-3 text-base"
              style={inputStyle}
            />
            <span className="shrink-0 text-sm" style={{ color: 'var(--fg-subtle)' }}>
              kg
            </span>
          </div>
        </div>

        <div className="flex-1">
          <label htmlFor="waist" className="block text-sm font-medium">
            Waist <span className="font-normal" style={{ color: 'var(--fg-subtle)' }}>(optional)</span>
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="waist"
              type="number"
              inputMode="decimal"
              step="0.5"
              min={30}
              max={250}
              value={waist}
              onChange={(e) => setWaist(e.target.value)}
              className="data min-h-11 w-full rounded-md border px-3 text-base"
              style={inputStyle}
            />
            <span className="shrink-0 text-sm" style={{ color: 'var(--fg-subtle)' }}>
              cm
            </span>
          </div>
        </div>
      </div>

      {/* Consistency beats frequency. A reading taken under the same conditions
          each time is worth more than three taken at random moments. */}
      <p className="mt-2 text-xs" style={{ color: 'var(--fg-subtle)' }}>
        Weigh yourself the same way each time — same time of day, after the toilet, before eating.
        Comparable readings matter far more than frequent ones.
      </p>

      <Feedback state={state} />

      <Button
        className="mt-3 w-full"
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
        <p className="mt-2 text-center text-xs" style={{ color: 'var(--fg-subtle)' }}>
          Sign in and finish setup to record your own measurements.
        </p>
      ) : null}
    </Panel>
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
    <Panel>

      <h3 className="eyebrow mb-4">Record your steps</h3>

      <label htmlFor="steps" className="block text-sm font-medium">
        Steps so far
      </label>
      <input
        id="steps"
        type="number"
        inputMode="numeric"
        min={0}
        max={100000}
        value={steps}
        onChange={(e) => setSteps(e.target.value)}
        placeholder="e.g. 4200"
        className="data mt-1.5 min-h-11 w-full rounded-md border px-3 text-base"
        style={inputStyle}
      />

      <p className="mt-2 text-xs" style={{ color: 'var(--fg-subtle)' }}>
        Read it off your phone&rsquo;s health app. We do not sync with devices yet, and we would
        rather you enter a real number than have us invent one.
      </p>

      <Feedback state={state} />

      <Button
        className="mt-3 w-full"
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
        <p className="mt-2 text-center text-xs" style={{ color: 'var(--fg-subtle)' }}>
          Sign in and finish setup to record your steps.
        </p>
      ) : null}
    </Panel>
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
    <Panel>

      {/*
       * A single rail rather than a grid of empty boxes. Ten outlined squares
       * took a third of the screen to communicate one number, and read as
       * decoration rather than data.
       */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">Water</span>
        <span className="data text-sm">
          <span style={{ color: 'var(--fg)' }}>{optimistic.toLocaleString()}</span>
          <span style={{ color: 'var(--fg-subtle)' }}> / {targetMl.toLocaleString()}</span>
          <span className="eyebrow ml-1.5">ml</span>
        </span>
      </div>

      <div
        className="relative mt-2 w-full overflow-hidden"
        style={{ height: 7, background: 'var(--ground)' }}
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
            background: 'var(--fg)',
          }}
        />
      </div>

      <div className="relative mt-1 h-2" aria-hidden>
        {Array.from({ length: 11 }, (_, i) => (
          <span
            key={i}
            className="absolute top-0"
            style={{
              left: `${i * 10}%`,
              width: 1,
              height: i % 5 === 0 ? 7 : 4,
              background: i % 5 === 0 ? 'var(--fg-subtle)' : 'var(--line-strong)',
            }}
          />
        ))}
      </div>

      <p className="mt-2 text-xs" style={{ color: 'var(--fg-subtle)' }}>
        {glasses - filled > 0
          ? `${glasses - filled} more glasses to target.`
          : 'Target reached. More is not better.'}
      </p>

      <Feedback state={state} />

      <Button className="mt-3 w-full" variant="ghost" disabled={saving || !canSave} onClick={addGlass}>
        {saving ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          'Add a glass (250 ml)'
        )}
      </Button>
    </Panel>
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
      <summary
        className="flex min-h-11 cursor-pointer list-none items-baseline justify-between gap-3 border-b"
        style={{ borderColor: 'var(--line)' }}
      >
        <span className="text-sm font-medium">Last night&rsquo;s sleep</span>
        <span className="data text-sm" style={{ color: 'var(--fg-subtle)' }}>
          {currentMinutes !== null ? `${(currentMinutes / 60).toFixed(1)} h` : 'not recorded'}
          <span className="eyebrow ml-2">record +</span>
        </span>
      </summary>

      <div className="pt-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <label htmlFor="sleep-hours" className="text-sm font-medium">
            How long did you sleep?
          </label>
          <span className="eyebrow">
            <span className="data">{targetHours}</span> h target
          </span>
        </div>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id="sleep-hours"
          type="number"
          inputMode="decimal"
          step="0.5"
          min={0}
          max={20}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="e.g. 7"
          className="data min-h-11 w-full rounded-md border px-3 text-base"
          style={inputStyle}
        />
        <span className="shrink-0 text-sm" style={{ color: 'var(--fg-subtle)' }}>
          hours
        </span>
      </div>

      <fieldset className="mt-3">
        <legend className="text-sm font-medium">
          How did it feel?{' '}
          <span className="font-normal" style={{ color: 'var(--fg-subtle)' }}>
            (optional)
          </span>
        </legend>
        <div className="mt-1.5 flex gap-2">
          {[
            { value: 1, label: 'Awful' },
            { value: 2, label: 'Poor' },
            { value: 3, label: 'OK' },
            { value: 4, label: 'Good' },
            { value: 5, label: 'Great' },
          ].map((q) => (
            <button
              key={q.value}
              type="button"
              aria-pressed={quality === q.value}
              onClick={() => setQuality(quality === q.value ? null : q.value)}
              className="min-h-11 flex-1 cursor-pointer rounded-md border text-xs font-semibold transition-colors duration-200"
              style={{
                background: quality === q.value ? 'var(--fg)' : 'var(--ground)',
                color: quality === q.value ? 'var(--bg)' : 'var(--fg)',
                borderColor: quality === q.value ? 'var(--fg)' : 'var(--line)',
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Correlation, stated as correlation. Short sleep makes a hard day more
          likely; it does not cause a specific outcome, and we do not claim it. */}
      <p className="mt-2 text-xs" style={{ color: 'var(--fg-subtle)' }}>
        Short nights tend to go with more hunger and less spontaneous movement. Worth recording so
        a difficult day has an explanation rather than feeling like a personal failure.
      </p>

      <Feedback state={state} />

      <Button
        className="mt-3 w-full"
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
