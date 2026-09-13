import { describe, expect, it } from 'vitest';
import { moneyTrends, type TrendsInput } from '@/lib/engines/money-trends';
import type { Commitment } from '@/lib/engines/commitments';

const TODAY = '2026-09-13';

type SpendRow = TrendsInput['spends'][number];

const spend = (spentOn: string, rupees: number, category = 'groceries', intent: SpendRow['intent'] = null): SpendRow => ({
  spentOn,
  amountPaise: rupees * 100,
  category,
  intent,
});

const income = (receivedOn: string, rupees: number) => ({ receivedOn, amountPaise: rupees * 100 });

const commitment = (over: Partial<Commitment>): Commitment => ({
  id: over.label ?? 'c',
  label: 'Rent',
  amountPaise: 1_200_000,
  category: 'rent',
  cadence: 'monthly',
  dueDay: 5,
  startedOn: '2026-01-01',
  endedOn: null,
  note: null,
  ...over,
});

const base = (over: Partial<TrendsInput> = {}): TrendsInput => ({
  spends: [],
  incomes: [],
  withdrawals: [],
  commitments: [],
  monthStartDay: 1,
  today: TODAY,
  recordedBefore: false,
  ...over,
});

/** Three full months (June–August) and September so far, on a ₹50,000 salary. */
const steady = base({
  spends: [
    spend('2026-06-02', 12_000, 'rent'),
    spend('2026-06-10', 6_000, 'groceries'),
    spend('2026-06-20', 2_000, 'eating_out'),
    spend('2026-06-25', 5_000, 'savings'),
    spend('2026-07-02', 12_000, 'rent'),
    spend('2026-07-10', 6_500, 'groceries'),
    spend('2026-07-20', 1_800, 'eating_out'),
    spend('2026-07-25', 5_000, 'savings'),
    spend('2026-08-02', 12_000, 'rent'),
    spend('2026-08-10', 6_200, 'groceries'),
    spend('2026-08-20', 3_900, 'eating_out'),
    spend('2026-08-25', 8_000, 'savings'),
    spend('2026-09-02', 12_000, 'rent'),
    spend('2026-09-08', 1_500, 'groceries'),
  ],
  incomes: [income('2026-06-01', 50_000), income('2026-07-01', 50_000), income('2026-08-01', 50_000), income('2026-09-01', 50_000)],
  recordedBefore: true,
});

describe('which months count', () => {
  it('lists full months oldest first, then the current one', () => {
    const t = moneyTrends(steady);
    expect(t.months.map((m) => [m.start, m.status])).toEqual([
      ['2026-06-01', 'complete'],
      ['2026-07-01', 'complete'],
      ['2026-08-01', 'complete'],
      ['2026-09-01', 'current'],
    ]);
  });

  it('leaves savings out of spending, as the money screen does', () => {
    const june = moneyTrends(steady).months[0];
    expect(june.spendingPaise).toBe(2_000_000);
    expect(june.savedPaise).toBe(500_000);
  });

  /*
   * Someone who started recording on 20 July has a July that looks cheap only
   * because most of it went unrecorded. Comparing August against it would
   * report a rise in spending that did not happen.
   */
  it('never compares a month that recording began partway through', () => {
    const t = moneyTrends(
      base({
        spends: [spend('2026-07-20', 3_000), spend('2026-08-05', 9_000), spend('2026-09-03', 1_000)],
      }),
    );
    expect(t.months.map((m) => m.status)).toEqual(['partial', 'complete', 'current']);
    expect(t.change).toBeNull();
    expect(t.usualSpendingPaise).toBeNull();
  });

  it('treats a month as fully recorded when records began in its first three days', () => {
    const t = moneyTrends(base({ spends: [spend('2026-07-03', 3_000), spend('2026-08-05', 9_000)] }));
    expect(t.months[0].status).toBe('complete');
  });

  it('trusts older months when there are records from before the window', () => {
    const t = moneyTrends(base({ spends: [spend('2026-08-20', 3_000)], recordedBefore: true }));
    // Nothing in the window before August, but records exist before it, so
    // those months were genuinely quiet rather than unrecorded.
    expect(t.months.every((m) => m.status !== 'partial')).toBe(true);
  });

  it('runs months from payday when the month starts later', () => {
    const t = moneyTrends(
      base({
        monthStartDay: 25,
        spends: [spend('2026-07-26', 1_000), spend('2026-08-24', 2_000), spend('2026-08-25', 4_000)],
      }),
    );
    const july = t.months.find((m) => m.start === '2026-07-25');
    expect(july?.end).toBe('2026-08-25');
    expect(july?.spendingPaise).toBe(300_000);
    expect(t.months.at(-1)?.start).toBe('2026-08-25');
  });

  it('says there is not enough history yet, rather than comparing nothing', () => {
    const t = moneyTrends(base({ spends: [spend('2026-09-02', 500)] }));
    expect(t.enoughHistory).toBe(false);
    expect(t.headline).toMatch(/first full month of records ends on 30 September/i);
  });

  it('counts the next month as the first full one when recording began partway through this one', () => {
    const t = moneyTrends(base({ spends: [spend('2026-09-10', 500)] }));
    expect(t.headline).toMatch(/ends on 31 October/);
  });
});

