'use client';

import { useState, useTransition } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import {
  CATEGORIES,
  categoryLabel,
  formatRupees,
  parseAmountToPaise,
  type SpendCategory,
} from '@/lib/engines/money';
import { deleteSpend, updateSpend } from '@/lib/actions/money';
import type { SpendRow } from '@/lib/data/money';

/**
 * This month's spends, each one correctable.
 *
 * A wrong amount in a total is worse than no amount, because it looks right.
 * Until this existed a spend could only be added: a typo stayed in every
 * figure on the screen for the rest of the month.
 *
 * Editing is inline rather than in a dialog, so the entry being corrected stays
 * in view beside its neighbours while it changes.
 */

const EMOJI = new Map(CATEGORIES.map((c) => [c.id, c.emoji]));

type Notice = { tone: 'success' | 'warning' | 'error'; text: string };

export function SpendList({ spends, canEdit }: { spends: SpendRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();

  if (spends.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
        Nothing recorded yet.
      </p>
    );
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await deleteSpend(id);
      setConfirming(null);
      setNotice(
        result.ok ? { tone: 'success', text: result.message } : { tone: 'error', text: result.error },
      );
    });
  }

  return (
    <div>
      {notice ? (
        <div className="mb-3">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}

      <ul>
        {spends.map((s) => {
          const label = `${categoryLabel(s.category)} ${formatRupees(s.amountPaise)}`;

          return (
            <li
              key={s.id}
              className="border-b py-2.5 first:pt-0 last:border-0 last:pb-0"
              style={{ borderColor: 'var(--line)' }}
            >
              {editing === s.id ? (
                <EditForm
                  spend={s}
                  onCancel={() => setEditing(null)}
                  onDone={(next) => {
                    setEditing(null);
                    setNotice(next);
                  }}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm">
                        {EMOJI.get(s.category as SpendCategory) ?? '•'} {categoryLabel(s.category)}
                      </span>
                      {s.note ? (
                        <span className="ml-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                          {s.note}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center">
                      <span className="data text-sm font-semibold">{formatRupees(s.amountPaise)}</span>
                      <span className="data ml-2 text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
                        {s.spentOn.slice(8)}/{s.spentOn.slice(5, 7)}
                      </span>

                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            aria-label={`Edit ${label}`}
                            onClick={() => {
                              setEditing(s.id);
                              setConfirming(null);
                              setNotice(null);
                            }}
                            className="ml-1 flex size-11 cursor-pointer items-center justify-center rounded-[10px]"
                            style={{ color: 'var(--fg-subtle)' }}
                          >
                            <Pencil size={15} aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${label}`}
                            aria-expanded={confirming === s.id}
                            onClick={() => {
                              setConfirming(confirming === s.id ? null : s.id);
                              setEditing(null);
                              setNotice(null);
                            }}
                            className="flex size-11 cursor-pointer items-center justify-center rounded-[10px]"
                            style={{ color: 'var(--fg-subtle)' }}
                          >
                            <Trash2 size={15} aria-hidden />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {confirming === s.id ? (
                    <div
                      className="mt-2.5 flex flex-wrap items-center gap-2 p-3"
                      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
                    >
                      <span className="flex-1 text-sm">
                        {s.commitmentId
                          ? 'Remove this payment? The bill it settled may show as unpaid again.'
                          : s.savingsGoalId
                            ? 'Remove this? It comes off the savings goal it was added to.'
                            : 'Remove this spend?'}
                      </span>
                      <Button variant="danger" size="sm" disabled={pending} onClick={() => remove(s.id)}>
                        {pending ? 'Removing…' : 'Remove'}
                      </Button>
                      <Button variant="quiet" size="sm" disabled={pending} onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EditForm({
  spend,
  onCancel,
  onDone,
}: {
  spend: SpendRow;
  onCancel: () => void;
  onDone: (notice: Notice) => void;
}) {
  const [amount, setAmount] = useState((spend.amountPaise / 100).toFixed(2).replace(/\.00$/, ''));
  const [category, setCategory] = useState(spend.category);
  const [note, setNote] = useState(spend.note ?? '');
  const [spentOn, setSpentOn] = useState(spend.spentOn);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const settled = spend.commitmentId !== null;
  const saved = spend.savingsGoalId !== null;
  const locked = settled || saved;

  async function save() {
    const paise = parseAmountToPaise(amount);
    if (paise === null || paise <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }

    setSaving(true);
    setError(null);

    const result = await updateSpend({
      id: spend.id,
      amountPaise: paise,
      // A bill payment's category follows the bill, and money added to a goal
      // is always savings. The database refuses to change either — so it is
      // not sent rather than sent and rejected.
      ...(locked ? {} : { category }),
      note: note.trim() === '' ? null : note.trim(),
      spentOn,
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    onDone(
      result.warning
        ? { tone: 'warning', text: result.warning }
        : { tone: 'success', text: result.message },
    );
  }

  return (
    <div
      className="space-y-3 p-3"
      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" htmlFor={`edit-amount-${spend.id}`}>
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id={`edit-amount-${spend.id}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`data ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field label="Date" htmlFor={`edit-date-${spend.id}`}>
          <input
            id={`edit-date-${spend.id}`}
            type="date"
            value={spentOn}
            onChange={(e) => setSpentOn(e.target.value)}
            className={`data ${inputClass}`}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field
        label="What it was for"
        htmlFor={`edit-category-${spend.id}`}
        description={
          settled
            ? 'This paid a recurring bill, so it stays filed with that bill.'
            : saved
              ? 'This went into a savings goal, so it stays filed as savings.'
              : undefined
        }
      >
        <select
          id={`edit-category-${spend.id}`}
          value={category}
          disabled={locked}
          onChange={(e) => setCategory(e.target.value)}
          className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
          style={inputStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Note" htmlFor={`edit-note-${spend.id}`}>
        <input
          id={`edit-note-${spend.id}`}
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex gap-2">
        <Button disabled={saving} onClick={save}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            'Save'
          )}
        </Button>
        <Button variant="quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
