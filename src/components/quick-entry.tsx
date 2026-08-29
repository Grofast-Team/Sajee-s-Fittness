'use client';

import { useState } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { Button, Card, CardTitle } from '@/components/ui';
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
  background: 'var(--surface-2)',
  color: 'var(--fg)',
  borderColor: 'var(--border)',
};

function Feedback({ state }: { state: TrackResult | null }) {
  if (!state) return null;

  return state.ok ? (
    <p role="status" className="mt-3 flex items-start gap-2 text-sm" style={{ color: 'var(--accent)' }}>
      <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
      {state.message}
    </p>
  ) : (
    <p role="alert" className="mt-3 flex items-start gap-2 text-sm" style={{ color: '#b91c1c' }}>
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
    <Card>
      <CardTitle hint="Today">Record a weigh-in</CardTitle>

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
              className="min-h-11 w-full rounded-xl border px-3 text-base"
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
              className="min-h-11 w-full rounded-xl border px-3 text-base"
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
    </Card>
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
    <Card>
      <CardTitle hint="Today">Record your steps</CardTitle>

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
        className="mt-1.5 min-h-11 w-full rounded-xl border px-3 text-base"
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
    </Card>
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
    <Card>
      <CardTitle hint={`${(targetMl / 1000).toFixed(1)} L target`}>Water</CardTitle>

      <div className="flex flex-wrap gap-1.5" role="img" aria-label={`${filled} of ${glasses} glasses`}>
        {Array.from({ length: glasses }, (_, i) => (
          <span
            key={i}
            className="h-7 w-5 rounded-b-md rounded-t-sm border"
            style={{
              background: i < filled ? 'var(--primary)' : 'var(--surface-2)',
              borderColor: i < filled ? 'var(--primary)' : 'var(--border)',
            }}
          />
        ))}
      </div>

      <p className="tabular mt-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
        {optimistic.toLocaleString()} of {targetMl.toLocaleString()} ml
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
    </Card>
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
    <Card>
      <CardTitle hint={`${targetHours} h target`}>Last night&rsquo;s sleep</CardTitle>

      <label htmlFor="sleep-hours" className="block text-sm font-medium">
        How long did you sleep?
      </label>
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
          className="min-h-11 w-full rounded-xl border px-3 text-base"
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
              className="min-h-11 flex-1 cursor-pointer rounded-xl border text-xs font-semibold transition-colors duration-200"
              style={{
                background: quality === q.value ? 'var(--primary)' : 'var(--surface-2)',
                color: quality === q.value ? 'var(--primary-fg)' : 'var(--fg)',
                borderColor: quality === q.value ? 'var(--primary)' : 'var(--border)',
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
    </Card>
  );
}
