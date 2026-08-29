import { Barcode, Mic, Zap } from 'lucide-react';
import { Card, CardTitle, ConfidenceBadge, Meter, Unavailable } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { ScalePhotoLogger } from '@/components/scale-photo';
import { FoodSearch } from '@/components/food-search';
import { getDayView } from '@/lib/data/day';
import { aiConfigured, supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Food — FitCoach' };

export default async function FoodPage() {
  const day = await getDayView();

  return (
    <div className="space-y-4">
      <SampleBanner isSample={day.isSample} />

      <header>
        <h1 className="text-2xl font-semibold">Food</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
          {day.remaining.message}
        </p>
      </header>

      <Card>
        <div className="space-y-3.5">
          <Meter label="Energy" value={day.consumedKcal} target={day.targetKcal} unit="kcal" />
          <Meter
            label="Protein"
            value={day.consumedProteinG}
            target={day.proteinTargetG}
            unit="g"
            tone="grow"
          />
        </div>
      </Card>

      {/* The photo path is the flagship, so it leads. The others are always
          available underneath — logging must never depend on AI being up. */}
      {aiConfigured ? (
        <ScalePhotoLogger />
      ) : (
        <Unavailable
          title="Photo logging is not configured"
          detail={
            'This deployment has no AI provider set, so photo analysis is switched off rather ' +
            'than faked. Set AI_GATEWAY_API_KEY to enable it. Everything below works without it.'
          }
        />
      )}

      <FoodSearch canSave={supabaseConfigured && !day.isSample} />

      <Card>
        <CardTitle>Other ways to log</CardTitle>
        <ul className="space-y-2">
          {[
            { Icon: Zap, label: 'Quick add', detail: 'Food, quantity, meal. Ten seconds.', available: false },
            { Icon: Mic, label: 'Say what you ate', detail: '"Two idli and a bowl of sambar."', available: false },
            { Icon: Barcode, label: 'Scan a barcode', detail: 'For packaged food with label data.', available: false },
          ].map(({ Icon, label, detail, available }) => (
            <li key={label}>
              <button
                type="button"
                disabled={!available}
                className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: 'var(--surface-2)' }}
              >
                <Icon size={20} style={{ color: 'var(--primary)' }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--fg-subtle)' }}>
                    {available ? detail : 'Not built yet'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle hint="Today">Logged</CardTitle>
        {day.items.length > 0 ? (
          <ul className="divide-y">
            {day.items.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{entry.meal}</p>
                  <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                    {entry.description}
                  </p>
                  <div className="mt-1">
                    <ConfidenceBadge level={entry.confidence} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-sm font-semibold">
                    {entry.kcalLow !== null && entry.kcalHigh !== null
                      ? `${entry.kcalLow}–${entry.kcalHigh} kcal`
                      : `${entry.kcal} kcal`}
                  </p>
                  <p className="tabular text-xs" style={{ color: 'var(--fg-subtle)' }}>
                    {entry.proteinG} g protein
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Nothing logged yet today.
          </p>
        )}
      </Card>
    </div>
  );
}
