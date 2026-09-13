import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Panel, PageHeader, Section, Stat, Why } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { MonthlyMoneyChart } from '@/components/monthly-money-chart';
import { getMoneyTrends } from '@/lib/data/money-trends';
import { formatRupees } from '@/lib/engines/money';
import type { MoneyTrends } from '@/lib/engines/money-trends';

export const metadata = { title: 'Money trends — FitCoach' };

const pct = (share: number) => `${Math.round(share * 100)}%`;
const about = (paise: number) => formatRupees(Math.round(paise / 100) * 100);

/**
 * How months compare.
 *
 * The money screen answers "where do I stand this month". This answers the
 * question behind it — is this month unusual, what changed, and is the
 * recording getting good enough that the answers can be trusted. Every figure
 * on it is built from full months only; see `money-trends.ts`.
 */
export default async function MoneyTrendsPage() {
  const { isSample, trends: t } = await getMoneyTrends();

  return (
    <>
      <SampleBanner isSample={isSample} />

      <PageHeader
        title="Trends"
        lede="How your months compare. Only full months are compared with each other."
        action={
          <Link
            href="/money"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium"
            style={{ color: 'var(--primary-dark)' }}
          >
            <ArrowLeft size={16} aria-hidden /> This month
          </Link>
        }
      />

      <div className="space-y-4 lg:space-y-5">
        <Panel feature>
          <p className="measure text-[15px] leading-relaxed" style={{ color: 'var(--fg)' }}>
            {t.headline}
          </p>

          {t.enoughHistory ? <Figures t={t} /> : null}
        </Panel>

        <Panel>
          <Section title="Month by month">
            <MonthlyMoneyChart months={t.months} />
          </Section>

          <Why label="How is this worked out?">
            <p>
              Months run the way your money screen runs them — from the 1st, or from the day you set
              as the start of your month.
            </p>
            <p className="mt-2">
              Only full months are compared with each other. This month is compared only with the same
              number of days of last month. A month you started recording partway through is shown,
              but never compared: most of it was not written down, so it would look cheaper than it was.
            </p>
            <p className="mt-2">
              Money set aside as savings is shown, but not counted as spending. Money with no recorded
              destination is what came in minus everything recorded going out; without your bank
              balance there is no telling whether it is still in the account or was spent and not
              recorded, so it is never called “left over”.
            </p>
          </Why>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
          <div className="space-y-4 lg:space-y-5">
            <Panel>
              <Section title="What changed">
                {t.change ? (
                  <>
                    <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                      {t.change.message}
                    </p>
                    {t.change.movers.length > 0 ? (
                      <ul className="mt-3">
                        {t.change.movers.map((m) => {
                          const up = m.toPaise > m.fromPaise;
                          return (
                            <li
                              key={m.category}
                              className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0"
                              style={{ borderColor: 'var(--line)' }}
                            >
                              <span className="text-sm">{m.label}</span>
                              <span className="data text-right text-sm">
                                <span style={{ fontWeight: 600 }}>
                                  {up ? '↑' : '↓'} {formatRupees(Math.abs(m.toPaise - m.fromPaise))}
                                </span>
                                <span className="block text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
                                  {formatRupees(m.fromPaise)} → {formatRupees(m.toPaise)}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                        No single category moved by more than ₹500.
                      </p>
                    )}
                  </>
                ) : (
                  <Quiet>Once there are two full months in a row, this shows what moved between them.</Quiet>
                )}
              </Section>
            </Panel>

            <Panel>
              <Section title="Is the picture getting clearer?">
                {t.unaccounted ? (
                  <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                    {t.unaccounted.message}
                  </p>
                ) : (
                  <Quiet>
                    With income recorded for three full months, this shows whether the money with no
                    recorded destination is shrinking.
                  </Quiet>
                )}
                {t.wants ? (
                  <p className="measure mt-3 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                    {t.wants.message}
                  </p>
                ) : null}
                {t.savingsRate ? (
                  <p className="measure mt-3 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                    {t.savingsRate.message}
                  </p>
                ) : null}
              </Section>
            </Panel>
          </div>

          <div className="space-y-4 lg:space-y-5">
            <Panel>
              <Section title="Fixed every month">
                {t.fixedCosts ? (
                  <>
                    <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                      {t.fixedCosts.message}
                    </p>
                    <ul className="mt-3">
                      {t.fixedCosts.items.map((item) => (
                        <li
                          key={item.label}
                          className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0"
                          style={{ borderColor: 'var(--line)' }}
                        >
                          <span className="min-w-0 truncate text-sm">{item.label}</span>
                          <span className="data shrink-0 text-sm">
                            {formatRupees(item.monthlyPaise)}
                            <span style={{ color: 'var(--fg-subtle)' }}> /month</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <Quiet>
                    Add rent, bills and other recurring payments on the money screen and this shows how
                    much of every month they take.
                  </Quiet>
                )}
              </Section>
            </Panel>

            {t.subscriptions ? (
              <Panel>
                <Section title="Subscriptions">
                  <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                    {t.subscriptions.message}
                  </p>
                  <ul className="mt-3">
                    {t.subscriptions.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0"
                        style={{ borderColor: 'var(--line)' }}
                      >
                        <span className="min-w-0 truncate text-sm">{item.label}</span>
                        <span className="data shrink-0 text-right text-sm">
                          <span style={{ fontWeight: 600 }}>{formatRupees(item.yearlyPaise)}</span>
                          <span style={{ color: 'var(--fg-subtle)' }}> a year</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                    Recurring payments filed as fun, or named like a streaming service or membership.
                    A yearly total is easier to weigh than a small monthly one.
                  </p>
                </Section>
              </Panel>
            ) : null}
          </div>
        </div>

      </div>
    </>
  );
}

/** The few numbers worth knowing at a glance. Each appears only when it can be trusted. */
function Figures({ t }: { t: MoneyTrends }) {
  const latestUnaccounted = [...t.months]
    .reverse()
    .find((m) => m.status === 'complete' && m.unaccountedPaise !== null);

  const figures = [
    t.usualSpendingPaise !== null
      ? { label: 'A usual month', value: about(t.usualSpendingPaise), unit: 'spent' }
      : null,
    t.savingsRate ? { label: 'Set aside', value: pct(t.savingsRate.average), unit: 'of income' } : null,
    t.fixedCosts?.share != null ? { label: 'Fixed costs', value: pct(t.fixedCosts.share), unit: 'of income' } : null,
    latestUnaccounted
      ? {
          label: `Not accounted for, ${latestUnaccounted.label}`,
          value: formatRupees(Math.max(0, latestUnaccounted.unaccountedPaise!)),
          unit: undefined,
        }
      : null,
  ].filter((f) => f !== null);

  if (figures.length === 0) return null;

  return (
    <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 border-t pt-5 sm:grid-cols-4" style={{ borderColor: 'var(--line)' }}>
      {figures.map((f) => (
        <Stat key={f.label} label={f.label} value={f.value} unit={f.unit} />
      ))}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return (
    <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
      {children}
    </p>
  );
}
