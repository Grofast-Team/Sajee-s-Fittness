import { describe, expect, it } from 'vitest';
import { goalProgress, type Contribution, type SavingsGoal } from '@/lib/engines/savings';

const TODAY = '2026-09-13';

const goal = (over: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'g1',
  label: 'Emergency fund',
  targetPaise: 10_000_000,
  openingPaise: 0,
  startedOn: '2026-06-01',
  targetDate: null,
  ...over,
});

const add = (spentOn: string, rupees: number): Contribution => ({ spentOn, amountPaise: rupees * 100 });

describe('goalProgress', () => {
  it('adds the opening balance to what has been put in', () => {
    const p = goalProgress(
      goal({ openingPaise: 2_000_000 }),
      [add('2026-07-05', 10_000), add('2026-09-02', 5_000)],
      TODAY,
    );
    expect(p.savedPaise).toBe(3_500_000);
    expect(p.remainingPaise).toBe(6_500_000);
    expect(p.share).toBeCloseTo(0.35);
    expect(p.reached).toBe(false);
  });

  it('caps progress at the target and stops asking for more', () => {
    const p = goalProgress(goal({ openingPaise: 9_000_000, targetDate: '2026-12-31' }), [add('2026-09-01', 20_000)], TODAY);
    expect(p.savedPaise).toBe(11_000_000);
    expect(p.share).toBe(1);
    expect(p.reached).toBe(true);
    expect(p.remainingPaise).toBe(0);
    expect(p.requiredMonthlyPaise).toBeNull();
    expect(p.projectedMonth).toBeNull();
    expect(p.message).toMatch(/^Reached/);
  });

  /*
   * The honesty rule from the roadmap. A goal started on 20 July has one full
   * month behind it (August). One deposit is not a pace, and a finish date
   * extrapolated from it would be a guess stated as a forecast.
   */
  it('reports no pace before two full months of history', () => {
    const p = goalProgress(goal({ startedOn: '2026-07-20' }), [add('2026-07-25', 50_000)], TODAY);
    expect(p.fullMonths).toBe(1);
    expect(p.averageMonthlyPaise).toBeNull();
    expect(p.projectedMonth).toBeNull();
    expect(p.onTrack).toBeNull();
    expect(p.message).toMatch(/two full months/);
  });

  it('leaves the partial first month and the current month out of the pace', () => {
    const p = goalProgress(
      goal({ startedOn: '2026-06-15' }),
      [add('2026-06-20', 9_000), add('2026-07-10', 4_000), add('2026-08-10', 6_000), add('2026-09-05', 50_000)],
      TODAY,
    );
    expect(p.fullMonths).toBe(2); // July and August
    expect(p.averageMonthlyPaise).toBe(500_000);
    // Every contribution still counts towards what has been saved.
    expect(p.savedPaise).toBe(6_900_000);
  });

  it('counts a month with nothing added as a zero', () => {
    const p = goalProgress(goal(), [add('2026-06-10', 6_000), add('2026-08-10', 3_000)], TODAY);
    expect(p.fullMonths).toBe(3); // June, July, August
    expect(p.averageMonthlyPaise).toBe(300_000);
  });

  it('works out what each month needs, starting next month', () => {
    // ₹60,000 to go; October, November and December are left.
    const p = goalProgress(goal({ openingPaise: 4_000_000, targetDate: '2026-12-31' }), [], TODAY);
    expect(p.requiredMonthlyPaise).toBe(2_000_000);
  });

  it('rounds the monthly amount up to a whole rupee', () => {
    // ₹1,000 over three months is ₹333.33…; ₹334 is what actually gets there.
    const p = goalProgress(goal({ targetPaise: 100_000, targetDate: '2026-12-31' }), [], TODAY);
    expect(p.requiredMonthlyPaise).toBe(33_400);
  });

  it('treats a date later this month as one month', () => {
    const p = goalProgress(goal({ targetPaise: 1_000_000, targetDate: '2026-09-30' }), [], TODAY);
    expect(p.requiredMonthlyPaise).toBe(1_000_000);
  });

  it('says when the usual pace meets the date', () => {
    const p = goalProgress(
      goal({ targetPaise: 16_000_000, openingPaise: 4_000_000, targetDate: '2026-12-31' }),
      [add('2026-06-10', 20_000), add('2026-07-10', 20_000), add('2026-08-10', 20_000)],
      TODAY,
    );
    expect(p.remainingPaise).toBe(6_000_000);
    expect(p.averageMonthlyPaise).toBe(2_000_000);
    expect(p.projectedMonth).toBe('2026-12');
    expect(p.onTrack).toBe(true);
    expect(p.gapMonthlyPaise).toBe(0);
    expect(p.message).toContain('gets you there by 31 Dec 2026');
  });

  it('states the monthly gap when the usual pace falls short', () => {
    const p = goalProgress(
      goal({ targetPaise: 16_000_000, openingPaise: 4_000_000, targetDate: '2026-12-31' }),
      [add('2026-06-10', 15_000), add('2026-07-10', 15_000), add('2026-08-10', 15_000)],
      TODAY,
    );
    expect(p.remainingPaise).toBe(7_500_000);
    expect(p.requiredMonthlyPaise).toBe(2_500_000);
    expect(p.averageMonthlyPaise).toBe(1_500_000);
    expect(p.projectedMonth).toBe('2027-02');
    expect(p.onTrack).toBe(false);
    expect(p.gapMonthlyPaise).toBe(1_000_000);
    expect(p.message).toContain('₹10,000 more');
    expect(p.message).toContain('February 2027');
  });

  it('gives a likely month instead of a monthly amount when there is no date', () => {
    const p = goalProgress(
      goal(),
      [add('2026-06-10', 20_000), add('2026-07-10', 20_000), add('2026-08-10', 20_000)],
      TODAY,
    );
    expect(p.requiredMonthlyPaise).toBeNull();
    expect(p.projectedMonth).toBe('2026-11');
    expect(p.onTrack).toBeNull();
    expect(p.gapMonthlyPaise).toBeNull();
  });

  it('says plainly when the date has passed, without asking for an amount', () => {
    const p = goalProgress(goal({ targetDate: '2026-08-31' }), [add('2026-07-10', 1_000)], TODAY);
    expect(p.pastDate).toBe(true);
    expect(p.requiredMonthlyPaise).toBeNull();
    expect(p.onTrack).toBeNull();
    expect(p.message).toMatch(/has passed/);
  });

  it('does not project a finish from a pace of nothing', () => {
    const p = goalProgress(goal(), [], TODAY);
    expect(p.averageMonthlyPaise).toBe(0);
    expect(p.projectedMonth).toBeNull();
    expect(p.message).toMatch(/Nothing has been added in the 3 full months/);
  });

  it('keeps every amount a whole number of paise', () => {
    const p = goalProgress(
      goal({ targetPaise: 9_999_999, targetDate: '2027-03-15' }),
      [
        { spentOn: '2026-06-03', amountPaise: 333_333 },
        { spentOn: '2026-07-03', amountPaise: 333_334 },
        { spentOn: '2026-08-03', amountPaise: 1 },
      ],
      TODAY,
    );
    for (const value of [p.requiredMonthlyPaise, p.averageMonthlyPaise, p.gapMonthlyPaise]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('never scolds', () => {
    const scenarios = [
      goalProgress(goal({ startedOn: '2026-07-20' }), [], TODAY),
      goalProgress(goal(), [], TODAY),
      goalProgress(goal({ targetDate: '2026-08-31' }), [], TODAY),
      goalProgress(
        goal({ targetPaise: 16_000_000, targetDate: '2026-12-31' }),
        [add('2026-06-10', 100), add('2026-07-10', 100), add('2026-08-10', 100)],
        TODAY,
      ),
    ];
    for (const p of scenarios) {
      expect(p.message).not.toMatch(/should|must|behind|fail|lazy|careful|only/i);
    }
  });
});