describe('this month against last month', () => {
  it('compares spending at the same point in both months', () => {
    // September 1–13: ₹13,500. August 1–13: rent ₹12,000 + groceries ₹6,200.
    const p = moneyTrends(steady).pace!;
    expect(p.day).toBe(13);
    expect(p.currentPaise).toBe(1_350_000);
    expect(p.previousPaise).toBe(1_820_000);
    expect(p.message).toMatch(/₹4,700 less than by the same point last month/);
  });

  it('calls a small difference about the same', () => {
    const p = moneyTrends(
      base({ spends: [spend('2026-08-05', 10_000), spend('2026-09-05', 10_200)], recordedBefore: true }),
    ).pace!;
    expect(p.message).toMatch(/about the same/);
  });

  it('does not compare against a month that was not fully recorded', () => {
    const t = moneyTrends(base({ spends: [spend('2026-08-20', 10_000), spend('2026-09-05', 2_000)] }));
    expect(t.pace).toBeNull();
  });
});

describe('the last two full months', () => {
  it('states the change and the categories that moved', () => {
    const c = moneyTrends(steady).change!;
    // July ₹20,300 → August ₹22,100.
    expect(c.differencePaise).toBe(180_000);
    expect(c.message).toMatch(/₹1,800 more than July/);
    // Eating out moved ₹2,100; groceries moved ₹300, below the threshold.
    expect(c.movers.map((m) => m.category)).toEqual(['eating_out']);
    expect(c.movers[0].fromPaise).toBe(180_000);
    expect(c.movers[0].toPaise).toBe(390_000);
  });

  it('gives a usual monthly figure only from full months', () => {
    // (20,000 + 20,300 + 22,100) / 3
    expect(moneyTrends(steady).usualSpendingPaise).toBe(2_080_000);
  });
});

describe('savings rate', () => {
  it('is what was set aside out of what came in, over full months', () => {
    const s = moneyTrends(steady).savingsRate!;
    // 18,000 of 1,50,000
    expect(s.average).toBeCloseTo(0.12, 5);
    expect(s.latest).toBeCloseTo(0.16, 5);
    expect(s.months).toBe(3);
  });

  it('is not shown without income in at least two full months', () => {
    const t = moneyTrends({ ...steady, incomes: [income('2026-08-01', 50_000)] });
    expect(t.savingsRate).toBeNull();
  });
});

