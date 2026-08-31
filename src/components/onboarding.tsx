'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, CircleAlert, Info, Loader2 } from 'lucide-react';
import { Button, Card, CardTitle, WhyPanel } from '@/components/ui';
import { STEPS, visibleFields, type Field } from '@/lib/onboarding-steps';
import { saveOnboarding } from '@/lib/actions/onboarding';
import { deriveActivityLevel, estimateBmr, estimateTdee } from '@/lib/engines/energy';
import { computeEnergyTarget, computeMacros, waterTargetMl } from '@/lib/engines/targets';
import { initialStepGoal } from '@/lib/engines/steps';
import { restrictionsFrom, screen, type SafetyFlag } from '@/lib/engines/safety';
import type { BodyInput, Pace, Sex } from '@/lib/engines/types';

type Answers = Record<string, unknown>;

/**
 * The onboarding interview.
 *
 * Progress is saved to `localStorage` on every change, so closing the app
 * halfway through does not mean starting again. Once Supabase is configured the
 * same answers are written to `profiles`, `lifestyle` and `food_profile`.
 */
const STORAGE_KEY = 'fitcoach.onboarding.v1';

export function Onboarding() {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    } catch {
      return {};
    }
  });
  const [done, setDone] = useState(false);

  const step = STEPS[index];
  const fields = visibleFields(step, answers);

  function set(id: string, value: unknown) {
    setAnswers((prev) => {
      const next = { ...prev, [id]: value };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private browsing or blocked storage. Progress just is not saved.
      }
      return next;
    });
  }

  const missingRequired = fields.filter(
    (f) => f.required && (answers[f.id] === undefined || answers[f.id] === ''),
  );

  if (done) return <PlanSummary answers={answers} onEdit={() => { setDone(false); setIndex(0); }} />;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span style={{ color: 'var(--fg-subtle)' }}>
            Step {index + 1} of {STEPS.length}
          </span>
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              className="inline-flex cursor-pointer items-center gap-1 font-medium"
              style={{ color: 'var(--fg)' }}
            >
              <ArrowLeft size={15} aria-hidden /> Back
            </button>
          ) : null}
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--ground)' }}
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-label={`Onboarding progress: step ${index + 1} of ${STEPS.length}`}
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${((index + 1) / STEPS.length) * 100}%`, background: 'var(--fg)' }}
          />
        </div>
      </div>

      <Card>
        <h1 className="text-xl font-semibold">{step.title}</h1>
        {step.intro ? (
          <p className="mt-1.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
            {step.intro}
          </p>
        ) : null}

        <div className="mt-5 space-y-5">
          {fields.map((field) => (
            <FieldInput key={field.id} field={field} value={answers[field.id]} onChange={(v) => set(field.id, v)} />
          ))}
        </div>
      </Card>

      {missingRequired.length > 0 ? (
        <p className="text-center text-xs" style={{ color: 'var(--fg-subtle)' }}>
          Still needed: {missingRequired.map((f) => f.label).join(', ')}
        </p>
      ) : null}

      <div className="flex gap-2">
        {index < STEPS.length - 1 ? (
          <>
            <Button
              className="flex-1"
              disabled={missingRequired.length > 0}
              onClick={() => setIndex((i) => i + 1)}
            >
              Continue
            </Button>
            {/* Skipping is a first-class action. A half-finished profile that
                yields a usable plan beats an abandoned perfect one. */}
            <Button variant="quiet" onClick={() => setIndex((i) => i + 1)}>
              Skip
            </Button>
          </>
        ) : (
          <Button className="w-full" disabled={missingRequired.length > 0} onClick={() => setDone(true)}>
            Build my plan
          </Button>
        )}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const inputStyle = {
    background: 'var(--ground)',
    color: 'var(--fg)',
    borderColor: 'var(--line)',
  };

  return (
    <div>
      {/* Visible labels, always. Placeholder-only labels vanish the moment
          someone starts typing, which is exactly when they are needed. */}
      <label htmlFor={field.id} className="block text-sm font-medium">
        {field.label}
      </label>
      {field.because ? (
        <p className="mt-0.5 text-xs" style={{ color: 'var(--fg-subtle)' }}>
          {field.because}
        </p>
      ) : null}

      <div className="mt-2">
        {field.type === 'choice' ? (
          <div className="flex flex-wrap gap-2">
            {field.options?.map((o) => {
              const selected = value === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onChange(o.value)}
                  aria-pressed={selected}
                  className="min-h-11 cursor-pointer rounded-md border px-3 text-sm font-medium transition-colors duration-200"
                  style={{
                    background: selected ? 'var(--fg)' : 'var(--ground)',
                    color: selected ? 'var(--bg)' : 'var(--fg)',
                    borderColor: selected ? 'var(--fg)' : 'var(--line)',
                  }}
                >
                  {o.label}
                  {o.hint ? (
                    <span className="ml-1.5 text-xs opacity-80">({o.hint})</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : field.type === 'multi' ? (
          <div className="flex flex-wrap gap-2">
            {field.options?.map((o) => {
              const list = Array.isArray(value) ? (value as string[]) : [];
              const selected = list.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    onChange(selected ? list.filter((v) => v !== o.value) : [...list, o.value])
                  }
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors duration-200"
                  style={{
                    background: selected ? 'var(--fg)' : 'var(--ground)',
                    color: selected ? 'var(--bg)' : 'var(--fg)',
                    borderColor: selected ? 'var(--fg)' : 'var(--line)',
                  }}
                >
                  {selected ? <Check size={14} aria-hidden /> : null}
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : field.type === 'scale' ? (
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={value === n}
                onClick={() => onChange(n)}
                className="min-h-11 flex-1 cursor-pointer rounded-md border text-sm font-semibold transition-colors duration-200"
                style={{
                  background: value === n ? 'var(--fg)' : 'var(--ground)',
                  color: value === n ? 'var(--bg)' : 'var(--fg)',
                  borderColor: value === n ? 'var(--fg)' : 'var(--line)',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              id={field.id}
              type={field.type === 'number' ? 'number' : field.type === 'time' ? 'time' : 'text'}
              inputMode={field.type === 'number' ? 'decimal' : undefined}
              min={field.min}
              max={field.max}
              placeholder={field.placeholder}
              value={(value as string | number | undefined) ?? ''}
              onChange={(e) =>
                onChange(field.type === 'number' ? Number(e.target.value) || undefined : e.target.value)
              }
              className="min-h-11 w-full rounded-md border px-3 text-base"
              style={inputStyle}
            />
            {field.unit ? (
              <span className="shrink-0 text-sm" style={{ color: 'var(--fg-subtle)' }}>
                {field.unit}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The end of onboarding: "Your starting plan".
 *
 * Every number here is computed live from the answers by the same engines the
 * rest of the app uses. Nothing is illustrative.
 */
function PlanSummary({ answers, onEdit }: { answers: Answers; onEdit: () => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Only the *answers* are sent. The server recomputes the plan from them, so a
   * crafted request cannot post its own calorie target past the safety floors.
   */
  async function handleStart() {
    setSaving(true);
    setSaveError(null);
    const result = await saveOnboarding(answers);

    if (result.ok) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage unavailable; the draft simply stays until it is overwritten.
      }
      router.push('/today');
      return;
    }

    setSaveError(result.error);
    setSaving(false);
  }

  const plan = useMemo(() => {
    const body: BodyInput = {
      weightKg: Number(answers.weightKg) || 70,
      heightCm: Number(answers.heightCm) || 170,
      ageYears: Number(answers.age) || 30,
      sex: (answers.sex as Sex) ?? 'prefer_not_to_say',
    };

    const conditions = (answers.conditions as string[] | undefined) ?? [];
    const flags: SafetyFlag[] = screen({
      ...body,
      pregnant: answers.pregnant === 'yes',
      breastfeeding: answers.breastfeeding === 'yes',
      eatingDisorderHistory: answers.eatingDisorderHistory === 'yes',
      diabetesOnMedication: conditions.includes('diabetesOnMedication'),
      kidneyDisease: conditions.includes('kidneyDisease'),
      liverDisease: conditions.includes('liverDisease'),
      cardiovascularCondition: conditions.includes('cardiovascularCondition'),
      recentSurgery: conditions.includes('recentSurgery'),
      severeMobilityLimits: conditions.includes('severeMobilityLimits'),
      weightAffectingMedication: conditions.includes('weightAffectingMedication'),
      unexplainedWeightLoss: conditions.includes('unexplainedWeightLoss'),
      requestedTargetWeightKg: Number(answers.targetWeightKg) || undefined,
      requestedWeeks: Number(answers.targetWeeks) || undefined,
    });

    const restrictions = [...restrictionsFrom(flags)];
    const activity = deriveActivityLevel({
      workPattern: answers.workPattern as never,
      sittingHours: Number(answers.sittingHours) || undefined,
      baselineSteps: Number(answers.baselineSteps) || undefined,
      trainingDaysPerWeek: Number(answers.trainingDays) || 0,
    });

    const bmr = estimateBmr(body);
    const tdee = estimateTdee(bmr.kcal, activity.level);
    const energy = computeEnergyTarget(body, bmr.kcal, tdee, (answers.pace as Pace) ?? 'steady', {
      restrictions,
    });
    const macros = computeMacros(body, energy.targetKcal, {
      goalWeightKg: Number(answers.targetWeightKg) || undefined,
    });
    const steps = initialStepGoal({
      baselineSteps: Number(answers.baselineSteps) || 3000,
      restrictions,
    });

    return { body, flags, activity, bmr, tdee, energy, macros, steps, water: waterTargetMl(body) };
  }, [answers]);

  const referrals = plan.flags.filter((f) => f.severity === 'refer' || f.severity === 'caution');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Your starting plan</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
          Built from your answers. These are starting points, not verdicts — we will adjust them
          from what actually happens over the next few weeks.
        </p>
      </header>

      {/* Safety notes come first, above the plan they constrain. */}
      {referrals.map((flag) => (
        <Card key={flag.code} className="border-dashed">
          <div className="flex gap-2.5">
            <CircleAlert size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--signal)' }} aria-hidden />
            <div>
              <p className="text-sm font-semibold">{flag.reason}</p>
              <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
                {flag.guidance}
              </p>
            </div>
          </div>
        </Card>
      ))}

      <Card>
        <CardTitle>Every day</CardTitle>
        <dl className="space-y-2.5">
          {[
            ['Energy', `${plan.energy.targetKcal.toLocaleString()} kcal`],
            ['Protein', `${plan.macros.proteinG} g`],
            ['Fibre', `${plan.macros.fibreG} g`],
            ['Steps', plan.steps.target.toLocaleString()],
            ['Water', `${(plan.water / 1000).toFixed(1)} litres`],
            ['Training', `${Number(answers.trainingDays) || 2} days a week`],
            ['Sleep', `${Number(answers.sleepHours) || 7.5} hours`],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4">
              <dt className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                {k}
              </dt>
              <dd className="data text-base font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <WhyPanel label="Where did these come from?">
          <p>{plan.energy.explanation}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {plan.activity.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-2">{plan.steps.explanation}</p>
        </WhyPanel>
      </Card>

      <Card>
        <CardTitle>What we will not do</CardTitle>
        <ul className="space-y-1.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
          {[
            `Take you below ${plan.energy.floorKcal.toLocaleString()} kcal. That floor is enforced in code, not just policy.`,
            'Tell you to fast or train extra to make up for a heavy meal.',
            'Promise you a specific weight on a specific date.',
            'Ban foods you like. Portions change; the food stays.',
            'Pretend a photo can tell us exactly how much you ate.',
          ].map((s) => (
            <li key={s} className="flex gap-2">
              <span aria-hidden>·</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Card>

      <div
        className="flex items-start gap-2.5 rounded-md p-3 text-sm"
        style={{ background: 'var(--ground)' }}
      >
        <Info size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--fg)' }} aria-hidden />
        <p>
          This is general wellness guidance, not medical advice, and it is not a substitute for a
          doctor or a registered dietitian.
        </p>
      </div>

      {saveError ? (
        <p role="alert" className="flex items-start gap-2 text-sm" style={{ color: 'var(--alarm)' }}>
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          {saveError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button className="flex-1" disabled={saving} onClick={handleStart}>
          {saving ? (
            <>
              <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            'Start'
          )}
        </Button>
        <Button variant="ghost" onClick={onEdit} disabled={saving}>
          Change an answer
        </Button>
      </div>
    </div>
  );
}
