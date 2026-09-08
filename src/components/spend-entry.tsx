'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, inputStyle } from '@/components/ui';
import { CATEGORIES, formatRupees, parseAmountToPaise } from '@/lib/engines/money';
import { logSpend, type MoneyResult } from '@/lib/actions/money';

/**
 * Adding a spend.
 *
 * The user said they want to record everything, down to a bus fare. That
 * decision is the whole design brief: a form with four fields and a Save
 * button gets abandoned inside a week for small amounts, and the totals then
 * quietly understate reality while looking complete.
 *
 * So this is two actions. Type the amount, tap what it was for — the tap is
 * the save. No date picker (today is nearly always right, and it can be
 * corrected in the list), no note field in the way (it is there, folded away,
 * for the times it matters).
 */

/*
 * The categories offered first.
 *
 * Everyday, small, frequent things — which is exactly what goes unrecorded.
 * Rent gets remembered without help; a ₹15 bus fare does not.
 */
const QUICK = ['groceries', 'eating_out', 'transport', 'phone_internet', 'household', 'medical'];

export function SpendEntry({ canSave }: { canSave: boolean }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [state, setState] = useState<MoneyResult | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const paise = parseAmountToPaise(amount);
  const ready = paise !== null && canSave;

  async function save(category: string) {
    if (paise === null) return;
    setSaving(category);
    setState(null);

    const result = await logSpend({ amountPaise: paise, category, note: note.trim() || undefined });

    setState(result);
    if (result.ok) {
      setAmount('');
      setNote('');
      // Straight back to the amount box: recording two things in a row is the
      // normal case, not the exception.
      amountRef.current?.focus();
    }
    setSaving(null);
  }

  return (
    <div>
      <label htmlFor="spend-amount" className="block text-sm font-medium">
        How much did you spend?
      </label>

      <div className="mt-2 flex items-center gap-2">
        <span className="data text-[28px] font-semibold" style={{ color: 'var(--fg-subtle)' }}>
          ₹
        </span>
        <input
          id="spend-amount"
          ref={amountRef}
          // `inputMode="decimal"` gives a phone the numeric keypad with a
          // decimal point, which is the whole keyboard this screen needs.
          inputMode="decimal"
          type="text"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          aria-describedby="spend-hint"
          className="data min-h-14 w-full border px-3 text-[28px] font-semibold outline-none"
          style={inputStyle}
        />
      </div>

      <p id="spend-hint" className="mt-1.5 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
        {paise !== null
          ? `${formatRupees(paise)} — now tap what it was for.`
          : 'Type the amount, then tap what it was for. That saves it.'}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CATEGORIES.filter((c) => QUICK.includes(c.id)).map((c) => (
          <CategoryButton
            key={c.id}
            emoji={c.emoji}
            label={c.label}
            disabled={!ready || saving !== null}
            busy={saving === c.id}
            onClick={() => save(c.id)}
          />
        ))}
      </div>

      {/* Everything else, and the note, out of the way until wanted. */}
      <details className="group mt-3">
        <summary
          className="inline-flex min-h-9 cursor-pointer list-none items-center text-[13px] font-medium"
          style={{ color: 'var(--primary-dark)' }}
        >
          Something else, or add a note
        </summary>

        <div className="mt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATEGORIES.filter((c) => !QUICK.includes(c.id)).map((c) => (
              <CategoryButton
                key={c.id}
                emoji={c.emoji}
                label={c.label}
                disabled={!ready || saving !== null}
                busy={saving === c.id}
                onClick={() => save(c.id)}
              />
            ))}
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="What was it? (optional)"
            aria-label="Note"
            className="mt-3 min-h-11 w-full border px-3 text-[15px] outline-none"
            style={inputStyle}
          />
        </div>
      </details>

      {state ? (
        <div className="mt-3">
          {state.ok ? (
            <Alert tone="success">{state.message}</Alert>
          ) : (
            <Alert tone="error">{state.error}</Alert>
          )}
        </div>
      ) : null}

      {!canSave ? (
        <p className="mt-3 text-center text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Sign in to record your own spending.
        </p>
      ) : null}
    </div>
  );
}

function CategoryButton({
  emoji,
  label,
  disabled,
  busy,
  onClick,
}: {
  emoji: string;
  label: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-12 items-center gap-2 border px-3 text-left text-sm font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--line-strong)',
        borderRadius: 'var(--radius-control)',
        cursor: disabled ? undefined : 'pointer',
      }}
    >
      {busy ? (
        <Loader2 size={16} className="animate-spin" aria-hidden />
      ) : (
        <span aria-hidden>{emoji}</span>
      )}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
