'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Alert, Button, Field, Section, Why, inputClass, inputStyle } from '@/components/ui';
import { categoryLabel, formatRupees } from '@/lib/engines/money';
import type { SalaryView } from '@/lib/data/salary';
import { classifySpend, recordIncome } from '@/lib/actions/income';

/**
 * Where this month's income went.
 *
 * One stacked bar, because the question is part-to-whole: of what came in, how
 * much went where. Four categorical slots carry the four things money can be
 * for; two further segments are not categories at all and are drawn to look
 * different:
 *
 * - **Not classified** is neutral grey. It is real spending whose purpose we
 *   have not been told, and grey is the honest colour for "unknown kind".
 * - **Not accounted for** is the app's translucent amber band — the same mark
 *   the energy ring uses for an estimate. It is money that arrived and has no
 *   recorded destination, which could be sitting in the account or could have
 *   been spent and never entered. Drawing it as a solid category would imply
 *   we know what it is.
 *
 * Colours come from `--series-1..4`, validated for colour-blind separation on
 * both surfaces. None of them is amber, emerald or red, which already mean
 * uncertain, confirmed and error everywhere else in this app.
 */

interface Segment {
  key: string;
  label: string;
  paise: number;
  /** Background for the bar and the legend swatch. */
  fill: string;
  opacity?: number;
  description: string;
}

