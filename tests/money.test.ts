import { describe, expect, it } from 'vitest';
import {
  formatRupees,
  monthWindow,
  parseAmountToPaise,
  summariseMonth,
  type Spend,
} from '@/lib/engines/money';

describe('parseAmountToPaise', () => {
  it('reads plain rupees', () => {
    expect(parseAmountToPaise('250')).toBe(25000);
  });

  it('reads rupees and paise', () => {
    expect(parseAmountToPaise('250.50')).toBe(25050);
  });

  it('treats a single decimal digit as tens of paise', () => {
    // ".5" is fifty paise, not five. Getting this wrong is a 10x error.
    expect(parseAmountToPaise('10.5')).toBe(1050);
  });

  it('accepts what people actually type', () => {
    expect(parseAmountToPaise('₹1,250.75')).toBe(125075);
    expect(parseAmountToPaise(' 99 ')).toBe(9900);
  });

  it('refuses nonsense instead of returning zero', () => {
    // A silently-zeroed amount lands in the total and cannot be spotted later.
    for (const bad of ['', 'abc', '12.34.56', '-50', '0', 'twenty']) {
      expect(parseAmountToPaise(bad)).toBeNull();
    }
  });

  it('stays exact where floating point would not', () => {
    // The classic: 0.1 + 0.2 !== 0.3 in binary floating point.
    const a = parseAmountToPaise('0.10')!;
    const b = parseAmountToPaise('0.20')!;
    expect(a + b).toBe(parseAmountToPaise('0.30'));
  });

  it('survives a long month of small amounts without drift', () => {
    // 300 chai at 12.35 each. Done in rupees as floats this ends in .0000001s.
    const one = parseAmountToPaise('12.35')!;
    let total = 0;
    for (let i = 0; i < 300; i += 1) total += one;
    expect(total).toBe(370500);
    expect(formatRupees(total)).toBe('₹3,705');
  });
});

describe('formatRupees', () => {
  it('drops the paise when they are zero', () => {
    expect(formatRupees(25000)).toBe('₹250');
  });

  it('shows paise when there are any', () => {
    expect(formatRupees(25050)).toBe('₹250.50');
  });

  it('groups in the Indian style', () => {
    expect(formatRupees(1234567800)).toContain('1,23,45,678');
  });

  it('pads a single paisa digit correctly', () => {
    expect(formatRupees(25005)).toBe('₹250.05');
  });
});

describe('monthWindow', () => {
  it('runs the calendar month when it starts on the 1st', () => {
    const w = monthWindow(new Date(2026, 8, 15), 1);
    expect(w.start).toBe('2026-09-01');
    expect(w.end).toBe('2026-10-01');
    expect(w.daysTotal).toBe(30);
    expect(w.daysElapsed).toBe(15);
    expect(w.daysLeft).toBe(15);
  });

  it('runs payday to payday when asked', () => {
    // On the 20th with a 25th start, we are still in the previous window.
    const w = monthWindow(new Date(2026, 8, 20), 25);
    expect(w.start).toBe('2026-08-25');
    expect(w.end).toBe('2026-09-25');
  });

  it('starts a new window on the start day itself', () => {
    const w = monthWindow(new Date(2026, 8, 25), 25);
    expect(w.start).toBe('2026-09-25');
    expect(w.daysElapsed).toBe(1);
  });

  it('handles February without losing days', () => {
    const w = monthWindow(new Date(2026, 1, 10), 1);
    expect(w.start).toBe('2026-02-01');
    expect(w.daysTotal).toBe(28);
  });
});

const spends = (...rows: [number, string][]): Spend[] =>
  rows.map(([rupees, category]) => ({
    amountPaise: rupees * 100,
    category,
    spentOn: '2026-09-05',
  }));

describe('summariseMonth', () => {
  const window = monthWindow(new Date(2026, 8, 15), 1);

  it('totals and ranks by category, biggest first', () => {
    const s = summariseMonth(
      spends([2000, 'groceries'], [500, 'eating_out'], [3000, 'rent'], [300, 'groceries']),
      window,
      null,
    );

    expect(s.totalPaise).toBe(580000);
    expect(s.byCategory[0].category).toBe('rent');
    expect(s.byCategory[1].category).toBe('groceries');
    expect(s.byCategory[1].paise).toBe(230000);
  });

  it('does not invent a limit that was never set', () => {
    const s = summariseMonth(spends([100, 'groceries']), window, null);
    expect(s.limitPaise).toBeNull();
    expect(s.remainingPaise).toBeNull();
    expect(s.overBudget).toBe(false);
    expect(s.message).toMatch(/set a monthly amount/i);
  });

  it('reports what is left and a daily allowance', () => {
    const s = summariseMonth(spends([5000, 'groceries']), window, 1000000);
    expect(s.remainingPaise).toBe(500000);
    // 15 days left, so about 333 a day.
    expect(s.dailyAllowancePaise).toBe(33333);
    expect(s.message).toMatch(/left for the next 15 days/i);
  });

  it('warns while there is still time to act, not only after', () => {
    // Spending fast but not yet over the limit.
    const s = summariseMonth(spends([9000, 'eating_out']), window, 1000000);
    expect(s.overBudget).toBe(false);
    expect(s.message).toMatch(/would finish around/i);
    // And it must not present a run rate as fact.
    expect(s.message).toMatch(/projection, not a prediction/i);
  });

  it('states going over as a fact, without shaming', () => {
    const s = summariseMonth(spends([12000, 'rent']), window, 1000000);
    expect(s.overBudget).toBe(true);
    expect(s.message).toContain('₹2,000');
    expect(s.message).not.toMatch(/failed|bad|should not have|irresponsible|overspent badly/i);
    expect(s.message).toMatch(/rather than worth panicking/i);
  });

  it('asks for a first entry rather than showing an empty zero', () => {
    const s = summariseMonth([], window, 1000000);
    expect(s.totalPaise).toBe(0);
    expect(s.message).toMatch(/nothing recorded/i);
  });

  it('never lets shares drift away from the total', () => {
    const s = summariseMonth(
      spends([1000, 'groceries'], [2000, 'rent'], [3000, 'transport']),
      window,
      null,
    );
    const summed = s.byCategory.reduce((acc, c) => acc + c.paise, 0);
    expect(summed).toBe(s.totalPaise);
    expect(s.byCategory.reduce((acc, c) => acc + c.share, 0)).toBeCloseTo(1, 5);
  });

  it('does not offer a negative daily allowance', () => {
    const s = summariseMonth(spends([15000, 'rent']), window, 1000000);
    expect(s.dailyAllowancePaise).toBe(0);
  });
});
