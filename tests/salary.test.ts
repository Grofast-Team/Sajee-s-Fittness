import { describe, expect, it } from 'vitest';
import { intentFor, salaryTrend, whereDidItGo, type SpendForSalary } from '@/lib/engines/salary';

const spend = (category: string, rupees: number, intent: SpendSalaryIntent = null): SpendForSalary => ({
  category,
  amountPaise: rupees * 100,
  intent,
});
type SpendSalaryIntent = SpendForSalary['intent'];

/** A plausible month on a ₹50,000 salary. */
const month: SpendForSalary[] = [
  spend('rent', 10_000),
  spend('bills', 2_100),
  spend('groceries', 4_200),
  spend('eating_out', 3_400),
  spend('transport', 3_000),
  spend('entertainment', 1_800),
  spend('clothes', 4_500), // genuinely ambiguous
  spend('savings', 5_000),
];

describe('whereDidItGo', () => {
  it('separates spending, saving and what cannot be accounted for', () => {
    const r = whereDidItGo({ incomePaise: 5_000_000, spends: month, incomeCount: 1 });

    expect(r.savedPaise).toBe(500_000);
    expect(r.spentPaise).toBe(2_900_000); // everything except savings
    expect(r.unaccountedPaise).toBe(1_600_000); // 50,000 − 29,000 − 5,000
  });

  /*
   * The reason this engine exists instead of a pie chart. The usual tool calls
   * that last ₹16,000 "remaining"; it is income minus *recorded* spending, and
   * nobody records everything.
   */
  it('never calls unaccounted money "remaining"', () => {
    const r = whereDidItGo({ incomePaise: 5_000_000, spends: month, incomeCount: 1 });

    expect(r.headline).toMatch(/not\s+accounted for/i);
    expect(r.headline).toMatch(/still with you, or spent and not recorded/i);
    expect(r.headline.toLowerCase()).not.toContain('remaining');
  });

  it('says how much was already spoken for before any choice was made', () => {
    const r = whereDidItGo({ incomePaise: 5_000_000, spends: month, incomeCount: 1 });

    expect(r.byIntent.obligation).toBe(1_210_000);
    expect(r.obligationShare).toBeCloseTo(0.242, 3);
    expect(r.observations.join(' ')).toMatch(/already spoken for/);
  });

  it('does not guess whether an ambiguous category was a need or a want', () => {
    const r = whereDidItGo({ incomePaise: 5_000_000, spends: month, incomeCount: 1 });

    // ₹4,500 on clothes could be either; silently calling it a want would
    // inflate the one figure this feature leads with.
    expect(r.byIntent.unclassified).toBe(450_000);
    expect(r.byIntent.want).toBe(520_000); // eating out + entertainment only
  });

  it('reports wants as a floor when some spending is unclassified', () => {
    const r = whereDidItGo({ incomePaise: 5_000_000, spends: month, incomeCount: 1 });
    expect(r.observations.join(' ')).toMatch(/at least ₹5,200/i);
    expect(r.observations.join(' ')).toMatch(/may be higher/i);
  });

  it('honours an explicit classification over the category default', () => {
    // A work laptop bought under "other" was a need, and the user said so.
    const r = whereDidItGo({
      incomePaise: 5_000_000,
      spends: [spend('clothes', 4_500, 'need'), spend('eating_out', 1_000, 'need')],
      incomeCount: 1,
    });
    expect(r.byIntent.need).toBe(550_000);
    expect(r.byIntent.unclassified).toBe(0);
    expect(r.byIntent.want).toBe(0);
  });

  it('computes a savings rate from what was actually set aside', () => {
    const r = whereDidItGo({ incomePaise: 5_000_000, spends: month, incomeCount: 1 });
    expect(r.savingsRate).toBeCloseTo(0.1, 5);
  });

  it('states it plainly when more went out than came in, without blame', () => {
    const r = whereDidItGo({
      incomePaise: 2_000_000,
      spends: [spend('rent', 15_000), spend('eating_out', 9_000)],
      incomeCount: 1,
    });

    expect(r.unaccountedPaise).toBeLessThan(0);
    expect(r.headline).toMatch(/more than arrived/i);
    expect(r.headline).not.toMatch(/overspent|too much|should|careless|failed/i);
  });

  it('asks for income rather than inventing shares without it', () => {
    const r = whereDidItGo({ incomePaise: 0, spends: month, incomeCount: 0 });

    expect(r.hasIncome).toBe(false);
    expect(r.savingsRate).toBeNull();
    expect(r.obligationShare).toBeNull();
    expect(r.byCategory.every((line) => line.share === null)).toBe(true);
    expect(r.headline).toMatch(/record what came in/i);
  });

  it('names the largest outgoing, and does not count savings as one', () => {
    const r = whereDidItGo({
      incomePaise: 5_000_000,
      spends: [spend('savings', 20_000), spend('rent', 10_000)],
      incomeCount: 1,
    });
    expect(r.observations.join(' ')).toMatch(/largest single outgoing was rent/i);
  });

  it('orders categories largest first', () => {
    const r = whereDidItGo({ incomePaise: 5_000_000, spends: month, incomeCount: 1 });
    const amounts = r.byCategory.map((line) => line.paise);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });
});

describe('intentFor', () => {
  it('leaves genuinely ambiguous categories unclassified', () => {
    for (const category of ['clothes', 'gifts', 'education', 'personal_care', 'family', 'other']) {
      expect(intentFor(category, null)).toBeNull();
    }
  });

  it('classifies the unambiguous ones', () => {
    expect(intentFor('rent', null)).toBe('obligation');
    expect(intentFor('groceries', null)).toBe('need');
    expect(intentFor('eating_out', null)).toBe('want');
    expect(intentFor('savings', null)).toBe('savings');
  });
});

describe('salaryTrend', () => {
  const income = (receivedOn: string, rupees: number) => ({ receivedOn, amountPaise: rupees * 100 });

  it('reports growth across complete months', () => {
    const r = salaryTrend(
      [income('2026-01-01', 40_000), income('2026-04-01', 45_000), income('2026-08-01', 50_000)],
      '2026-09-13',
    );
    expect(r.change).toBeCloseTo(0.25, 5);
    expect(r.message).toMatch(/up 25%/);
  });

  /*
   * September has only the salary so far; freelance arrives on the 20th.
   * Comparing it against a full August would report a pay cut that has not
   * happened.
   */
  it('ignores the current, partial month', () => {
    const r = salaryTrend(
      [
        income('2026-07-01', 50_000),
        income('2026-07-20', 8_000),
        income('2026-08-01', 50_000),
        income('2026-08-20', 8_000),
        income('2026-09-01', 50_000), // freelance not in yet
      ],
      '2026-09-13',
    );
    expect(r.message).toMatch(/steady/i);
    expect(r.message).not.toMatch(/down/);
  });

  it('adds up several payments inside one month', () => {
    const r = salaryTrend([income('2026-08-01', 45_000), income('2026-08-20', 7_500)], '2026-09-13');
    expect(r.months.find((m) => m.month === '2026-08')?.paise).toBe(5_250_000);
  });

  it('treats small movements as steady rather than a trend', () => {
    const r = salaryTrend([income('2026-06-01', 50_000), income('2026-08-01', 51_000)], '2026-09-13');
    expect(r.message).toMatch(/steady/i);
  });

  it('says nothing with too little history', () => {
    const r = salaryTrend([income('2026-08-01', 50_000)], '2026-09-13');
    expect(r.change).toBeNull();
    expect(r.message).toBeNull();
  });
});
