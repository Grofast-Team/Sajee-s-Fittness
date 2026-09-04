'use client';

import { useState, useTransition } from 'react';
import { Trash2, UtensilsCrossed } from 'lucide-react';
import { Alert, Button, ConfidenceTag, EmptyState } from '@/components/ui';
import { deleteFoodLog } from '@/lib/actions/food';
import type { LoggedItem } from '@/lib/data/day';

/**
 * Today's logged meals, with the ability to remove one.
 *
 * Being able to delete matters more than it looks. A mis-logged entry is not
 * just an annoying wrong number on screen: it feeds `daily_logs`, which feeds
 * the adherence score, which gates whether the adaptation engine is willing to
 * change someone's calorie target. A phantom 600 kcal makes the app draw wrong
 * conclusions about a real person for weeks.
 */
export function LoggedMeals({ items, canEdit }: { items: LoggedItem[]; canEdit: boolean }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<UtensilsCrossed size={22} aria-hidden />}
        title="Nothing logged yet today"
        detail="Start with whatever you ate last. It does not have to be perfect — a rough entry beats no entry."
      />
    );
  }

  return (
    <div>
      {error ? (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <ul className="divide-y">
        {items.map((entry) => (
          <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{entry.meal}</p>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
                  {entry.description}
                </p>
                <div className="mt-1.5">
                  <ConfidenceTag level={entry.confidence} />
                </div>
              </div>

              <div className="flex shrink-0 items-start gap-1">
                <div className="text-right">
                  <p className="data text-sm font-semibold">
                    {/* An entry saved as a range stays a range. */}
                    {entry.kcalLow !== null && entry.kcalHigh !== null
                      ? `${entry.kcalLow}–${entry.kcalHigh} kcal`
                      : `${entry.kcal} kcal`}
                  </p>
                  <p className="data text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                    {entry.proteinG} g protein
                  </p>
                </div>

                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(confirming === entry.id ? null : entry.id);
                      setError(null);
                    }}
                    aria-label={`Remove ${entry.description}`}
                    aria-expanded={confirming === entry.id}
                    className="flex size-11 cursor-pointer items-center justify-center rounded-[10px] transition-colors duration-200"
                    style={{ color: 'var(--fg-subtle)' }}
                  >
                    <Trash2 size={16} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Confirmation is inline rather than a modal: it keeps the entry
                you are about to remove visible while you decide. */}
            {confirming === entry.id ? (
              <div
                className="mt-3 flex flex-wrap items-center gap-2 p-3"
                style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
              >
                <span className="flex-1 text-sm">Remove this entry?</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteFoodLog(entry.id);
                      if (!result.ok) setError(result.error ?? 'We could not remove that entry.');
                      setConfirming(null);
                    })
                  }
                >
                  {pending ? 'Removing…' : 'Remove'}
                </Button>
                <Button variant="quiet" size="sm" disabled={pending} onClick={() => setConfirming(null)}>
                  Keep
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
