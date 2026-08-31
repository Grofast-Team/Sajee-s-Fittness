import { Barcode, Mic, Zap } from 'lucide-react';
import { Rail, Section, Unavailable } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { ScalePhotoLogger } from '@/components/scale-photo';
import { FoodSearch } from '@/components/food-search';
import { LoggedMeals } from '@/components/logged-meals';
import { getDayView } from '@/lib/data/day';
import { aiConfigured, supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Food — FitCoach' };

export default async function FoodPage() {
  const day = await getDayView();
  const remaining = day.remaining.kcalRemaining;
  const over = remaining < 0;

  return (
    <>
      <SampleBanner isSample={day.isSample} />

      <header className="pb-7 pt-6">
        <p className="eyebrow mb-5">Food</p>
        <div className="flex items-end gap-3">
          <span
            className="data leading-none"
            style={{
              fontSize: 'clamp(3rem, 15vw, 4.2rem)',
              fontWeight: 500,
              color: over ? 'var(--signal)' : 'var(--fg)',
            }}
          >
            {Math.abs(remaining).toLocaleString()}
          </span>
          <span className="pb-1.5">
            <span className="eyebrow block">kcal</span>
            <span className="block text-sm" style={{ color: 'var(--fg-muted)' }}>
              {over ? 'over' : 'left'}
            </span>
          </span>
        </div>
        <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          {day.remaining.message}
        </p>
      </header>
      <Section title="Today so far">
        <div className="space-y-5">
          <Rail label="Energy" value={day.consumedKcal} target={day.targetKcal} unit="kcal" size="lg" />
          <Rail label="Protein" value={day.consumedProteinG} target={day.proteinTargetG} unit="g" />
        </div>
      </Section>
      {/* The photo path leads because it is the flagship, but search sits right
          beneath it and needs no AI — logging must never depend on a model
          being reachable. */}
      <Section title="Add food">
        {aiConfigured ? (
          <ScalePhotoLogger />
        ) : (
          <Unavailable
            title="Photo logging is switched off"
            detail="No AI provider is configured on this deployment, so photo analysis is disabled rather than faked. Search below works without it."
          />
        )}

        <div className="mt-6">
          <FoodSearch canSave={supabaseConfigured && !day.isSample} />
        </div>
      </Section>
      <Section title="Not built yet">
        <ul className="space-y-3">
          {[
            { Icon: Zap, label: 'Quick add', detail: 'Food, quantity, meal — ten seconds.' },
            { Icon: Mic, label: 'Say what you ate', detail: '"Two idli and a bowl of sambar."' },
            { Icon: Barcode, label: 'Scan a barcode', detail: 'For packaged food with label data.' },
          ].map(({ Icon, label, detail }) => (
            <li key={label} className="flex items-start gap-3" style={{ opacity: 0.5 }}>
              <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
              <div>
                <p className="text-sm">{label}</p>
                <p className="text-xs" style={{ color: 'var(--fg-subtle)' }}>
                  {detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Logged" meta={day.items.length > 0 ? `${day.items.length} today` : undefined}>
        <LoggedMeals items={day.items} canEdit={!day.isSample} />
      </Section>
    </>
  );
}