describe('not accounted for', () => {
  it('reports whether it is shrinking, in neutral words', () => {
    const t = moneyTrends(
      base({
        spends: [
          spend('2026-06-05', 30_000),
          spend('2026-07-05', 38_000),
          spend('2026-08-05', 45_000),
        ],
        incomes: [income('2026-06-01', 50_000), income('2026-07-01', 50_000), income('2026-08-01', 50_000)],
        recordedBefore: true,
      }),
    );
    const u = t.unaccounted!;
    expect(u.direction).toBe('shrinking');
    expect(u.firstShare).toBeCloseTo(0.4, 5);
    expect(u.latestShare).toBeCloseTo(0.1, 5);
    expect(u.message).toMatch(/40%/);
    expect(u.message).toMatch(/10%/);
  });

  it('needs three full months with income before calling a direction', () => {
    const t = moneyTrends(
      base({
        spends: [spend('2026-07-05', 30_000), spend('2026-08-05', 45_000)],
        incomes: [income('2026-07-01', 50_000), income('2026-08-01', 50_000)],
        recordedBefore: true,
      }),
    );
    expect(t.unaccounted).toBeNull();
  });
});

describe('wants', () => {
  it('notices wants taking a larger share', () => {
    const t = moneyTrends(steady);
    // June 10%, July 8.9%, August 17.6% of spending.
    expect(t.wants?.direction).toBe('up');
    expect(t.wants?.message).toMatch(/18% of spending in August, up from about 9%/);
  });

  it('calls the share a floor while some spending is unclassified', () => {
    const t = moneyTrends({
      ...steady,
      spends: [...steady.spends, spend('2026-08-15', 2_000, 'clothes')],
    });
    expect(t.wants?.message).toMatch(/at least/);
  });
});

describe('fixed costs and subscriptions', () => {
  const commitments = [
    commitment({ label: 'Rent', amountPaise: 1_200_000 }),
    commitment({ label: 'Netflix', amountPaise: 64_900, category: 'entertainment' }),
    commitment({ label: 'Spotify', amountPaise: 11_900, category: 'other' }),
    commitment({ label: 'Insurance', amountPaise: 1_200_000, category: 'medical', cadence: 'yearly' }),
    commitment({ label: 'SIP', amountPaise: 500_000, category: 'savings' }),
    commitment({ label: 'Old gym', amountPaise: 150_000, category: 'entertainment', endedOn: '2026-05-01' }),
  ];

  it('spreads fixed costs to a monthly figure and compares them with usual income', () => {
    const f = moneyTrends({ ...steady, commitments }).fixedCosts!;
    // 12,000 + 649 + 119 + 12,000/12. The SIP is savings; the gym has ended.
    expect(f.monthlyPaise).toBe(1_376_800);
    expect(f.share).toBeCloseTo(13_768 / 50_000, 5);
    expect(f.message).toMatch(/28% of your usual income/);
  });

  it('finds subscriptions by category or by name, and gives the yearly cost', () => {
    const s = moneyTrends({ ...steady, commitments }).subscriptions!;
    expect(s.items.map((i) => i.label)).toEqual(['Netflix', 'Spotify']);
    expect(s.yearlyPaise).toBe((64_900 + 11_900) * 12);
    expect(s.message).toMatch(/₹9,216 a year/);
  });

  it('shows nothing when there are no commitments', () => {
    const t = moneyTrends(steady);
    expect(t.fixedCosts).toBeNull();
    expect(t.subscriptions).toBeNull();
  });
});

describe('tone and arithmetic', () => {
  it('never scolds', () => {
    const t = moneyTrends(steady);
    const words = [t.headline, t.pace?.message, t.change?.message, t.wants?.message, t.savingsRate?.message]
      .filter(Boolean)
      .join(' ');
    expect(words).not.toMatch(/should|must|overspen|too much|careful|bad|fail|cut back/i);
  });

  it('keeps every amount a whole number of paise', () => {
    const t = moneyTrends(steady);
    for (const m of t.months) {
      for (const v of [m.spendingPaise, m.savedPaise, m.incomePaise, ...Object.values(m.byIntent)]) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
    expect(Number.isInteger(t.usualSpendingPaise)).toBe(true);
  });
});
