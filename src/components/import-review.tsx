'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Alert, Badge, Button, inputStyle } from '@/components/ui';
import { CATEGORIES, categoryLabel, formatRupees, type SpendCategory } from '@/lib/engines/money';
import type { ReviewRow } from '@/lib/data/bank-import';
import { confirmImport, discardImport } from '@/lib/actions/bank-import';

/**
 * Reviewing an import before anything is recorded.
 *
 * Every line starts in the state that is safest to accept without reading:
 * money out ticked, possible duplicates and money in not. Changing one line's
 * category changes the untouched lines from the same merchant too, because
 * that is almost always what was meant — and each changed merchant is
 * remembered for next time when the import is confirmed.
 */

type Tab = 'out' | 'duplicates' | 'in' | 'unreadable' | 'done';

interface Choice {
  include: boolean;
  category: SpendCategory | null;
  /** The person set this line's category themselves. */
  touched: boolean;
}

const SOURCE: Record<string, { text: string; tone: 'neutral' | 'primary' | 'signal' }> = {
  rule: { text: 'You taught this', tone: 'primary' },
  keyword: { text: 'Known merchant', tone: 'neutral' },
  none: { text: 'No suggestion', tone: 'signal' },
  person: { text: 'You chose', tone: 'primary' },
};

const shortDate = (iso: string | null) => (iso ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—');

export function ImportReview({ batchId, rows, confirmed }: { batchId: string; rows: ReviewRow[]; confirmed: boolean }) {
  const router = useRouter();
  const pending = rows.filter((r) => r.status === 'pending');

  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      pending.map((r) => [
        r.id,
        {
          include: r.direction === 'out' && !r.duplicateOfSpend && r.duplicateOfRow === null,
          category: r.category,
          touched: false,
        },
      ]),
    ),
  );
  const [tab, setTab] = useState<Tab>(pending.length > 0 ? 'out' : 'done');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const duplicate = (r: ReviewRow) => r.duplicateOfSpend !== null || r.duplicateOfRow !== null;
  const groups = {
    out: pending.filter((r) => r.direction === 'out' && !duplicate(r)),
    duplicates: pending.filter(duplicate),
    in: pending.filter((r) => r.direction === 'in' && !duplicate(r)),
    unreadable: rows.filter((r) => r.status === 'unreadable'),
    done: rows.filter((r) => r.status === 'imported' || r.status === 'skipped'),
  };

  const included = pending.filter((r) => choices[r.id]?.include);
  const includedOut = included.filter((r) => r.direction === 'out');
  const includedIn = included.filter((r) => r.direction === 'in');
  const outPaise = includedOut.reduce((s, r) => s + (r.amountPaise ?? 0), 0);

  function toggle(id: string, include: boolean) {
    setChoices((c) => ({ ...c, [id]: { ...c[id], include } }));
  }

  function setCategory(row: ReviewRow, category: SpendCategory) {
    setChoices((c) => {
      const next = { ...c, [row.id]: { ...c[row.id], category, touched: true } };
      // The same merchant's other lines follow, unless someone set them by hand.
      if (row.merchantKey !== 'unknown' && row.merchantKey !== 'cash withdrawal') {
        for (const other of pending) {
          if (other.id !== row.id && other.merchantKey === row.merchantKey && other.direction === 'out' && !c[other.id]?.touched) {
            next[other.id] = { ...c[other.id], category };
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
          return {
            rowId: r.id,
            include: choice.include,
            ...(r.direction === 'out' && choice.category && choice.category !== r.category ? { category: choice.category } : {}),
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

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'out', label: 'Money out', count: groups.out.length },
    { key: 'duplicates', label: 'Possible duplicates', count: groups.duplicates.length },
    { key: 'in', label: 'Money in', count: groups.in.length },
    { key: 'unreadable', label: 'Could not read', count: groups.unreadable.length },
    { key: 'done', label: 'Dealt with', count: groups.done.length },
  ];

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
          .filter((t) => t.count > 0 || t.key === 'out')
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
              {t.label} <span className="data">{t.count}</span>
            </button>
          ))}
      </div>

      <p className="measure mb-3 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        {tab === 'out'
          ? 'Ticked lines become spends. A suggested category can be changed; other lines from the same merchant follow.'
          : tab === 'duplicates'
            ? 'These look already recorded — the same amount a day either side of a spend you have, or a line repeated in the file. They are left out unless you tick them.'
            : tab === 'in'
              ? 'Money that came in. Tick any you want recorded as income. Transfers between your own accounts are best left out.'
              : tab === 'unreadable'
                ? 'Lines without a date or amount we could read — usually opening and closing balances. They are kept here, not recorded.'
                : 'Lines already recorded or left out.'}
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
              onToggle={(include) => toggle(row.id, include)}
              onCategory={(category) => setCategory(row, category)}
            />
          ))}
        </ul>
      )}

      {pending.length > 0 ? (
        <div
          className="sticky bottom-20 mt-5 flex flex-col gap-3 border p-3.5 sm:flex-row sm:items-center sm:justify-between md:bottom-4"
          style={{ background: 'var(--surface)', borderColor: 'var(--line)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-sm)' }}
        >
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
              {includedOut.length}
            </span>{' '}
            spend{includedOut.length === 1 ? '' : 's'} ({formatRupees(outPaise)})
            {includedIn.length > 0 ? (
              <>
                {' '}
                and{' '}
                <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                  {includedIn.length}
                </span>{' '}
                in
              </>
            ) : null}{' '}
            ticked, {pending.length - included.length} left out.
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

function Line({
  row,
  choice,
  onToggle,
  onCategory,
}: {
  row: ReviewRow;
  choice: Choice | undefined;
  onToggle: (include: boolean) => void;
  onCategory: (category: SpendCategory) => void;
}) {
  const pending = row.status === 'pending' && choice;
  const source = choice?.touched ? 'person' : row.categorySource;
  const checkboxId = `line-${row.id}`;

  return (
    <li className="border-b py-3 first:pt-0 last:border-0" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-start gap-3">
        {pending ? (
          <input
            id={checkboxId}
            type="checkbox"
            checked={choice.include}
            onChange={(e) => onToggle(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 cursor-pointer"
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
            {row.status === 'imported' ? <Badge tone="confirm">Recorded</Badge> : null}
            {row.status === 'skipped' ? <Badge>Left out</Badge> : null}
          </div>

          {row.problem ? (
            <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
              {row.problem}
            </p>
          ) : null}

          {row.duplicateOfSpend ? (
            <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
              Looks like {formatRupees(row.duplicateOfSpend.amountPaise)} on {shortDate(row.duplicateOfSpend.spentOn)} already recorded
              as {categoryLabel(row.duplicateOfSpend.category).toLowerCase()}
              {row.duplicateOfSpend.note ? ` (${row.duplicateOfSpend.note})` : ''}.
            </p>
          ) : row.duplicateOfRow !== null ? (
            <p className="mt-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
              The same as line {row.duplicateOfRow} of this file.
            </p>
          ) : null}

          {pending && row.direction === 'out' ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label htmlFor={`cat-${row.id}`} className="sr-only">
                Category for line {row.rowNumber}
              </label>
              <select
                id={`cat-${row.id}`}
                value={choice.category ?? 'other'}
                onChange={(e) => onCategory(e.target.value as SpendCategory)}
                className="min-h-10 border px-2.5 text-[13px] outline-none"
                style={inputStyle}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              {source && SOURCE[source] ? <Badge tone={SOURCE[source].tone}>{SOURCE[source].text}</Badge> : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
