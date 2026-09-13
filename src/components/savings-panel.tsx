'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Field, Section, Why, inputClass, inputStyle } from '@/components/ui';
import { formatRupees } from '@/lib/engines/money';
import type { GoalEntry, GoalView } from '@/lib/data/savings';
import {
  addSavingsGoal,
  closeSavingsGoal,
  contributeToSavingsGoal,
  removeSavingsWithdrawal,
  updateSavingsGoal,
  withdrawFromSavingsGoal,
} from '@/lib/actions/savings';
import { deleteSpend } from '@/lib/actions/money';

/**
 * What someone is saving towards, and how it is going.
 *
 * "₹5,000 saved this month" means little on its own. Against a ₹1,00,000
 * emergency fund due by March it becomes a position: how far along, what each
 * month needs, and — once there is enough history to say — whether the usual
 * pace gets there.
 */

type Notice = { ok: boolean; text: string };
type Result = { ok: true; message: string } | { ok: false; error: string };

const toNotice = (result: Result): Notice => ({
  ok: result.ok,
  text: result.ok ? result.message : result.error,
});

/** Paise as someone would type them back: "2500", or "2500.50". */
const asTyped = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, '');

const shortDate = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

const HISTORY_SHOWN = 8;

export function SavingsPanel({ goals, canEdit }: { goals: GoalView[]; canEdit: boolean }) {
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
          <GoalForm
            idPrefix="goal"
            onCancel={() => setAdding(false)}
            submit={(fields) =>
              addSavingsGoal({
                label: fields.label,
                target: fields.target,
                ...(fields.saved.trim() ? { saved: fields.saved } : {}),
                // An empty date input is "no deadline", not a malformed date.
                ...(fields.targetDate ? { targetDate: fields.targetDate } : {}),
              })
            }
            submitLabel="Add it"
            onDone={(result) => {
              setNotice(toNotice(result));
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
          Adding money to a goal records a normal spend filed as savings, so there is no second set
          of books. It shows in “where your income went” as money set aside, and it is not counted
          against what you plan to spend: it is kept, not spent.
        </p>
        <p className="mt-2">
          Taking money out is recorded against the goal. It is not income and not spending — in
          “where your income went” it sits beside what came in, as money that arrived to be spent.
        </p>
        <p className="mt-2">
          The monthly amount spreads what is left over the months before your date, starting next
          month. Anything you added this month is already in the total.
        </p>
        <p className="mt-2">
          Your usual pace is what stayed in — added minus taken out — averaged over full calendar
          months since the goal began, counting months where nothing went in. The month you started
          and the current month are left out because they are partly over. Until there are two full
          months, there is no pace to show — one deposit is not a habit.
        </p>
      </Why>
    </Section>
  );
}

type Mode = 'idle' | 'add' | 'take' | 'edit' | 'close';

function GoalRow({
  progress: p,
  canEdit,
  onNotice,
}: {
  progress: GoalView;
  canEdit: boolean;
  onNotice: (notice: Notice) => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [pending, startTransition] = useTransition();

  const { goal } = p;
  const pct = Math.round(p.share * 100);

  /*
   * State set after an `await` is not part of the transition on its own, so
   * without the inner startTransition the message commits first and the
   * refreshed goal arrives up to a second later — "₹2,500 added" beside the
   * old total. Wrapped, both land in the same commit.
   */
  function run(action: () => Promise<Result>) {
    startTransition(async () => {
      const result = await action();
      startTransition(() => {
        onNotice(toNotice(result));
        if (result.ok) setMode('idle');
      });
    });
  }

  const open = (next: Mode) => setMode(mode === next ? 'idle' : next);

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
        <>
          {mode === 'add' ? (
            <AmountForm
              id={`goal-add-${goal.id}`}
              label={`Amount to add to ${goal.label}`}
              action="Add"
              pending={pending}
              onCancel={() => setMode('idle')}
              onSubmit={(amount) => run(() => contributeToSavingsGoal({ id: goal.id, amount }))}
            />
          ) : mode === 'take' ? (
            <AmountForm
              id={`goal-take-${goal.id}`}
              label={`Amount to take out of ${goal.label}`}
              action="Take out"
              hint={
                p.savedPaise > 0
                  ? `Up to ${formatRupees(p.savedPaise)}.`
                  : 'Nothing is recorded in this goal yet.'
              }
              pending={pending}
              onCancel={() => setMode('idle')}
              onSubmit={(amount) => run(() => withdrawFromSavingsGoal({ id: goal.id, amount }))}
            />
          ) : mode === 'edit' ? (
            <>
              <GoalForm
                idPrefix={`goal-edit-${goal.id}`}
                initial={{
                  label: goal.label,
                  target: asTyped(goal.targetPaise),
                  saved: goal.openingPaise > 0 ? asTyped(goal.openingPaise) : '',
                  targetDate: goal.targetDate ?? '',
                }}
                submitLabel="Save"
                onCancel={() => setMode('idle')}
                submit={(fields) => updateSavingsGoal({ id: goal.id, ...editFrom(goal, fields) })}
                onDone={(result) => {
                  onNotice(toNotice(result));
                  if (result.ok) setMode('idle');
                }}
              />
              {/* Here rather than beside Add money: it is rare and final, and a
                  fourth button in the row wrapped onto its own line on a phone. */}
              <Button
                className="mt-2"
                variant="quiet"
                aria-label={`Close ${goal.label}`}
                onClick={() => setMode('close')}
              >
                Close this goal…
              </Button>
            </>
          ) : mode === 'close' ? (
            <div
              className="mt-2.5 flex flex-wrap items-center gap-2 p-3"
              style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
            >
              <span className="flex-1 text-sm">
                Close this goal? What you added and took out stays in your records.
              </span>
              <Button variant="ghost" disabled={pending} onClick={() => run(() => closeSavingsGoal(goal.id))}>
                {pending ? 'Closing…' : 'Close'}
              </Button>
              <Button variant="quiet" disabled={pending} onClick={() => setMode('idle')}>
                Keep
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" aria-label={`Add money to ${goal.label}`} onClick={() => open('add')}>
                Add money
              </Button>
              {p.savedPaise > 0 ? (
                <Button
                  variant="quiet"
                  aria-label={`Take money out of ${goal.label}`}
                  onClick={() => open('take')}
                >
                  Take out
                </Button>
              ) : null}
              <Button variant="quiet" aria-label={`Edit ${goal.label}`} onClick={() => open('edit')}>
                Edit
              </Button>
            </div>
          )}

          {p.history.length > 0 ? (
            <History goal={goal.label} entries={p.history} onNotice={onNotice} />
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/** Only what changed is sent, so an untouched date on a past-due goal is not re-checked. */
function editFrom(goal: GoalView['goal'], fields: GoalFields) {
  const change: { label?: string; target?: string; saved?: string; targetDate?: string | null } = {};
  if (fields.label.trim() !== goal.label) change.label = fields.label;
  if (fields.target !== asTyped(goal.targetPaise)) change.target = fields.target;
  if (fields.saved !== (goal.openingPaise > 0 ? asTyped(goal.openingPaise) : '')) {
    change.saved = fields.saved;
  }
  if (fields.targetDate !== (goal.targetDate ?? '')) change.targetDate = fields.targetDate || null;
  return change;
}

function AmountForm({
  id,
  label,
  action,
  hint,
  pending,
  onCancel,
  onSubmit,
}: {
  id: string;
  label: string;
  action: string;
  hint?: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (amount: string) => void;
}) {
  const [amount, setAmount] = useState('');

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
        <input
          id={id}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="5000"
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={`data ${inputClass} min-w-0 flex-1`}
          style={inputStyle}
        />
        {/* Full-size buttons throughout: 44px targets, used one-handed. */}
        <Button disabled={pending || !amount.trim()} onClick={() => onSubmit(amount)}>
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : action}
        </Button>
        <Button variant="quiet" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Every movement in and out, so a mistake can be found and taken back.
 *
 * Money in is a spend and is removed the way any spend is — its removal lands
 * in the spend history. Money out is removed from here only.
 */
function History({
  goal,
  entries,
  onNotice,
}: {
  goal: string;
  entries: GoalEntry[];
  onNotice: (notice: Notice) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove(entry: GoalEntry) {
    startTransition(async () => {
      const result =
        entry.kind === 'in' ? await deleteSpend(entry.id) : await removeSavingsWithdrawal(entry.id);
      startTransition(() => {
        onNotice(toNotice(result));
        setConfirming(null);
      });
    });
  }

  const shown = entries.slice(0, HISTORY_SHOWN);

  return (
    <details className="mt-2">
      <summary
        className="inline-flex min-h-9 cursor-pointer list-none items-center text-[13px] font-medium"
        style={{ color: 'var(--primary-dark)' }}
      >
        History ({entries.length})
      </summary>

      <ul className="mt-1">
        {shown.map((entry) => {
          const sign = entry.kind === 'in' ? '+' : '−';
          const what = entry.kind === 'in' ? 'Added' : 'Taken out';
          const label = `${what} ${formatRupees(entry.amountPaise)} on ${shortDate(entry.on)}`;

          return (
            <li key={`${entry.kind}-${entry.id}`} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
                  {what}
                  {entry.note && entry.note !== goal ? (
                    <span style={{ color: 'var(--fg-subtle)' }}> · {entry.note}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center">
                  <span
                    className="data text-[13px] font-semibold"
                    style={{ color: entry.kind === 'in' ? 'var(--fg)' : 'var(--fg-muted)' }}
                  >
                    {sign}
                    {formatRupees(entry.amountPaise)}
                  </span>
                  <span className="data ml-2 text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
                    {shortDate(entry.on)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove: ${label}`}
                    aria-expanded={confirming === entry.id}
                    onClick={() => setConfirming(confirming === entry.id ? null : entry.id)}
                    className="flex size-11 cursor-pointer items-center justify-center rounded-[10px]"
                    style={{ color: 'var(--fg-subtle)' }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </span>
              </div>

              {confirming === entry.id ? (
                <div
                  className="mb-2 flex flex-wrap items-center gap-2 p-3"
                  style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
                >
                  <span className="flex-1 text-sm">
                    {entry.kind === 'in'
                      ? 'Remove this? It comes off the goal and out of your spending records.'
                      : 'Remove this? The money counts as saved again.'}
                  </span>
                  <Button variant="danger" size="sm" disabled={pending} onClick={() => remove(entry)}>
                    {pending ? 'Removing…' : 'Remove'}
                  </Button>
                  <Button variant="quiet" size="sm" disabled={pending} onClick={() => setConfirming(null)}>
                    Keep
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {entries.length > HISTORY_SHOWN ? (
        <p className="mt-1.5 text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
          The {HISTORY_SHOWN} most recent of {entries.length}.
        </p>
      ) : null}
    </details>
  );
}

interface GoalFields {
  label: string;
  target: string;
  saved: string;
  targetDate: string;
}

function GoalForm({
  idPrefix: prefix,
  initial,
  submitLabel,
  submit,
  onCancel,
  onDone,
}: {
  /** Distinct per form: an edit form can be open beside the add form. */
  idPrefix: string;
  initial?: GoalFields;
  submitLabel: string;
  submit: (fields: GoalFields) => Promise<Result>;
  onCancel: () => void;
  onDone: (result: Result) => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [target, setTarget] = useState(initial?.target ?? '');
  const [saved, setSaved] = useState(initial?.saved ?? '');
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? '');
  // A transition rather than a boolean, so "Saving…" lasts until the change is
  // on screen, and the message commits with it (see GoalRow.run).
  const [saving, startTransition] = useTransition();

  function onSubmit() {
    startTransition(async () => {
      const result = await submit({ label, target, saved, targetDate });
      startTransition(() => onDone(result));
    });
  }

  return (
    <div
      className="mt-4 space-y-3 p-3.5"
      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
    >
      <Field label="What are you saving for?" htmlFor={`${prefix}-label`}>
        <input
          id={`${prefix}-label`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder="Emergency fund, deposit, trip…"
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How much do you need?" htmlFor={`${prefix}-target`}>
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id={`${prefix}-target`}
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
          htmlFor={`${prefix}-saved`}
          description={
            initial
              ? 'Money put aside before you added the goal here.'
              : 'Money put aside before today. Leave empty if none.'
          }
        >
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id={`${prefix}-saved`}
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
        htmlFor={`${prefix}-date`}
        description="Optional. Without a date we show when you are likely to get there instead."
      >
        <input
          id={`${prefix}-date`}
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className={`data ${inputClass}`}
          style={inputStyle}
        />
      </Field>

      <div className="flex gap-2">
        <Button disabled={saving || !label.trim() || !target.trim()} onClick={onSubmit}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
            </>
          ) : (
            submitLabel
          )}
        </Button>
        <Button variant="quiet" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
