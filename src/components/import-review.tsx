'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Alert, Badge, Button, inputStyle } from '@/components/ui';
import { CATEGORIES, categoryLabel, formatRupees, type SpendCategory } from '@/lib/engines/money';
import { KINDS_FOR, type LineKind } from '@/lib/engines/bank-import';
import type { ReviewRow } from '@/lib/data/bank-import';
import { confirmImport, discardImport } from '@/lib/actions/bank-import';

/**
 * Reviewing an import before anything is recorded.
 *
 * Every line has a kind — spending, saving, transfer, income or refund — and
 * starts in the state that is safest to accept without reading: duplicates and
 * unexplained money in are left out, and a transfer is kept out of the totals.
 * Changing one line changes the untouched lines from the same merchant too,
 * because that is almost always what was meant, and each change is remembered
 * for next time when the import is confirmed.
 */

type Tab = 'spending' | 'saving' | 'income' | 'transfer' | 'duplicates' | 'unreadable' | 'done';

interface Choice {
  include: boolean;
  kind: LineKind;
  category: SpendCategory;
  goalId: string | null;
  sourceId: string | null;
  /** The person changed this line themselves. */
  touched: boolean;
}

interface Option {
  id: string;
  label: string;
}

const KIND_LABEL: Record<'in' | 'out', Record<LineKind, string>> = {
  out: { expense: 'Spending', saving: 'Saving', transfer: 'Transfer — not spending', income: '', refund: '' },
  in: { expense: '', saving: 'Taken out of savings', transfer: 'Transfer — not income', income: 'Income', refund: 'Refund' },
};

const SOURCE: Record<string, { text: string; tone: 'neutral' | 'primary' | 'signal' }> = {
  rule: { text: 'You taught this', tone: 'primary' },
  keyword: { text: 'Recognised', tone: 'neutral' },
  pair: { text: 'Matched transfer', tone: 'neutral' },
  none: { text: 'No suggestion', tone: 'signal' },
  person: { text: 'You chose', tone: 'primary' },
};

