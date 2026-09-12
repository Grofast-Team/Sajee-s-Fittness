'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, Plus, X } from 'lucide-react';
import { Alert, Badge, Button, Field, Section, Why, inputClass, inputStyle } from '@/components/ui';
import { CATEGORIES, categoryLabel, formatRupees } from '@/lib/engines/money';
import type { CommitmentSummary } from '@/lib/engines/commitments';
import { addCommitment, endCommitment, markCommitmentPaid } from '@/lib/actions/commitments';

/**
 * What is already promised this month, and what that leaves free.
 *
 * The figure that matters here is not "spent" — it is what remains once the
 * rent and the bills are set aside. Someone eleven days in with ₹17,000
 * apparently remaining and ₹12,000 of rent still due does not have ₹17,000 to
 * decide about, and a screen that implies otherwise encourages exactly the
 * overspend it will report at the end of the month.
 */
export function CommitmentsPanel({
  summary,
  canEdit,
}: {
  summary: CommitmentSummary;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [, startTransition] = useTransition();

  function run(id: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusyId(id);
    setState(null);
    startTransition(async () => {
      const result = await fn();
      setState({ ok: result.ok, text: result.ok ? (result.message ?? '') : (result.error ?? '') });
      setBusyId(null);
    });
  }

  return (
    <Section
      title="Already promised"
      meta={
        summary.outstandingPaise > 0 ? (
          <Badge tone="signal">{formatRupees(summary.outstandingPaise)} to go</Badge>
        ) : summary.statuses.length > 0 ? (
          <Badge tone="confirm">All paid</Badge>
        ) : undefined
      }
    >
      {/* The headline: what is genuinely free, not what is nominally left. */}
      {summary.freePaise !== null ? (
        <div className="flex items-baseline gap-2">
          <span
            className="data text-[26px] font-semibold leading-none"
            style={{ color: summary.freePaise < 0 ? 'var(--alarm)' : 'var(--fg)' }}
          >
            {formatRupees(summary.freePaise)}
          </span>
          <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
            free to decide about
          </span>
        </div>
      ) : null}

      <p className="measure mt-2 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {summary.message}
      </p>

      {summary.overdue.length > 0 ? (
        <div className="mt-3">
          <Alert tone="warning" title={`${summary.overdue.length} past its date`}>
            {summary.overdue.map((s) => s.commitment.label).join(', ')}. If you have already paid,
            marking it below keeps the figures right.
          </Alert>
        </div>
      ) : null}

      {summary.statuses.length > 0 ? (
        <ul className="mt-4">
          {summary.statuses.map((s) => (
            <li
              key={s.commitment.id}
              className="flex items-center justify-between gap-3 border-b py-2.5 first:pt-0 last:border-0 last:pb-0"
              style={{ borderColor: 'var(--line)' }}
            >
              <div className="min-w-0">
                <span className="text-sm font-medium">{s.commitment.label}</span>
                <span className="ml-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                  {categoryLabel(s.commitment.category)} ·{' '}
                  {s.paid
                    ? 'paid'
                    : s.overdue
                      ? `due ${s.dueOn.slice(8)}/${s.dueOn.slice(5, 7)}`
                      : s.daysUntilDue === 0
                        ? 'due today'
                        : `in ${s.daysUntilDue} day${s.daysUntilDue === 1 ? '' : 's'}`}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className="data text-sm"
                  style={{
                    color: s.paid ? 'var(--fg-subtle)' : 'var(--fg)',
                    fontWeight: s.paid ? 400 : 600,
                    textDecoration: s.paid ? 'line-through' : undefined,
                  }}
                >
                  {formatRupees(s.commitment.amountPaise)}
                </span>

                {canEdit && !s.paid ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId !== null}
                    onClick={() =>
                      run(s.commitment.id, () => markCommitmentPaid({ id: s.commitment.id }))
                    }
                  >
                    {busyId === s.commitment.id ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <>
                        <Check size={14} aria-hidden /> Paid
                      </>
                    )}
                  </Button>
                ) : null}

                {canEdit ? (
                  <button
                    type="button"
                    aria-label={`Stop ${s.commitment.label}`}
                    disabled={busyId !== null}
                    onClick={() => run(s.commitment.id, () => endCommitment(s.commitment.id))}
                    className="flex size-9 cursor-pointer items-center justify-center rounded-[10px]"
                    style={{ color: 'var(--fg-subtle)' }}
                  >
                    <X size={14} aria-hidden />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {state ? (
        <div className="mt-3">
          <Alert tone={state.ok ? 'success' : 'error'}>{state.text}</Alert>
        </div>
      ) : null}

      {canEdit ? (
        adding ? (
          <AddForm
            onDone={(result) => {
              setState(result);
              if (result.ok) setAdding(false);
            }}
          />
        ) : (
          <Button className="mt-4" variant="ghost" fullWidth onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Add something recurring
          </Button>
        )
      ) : null}

      <Why label="How is this worked out?">
        <p>
          Marking something paid records a normal spend, so it appears in “where it went” like
          anything else. There is no second set of books — that is how the outstanding figure stays
          trustworthy.
        </p>
        <p className="mt-2">
          Free money is your monthly amount, minus what you have spent, minus what is still owed.
          Anything already paid is not subtracted twice.
        </p>
      </Why>
    </Section>
  );
}

function AddForm({ onDone }: { onDone: (r: { ok: boolean; text: string }) => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('rent');
  const [dueDay, setDueDay] = useState('1');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const result = await addCommitment({ label, amount, category, dueDay: Number(dueDay) });
    onDone({ ok: result.ok, text: result.ok ? result.message : result.error });
    if (result.ok) {
      setLabel('');
      setAmount('');
    }
    setSaving(false);
  }

  return (
    <div
      className="mt-4 space-y-3 p-3.5"
      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
    >
      <Field label="What is it?" htmlFor="c-label">
        <input
          id="c-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="Rent, Electricity, Netflix…"
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How much, each time?" htmlFor="c-amount">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id="c-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="12000"
              className={`data ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field
          label="Day of the month"
          htmlFor="c-due"
          description="Up to the 28th, so it never skips February."
        >
          <input
            id="c-due"
            type="number"
            min={1}
            max={28}
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            className={`data ${inputClass}`}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="What kind of thing?" htmlFor="c-cat">
        <select
          id="c-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={inputClass}
          style={inputStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      <Button fullWidth disabled={saving || !label.trim() || !amount.trim()} onClick={submit}>
        {saving ? (
          <>
            <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          'Add it'
        )}
      </Button>
    </div>
  );
}
