'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Alert } from '@/components/ui';
import { logFood } from '@/lib/actions/food';
import { mealForHour } from '@/lib/meal-time';
import type { RecentFood } from '@/lib/data/recent-foods';

/**
 * One tap to log something you eat often.
 *
 * The search flow is four decisions — find the food, pick a portion mode, type
 * an amount, choose a meal — and it has to be, because it handles anything.
 * But most entries are not anything: they are the same dosa, the same katori
 * of rice, the same two idli. For those, four decisions is three too many, and
 * the friction is what ends food logging for most people who try it.
 *
 * The portion is replayed exactly as it was entered, so the server recomputes
 * the same numbers through the same path. Nothing is copied from the old row.
 */
export function QuickAdd({ items, canLog }: { items: RecentFood[]; canLog: boolean }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (items.length === 0) return null;

  function add(item: RecentFood) {
    const key = `${item.foodId}:${item.quantity}:${item.unitLabel}`;
    setPendingId(key);
    setError(null);
    setDone(null);

    startTransition(async () => {
      const result = await logFood({
        foodId: item.foodId,
        // The browser's clock, because the server's is in another timezone.
        meal: mealForHour(new Date().getHours()),
        ...(item.unitLabel === 'g'
          ? { grams: item.quantity }
          : { serving: { unitLabel: item.unitLabel, count: item.quantity } }),
      });

      if (result.ok) setDone(item.description);
      else setError(result.error);
      setPendingId(null);
    });
  }

  return (
    <div>
      <p className="text-[13px]" style={{ color: 'var(--fg-muted)' }}>
        Things you log often. One tap adds today&rsquo;s entry.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {items.map((item) => {
          const key = `${item.foodId}:${item.quantity}:${item.unitLabel}`;
          const busy = pendingId === key;

          return (
            <button
              key={key}
              type="button"
              disabled={!canLog || pendingId !== null}
              onClick={() => add(item)}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-left text-[13px] transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                borderColor: 'var(--line-strong)',
                borderRadius: 'var(--radius-control)',
                background: 'var(--surface)',
              }}
            >
              {busy ? (
                <Loader2 size={14} className="animate-spin shrink-0" aria-hidden />
              ) : (
                <Plus size={14} className="shrink-0" aria-hidden style={{ color: 'var(--primary)' }} />
              )}
              <span>
                <span className="font-medium">{item.description}</span>
                <span className="data ml-1.5" style={{ color: 'var(--fg-subtle)' }}>
                  {/* A range stays a range here too. */}
                  {item.kcalLow !== null && item.kcalHigh !== null
                    ? `${item.kcalLow}–${item.kcalHigh}`
                    : item.kcal}{' '}
                  kcal
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {done ? (
        <div className="mt-3">
          <Alert tone="success">Added {done}.</Alert>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </div>
  );
}
