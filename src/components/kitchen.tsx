'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import { Alert, Badge, Button, Field, Section, inputClass, inputStyle } from '@/components/ui';
import { formatQuantity, type PantryItem, type PendingUse } from '@/lib/engines/pantry';
import type { KitchenEntry, KitchenItemView } from '@/lib/data/pantry';
import {
  addPantryItem,
  archivePantryItem,
  recordCount,
  recordPurchase,
  recordRemoval,
  removeMovement,
  settleLoggedFood,
} from '@/lib/actions/pantry';

/**
 * The kitchen screen's moving parts.
 *
 * Every action records a movement and the page is re-read from the ledger; no
 * figure here is edited in place. Messages commit together with the refreshed
 * stock (the inner startTransition), never a moment before it.
 */

type Notice = { ok: boolean; text: string };
type Result = { ok: true; message: string } | { ok: false; error: string };

const toNotice = (r: Result): Notice => ({ ok: r.ok, text: r.ok ? r.message : r.error });

const UNIT_WORD: Record<PantryItem['unit'], string> = { piece: 'pieces', g: 'grams', ml: 'millilitres' };

/** Numbers as typed, in the item's unit. Null for anything that is not a plain positive number. */
function parseQuantity(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function useAction(onNotice: (n: Notice) => void, onDone?: () => void) {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<Result>) =>
    startTransition(async () => {
      const result = await action();
      startTransition(() => {
        onNotice(toNotice(result));
        if (result.ok) onDone?.();
      });
    });
  return [pending, run] as const;
}

/* ------------------------------------------------------------------ */
/* From the food log                                                   */
/* ------------------------------------------------------------------ */

export function FromFoodLog({ pending: uses }: { pending: PendingUse[] }) {
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <Section title="From your food log" meta={`${uses.length} to check`}>
      <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        These were logged recently and are foods you keep. Only you know whether they came from home —
        food eaten out is never taken from your kitchen.
      </p>
      <ul className="mt-3">
        {uses.map((use) => (
          <PendingRow key={use.log.id} use={use} onNotice={setNotice} />
        ))}
      </ul>
      {notice ? (
        <div className="mt-3">
          <Alert tone={notice.ok ? 'success' : 'error'}>{notice.text}</Alert>
        </div>
      ) : null}
    </Section>
  );
}

function PendingRow({ use, onNotice }: { use: PendingUse; onNotice: (n: Notice) => void }) {
  const [busy, run] = useAction(onNotice);
  const settle = (fromHome: boolean) => run(() => settleLoggedFood({ foodLogId: use.log.id, fromHome }));

  return (
    <li
      className="flex flex-col gap-2 border-b py-2.5 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderColor: 'var(--line)' }}
    >
      <span className="min-w-0 text-sm">
        {use.log.description}
        <span className="block text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
          {use.log.logDate.slice(8)}/{use.log.logDate.slice(5, 7)} · would take{' '}
          <span className="data">{formatQuantity(use.item, use.units)}</span> {use.item.label.toLowerCase()}
        </span>
      </span>
      <span className="flex shrink-0 gap-2">
        <Button size="sm" disabled={busy} onClick={() => settle(true)}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : 'From home'}
        </Button>
        <Button size="sm" variant="quiet" disabled={busy} onClick={() => settle(false)}>
          Not from home
        </Button>
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Stock                                                               */
/* ------------------------------------------------------------------ */

export function StockList({ items }: { items: KitchenItemView[] }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(items.length === 0);

  return (
    <Section title="In your kitchen" meta={items.length > 0 ? `${items.length} kept` : undefined}>
      {items.length === 0 ? (
        <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          Nothing tracked yet. Start with a few things you buy often and eat as they are — eggs, milk,
          curd, bread, fruit.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((view) => (
            <StockRow key={view.item.id} view={view} onNotice={setNotice} />
          ))}
        </ul>
      )}

      {notice ? (
        <div className="mt-3">
          <Alert tone={notice.ok ? 'success' : 'error'}>{notice.text}</Alert>
        </div>
      ) : null}

      {adding ? (
        <AddItemForm
          onCancel={items.length > 0 ? () => setAdding(false) : undefined}
          onDone={(result) => {
            setNotice(toNotice(result));
            if (result.ok) setAdding(false);
          }}
        />
      ) : (
        <Button className="mt-4" variant="ghost" fullWidth onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden /> Keep track of something else
        </Button>
      )}
    </Section>
  );
}