const shortDate = (iso: string | null) => (iso ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—');

const isDuplicate = (r: ReviewRow) => r.duplicateOfSpend !== null || r.duplicateOfIncome !== null || r.duplicateOfRow !== null;

function initialChoice(r: ReviewRow): Choice {
  const kind = r.kind ?? (r.direction === 'out' ? 'expense' : 'income');
  const confident = r.kindSource === 'rule' || r.kindSource === 'keyword' || r.kindSource === 'pair';
  const include =
    !isDuplicate(r) &&
    (r.direction === 'out'
      ? true
      : // A transfer or a refund writes nothing when confirmed; ticking it only
        // files it as what it is.
        kind === 'transfer' ||
        (kind === 'refund' && confident) ||
        (kind === 'income' && confident) ||
        (kind === 'saving' && r.savingsGoalId !== null));
  return {
    include,
    kind,
    category: r.category ?? 'other',
    goalId: r.savingsGoalId,
    sourceId: r.incomeSourceId,
    touched: false,
  };
}

export function ImportReview({
  batchId,
  rows,
  confirmed,
  goals,
  sources,
}: {
  batchId: string;
  rows: ReviewRow[];
  confirmed: boolean;
  goals: Option[];
  sources: Option[];
}) {
  const router = useRouter();
  const pending = rows.filter((r) => r.status === 'pending');

  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(pending.map((r) => [r.id, initialChoice(r)])),
  );
  const [tab, setTab] = useState<Tab>(pending.length > 0 ? 'spending' : 'done');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  // Grouped by what each line was read as, not by the current choice, so a
  // line does not jump to another tab while it is being changed.
  const suggested = (r: ReviewRow) => r.kind ?? (r.direction === 'out' ? 'expense' : 'income');
  const groups: Record<Tab, ReviewRow[]> = {
    spending: pending.filter((r) => !isDuplicate(r) && suggested(r) === 'expense'),
    saving: pending.filter((r) => !isDuplicate(r) && suggested(r) === 'saving'),
    income: pending.filter((r) => !isDuplicate(r) && (suggested(r) === 'income' || suggested(r) === 'refund')),
    transfer: pending.filter((r) => !isDuplicate(r) && suggested(r) === 'transfer'),
    duplicates: pending.filter(isDuplicate),
    unreadable: rows.filter((r) => r.status === 'unreadable'),
    done: rows.filter((r) => r.status === 'imported' || r.status === 'skipped'),
  };

  const included = pending.filter((r) => choices[r.id]?.include);
  const total = (kinds: LineKind[], direction?: 'in' | 'out') =>
    included
      .filter((r) => kinds.includes(choices[r.id].kind) && (!direction || r.direction === direction))
      .reduce((sum, r) => ({ count: sum.count + 1, paise: sum.paise + (r.amountPaise ?? 0) }), { count: 0, paise: 0 });
  const spent = total(['expense']);
  const saved = total(['saving'], 'out');
  const income = total(['income']);
  const transfers = total(['transfer']);

  /** Change one line, and the untouched lines from the same merchant, going the same way. */
  function change(row: ReviewRow, patch: Partial<Choice>) {
    setChoices((c) => {
      const next = { ...c, [row.id]: { ...c[row.id], ...patch, touched: true } };
      if (row.merchantKey !== 'unknown' && row.merchantKey !== 'cash withdrawal') {
        for (const other of pending) {
          if (
            other.id !== row.id &&
            other.merchantKey === row.merchantKey &&
            other.direction === row.direction &&
            !isDuplicate(other) &&
            !c[other.id]?.touched
          ) {
            next[other.id] = { ...c[other.id], ...patch };
          }
        }
      }
      return next;
    });
  }

  function confirm() {
    setNotice(null);
    startTransition(async () => {
      const result = await confirmImport({
        batchId,
        decisions: pending.map((r) => {
          const choice = choices[r.id];
          const initialKind = r.kind ?? (r.direction === 'out' ? 'expense' : 'income');
          return {
            rowId: r.id,
            include: choice.include,
            ...(choice.kind !== initialKind ? { kind: choice.kind } : {}),
            ...(choice.kind === 'expense' && choice.category !== r.category ? { category: choice.category } : {}),
            ...(choice.kind === 'saving' && choice.goalId !== r.savingsGoalId ? { savingsGoalId: choice.goalId } : {}),
            ...(choice.kind === 'income' && choice.sourceId !== r.incomeSourceId ? { incomeSourceId: choice.sourceId } : {}),
          };
        }),
      });
      startTransition(() => {
        setNotice({ ok: result.ok, text: result.ok ? result.message : result.error });
        if (result.ok) setTab('done');
        router.refresh();
      });
    });
  }

  function discard() {
    startTransition(async () => {
      const result = await discardImport(batchId);
      if (result.ok) router.push('/money/import');
      else startTransition(() => setNotice({ ok: false, text: result.error }));
    });
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'spending', label: 'Spending' },
    { key: 'saving', label: 'Saving' },
    { key: 'income', label: 'Money in' },
    { key: 'transfer', label: 'Transfers' },
    { key: 'duplicates', label: 'Possible duplicates' },
    { key: 'unreadable', label: 'Could not read' },
    { key: 'done', label: 'Dealt with' },
  ];

  const HELP: Record<Tab, string> = {
    spending: 'Ticked lines become spends. Change the category, or say a line is really a saving or a transfer; other lines from the same merchant follow.',
    saving:
      'Money put into savings or investments, filed as savings and not counted as spending. Choose the goal it was for. Money coming back out of savings needs a goal to come out of.',
    income:
      'Money that came in. Salary and interest are ticked; anything unexplained is not, because a friend paying you back is not income. A refund is not recorded — refunds are not modelled yet.',
    transfer:
      'Money moving between your own accounts, or paying a credit card bill. Neither is spending or income, so nothing is recorded — the line is kept here with its other side where one was found.',
    duplicates:
      'These look already recorded — the same amount a day either side of a spend or income you have, or a line repeated in the file. They are left out unless you tick them.',
    unreadable: 'Lines without a date or amount we could read — usually opening and closing balances. They are kept here, not recorded.',
    done: 'Lines already recorded or left out.',
  };

  const visible = groups[tab];

  return (
    <div>
      {notice ? (
        <div className="mb-4">
          <Alert tone={notice.ok ? 'success' : 'error'}>{notice.text}</Alert>
        </div>
      ) : null}

      <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Lines by kind">
        {tabs
          .filter((t) => groups[t.key].length > 0 || t.key === 'spending')
          .map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className="min-h-11 shrink-0 cursor-pointer rounded-full px-3.5 text-[13px] font-medium"
              style={{
                background: tab === t.key ? 'var(--primary-light)' : 'transparent',
                color: tab === t.key ? 'var(--primary-dark)' : 'var(--fg-muted)',
              }}
            >
              {t.label} <span className="data">{groups[t.key].length}</span>
            </button>
          ))}
      </div>

      <p className="measure mb-3 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        {HELP[tab]}
      </p>

      {visible.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
          Nothing here.
        </p>
      ) : (
        <ul>
          {visible.map((row) => (
            <Line
              key={row.id}
              row={row}
              choice={choices[row.id]}
              goals={goals}
              sources={sources}
              onChange={(patch) => change(row, patch)}
              onToggle={(include) => setChoices((c) => ({ ...c, [row.id]: { ...c[row.id], include } }))}
            />
          ))}
        </ul>
      )}

      {pending.length > 0 ? (
        <div
          className="sticky bottom-20 mt-5 flex flex-col gap-3 border p-3.5 sm:flex-row sm:items-center sm:justify-between md:bottom-4"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
        >
          <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            <Figure count={spent.count} word="spend" paise={spent.paise} />
            {saved.count > 0 ? (
              <>
                {' · '}
                <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                  {formatRupees(saved.paise)}
                </span>{' '}
                saved
              </>
            ) : null}
            {income.count > 0 ? (
              <>
                {' · '}
                <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                  {formatRupees(income.paise)}
                </span>{' '}
                income
              </>
            ) : null}
            {transfers.count > 0 ? ` · ${transfers.count} transfer${transfers.count === 1 ? '' : 's'} kept out` : ''}
            {' · '}
            {pending.length - included.length} left out
          </p>
          <div className="flex gap-2">
            <Button disabled={busy || included.length === 0} onClick={confirm}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : 'Record ticked lines'}
            </Button>
            {!confirmed ? (
              <Button variant="quiet" disabled={busy} onClick={discard}>
                Discard
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Figure({ count, word, paise }: { count: number; word: string; paise: number }) {
  return (
    <>
      <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
        {count}
      </span>{' '}
      {word}
      {count === 1 ? '' : 's'} ({formatRupees(paise)})
    </>
  );
}

function Line({
  row,
  choice,
  goals,
  sources,
  onChange,
  onToggle,
}: {
  row: ReviewRow;
  choice: Choice | undefined;
  goals: Option[];
  sources: Option[];
  onChange: (patch: Partial<Choice>) => void;
  onToggle: (include: boolean) => void;
}) {
  const pending = row.status === 'pending' && choice && row.direction;
  const checkboxId = `line-${row.id}`;
  const direction = row.direction ?? 'out';
  const needsGoal = pending && choice.kind === 'saving' && direction === 'in' && !choice.goalId;

  const shownKind = choice?.kind ?? row.kind;
  const source =
    choice?.touched || (choice && choice.kind !== row.kind) ? 'person' : shownKind === 'expense' ? row.categorySource : row.kindSource;

  return (
    <li className="border-b py-3 first:pt-0 last:border-0" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-start gap-3">
        {pending ? (
          <input
            id={checkboxId}
            type="checkbox"
            checked={choice.include && !needsGoal}
            disabled={Boolean(needsGoal)}
            onChange={(e) => onToggle(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
            aria-label={`Record line ${row.rowNumber}: ${row.description}`}
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={pending ? checkboxId : undefined} className="min-w-0 break-words text-sm">
              {row.description || <span style={{ color: 'var(--fg-subtle)' }}>No description</span>}
            </label>
            <span className="data shrink-0 text-sm font-semibold">
              {row.amountPaise === null ? '—' : `${row.direction === 'out' ? '−' : '+'}${formatRupees(row.amountPaise)}`}
            </span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
            <span className="data">{shortDate(row.occurredOn)}</span>
            <span>· line {row.rowNumber}</span>
            {row.merchantKey !== 'unknown' ? <span>· {row.merchantKey}</span> : null}
            {row.status !== 'pending' && row.kind ? <span>· {KIND_LABEL[direction][row.kind]}</span> : null}
            {row.status === 'imported' ? <Badge tone="confirm">{row.kind === 'transfer' ? 'Kept out' : 'Recorded'}</Badge> : null}
            {row.status === 'skipped' ? <Badge>Left out</Badge> : null}
          </div>

          {row.problem ? <Note>{row.problem}</Note> : null}

          {row.duplicateOfSpend ? (
            <Note>
              Looks like {formatRupees(row.duplicateOfSpend.amountPaise)} on {shortDate(row.duplicateOfSpend.spentOn)} already
              recorded as {categoryLabel(row.duplicateOfSpend.category).toLowerCase()}
              {row.duplicateOfSpend.note ? ` (${row.duplicateOfSpend.note})` : ''}.
            </Note>
          ) : row.duplicateOfIncome ? (
            <Note>
              Looks like {formatRupees(row.duplicateOfIncome.amountPaise)} received on {shortDate(row.duplicateOfIncome.receivedOn)}{' '}
              is already recorded as income{row.duplicateOfIncome.note ? ` (${row.duplicateOfIncome.note})` : ''}.
            </Note>
          ) : row.duplicateOfRow !== null ? (
            <Note>The same as line {row.duplicateOfRow} of this file.</Note>
          ) : null}

          {row.kindReason && shownKind === row.kind ? <Note>{row.kindReason}</Note> : null}

          {pending ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select
                id={`kind-${row.id}`}
                label={`What line ${row.rowNumber} is`}
                value={choice.kind}
                onChange={(kind) => onChange({ kind: kind as LineKind })}
                options={KINDS_FOR[direction].map((k) => ({ id: k, label: KIND_LABEL[direction][k] }))}
              />

              {choice.kind === 'expense' ? (
                <Select
                  id={`cat-${row.id}`}
                  label={`Category for line ${row.rowNumber}`}
                  value={choice.category}
                  onChange={(category) => onChange({ category: category as SpendCategory })}
                  options={CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
                />
              ) : null}

              {choice.kind === 'saving' ? (
                goals.length > 0 ? (
                  <Select
                    id={`goal-${row.id}`}
                    label={`Savings goal for line ${row.rowNumber}`}
                    value={choice.goalId ?? ''}
                    onChange={(goalId) => onChange({ goalId: goalId || null })}
                    options={[
                      { id: '', label: direction === 'out' ? 'No particular goal' : 'Choose the goal it came out of' },
                      ...goals,
                    ]}
                  />
                ) : (
                  <span className="text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
                    {direction === 'out'
                      ? 'Filed as savings. Add a goal on the money screen to track what it is for.'
                      : 'There is no open goal for this to come out of. File it as a transfer instead.'}
                  </span>
                )
              ) : null}

              {choice.kind === 'income' ? (
                <Select
                  id={`src-${row.id}`}
                  label={`Income source for line ${row.rowNumber}`}
                  value={choice.sourceId ?? ''}
                  onChange={(sourceId) => onChange({ sourceId: sourceId || null })}
                  options={[{ id: '', label: 'One-off, no source' }, ...sources]}
                />
              ) : null}

              {source && SOURCE[source] ? <Badge tone={SOURCE[source].tone}>{SOURCE[source].text}</Badge> : null}
            </div>
          ) : null}

          {row.pairRowNumber !== null ? (
            <Note>Other side: line {row.pairRowNumber} of this file.</Note>
          ) : row.pairRowId && !row.kindReason ? (
            <Note>Other side: a line in another statement you imported.</Note>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
      {children}
    </p>
  );
}

function Select({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-10 max-w-full border px-2.5 text-[13px] outline-none"
        style={inputStyle}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
