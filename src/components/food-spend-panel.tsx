import Link from 'next/link';
import { Badge, Section, Why } from '@/components/ui';
import type { FoodCostView } from '@/lib/engines/food-cost';

/**
 * What the month's logged meals are worth, beside what was actually spent.
 *
 * Sits next to the spending totals but is deliberately never added to them.
 * Someone who logs their meals *and* records a grocery shop has described the
 * same money twice; summing the two would inflate their spending and then, as
 * the money screen compares against a monthly limit, tell them they had gone
 * over when they had not.
 *
 * Kept separate, the two numbers are useful precisely because they are
 * independent: a large gap between them is a real signal — food bought and not
 * logged, or meals eaten and not paid for by you.
 */
export function FoodSpendPanel({ view }: { view: FoodCostView }) {
  return (
    <Section title="Food, from your meal log" meta={<Badge tone="signal">Estimate</Badge>}>
      {/*
       * Hidden only when there is genuinely nothing priced.
       *
       * `insufficient` also covers "the log is too partial to compare against
       * a budget", and in that case the figure itself is still real — it is
       * the comparison that is withheld, not the number. Hiding it left the
       * verdict referring to "the figure above" when there was none.
       */}
      {view.entriesPriced === 0 ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          {view.verdict}{' '}
          <Link href="/food" style={{ color: 'var(--primary-dark)' }}>
            Log a meal
          </Link>{' '}
          and this fills in.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="data text-[26px] font-semibold leading-none">
              ₹{view.lowRupees.toLocaleString('en-IN')}–{view.highRupees.toLocaleString('en-IN')}
            </span>
            <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
              this month
            </span>
          </div>

          <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            {view.verdict}
          </p>

          {view.budgetToDateRupees !== null && !view.insufficient ? (
            <p className="mt-1.5 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
              Budget so far this month:{' '}
              <span className="data">₹{view.budgetToDateRupees.toLocaleString('en-IN')}</span> over{' '}
              {view.daysWithData} day{view.daysWithData === 1 ? '' : 's'} logged.
            </p>
          ) : null}
        </>
      )}

      <Why label="Why is this a range?">
        <ul className="list-disc space-y-1 pl-4">
          {view.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>
            This is <strong>not</strong> counted in your spending above. If you also recorded the
            groceries you bought, adding both would count the same money twice.
          </li>
        </ul>
      </Why>
    </Section>
  );
}
