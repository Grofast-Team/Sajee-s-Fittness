'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Alert, Button, Field, Section, Why, inputClass, inputStyle } from '@/components/ui';
import { formatRupees } from '@/lib/engines/money';
import type { GoalProgress } from '@/lib/engines/savings';
import { addSavingsGoal, closeSavingsGoal, contributeToSavingsGoal } from '@/lib/actions/savings';

/**
 * What someone is saving towards, and how it is going.
 *
 * "₹5,000 saved this month" means little on its own. Against a ₹1,00,000
 * emergency fund due by March it becomes a position: how far along, what each
 * month needs, and — once there is enough history to say — whether the usual
 * pace gets there.
 */

type Notice = { ok: boolean; text: string };

export function SavingsPanel({ goals, canEdit }: { goals: GoalProgress[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  return (
    <Section
      title="Saving towards"
      meta={goals.length > 0 ? `${goals.length} goal${goals.length === 1 ? '' : 's'}` : undefined}
    >
      {goals.length === 0 ? (
        <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          Nothing set up yet. A goal — an emergency fund, a deposit, a trip — turns money set aside
          into how far along you are.
        </p>
      ) : (
        <ul className="space-y-5">
          {goals.map((g) => (
            <GoalRow key={g.goal.id} progress={g} canEdit={canEdit} onNotice={setNotice} />
          ))}
        </ul>
      )}

      {notice ? (
        <div className="mt-3">
          <Alert tone={notice.ok ? 'success' : 'error'}>{notice.text}</Alert>
        </div>
      ) : null}

      {canEdit ? (
        adding ? (
          <AddGoalForm
            onCancel={() => setAdding(false)}
            onDone={(result) => {
              setNotice(result);
              if (result.ok) setAdding(false);
            }}
          />
        ) : (
          <Button
            className="mt-4"
            variant="ghost"
            fullWidth
            onClick={() => {
              setAdding(true);
              setNotice(null);
            }}
          >
            <Plus size={16} aria-hidden /> Add a savings goal
          </Button>
        )
      ) : null}

      <Why label="How is this worked out?">
        <p>
          Adding money to a goal records a normal spend filed as savings. It shows in “where your
          income went” as money set aside, and it counts in this month’s total like any money that
          leaves your account. There is no second set of books.
        </p>
        <p className="mt-2">
          The monthly amount spreads what is left over the months before your date, starting next
          month. Anything you added this month is already in the total.
        </p>
        <p className="mt-2">
          Your usual pace is the average over full calendar months since the goal began, counting
          months where nothing went in. The month you started and the current month are left out
          because they are only partly over. Until there are two full months, there is no pace to
          show — one deposit is not a habit.
        </p>
      </Why>
    </Section>
  );
}

function GoalRow({
  progress: p,
  canEdit,
  onNotice,
}: {
  progress: GoalProgress;
  canEdit: boolean;
  onNotice: (notice: Notice) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [amount, setAmount] = useState('');
  const [pending, startTransition] = useTransition();

  const { goal } = p;
  const pct = Math.round(p.share * 100);

  /*
   * State set after an `await` is not part of the transition on its own, so
   * without the inner startTransition the message commits first and the
   * refreshed goal arrives up to a second later — "₹2,500 added" beside the
   * old total. Wrapped, both land in the same commit.
   */
  function contribute() {
    startTransition(async () => {
      const result = await contributeToSavingsGoal({ id: goal.id, amount });
      startTransition(() => {
        onNotice({ ok: result.ok, text: result.ok ? result.message : result.error });
        if (result.ok) {
          setAmount('');
          setAdding(false);
        }
      });
    });
  }

  function close() {
    startTransition(async () => {
      const result = await closeSavingsGoal(goal.id);
      startTransition(() => {
        onNotice({ ok: result.ok, text: result.ok ? result.message : result.error });
        setConfirmingClose(false);
      });
    });
  }

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{goal.label}</span>
        <span className="data shrink-0 text-sm">
          <span style={{ fontWeight: 600 }}>{formatRupees(p.savedPaise)}</span>
          <span style={{ color: 'var(--fg-subtle)' }}> of {formatRupees(goal.targetPaise)}</span>
        </span>
      </div>

      <div
        className="relative mt-1.5 w-full overflow-hidden"
        style={{ height: 8, background: 'var(--ground)', borderRadius: 8 }}
        role="img"
        aria-label={`${goal.label}: ${formatRupees(p.savedPaise)} of ${formatRupees(goal.targetPaise)}, ${pct} percent`}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${p.share * 100}%`,
            background: p.reached ? 'var(--confirm)' : 'var(--primary)',
            borderRadius: 8,
          }}
        />
      </div>

      <p className="measure mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        {p.message}
      </p>

      {canEdit ? (
        adding ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label htmlFor={`goal-amount-${goal.id}`} className="sr-only">
              Amount to add to {goal.label}
            </label>
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id={`goal-amount-${goal.id}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
              className={`data ${inputClass} min-w-0 flex-1`}
              style={inputStyle}
            />
            {/* Full-size buttons throughout: 44px targets, used one-handed. */}
            <Button disabled={pending || !amount.trim()} onClick={contribute}>
              {pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : 'Add'}
            </Button>
            <Button variant="quiet" disabled={pending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : confirmingClose ? (
          <div
            className="mt-2.5 flex flex-wrap items-center gap-2 p-3"
            style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
          >
            <span className="flex-1 text-sm">Close this goal? What you added stays in your records.</span>
            <Button variant="ghost" disabled={pending} onClick={close}>
              {pending ? 'Closing…' : 'Close'}
            </Button>
            <Button variant="quiet" disabled={pending} onClick={() => setConfirmingClose(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <Button
              variant="ghost"
              aria-label={`Add money to ${goal.label}`}
              onClick={() => setAdding(true)}
            >
              Add money
            </Button>
            <Button
              variant="quiet"
              aria-label={`Close ${goal.label}`}
              onClick={() => setConfirmingClose(true)}
            >
              Close
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

function AddGoalForm({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: (notice: Notice) => void;
}) {
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [targetDate, setTargetDate] = useState('');
  // A transition rather than a boolean, so "Saving…" lasts until the new goal
  // is on screen, and the message commits with it (see GoalRow.contribute).
  const [saving, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await addSavingsGoal({
        label,
        target,
        ...(saved.trim() ? { saved } : {}),
        // An empty date input is "no deadline", not a malformed date.
        ...(targetDate ? { targetDate } : {}),
      });
      startTransition(() => {
        onDone({ ok: result.ok, text: result.ok ? result.message : result.error });
      });
    });
  }

  return (
    <div
      className="mt-4 space-y-3 p-3.5"
      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
    >
      <Field label="What are you saving for?" htmlFor="goal-label">
        <input
          id="goal-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="Emergency fund, deposit, trip…"
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How much do you need?" htmlFor="goal-target">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id="goal-target"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="100000"
              className={`data ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field
          label="Already saved towards it"
          htmlFor="goal-saved"
          description="Money put aside before today. Leave empty if none."
        >
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id="goal-saved"
              inputMode="decimal"
              value={saved}
              onChange={(e) => setSaved(e.target.value)}
              placeholder="0"
              className={`data ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </Field>
      </div>

      <Field
        label="By when?"
        htmlFor="goal-date"
        description="Optional. Without a date we show when you are likely to get there instead."
      >
        <input
          id="goal-date"
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className={`data ${inputClass}`}
          style={inputStyle}
        />
      </Field>

      <div className="flex gap-2">
        <Button disabled={saving || !label.trim() || !target.trim()} onClick={submit}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            'Add it'
          )}
        </Button>
        <Button variant="quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
