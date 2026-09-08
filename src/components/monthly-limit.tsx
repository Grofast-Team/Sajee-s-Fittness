'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import { formatRupees, parseAmountToPaise } from '@/lib/engines/money';
import { setMoneySettings, type MoneyResult } from '@/lib/actions/money';

/**
 * Setting the monthly amount.
 *
 * Kept separate from adding a spend because it is a once-in-a-while decision,
 * and mixing a rare setting in with the thing you do ten times a day makes the
 * frequent action slower.
 *
 * The copy avoids the word "budget" on purpose. Budgets are something people
 * have failed at before, and the word arrives carrying that. "What you plan to
 * spend" is the same number without the history.
 */
export function MonthlyLimit({
  canSave,
  currentPaise,
  monthStartDay,
}: {
  canSave: boolean;
  currentPaise: number | null;
  monthStartDay: number;
}) {
  const [value, setValue] = useState(
    currentPaise === null ? '' : String(Math.round(currentPaise / 100)),
  );
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<MoneyResult | null>(null);

  const paise = parseAmountToPaise(value);

  async function save() {
    setSaving(true);
    setState(null);
    setState(await setMoneySettings({ monthlyLimitPaise: paise }));
    setSaving(false);
  }

  async function clear() {
    setSaving(true);
    setState(null);
    setValue('');
    setState(await setMoneySettings({ monthlyLimitPaise: null }));
    setSaving(false);
  }

  return (
    <div>
      <Field
        label="What do you plan to spend this month?"
        htmlFor="monthly-limit"
        description={
          monthStartDay === 1
            ? 'Your month runs from the 1st. Everything resets then.'
            : `Your month runs from the ${monthStartDay}th.`
        }
      >
        <div className="flex items-center gap-2">
          <span className="data text-sm" style={{ color: 'var(--fg-subtle)' }}>
            ₹
          </span>
          <input
            id="monthly-limit"
            inputMode="decimal"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 20000"
            className={`data ${inputClass}`}
            style={inputStyle}
          />
        </div>
      </Field>

      {/* Said plainly, because the number is a plan and not a promise. */}
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        A rough figure is fine — it is there to show you where you stand, not to tell you off. You
        can change it whenever you like.
      </p>

      {state ? (
        <div className="mt-3">
          {state.ok ? (
            <Alert tone="success">{state.message}</Alert>
          ) : (
            <Alert tone="error">{state.error}</Alert>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button fullWidth disabled={saving || !canSave || paise === null} onClick={save}>
          {saving ? (
            <>
              <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : currentPaise === null ? (
            'Set the amount'
          ) : (
            'Update'
          )}
        </Button>

        {currentPaise !== null ? (
          <Button variant="quiet" disabled={saving || !canSave} onClick={clear}>
            Remove
          </Button>
        ) : null}
      </div>

      {currentPaise !== null ? (
        <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          Currently {formatRupees(currentPaise)} a month.
        </p>
      ) : null}
    </div>
  );
}