type Mode = 'idle' | 'bought' | 'used' | 'discarded' | 'counted' | 'history' | 'remove';

const STATUS_BADGE = {
  out: { tone: 'alarm', text: 'Out' },
  low: { tone: 'signal', text: 'Running low' },
  ok: null,
  unknown: null,
} as const;

function StockRow({ view, onNotice }: { view: KitchenItemView; onNotice: (n: Notice) => void }) {
  const { item, level, recent } = view;
  const [mode, setMode] = useState<Mode>('idle');
  const [busy, run] = useAction(onNotice, () => setMode('idle'));
  const badge = STATUS_BADGE[level.status];

  const toggle = (next: Mode) => setMode(mode === next ? 'idle' : next);

  return (
    <li className="border-b pb-4 last:border-0 last:pb-0" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">
          {item.label} {badge ? <Badge tone={badge.tone}>{badge.text}</Badge> : null}
        </span>
        <span className="data shrink-0 text-sm font-semibold">{formatQuantity(item, level.onHand)}</span>
      </div>
      <p className="measure mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {level.message}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(
          [
            ['bought', 'Bought'],
            ['used', 'Used'],
            ['counted', 'Count'],
            ['discarded', 'Threw out'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={mode === key ? 'ghost' : 'quiet'}
            aria-expanded={mode === key}
            aria-label={`${label}: ${item.label}`}
            onClick={() => toggle(key)}
          >
            {label}
          </Button>
        ))}
        {recent.length > 0 ? (
          <Button size="sm" variant="quiet" aria-expanded={mode === 'history'} onClick={() => toggle('history')}>
            History
          </Button>
        ) : null}
      </div>

      {mode === 'bought' ? (
        <QuantityForm
          id={`bought-${item.id}`}
          item={item}
          question="How much did you buy?"
          withCost
          busy={busy}
          action="Add"
          onCancel={() => setMode('idle')}
          onSubmit={(quantity, cost) => run(() => recordPurchase({ itemId: item.id, quantity, ...(cost ? { cost } : {}) }))}
        />
      ) : mode === 'used' || mode === 'discarded' ? (
        <QuantityForm
          id={`${mode}-${item.id}`}
          item={item}
          question={mode === 'used' ? 'How much did you use?' : 'How much went in the bin?'}
          hint={
            mode === 'used'
              ? 'For anything not logged as food — cooking with it, say. Logged food is offered above.'
              : 'Not counted as use, so it does not change how long the rest lasts.'
          }
          busy={busy}
          action="Record"
          onCancel={() => setMode('idle')}
          onSubmit={(quantity) => run(() => recordRemoval({ itemId: item.id, kind: mode, quantity }))}
        />
      ) : mode === 'counted' ? (
        <QuantityForm
          id={`counted-${item.id}`}
          item={item}
          question="How much is there right now?"
          hint="Corrects the figure without erasing what was recorded before."
          allowZero
          busy={busy}
          action="Set"
          onCancel={() => setMode('idle')}
          onSubmit={(counted) => run(() => recordCount({ itemId: item.id, counted }))}
        />
      ) : mode === 'history' ? (
        <History item={item} entries={recent} onNotice={onNotice} onRemove={() => setMode('remove')} />
      ) : mode === 'remove' ? (
        <div
          className="mt-2.5 flex flex-wrap items-center gap-2 p-3"
          style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
        >
          <span className="flex-1 text-sm">Stop keeping track of {item.label}? Its history is kept.</span>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => archivePantryItem(item.id))}>
            {busy ? 'Removing…' : 'Stop tracking'}
          </Button>
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => setMode('idle')}>
            Keep
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function QuantityForm({
  id,
  item,
  question,
  hint,
  withCost = false,
  allowZero = false,
  busy,
  action,
  onCancel,
  onSubmit,
}: {
  id: string;
  item: PantryItem;
  question: string;
  hint?: string;
  withCost?: boolean;
  allowZero?: boolean;
  busy: boolean;
  action: string;
  onCancel: () => void;
  onSubmit: (quantity: number, cost?: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const quantity = parseQuantity(amount);
    if (quantity === null || (!allowZero && quantity <= 0)) {
      setError(`Enter a number of ${UNIT_WORD[item.unit]}.`);
      return;
    }
    setError(null);
    onSubmit(quantity, cost.trim() || undefined);
  }

  return (
    <div className="mt-2.5 space-y-3 p-3" style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={question} htmlFor={id} description={hint}>
          <div className="flex items-center gap-2">
            <input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={item.unit === 'piece' ? '12' : '500'}
              className={`data ${inputClass}`}
              style={inputStyle}
            />
            <span className="shrink-0 text-sm" style={{ color: 'var(--fg-subtle)' }}>
              {item.unit === 'piece' ? '' : item.unit}
            </span>
          </div>
        </Field>
        {withCost ? (
          <Field
            label="What did it cost?"
            htmlFor={`${id}-cost`}
            description="Optional. Recorded as a groceries spend on the money screen."
          >
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
              <input
                id={`${id}-cost`}
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="84"
                className={`data ${inputClass}`}
                style={inputStyle}
              />
            </div>
          </Field>
        ) : null}
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex gap-2">
        <Button disabled={busy || !amount.trim()} onClick={submit}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : action}
        </Button>
        <Button variant="quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const KIND_WORD: Record<KitchenEntry['kind'], string> = {
  bought: 'Bought',
  used: 'Used',
  discarded: 'Threw out',
  counted: 'Counted',
  skipped: 'Not from home',
};

function History({
  item,
  entries,
  onNotice,
  onRemove,
}: {
  item: PantryItem;
  entries: KitchenEntry[];
  onNotice: (n: Notice) => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, run] = useAction(onNotice, () => setConfirming(null));

  return (
    <div className="mt-2.5">
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px]" style={{ color: 'var(--fg-muted)' }}>
                {KIND_WORD[entry.kind]}
                {entry.fromLog ? ' · from food log' : ''}
                <span className="data ml-2 text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
                  {entry.occurredOn.slice(8)}/{entry.occurredOn.slice(5, 7)}
                </span>
              </span>
              <span className="flex items-center">
                <span className="data text-[13px] font-semibold">
                  {entry.quantity > 0 ? '+' : '−'}
                  {formatQuantity(item, Math.abs(entry.quantity))}
                </span>
                {entry.fromLog ? (
                  // Undone from the food log, so the two can never disagree.
                  <span className="size-11" aria-hidden />
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove: ${KIND_WORD[entry.kind]} ${formatQuantity(item, Math.abs(entry.quantity))} ${item.label}`}
                    onClick={() => setConfirming(confirming === entry.id ? null : entry.id)}
                    className="flex size-11 cursor-pointer items-center justify-center rounded-[10px]"
                    style={{ color: 'var(--fg-subtle)' }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                )}
              </span>
            </div>
            {confirming === entry.id ? (
              <div
                className="mb-2 flex flex-wrap items-center gap-2 p-3"
                style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
              >
                <span className="flex-1 text-sm">Remove this? {item.label} goes back to what it was before it.</span>
                <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => removeMovement(entry.id))}>
                  {busy ? 'Removing…' : 'Remove'}
                </Button>
                <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(null)}>
                  Keep
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
        Use from the food log is undone by removing or changing that log. A spend recorded with a purchase
        stays on the money screen, where it can be corrected.
      </p>
      <Button className="mt-2" size="sm" variant="quiet" onClick={onRemove}>
        Stop tracking {item.label}…
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Adding an item                                                      */
/* ------------------------------------------------------------------ */

interface FoodMatch {
  id: string;
  name: string;
  servings: { unitLabel: string; grams: number }[];
}

function AddItemForm({ onCancel, onDone }: { onCancel?: () => void; onDone: (r: Result) => void }) {
  const [label, setLabel] = useState('');
  const [unit, setUnit] = useState<PantryItem['unit']>('piece');
  const [onHand, setOnHand] = useState('');
  const [food, setFood] = useState<FoodMatch | null>(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<FoodMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const abort = useRef<AbortController | null>(null);

  // Debounced, like the food screen's search, and through the same endpoint.
  useEffect(() => {
    if (food || query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      try {
        const res = await fetch(`/api/food/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const body = await res.json();
        setMatches((body.results ?? []).slice(0, 5));
      } catch {
        // An aborted or failed search leaves the previous matches; linking is optional.
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, food]);

  function choose(match: FoodMatch) {
    setFood(match);
    setLabel(match.name);
    // A food with a per-piece serving is naturally counted in pieces.
    setUnit(match.servings.some((s) => s.unitLabel === 'piece') ? 'piece' : /milk|juice|oil/i.test(match.name) ? 'ml' : 'g');
    setQuery('');
    setMatches([]);
  }

  function submit() {
    const count = onHand.trim() ? parseQuantity(onHand) : 0;
    if (count === null) {
      setError(`Enter how many ${UNIT_WORD[unit]} are there now, or leave it empty.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await addPantryItem({
        label,
        unit,
        ...(food ? { foodId: food.id } : {}),
        ...(count > 0 ? { onHand: count } : {}),
      });
      startTransition(() => onDone(result));
    });
  }

  const visibleMatches = query.trim().length >= 2 && !food ? matches : [];

  return (
    <div className="mt-4 space-y-3 p-3.5" style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}>
      <Field
        label="Which food is it?"
        htmlFor="kitchen-food"
        description="Linking it to a food lets what you log be taken from stock. Skip it for things you never log as they are, like oil."
      >
        {food ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              Linked to <strong>{food.name}</strong>
            </span>
            <button
              type="button"
              aria-label="Unlink the food"
              onClick={() => setFood(null)}
              className="flex size-9 cursor-pointer items-center justify-center rounded-[10px]"
              style={{ color: 'var(--fg-subtle)' }}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search
              size={15}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--fg-subtle)' }}
            />
            <input
              id="kitchen-food"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Egg, milk, curd…"
              autoComplete="off"
              className={`${inputClass} pl-9`}
              style={inputStyle}
            />
          </div>
        )}
      </Field>

      {visibleMatches.length > 0 ? (
        <ul className="-mt-1 space-y-1" aria-label="Matching foods">
          {visibleMatches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => choose(m)}
                className="w-full cursor-pointer rounded-[10px] px-3 py-2 text-left text-sm"
                style={{ background: 'var(--surface)' }}
              >
                {m.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" htmlFor="kitchen-label">
          <input
            id="kitchen-label"
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Eggs"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
        <Field label="Counted in" htmlFor="kitchen-unit">
          <select
            id="kitchen-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value as PantryItem['unit'])}
            className={inputClass}
            style={inputStyle}
          >
            <option value="piece">Pieces</option>
            <option value="g">Grams</option>
            <option value="ml">Millilitres</option>
          </select>
        </Field>
        <Field label="How much is there now?" htmlFor="kitchen-onhand">
          <input
            id="kitchen-onhand"
            inputMode="decimal"
            value={onHand}
            onChange={(e) => setOnHand(e.target.value)}
            placeholder="0"
            className={`data ${inputClass}`}
            style={inputStyle}
          />
        </Field>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex gap-2">
        <Button disabled={saving || !label.trim()} onClick={submit}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            'Start tracking'
          )}
        </Button>
        {onCancel ? (
          <Button variant="quiet" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
