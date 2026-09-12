import { Panel, PageHeader, Ring, Section, Why } from '@/components/ui';
import { SampleBanner } from '@/components/sample-banner';
import { SpendEntry } from '@/components/spend-entry';
import { MonthlyLimit } from '@/components/monthly-limit';
import { FoodSpendPanel } from '@/components/food-spend-panel';
import { CommitmentsPanel } from '@/components/commitments-panel';
import { getMoneyMonth } from '@/lib/data/money';
import { getFoodSpend } from '@/lib/data/food-spend';
import { getCommitments } from '@/lib/data/commitments';
import { CATEGORIES, categoryLabel, formatRupees, type CategoryTotal } from '@/lib/engines/money';

/**
 * One category's share of the month.
 *
 * Not the shared `Rail`: that renders whatever number it is given with
 * `toLocaleString`, and these amounts are in paise. Handing it 1250000 printed
 * "12,50,000" next to a bar meaning twelve and a half thousand rupees, which
 * is off by a factor of a hundred and reads as a wrong total rather than a
 * formatting slip. Money needs a bar that knows it is money.
 */
function CategoryBar({ category, totalPaise }: { category: CategoryTotal; totalPaise: number }) {
  const pct = totalPaise > 0 ? (category.paise / totalPaise) * 100 : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">
          <span aria-hidden>{EMOJI.get(category.category as never) ?? '•'}</span> {category.label}
        </span>
        <span className="data shrink-0 text-sm">
          <span style={{ fontWeight: 600 }}>{formatRupees(category.paise)}</span>
          <span style={{ color: 'var(--fg-subtle)' }}> · {Math.round(category.share * 100)}%</span>
        </span>
      </div>
      <div
        className="relative mt-1.5 w-full overflow-hidden"
        style={{ height: 8, background: 'var(--ground)', borderRadius: 8 }}
        role="img"
        aria-label={`${category.label}: ${formatRupees(category.paise)}, ${Math.round(category.share * 100)} percent of this month`}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, background: 'var(--primary)', borderRadius: 8 }}
        />
      </div>
    </div>
  );
}

export const metadata = { title: 'Money — FitCoach' };

const EMOJI = new Map(CATEGORIES.map((c) => [c.id, c.emoji]));

/**
 * The money screen.
 *
 * Deliberately the same shape as the food screen: one big ring for the number
 * that decides everything, the entry form right under it, and the detail
 * below. Someone who has learned to read "calories left" already knows how to
 * read "money left" — reusing the pattern is worth more than a novel layout.
 *
 * Nothing here scolds. Going over is stated with the number and what to do
 * next, never as a failing.
 */
