import { Alert, Panel, PageHeader, Section, Unavailable } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { getDayView } from '@/lib/data/day';
import { aiConfigured } from '@/lib/config';

export const metadata = { title: 'Coach — FitCoach' };

/**
 * The coach.
 *
 * This screen reads as a conversation, so it keeps a single centred column at
 * every width rather than spreading into the desktop grid the other screens
 * use. Chat that stretches to 1200px is unreadable, and a two-column coach
 * would imply there is a second thing to look at while you are asking a
 * question.
 *
 * The prompts below are the real questions beginners ask, and each maps to an
 * engine-backed answer rather than a free-form generation. "Why did my weight
 * go up?" is answered by the trend engine; "What can I eat for ₹80?" by the
 * budget and food-price data.
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
    <div className="mx-auto max-w-3xl">
      <SampleBanner isSample={day.isSample} />

      <PageHeader
        title="Coach"
        lede="Ask anything. The coach can see your plan, today's log, your budget and what you can cook."
      />

      <div className="space-y-4 lg:space-y-5">
        {aiConfigured ? (
          <Panel>
            <Section title="What you can ask">
              {/* Rendered as a list rather than buttons: there is no chat
                  endpoint behind them yet, and a control that looks pressable
                  but does nothing is worse than an honest example. */}
              <ul className="flex flex-wrap gap-2">
                {PROMPTS.map((p) => (
                  <li
                    key={p}
                    className="rounded-full px-3 py-2 text-sm"
                    style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)' }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <Alert tone="info" title="The conversation is not wired up yet">
                  An AI provider is configured, but there is no chat endpoint behind these prompts
                  so far. The answers below come from the calculation engines and are live now.
                </Alert>
              </div>
            </Section>
          </Panel>
        ) : (
          <Panel>
            <Unavailable
              title="The chat coach is not configured"
              detail={
                'No AI provider is set on this deployment, so the conversational coach is switched ' +
                'off rather than answering with something generic. Set AI_GATEWAY_API_KEY to turn ' +
                'it on. The engine-backed answers below work regardless.'
              }
            />
          </Panel>
        )}

        <Panel>
          <Section title="Answers that do not need AI">
            <p className="mb-4 text-sm" style={{ color: 'var(--fg-muted)' }}>
              These come straight from the calculation engines, so they work even when every model
              is offline.
            </p>
            <ul className="space-y-4">
              {[
                ['How much do I have left today?', remaining.message],
                [
                  `Why is my target ${day.targetKcal.toLocaleString()} kcal?`,
                  day.rationale.energy,
                ],
                ['What is my weight actually doing?', day.trend.message],
              ].map(([question, answer]) => (
                <li key={question}>
                  <p className="text-sm font-semibold">{question}</p>
                  <p
                    className="mt-1 text-sm leading-relaxed"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    {answer}
                  </p>
                </li>
              ))}
            </ul>
          </Section>
        </Panel>

        {/* What the coach is given is shown to the user. Nothing is retrieved
            about them that they cannot see. */}
        <Panel>
          <Section title="What it knows about you" meta="Visible to the coach">
            <dl className="space-y-2 text-sm">
              {[
                [
                  'Remaining today',
                  `${remaining.kcalRemaining.toLocaleString()} kcal · ${Math.round(remaining.proteinRemaining)} g protein`,
                ],
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
            <p className="mt-4 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
              You can view and delete anything the coach remembers about you in Settings.
            </p>
          </Section>
        </Panel>

        <Panel>
          <Section title="What this app will not do">
            <ul className="space-y-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
              {[
                `Set you a starvation target. Your floor is ${day.floorKcal.toLocaleString()} kcal and nothing can push it lower.`,
                'Tell you to fast or train extra to make up for a heavy meal.',
                'Promise you a specific weight by a specific date.',
                'Pretend a photo can tell us exactly how much you ate.',
                'Diagnose anything, or tell you to change medication.',
              ].map((s) => (
                <li key={s} className="flex gap-2.5">
                  <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
                    —
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Section>
        </Panel>
      </div>
    </div>
  );
}
