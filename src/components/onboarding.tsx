'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { Alert, Button, Panel, Why } from '@/components/ui';
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
 * One topic per screen, never a wall of fields. Progress is saved to
 * `localStorage` on every change, so closing the app halfway through does not
 * mean starting again. Once Supabase is configured the same answers are written
 * to `profiles`, `lifestyle` and `food_profile`.
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

  if (done) {
    return (
      <PlanSummary
        answers={answers}
        onEdit={() => {
          setDone(false);
          setIndex(0);
        }}
      />
    );
  }

  const pct = ((index + 1) / STEPS.length) * 100;

  return (
    <div>
      <div className="pb-7 pt-2">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <span className="text-[13px] font-medium" style={{ color: 'var(--fg-muted)' }}>
            Step <span className="data">{index + 1}</span> of{' '}
            <span className="data">{STEPS.length}</span>
          </span>
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-[13px] font-medium"
              style={{ color: 'var(--primary-dark)' }}
            >
              <ArrowLeft size={14} aria-hidden /> Back
            </button>
          ) : null}
        </div>

        <div
          className="relative w-full overflow-hidden"
          style={{ height: 8, background: 'var(--ground)', borderRadius: 8 }}
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-label={`Setup progress: step ${index + 1} of ${STEPS.length}`}
        >
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-300"
            style={{ width: `${pct}%`, background: 'var(--primary)', borderRadius: 8 }}
          />
        </div>
      </div>

      {/* No card. The step is the page — one question at a time is the whole
          idea, and a box around it adds a frame with nothing to frame against. */}
      <section>
        <h1 className="display" style={{ fontSize: 'clamp(1.65rem, 6vw, 2rem)' }}>
          {step.title}
        </h1>
        {step.intro ? (
          <p className="measure mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            {step.intro}
          </p>
        ) : null}

        <div className="mt-8 space-y-7">
          {fields.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              value={answers[field.id]}
              onChange={(v) => set(field.id, v)}
            />
          ))}
        </div>
      </section>

      {missingRequired.length > 0 ? (
        <p className="mt-6 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Still needed: {missingRequired.map((f) => f.label).join(', ')}
        </p>
      ) : null}

      <div className="mt-6 flex gap-2">
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
          <Button fullWidth disabled={missingRequired.length > 0} onClick={() => setDone(true)}>
            Build my plan
          </Button>
        )}
      </div>
    </div>
  );
}

/** A selectable chip. Used for single choice, multiple choice and 1–5 scales. */
function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 border px-3.5 text-sm font-medium transition-colors duration-200 ${className ?? ''}`}
      style={{
        background: selected ? 'var(--primary)' : 'var(--surface)',
        color: selected ? 'var(--on-primary)' : 'var(--fg)',
        borderColor: selected ? 'var(--primary)' : 'var(--line-strong)',
        borderRadius: 'var(--radius-control)',
      }}
    >
      {children}
    </button>
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
  return (
    <div>
      {/* Visible labels, always. Placeholder-only labels vanish the moment
          someone starts typing, which is exactly when they are needed. */}
      <label htmlFor={field.id} className="block text-[15px] font-medium">
        {field.label}
      </label>
      {/* "Why are we asking?" sits with the question rather than in a help
          panel somewhere else. Explaining the reason is what makes a personal
          question feel reasonable instead of nosy. */}
      {field.because ? (
        <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
          {field.because}
        </p>
      ) : null}

      <div className="mt-2.5">
        {field.type === 'choice' ? (
          <div className="flex flex-wrap gap-2">
            {field.options?.map((o) => (
              <Chip key={o.value} selected={value === o.value} onClick={() => onChange(o.value)}>
                {o.label}
                {o.hint ? <span className="text-[13px] opacity-75">({o.hint})</span> : null}
              </Chip>
            ))}
          </div>
        ) : field.type === 'multi' ? (
          <div className="flex flex-wrap gap-2">
            {field.options?.map((o) => {
              const list = Array.isArray(value) ? (value as string[]) : [];
              const selected = list.includes(o.value);
              return (
                <Chip
                  key={o.value}
                  selected={selected}
                  onClick={() =>
                    onChange(selected ? list.filter((v) => v !== o.value) : [...list, o.value])
                  }
                >
                  {selected ? <Check size={14} aria-hidden /> : null}
                  {o.label}
                </Chip>
              );
            })}
          </div>
        ) : field.type === 'scale' ? (
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <Chip
                key={n}
                selected={value === n}
                onClick={() => onChange(n)}
                className="flex-1 font-semibold"
              >
                {n}
              </Chip>
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
                onChange(
                  field.type === 'number' ? Number(e.target.value) || undefined : e.target.value,
                )
              }
              className="min-h-11 w-full border px-3 text-[15px] outline-none"
              style={{
                background: 'var(--surface)',
                color: 'var(--fg)',
                borderColor: 'var(--line-strong)',
                borderRadius: 'var(--radius-control)',
              }}
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
      <header className="pb-2">
        <h1 className="display text-[1.75rem] md:text-[2rem]">Your starting plan</h1>
        <p className="measure mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          Built from your answers. These are starting points, not verdicts — we will adjust them
          from what actually happens over the next few weeks.
        </p>
      </header>

      {/* Safety notes come first, above the plan they constrain. */}
      {referrals.map((flag) => (
        <Alert key={flag.code} tone="warning" title={flag.reason}>
          {flag.guidance}
        </Alert>
      ))}

      <Panel feature>
        <h2 className="mb-4 text-[17px] font-semibold">Every day</h2>
        <dl className="space-y-3">
          {[
            ['Energy', `${plan.energy.targetKcal.toLocaleString()} kcal`],
            ['Protein', `${plan.macros.proteinG} g`],
            ['Fibre', `${plan.macros.fibreG} g`],
            ['Steps', plan.steps.target.toLocaleString()],
            ['Water', `${(plan.water / 1000).toFixed(1)} litres`],
            ['Training', `${Number(answers.trainingDays) || 2} days a week`],
            ['Sleep', `${Number(answers.sleepHours) || 7.5} hours`],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"
              style={{ borderColor: 'var(--line)' }}
            >
              <dt className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                {k}
              </dt>
              <dd className="data text-base font-semibold">{v}</dd>
            </div>
          ))}
        </dl>

        <Why label="Where did these come from?">
          <p>{plan.energy.explanation}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {plan.activity.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-2">{plan.steps.explanation}</p>
        </Why>
      </Panel>

      <Panel>
        <h2 className="mb-3 text-[15px] font-semibold">What we will not do</h2>
        <ul className="space-y-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
          {[
            `Take you below ${plan.energy.floorKcal.toLocaleString()} kcal. That floor is enforced in code, not just policy.`,
            'Tell you to fast or train extra to make up for a heavy meal.',
            'Promise you a specific weight on a specific date.',
            'Ban foods you like. Portions change; the food stays.',
            'Pretend a photo can tell us exactly how much you ate.',
          ].map((s) => (
            <li key={s} className="flex gap-2.5">
              <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
                —
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Alert tone="info">
        This is general wellness guidance, not medical advice, and it is not a substitute for a
        doctor or a registered dietitian.
      </Alert>

      {saveError ? <Alert tone="error">{saveError}</Alert> : null}

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
