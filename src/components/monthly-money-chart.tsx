'use client';

import { useState } from 'react';
import { formatRupees } from '@/lib/engines/money';
import type { MonthStat } from '@/lib/engines/money-trends';

/**
 * Month by month: where spending went, what was set aside, and what came in.
 *
 * One stacked column per money-month, on one rupee axis. The segments use the
 * same colours for the same things as "Where your income went", so a colour
 * learned on the money screen means the same here. Income is a line across its
 * column rather than a bar of its own: it is the level the stack is measured
 * against, not another thing money went on.
 *
 * Built from HTML boxes rather than an SVG viewBox, so axis text stays the
 * same size at every width instead of scaling up with the chart.
 *
 * The current month is drawn lighter and labelled "so far", and a month that
 * recording began partway through is labelled "part" — both are shown so the
 * picture is complete, and neither is ever compared.
 */

interface Series {
  key: 'obligation' | 'need' | 'want' | 'unclassified' | 'saved';
  label: string;
  fill: string;
  opacity?: number;
}

// Bottom to top. Set aside sits on top: it is kept, not spent.
const SERIES: Series[] = [
  { key: 'obligation', label: 'Already spoken for', fill: 'var(--series-1)' },
  { key: 'need', label: 'Needs', fill: 'var(--series-2)' },
  { key: 'want', label: 'Wants', fill: 'var(--series-3)' },
  { key: 'unclassified', label: 'Not classified', fill: 'var(--fg-subtle)', opacity: 0.55 },
  { key: 'saved', label: 'Set aside', fill: 'var(--series-4)' },
];

const value = (m: MonthStat, key: Series['key']) => (key === 'saved' ? m.savedPaise : m.byIntent[key]);

const HEIGHT = 180;

/**
 * A round axis top with a little room above the tallest mark, so an income
 * line level with the largest value does not vanish into the top gridline.
 */
function niceCeiling(paise: number): number {
  const rupees = Math.max(1, (paise * 1.08) / 100);
  const power = 10 ** Math.floor(Math.log10(rupees));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * power >= rupees) ?? 10;
  return step * power * 100;
}

const tick = (paise: number) =>
  paise >= 10_000_000 ? `₹${(paise / 10_000_000).toFixed(paise % 10_000_000 === 0 ? 0 : 1)}L` : paise >= 100_000 ? `₹${Math.round(paise / 100_000)}k` : formatRupees(paise);

const note = (m: MonthStat) => (m.status === 'current' ? 'so far' : m.status === 'partial' ? 'part' : null);