export function SalaryPanel({ view, canEdit }: { view: SalaryView; canEdit: boolean }) {
  const { breakdown: b } = view;
  const [adding, setAdding] = useState(!b.hasIncome);
  const [hovered, setHovered] = useState<string | null>(null);

  const unaccounted = Math.max(0, b.unaccountedPaise);

  const segments: Segment[] = [
    {
      key: 'obligation',
      label: 'Already spoken for',
      paise: b.byIntent.obligation,
      fill: 'var(--series-1)',
      description: 'Rent, bills and similar — owed before any choice.',
    },
    {
      key: 'need',
      label: 'Needs',
      paise: b.byIntent.need,
      fill: 'var(--series-2)',
      description: 'Groceries, travel, medical, household.',
    },
    {
      key: 'want',
      label: 'Wants',
      paise: b.byIntent.want,
      fill: 'var(--series-3)',
      description: 'Eating out, entertainment.',
    },
    {
      key: 'savings',
      label: 'Set aside',
      paise: b.byIntent.savings,
      fill: 'var(--series-4)',
      description: 'Money moved into savings.',
    },
    {
      key: 'unclassified',
      label: 'Not classified',
      paise: b.byIntent.unclassified,
      fill: 'var(--fg-subtle)',
      opacity: 0.55,
      description: 'Spending we have not been told the purpose of.',
    },
    {
      key: 'unaccounted',
      label: 'Not accounted for',
      paise: unaccounted,
      fill: 'var(--signal)',
      opacity: 0.35,
      description: 'Arrived with no recorded destination — still with you, or spent and not recorded.',
    },
  ].filter((s) => s.paise > 0);

  const outgoings = b.incomePaise - b.unaccountedPaise;
  // When more went out than came in, the bar is scaled to what went out and a
  // tick marks where income ran out — the overspend is shown, not clipped.
  const scale = Math.max(b.incomePaise, outgoings, 1);
  const incomeTickAt = b.unaccountedPaise < 0 ? (b.incomePaise / scale) * 100 : null;

  const active = segments.find((s) => s.key === hovered) ?? null;

  return (
    <Section title="Where your income went">
      {b.hasIncome ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="data text-[26px] font-semibold leading-none">
              {formatRupees(b.incomePaise)}
            </span>
            <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
              came in this month
            </span>
          </div>

          <p className="measure mt-2 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            {b.headline}
          </p>

          {/* ---------------- The bar ---------------- */}
          <div className="relative mt-4">
            <div
              className="flex h-4 w-full overflow-hidden"
              style={{ gap: 2, borderRadius: 4, background: 'var(--surface)' }}
              role="img"
              aria-label={`Income breakdown: ${segments
                .map((s) => `${s.label} ${formatRupees(s.paise)}`)
                .join(', ')}`}
            >
              {segments.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-label={`${s.label}: ${formatRupees(s.paise)}`}
                  onPointerEnter={() => setHovered(s.key)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(s.key)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setHovered(hovered === s.key ? null : s.key)}
                  className="h-full cursor-pointer transition-[filter] duration-150"
                  style={{
                    width: `${(s.paise / scale) * 100}%`,
                    // Tiny segments still exist on screen, so they can be hovered.
                    minWidth: 3,
                    background: s.fill,
                    opacity: s.opacity ?? 1,
                    filter: hovered && hovered !== s.key ? 'saturate(0.35) brightness(1.08)' : undefined,
                  }}
                />
              ))}
            </div>

            {incomeTickAt !== null ? (
              <div
                aria-hidden
                className="absolute -top-1.5 h-7 w-0.5"
                style={{ left: `${incomeTickAt}%`, background: 'var(--fg)' }}
              />
            ) : null}
          </div>

          {/* One tooltip, fixed under the bar: readable on a phone, where a
              floating tooltip would sit under the thumb. */}
          <p
            className="mt-2 min-h-5 text-[13px]"
            style={{ color: 'var(--fg-muted)' }}
            aria-live="polite"
          >
            {active ? (
              <>
                <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{active.label}</span>{' '}
                <span className="data">
                  {formatRupees(active.paise)}
                  {b.incomePaise > 0 ? ` · ${Math.round((active.paise / b.incomePaise) * 100)}%` : ''}
                </span>{' '}
                — {active.description}
              </>
            ) : incomeTickAt !== null ? (
              'The mark shows where this month’s income ran out.'
            ) : (
              'Tap a section for details.'
            )}
          </p>

          {/* ---------------- Legend, which is also the table view ----------------
              Every value is here in text, so nothing depends on telling the
              colours apart. */}
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">Income breakdown for this month</caption>
            <tbody>
              {segments.map((s) => (
                <tr
                  key={s.key}
                  className="border-b last:border-0"
                  style={{ borderColor: 'var(--line)' }}
                  onPointerEnter={() => setHovered(s.key)}
                  onPointerLeave={() => setHovered(null)}
                >
                  <th scope="row" className="py-1.5 text-left font-normal">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block size-2.5 shrink-0 rounded-sm"
                        style={{ background: s.fill, opacity: s.opacity ?? 1 }}
                      />
                      {s.label}
                    </span>
                  </th>
                  <td className="data py-1.5 text-right" style={{ fontWeight: 600 }}>
                    {formatRupees(s.paise)}
                  </td>
                  <td
                    className="data w-14 py-1.5 text-right text-[13px]"
                    style={{ color: 'var(--fg-subtle)' }}
                  >
                    {Math.round((s.paise / b.incomePaise) * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {b.observations.length > 0 ? (
            <ul className="measure mt-4 space-y-1.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
              {b.observations.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          ) : null}

          {view.trend.message ? (
            <p className="mt-3 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
              {view.trend.message}
            </p>
          ) : null}
        </>
      ) : (
        <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          {b.headline}
        </p>
      )}

      {canEdit && view.unclassified.length > 0 ? (
        <Classify items={view.unclassified} />
      ) : null}

      {canEdit ? (
        adding ? (
          <IncomeForm sources={view.sources} onDone={() => setAdding(false)} />
        ) : (
          <Button className="mt-4" variant="ghost" fullWidth onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Record money that came in
          </Button>
        )
      ) : null}

      <Why label="What does “not accounted for” mean?">
        <p>
          It is what came in, minus everything recorded going out. Without your bank balance we
          cannot tell whether that money is still in your account or was spent and never entered
          here — so we do not call it “remaining”.
        </p>
        <p className="mt-2">
          Some categories can honestly be either a need or a want — clothes, gifts, education. We do
          not guess those; tell us below and the figures update.
        </p>
      </Why>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function Classify({ items }: { items: SalaryView['unclassified'] }) {
  const [done, setDone] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const remaining = items.filter((i) => !done.includes(i.id));
  if (remaining.length === 0) return null;

  function set(id: string, intent: 'need' | 'want') {
    setDone((d) => [...d, id]);
    startTransition(async () => {
      const result = await classifySpend({ id, intent });
      if (!result.ok) setDone((d) => d.filter((x) => x !== id));
    });
  }

  return (
    <div
      className="mt-4 p-3.5"
      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
    >
      <p className="text-sm font-medium">Need or want?</p>
      <p className="mt-0.5 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
        These could be either, so we have not guessed.
      </p>
      <ul className="mt-2.5 space-y-2">
        {remaining.map((item) => (
          /* Stacked below the sm breakpoint, in a row above it — decided by the
             viewport rather than by flex-wrap. Wrapping on content width made
             a long label drop its buttons onto a new line while a short one
             kept them inline, so neighbouring rows looked unrelated. */
          <li
            key={item.id}
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="min-w-0 text-sm">
              {categoryLabel(item.category)}
              {item.note ? (
                <span style={{ color: 'var(--fg-subtle)' }}> · {item.note}</span>
              ) : null}{' '}
              <span className="data" style={{ fontWeight: 600 }}>
                {formatRupees(item.amountPaise)}
              </span>
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => set(item.id, 'need')}>
                Need
              </Button>
              <Button size="sm" variant="ghost" onClick={() => set(item.id, 'want')}>
                Want
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IncomeForm({
  sources,
  onDone,
}: {
  sources: SalaryView['sources'];
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState(sources[0]?.label ?? 'Salary');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const existing = sources.find((s) => s.label.toLowerCase() === label.trim().toLowerCase());
    const result = await recordIncome({
      amount,
      receivedOn: date,
      ...(existing ? { sourceId: existing.id } : { sourceLabel: label.trim() }),
      kind: /salary/i.test(label) ? 'salary' : 'other',
    });
    setSaving(false);
    if (result.ok) {
      setAmount('');
      onDone();
    } else {
      setError(result.error);
    }
  }

  return (
    <div
      className="mt-4 space-y-3 p-3.5"
      style={{ background: 'var(--bg)', borderRadius: 'var(--radius-control)' }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How much came in?" htmlFor="inc-amount">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--fg-subtle)' }}>₹</span>
            <input
              id="inc-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="50000"
              className={`data ${inputClass}`}
              style={inputStyle}
            />
          </div>
        </Field>

        <Field label="On" htmlFor="inc-date">
          <input
            id="inc-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`data ${inputClass}`}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field
        label="From"
        htmlFor="inc-source"
        description="Use the same name each month and it builds a history."
      >
        <input
          id="inc-source"
          list="inc-sources"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          className={inputClass}
          style={inputStyle}
        />
        <datalist id="inc-sources">
          {sources.map((s) => (
            <option key={s.id} value={s.label} />
          ))}
        </datalist>
      </Field>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button fullWidth disabled={saving || !amount.trim() || !label.trim()} onClick={submit}>
        {saving ? (
          <>
            <Loader2 size={16} className="animate-spin" aria-hidden /> Saving…
          </>
        ) : (
          'Record it'
        )}
      </Button>
    </div>
  );
}