export default async function MoneyPage() {
  const view = await getMoneyMonth();
  const { summary, window } = view;

  /*
   * The food estimate covers the month *so far*, not the whole month.
   *
   * `window.end` is exclusive and sits in the future mid-month; using it would
   * pro-rate the food budget across days that have not happened and make every
   * month look under budget until the last day of it.
   */
  const todayIso = new Date().toISOString().slice(0, 10);
  const [foodSpend, commitments] = await Promise.all([
    getFoodSpend(window.start, todayIso),
    /*
     * `summary.totalPaise` already includes any commitment settled this month,
     * because paying one writes an ordinary spend. The engine subtracts only
     * what is still *outstanding*, so nothing is counted twice.
     */
    getCommitments(
      window.start,
      window.end,
      summary.limitPaise,
      summary.totalPaise,
      window.daysLeft,
    ),
  ]);

  const spent = summary.totalPaise;
  const limit = summary.limitPaise;
  const over = summary.overBudget;

  return (
    <>
      <SampleBanner isSample={view.isSample} />

      <PageHeader
        title="Money"
        lede={`${window.label} — ${window.daysLeft} day${window.daysLeft === 1 ? '' : 's'} left in this month.`}
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          <Panel feature className="sm:flex sm:items-center sm:gap-7">
            <div className="flex justify-center sm:shrink-0">
              <Ring
                label="Spent"
                value={spent}
                // With no limit the ring has nothing to fill against, so it is
                // drawn against what has been spent — a full circle that
                // states the total rather than implying a target.
                target={limit ?? Math.max(spent, 1)}
                unit="₹"
                size="lg"
                hideCaption
                centre={
                  <>
                    <span
                      className="data text-[30px] font-semibold leading-none"
                      style={{ color: over ? 'var(--signal)' : 'var(--fg)' }}
                    >
                      {formatRupees(
                        limit === null ? spent : Math.abs(summary.remainingPaise ?? 0),
                        { compact: true },
                      )}
                    </span>
                    <span className="mt-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
                      {limit === null ? 'spent' : over ? 'over' : 'left'}
                    </span>
                  </>
                }
              />
            </div>

            <div className="mt-5 min-w-0 flex-1 sm:mt-0">
              <p className="text-[15px] leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                {summary.message}
              </p>

              {limit !== null ? (
                <Why label="How this is worked out">
                  <p>
                    You have spent <span className="data">{formatRupees(spent)}</span> of{' '}
                    <span className="data">{formatRupees(limit)}</span> in the{' '}
                    <span className="data">{window.daysElapsed}</span> days since{' '}
                    {window.start.split('-').reverse().join('/')}.
                  </p>
                  <p className="mt-2">
                    That is about <span className="data">{formatRupees(summary.averagePerDayPaise)}</span>{' '}
                    a day so far. Carrying on at that rate would finish the month near{' '}
                    <span className="data">{formatRupees(summary.projectedPaise)}</span>.
                  </p>
                  <p className="mt-2">
                    Only what you have actually recorded is counted here. If something is missing,
                    the total is lower than your real spending — we would rather show you a number
                    you can check than guess at the rest.
                  </p>
                </Why>
              ) : null}
            </div>
          </Panel>

          {/* Directly under the headline figure, because it corrects it: what
              is left is not what is free until the rent is set aside. */}
          {commitments ? (
            <Panel>
              <CommitmentsPanel summary={commitments} canEdit={!view.isSample} />
            </Panel>
          ) : null}

          <Panel>
            <Section title="Add a spend">
              <SpendEntry canSave={!view.isSample} />
            </Section>
          </Panel>

          <Panel>
            <Section title="Your monthly amount">
              <MonthlyLimit
                canSave={!view.isSample}
                currentPaise={limit}
                monthStartDay={view.monthStartDay}
              />
            </Section>
          </Panel>
        </div>

        <div className="space-y-4 lg:space-y-5">
          <Panel>
            <Section
              title="Where it went"
              meta={summary.byCategory.length > 0 ? formatRupees(spent) : undefined}
            >
              {summary.byCategory.length > 0 ? (
                <div className="space-y-3">
                  {summary.byCategory.map((c) => (
                    <CategoryBar key={c.category} category={c} totalPaise={spent} />
                  ))}
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  Nothing recorded yet this month. Add the last thing you paid for and it will
                  appear here.
                </p>
              )}
            </Section>
          </Panel>

          {/* Beside the spending, never inside it — see FoodSpendPanel. */}
          {foodSpend ? (
            <Panel>
              <FoodSpendPanel view={foodSpend} />
            </Panel>
          ) : null}

          <Panel>
            <Section
              title="Recent"
              meta={view.recent.length > 0 ? `${view.recent.length} this month` : undefined}
            >
              {view.recent.length > 0 ? (
                <ul>
                  {view.recent.slice(0, 25).map((s) => (
                    <li
                      key={s.id}
                      className="flex items-baseline justify-between gap-3 border-b py-2.5 first:pt-0 last:border-0 last:pb-0"
                      style={{ borderColor: 'var(--line)' }}
                    >
                      <div className="min-w-0">
                        <span className="text-sm">
                          {EMOJI.get(s.category as never) ?? '•'} {categoryLabel(s.category)}
                        </span>
                        {s.note ? (
                          <span className="ml-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                            {s.note}
                          </span>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="data text-sm font-semibold">
                          {formatRupees(s.amountPaise)}
                        </span>
                        <span
                          className="data ml-2 text-[12px]"
                          style={{ color: 'var(--fg-subtle)' }}
                        >
                          {s.spentOn.slice(8)}/{s.spentOn.slice(5, 7)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
                  Nothing recorded yet.
                </p>
              )}
            </Section>
          </Panel>
        </div>
      </div>
    </>
  );
}