export function MonthlyMoneyChart({ months }: { months: MonthStat[] }) {
  const [active, setActive] = useState<string | null>(null);

  const top = niceCeiling(
    Math.max(1, ...months.map((m) => Math.max(m.spendingPaise + m.savedPaise, m.incomePaise))),
  );
  const pct = (paise: number) => (paise / top) * 100;
  const hasIncome = months.some((m) => m.incomePaise > 0);
  const shown = SERIES.filter((s) => months.some((m) => value(m, s.key) > 0));

  const current = months.find((m) => m.start === active) ?? null;

  return (
    <figure>
      {/* Legend first: identity never depends on matching colours by eye. */}
      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
        {shown.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-sm"
              style={{ background: s.fill, opacity: s.opacity ?? 1 }}
            />
            {s.label}
          </li>
        ))}
        {hasIncome ? (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3.5" style={{ background: 'var(--fg)' }} />
            Came in
          </li>
        ) : null}
      </ul>

      <div className="flex gap-2">
        {/* Axis: three round values, recessive. */}
        <div
          aria-hidden
          className="data relative shrink-0 text-right text-[11px]"
          style={{ height: HEIGHT, width: 38, color: 'var(--fg-subtle)' }}
        >
          {[top, top / 2, 0].map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - pct(t)}%` }}>
              {tick(t)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: HEIGHT }}>
            {[top, top / 2, 0].map((t) => (
              <div
                key={t}
                aria-hidden
                className="absolute inset-x-0 h-px"
                style={{ top: `${100 - pct(t)}%`, background: 'var(--line)' }}
              />
            ))}

            <div
              className="absolute inset-0 grid"
              style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}
            >
              {months.map((m) => {
                const faded = m.status !== 'complete';
                const segments = SERIES.map((s) => ({ ...s, paise: value(m, s.key) })).filter((s) => s.paise > 0);
                const isActive = active === m.start;

                return (
                  <button
                    key={m.start}
                    type="button"
                    // The whole column band is the target, not the painted bar.
                    aria-label={`${m.label}${note(m) ? ` (${note(m)})` : ''}: ${formatRupees(m.spendingPaise)} spent, ${formatRupees(m.savedPaise)} set aside${m.incomePaise > 0 ? `, ${formatRupees(m.incomePaise)} came in` : ''}`}
                    aria-pressed={isActive}
                    onPointerEnter={() => setActive(m.start)}
                    onFocus={() => setActive(m.start)}
                    onClick={() => setActive(isActive ? null : m.start)}
                    className="relative h-full cursor-pointer rounded-md outline-offset-2"
                    style={{ background: isActive ? 'var(--ground)' : undefined }}
                  >
                    {/* The stack. A 2px surface gap separates segments; only the
                        top end is rounded, square at the baseline. */}
                    <span
                      aria-hidden
                      className="absolute bottom-0 left-1/2 flex w-6 max-w-[70%] -translate-x-1/2 flex-col-reverse overflow-hidden"
                      style={{
                        height: `${pct(m.spendingPaise + m.savedPaise)}%`,
                        gap: 2,
                        borderRadius: '4px 4px 0 0',
                        opacity: faded ? 0.45 : 1,
                      }}
                    >
                      {segments.map((s) => (
                        <span
                          key={s.key}
                          className="block w-full shrink-0"
                          style={{
                            // Heights are shares of the stack; the gaps come out of them.
                            flexGrow: s.paise,
                            flexBasis: 0,
                            minHeight: 2,
                            background: s.fill,
                            opacity: s.opacity ?? 1,
                          }}
                        />
                      ))}
                    </span>

                    {m.incomePaise > 0 ? (
                      <span
                        aria-hidden
                        className="absolute left-1/2 h-0.5 w-9 max-w-[95%] -translate-x-1/2"
                        style={{ bottom: `calc(${pct(m.incomePaise)}% - 1px)`, background: 'var(--fg)' }}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            aria-hidden
            className="mt-1.5 grid text-center text-[11px] leading-tight"
            style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, color: 'var(--fg-subtle)' }}
          >
            {months.map((m) => (
              <span key={m.start} className="min-w-0 truncate">
                <span style={{ color: active === m.start ? 'var(--fg)' : undefined }}>{m.shortLabel}</span>
                {note(m) ? <span className="block">{note(m)}</span> : null}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* One readout, fixed under the chart: on a phone a floating tooltip
          would sit under the thumb. Values lead, labels follow. */}
      <div className="mt-3 min-h-[3.25rem] text-[13px]" aria-live="polite" style={{ color: 'var(--fg-muted)' }}>
        {current ? (
          <>
            <p>
              <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{current.label}</span>
              {note(current) ? ` — ${note(current)}` : ''}
              {': '}
              <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                {formatRupees(current.spendingPaise)}
              </span>{' '}
              spent
              {current.savedPaise > 0 ? (
                <>
                  ,{' '}
                  <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                    {formatRupees(current.savedPaise)}
                  </span>{' '}
                  set aside
                </>
              ) : null}
              {current.incomePaise > 0 ? (
                <>
                  , of{' '}
                  <span className="data" style={{ color: 'var(--fg)', fontWeight: 600 }}>
                    {formatRupees(current.incomePaise)}
                  </span>{' '}
                  that came in
                </>
              ) : null}
              .
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {SERIES.filter((s) => value(current, s.key) > 0).map((s) => (
                <li key={s.key} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-3"
                    style={{ background: s.fill, opacity: s.opacity ?? 1 }}
                  />
                  <span className="data" style={{ color: 'var(--fg)' }}>
                    {formatRupees(value(current, s.key))}
                  </span>{' '}
                  {s.label.toLowerCase()}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>Tap or hover over a month for its breakdown.</p>
        )}
      </div>

      <details className="mt-2">
        <summary
          className="inline-flex min-h-9 cursor-pointer list-none items-center text-[13px] font-medium"
          style={{ color: 'var(--primary-dark)' }}
        >
          Show as a table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-[13px]">
            <caption className="sr-only">Spending, savings and income by month</caption>
            <thead style={{ color: 'var(--fg-subtle)' }}>
              <tr className="border-b" style={{ borderColor: 'var(--line)' }}>
                <th scope="col" className="py-1.5 text-left font-medium">
                  Month
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Spent
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Set aside
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Came in
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Not accounted for
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.start} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {m.label}
                    {note(m) ? <span style={{ color: 'var(--fg-subtle)' }}> · {note(m)}</span> : null}
                  </th>
                  <td className="data py-1.5 text-right">{formatRupees(m.spendingPaise)}</td>
                  <td className="data py-1.5 text-right">{formatRupees(m.savedPaise)}</td>
                  <td className="data py-1.5 text-right">{m.incomePaise > 0 ? formatRupees(m.incomePaise) : '—'}</td>
                  <td className="data py-1.5 text-right">
                    {m.unaccountedPaise === null ? '—' : formatRupees(m.unaccountedPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
