import { describe, expect, it } from 'vitest';
import {
  summariseCommitments,
  type Commitment,
  type CommitmentInput,
} from '@/lib/engines/commitments';

const rent: Commitment = {
  id: 'rent',
  label: 'Rent',
  amountPaise: 1_200_000, // ₹12,000
  category: 'rent',
  cadence: 'monthly',
  dueDay: 5,
  startedOn: '2026-01-01',
  endedOn: null,
  note: null,
};

const phone: Commitment = {
  ...rent,
  id: 'phone',
  label: 'Phone',
  amountPaise: 59_900,
  category: 'phone_internet',
  dueDay: 20,
};

const insurance: Commitment = {
  ...rent,
  id: 'insurance',
  label: 'Insurance',
  amountPaise: 1_500_000,
  category: 'medical',
  cadence: 'yearly',
  dueDay: 12,
  startedOn: '2026-03-12',
};

/** Eleven days into a ₹25,000 September, ₹8,000 already spent. */
const base: CommitmentInput = {
  commitments: [rent, phone],
  paidByCommitment: {},
  windowStart: '2026-09-01',
  windowEnd: '2026-10-01',
  today: '2026-09-11',
  limitPaise: 2_500_000,
  spentPaise: 800_000,
  daysLeft: 19,
};

describe('summariseCommitments', () => {
  it('separates money already promised from money actually free', () => {
    const r = summariseCommitments(base);

    // ₹25,000 planned − ₹8,000 spent − ₹12,599 still owed = ₹4,401 free.
    expect(r.outstandingPaise).toBe(1_259_900);
    expect(r.freePaise).toBe(440_100);
  });

  /*
   * The reason this engine exists. Without commitments the screen reports
   * ₹17,000 remaining, and the honest figure is a quarter of that.
   */
  it('is far below the naive "limit minus spent" figure', () => {
    const r = summariseCommitments(base);
    const naive = base.limitPaise! - base.spentPaise;

    expect(naive).toBe(1_700_000);
    expect(r.freePaise!).toBeLessThan(naive / 3);
  });

  it('does not double-count a commitment that has been paid', () => {
    // Paying the rent wrote an ordinary spend, so it is already inside
    // `spentPaise`. Subtracting it again would understate what is free.
    const r = summariseCommitments({
      ...base,
      paidByCommitment: { rent: 1_200_000 },
      spentPaise: 2_000_000, // ₹8,000 + the ₹12,000 rent
    });

    expect(r.paidPaise).toBe(1_200_000);
    expect(r.outstandingPaise).toBe(59_900);
    // ₹25,000 − ₹20,000 − ₹599 = ₹4,401. Same as before, correctly.
    expect(r.freePaise).toBe(440_100);
  });

  it('treats a slightly short payment as paid', () => {
    // ₹11,950 by bank transfer settles a ₹12,000 rent. Demanding an exact
    // match would leave it outstanding for the rest of the month.
    const r = summariseCommitments({ ...base, paidByCommitment: { rent: 1_195_000 } });
    expect(r.statuses.find((s) => s.commitment.id === 'rent')?.paid).toBe(true);
  });

  it('does not treat a part payment as settled', () => {
    const r = summariseCommitments({ ...base, paidByCommitment: { rent: 500_000 } });
    expect(r.statuses.find((s) => s.commitment.id === 'rent')?.paid).toBe(false);
  });

  it('flags what is already overdue', () => {
    const r = summariseCommitments(base); // rent due on the 5th, today is the 11th
    expect(r.overdue.map((s) => s.commitment.id)).toEqual(['rent']);
  });

  it('warns about what falls due shortly, without counting it as overdue', () => {
    const r = summariseCommitments({ ...base, today: '2026-09-17' });
    expect(r.dueSoon.map((s) => s.commitment.id)).toContain('phone');
    expect(r.overdue.map((s) => s.commitment.id)).not.toContain('phone');
  });
});

describe('cadence', () => {
  it('counts a yearly premium only in the month it lands', () => {
    const march = summariseCommitments({
      ...base,
      commitments: [insurance],
      windowStart: '2027-03-01',
      windowEnd: '2027-04-01',
      today: '2027-03-01',
    });
    const april = summariseCommitments({
      ...base,
      commitments: [insurance],
      windowStart: '2027-04-01',
      windowEnd: '2027-05-01',
      today: '2027-04-01',
    });

    // Counting it every month would make someone look permanently broke;
    // counting it in no month would let it arrive as a surprise.
    expect(march.dueThisPeriodPaise).toBe(1_500_000);
    expect(april.dueThisPeriodPaise).toBe(0);
  });

  it('ignores a commitment that has not started yet', () => {
    const r = summariseCommitments({
      ...base,
      commitments: [{ ...rent, startedOn: '2026-12-01' }],
    });
    expect(r.statuses).toHaveLength(0);
  });

  it('ignores one that has ended, without forgetting it existed', () => {
    const r = summariseCommitments({
      ...base,
      commitments: [{ ...rent, endedOn: '2026-08-31' }],
    });
    expect(r.statuses).toHaveLength(0);
  });

  it('finds a weekly commitment in the window', () => {
    const r = summariseCommitments({
      ...base,
      commitments: [{ ...rent, cadence: 'weekly', startedOn: '2026-09-02', amountPaise: 20_000 }],
    });
    expect(r.statuses.length).toBeGreaterThan(0);
  });
});

describe('the wording', () => {
  it('states an overcommitment factually, without a telling-off', () => {
    const r = summariseCommitments({ ...base, limitPaise: 1_000_000 });

    expect(r.freePaise!).toBeLessThan(0);
    expect(r.message).toMatch(/more than your plan covers/i);
    expect(r.message).not.toMatch(/you should|too much|overspent|cut back/i);
  });

  it('says so plainly when nothing is set up', () => {
    const r = summariseCommitments({ ...base, commitments: [] });
    expect(r.message).toMatch(/nothing recurring set up/i);
    expect(r.outstandingPaise).toBe(0);
  });

  it('does not promise a free figure with no monthly amount set', () => {
    const r = summariseCommitments({ ...base, limitPaise: null });
    expect(r.freePaise).toBeNull();
    expect(r.message).toMatch(/set a monthly amount/i);
  });

  it('confirms when everything is settled', () => {
    const r = summariseCommitments({
      ...base,
      paidByCommitment: { rent: 1_200_000, phone: 59_900 },
      spentPaise: 2_059_900,
    });
    expect(r.outstandingPaise).toBe(0);
    expect(r.message).toMatch(/everything due this month is paid/i);
  });
});
