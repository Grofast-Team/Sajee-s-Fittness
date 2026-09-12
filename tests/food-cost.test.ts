import { describe, expect, it } from 'vitest';
import { summariseFoodCost, type FoodCostDay } from '@/lib/engines/food-cost';

const day = (date: string, cost: number | null, priced: number, total: number): FoodCostDay => ({
  date,
  costRupees: cost,
  entriesPriced: priced,
  entriesTotal: total,
});

/** A fortnight of fully-priced days at about ₹140. */
const fortnight = Array.from({ length: 14 }, (_, i) =>
  day(`2026-09-${String(i + 1).padStart(2, '0')}`, 140, 3, 3),
);

describe('summariseFoodCost', () => {
  it('totals the priced days and reports a per-day figure', () => {
    const r = summariseFoodCost({ days: fortnight, dailyBudgetRupees: 150, daysElapsed: 14 });
    expect(r.totalRupees).toBe(1960);
    expect(r.perDayRupees).toBe(140);
    expect(r.insufficient).toBe(false);
  });

  it('reports a range, because these are typical prices and not receipts', () => {
    const r = summariseFoodCost({ days: fortnight, dailyBudgetRupees: 150, daysElapsed: 14 });
    expect(r.lowRupees).toBeLessThan(r.totalRupees);
    expect(r.highRupees).toBeGreaterThan(r.totalRupees);
    // And it can never claim to be certain.
    expect(r.confidence).not.toBe('high' as unknown as typeof r.confidence);
  });

  it('never describes the figure as money spent', () => {
    const r = summariseFoodCost({ days: fortnight, dailyBudgetRupees: 150, daysElapsed: 14 });
    const text = [r.verdict, ...r.caveats].join(' ').toLowerCase();
    expect(text).toMatch(/typical prices/);
    expect(text).not.toMatch(/you spent|you paid/);
  });

  it('treats a small difference as "roughly your budget" rather than inventing precision', () => {
    // ₹145 against ₹150, inside a ±25% price band, is not a real difference.
    const days = fortnight.map((d) => ({ ...d, costRupees: 145 }));
    const r = summariseFoodCost({ days, dailyBudgetRupees: 150, daysElapsed: 14 });
    expect(r.verdict).toMatch(/roughly your/i);
  });

  it('states an overspend factually, without scolding', () => {
    const days = fortnight.map((d) => ({ ...d, costRupees: 260 }));
    const r = summariseFoodCost({ days, dailyBudgetRupees: 150, daysElapsed: 14 });

    expect(r.verdict).toMatch(/over/);
    // No blame, and it leaves open that the budget may be the thing that is wrong.
    expect(r.verdict).not.toMatch(/too much|overspent|failed|should/i);
    expect(r.verdict).toMatch(/the food or the budget/i);
  });

  it('says the total is understated when entries have no price', () => {
    const days = fortnight.map((d) => day(d.date, 90, 2, 3));
    const r = summariseFoodCost({ days, dailyBudgetRupees: 150, daysElapsed: 14 });
    expect(r.entriesUnpriced).toBe(14);
    expect(r.caveats.join(' ')).toMatch(/higher than this/i);
  });

  it('refuses to compare when too few entries are priced', () => {
    // One of four entries priced each day: the total is missing most of the food.
    const days = fortnight.map((d) => day(d.date, 40, 1, 4));
    const r = summariseFoodCost({ days, dailyBudgetRupees: 150, daysElapsed: 14 });

    expect(r.insufficient).toBe(true);
    expect(r.confidence).toBe('low');
    expect(r.verdict).toMatch(/too few/i);
  });

  it('handles having no budget set without pretending there is one', () => {
    const r = summariseFoodCost({ days: fortnight, dailyBudgetRupees: null, daysElapsed: 14 });
    expect(r.budgetToDateRupees).toBeNull();
    expect(r.verdict).toMatch(/not set a food budget/i);
  });

  it('says nothing is logged rather than reporting zero as a result', () => {
    const r = summariseFoodCost({ days: [], dailyBudgetRupees: 150, daysElapsed: 5 });
    expect(r.insufficient).toBe(true);
    expect(r.verdict).toMatch(/nothing logged/i);
  });

  it('prorates the budget to the days elapsed, not the whole month', () => {
    // Five days in, ₹150/day, the fair comparison is ₹750 — not ₹4,500.
    const r = summariseFoodCost({ days: fortnight, dailyBudgetRupees: 150, daysElapsed: 5 });
    expect(r.budgetToDateRupees).toBe(750);
  });
});

describe('partial food logs do not get a budget verdict', () => {
  const days = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    costRupees: 17,
    entriesPriced: 3,
    entriesTotal: 3,
  }));

  it('refuses to claim someone is under budget off a third of their food', () => {
    // This is the real failure mode. Every entry is priced, so the earlier
    // coverage check passes — but the log holds 30% of a day's energy, and
    // "roughly ₹133 a day under" would be confidently wrong in the direction
    // that tells someone to spend more.
    const r = summariseFoodCost({
      days,
      dailyBudgetRupees: 150,
      daysElapsed: 10,
      energyCoverage: 0.3,
    });

    expect(r.verdict).toMatch(/cannot compare/i);
    expect(r.verdict).not.toMatch(/under/);
    expect(r.insufficient).toBe(true);
    // The caveat quantifies the gap; the verdict declines to draw a conclusion.
    expect(r.caveats.join(' ')).toMatch(/30% of your daily energy target/i);
    expect(r.verdict).toMatch(/not reaching the food log/i);
  });

  it('still compares when the log covers most of the day', () => {
    const r = summariseFoodCost({
      days: days.map((d) => ({ ...d, costRupees: 160 })),
      dailyBudgetRupees: 150,
      daysElapsed: 10,
      energyCoverage: 0.9,
    });

    expect(r.verdict).not.toMatch(/cannot compare/i);
    expect(r.insufficient).toBe(false);
  });

  it('compares as before when coverage is unknown', () => {
    // Absent a plan we cannot compute coverage; that must not silently block
    // the feature for everyone.
    const r = summariseFoodCost({
      days: days.map((d) => ({ ...d, costRupees: 160 })),
      dailyBudgetRupees: 150,
      daysElapsed: 10,
      energyCoverage: null,
    });
    expect(r.insufficient).toBe(false);
  });
});
