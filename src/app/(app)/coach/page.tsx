import { Card, CardTitle, Unavailable } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { getDayView } from '@/lib/data/day';
import { aiConfigured } from '@/lib/config';

export const metadata = { title: 'Coach — FitCoach' };

/**
 * The coach.
 *
 * The prompt chips below are not decoration - they are the real questions
 * beginners ask, and each maps to an engine-backed answer rather than a
 * free-form generation. "Why did my weight go up?" is answered by the trend
 * engine; "What can I eat for ₹80?" by the budget and food-price data.
 */
const PROMPTS = [
  'What should I eat now?',
  'Can I eat biryani tonight?',
  'Why did my weight go up?',
  'I only have ₹80 for dinner',
  'I have no eggs',
  'I only have 15 minutes',
  'I skipped my workout',
  'I am travelling next week',
  'How much rice can I have?',
];

export default async function CoachPage() {
  const day = await getDayView();
  const remaining = day.remaining;

  return (
    <div className="space-y-4">
      <SampleBanner isSample={day.isSample} />

      <header>
        <h1 className="text-2xl font-semibold">Coach</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
          Ask anything. The coach can see your plan, today&rsquo;s log, your budget and what you
          can cook.
        </p>
      </header>

      {/* What the coach is given is shown to the user. Nothing is retrieved
          about them that they cannot see. */}
      <Card>
        <CardTitle hint="Visible to the coach">What it knows right now</CardTitle>
        <dl className="space-y-1.5 text-sm">
          {[
            ['Remaining today', `${remaining.kcalRemaining.toLocaleString()} kcal · ${Math.round(remaining.proteinRemaining)} g protein`],
            // "not set" is a real answer. An invented budget would make the
            // coach confidently recommend meals the user cannot afford.
            ['Budget', day.constraints.budgetPerDay ?? 'not set'],
            ['Diet', day.constraints.diet],
            ['Allergies', day.constraints.allergies.join(', ') || 'none recorded'],
            ['Dislikes', day.constraints.dislikes.join(', ') || 'none recorded'],
            [
              'Cooking time',
              day.constraints.cookMinutes !== null
                ? `${day.constraints.cookMinutes} minutes on weekdays`
                : 'not set',
            ],
            ['Equipment', day.constraints.equipment],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt style={{ color: 'var(--fg-subtle)' }}>{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs" style={{ color: 'var(--fg-subtle)' }}>
          You can view and delete anything the coach remembers about you in Settings.
        </p>
      </Card>

      {aiConfigured ? (
        <Card>
          <CardTitle>Ask</CardTitle>
          <div className="flex flex-wrap gap-2">
            {PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                className="min-h-11 cursor-pointer rounded-full px-3 text-sm font-medium transition-colors duration-200"
                style={{ background: 'var(--surface-2)' }}
              >
                {p}
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <Unavailable
          title="The chat coach is not configured"
          detail={
            'No AI provider is set on this deployment, so the conversational coach is switched ' +
            'off rather than answering with something generic. Set AI_GATEWAY_API_KEY to turn it ' +
            'on. The engine-backed answers below work regardless.'
          }
        />
      )}

      <Card>
        <CardTitle>Answers that do not need AI</CardTitle>
        <p className="mb-3 text-sm" style={{ color: 'var(--fg-muted)' }}>
          These come straight from the calculation engines, so they work even when every model is
          offline.
        </p>
        <ul className="space-y-3">
          <li>
            <p className="text-sm font-medium">How much do I have left today?</p>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              {remaining.message}
            </p>
          </li>
          <li>
            <p className="text-sm font-medium">Why is my target {day.targetKcal.toLocaleString()} kcal?</p>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              {day.rationale.energy}
            </p>
          </li>
          <li>
            <p className="text-sm font-medium">What is my weight actually doing?</p>
            <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
              {day.trend.message}
            </p>
          </li>
        </ul>
      </Card>

      <Card>
        <CardTitle>What this app will not do</CardTitle>
        <ul className="space-y-1.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
          {[
            `Set you a starvation target. Your floor is ${day.floorKcal.toLocaleString()} kcal and nothing can push it lower.`,
            'Tell you to fast or train extra to make up for a heavy meal.',
            'Promise you a specific weight by a specific date.',
            'Pretend a photo can tell us exactly how much you ate.',
            'Diagnose anything, or tell you to change medication.',
          ].map((s) => (
            <li key={s} className="flex gap-2">
              <span aria-hidden>·</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
