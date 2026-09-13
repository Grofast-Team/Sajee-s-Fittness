import { describe, expect, it } from 'vitest';
import { planSpendEdit, type ExistingSpend, type LinkedCommitment } from '@/lib/engines/spend-edit';

const groceries: ExistingSpend = {
  id: 'spend-1',
  amountPaise: 45_000,
  category: 'groceries',
  note: 'veg',
  spentOn: '2026-09-10',
  intent: null,
  commitmentId: null,
  savingsGoalId: null,
};

const rentPayment: ExistingSpend = {
  id: 'spend-2',
  amountPaise: 1_200_000,
  category: 'rent',
  note: 'Rent',
  spentOn: '2026-09-01',
  intent: null,
  commitmentId: 'commitment-rent',
  savingsGoalId: null,
};

const rent: LinkedCommitment = { label: 'Rent', amountPaise: 1_200_000, otherPaidPaise: 0 };

describe('planSpendEdit', () => {
  it('reports no change when nothing differs', () => {
    const plan = planSpendEdit(groceries, { amountPaise: 45_000, note: 'veg' }, null);
    expect(plan).toEqual({ ok: true, changed: false });
  });

  it('puts only the fields that actually changed into the patch', () => {
    const plan = planSpendEdit(groceries, { amountPaise: 52_000, note: 'veg', category: 'groceries' }, null);
    expect(plan).toEqual({ ok: true, changed: true, patch: { amountPaise: 52_000 }, warning: null });
  });

  it('refuses an amount that is not a positive whole number of paise', () => {
    for (const amountPaise of [0, -100, 10.5]) {
      const plan = planSpendEdit(groceries, { amountPaise }, null);
      expect(plan.ok).toBe(false);
    }
  });

  it('trims a note and treats an empty one as no note', () => {
    expect(planSpendEdit(groceries, { note: '  veg  ' }, null)).toEqual({ ok: true, changed: false });

    const cleared = planSpendEdit(groceries, { note: '   ' }, null);
    expect(cleared).toEqual({ ok: true, changed: true, patch: { note: null }, warning: null });
  });

  it('allows recategorising an ordinary spend', () => {
    const plan = planSpendEdit(groceries, { category: 'eating_out' }, null);
    expect(plan).toEqual({ ok: true, changed: true, patch: { category: 'eating_out' }, warning: null });
  });

  it('refuses to recategorise a payment that settled a bill, and names the bill', () => {
    const plan = planSpendEdit(rentPayment, { category: 'groceries' }, rent);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error).toContain('Rent');
      expect(plan.error).toMatch(/remove it and record it again/i);
    }
  });

  /*
   * An explicit need/want choice answered a question about the *old* category.
   * Carrying it onto a new one would silently force that category's
   * classification, which is exactly the guessing the salary breakdown refuses.
   */
  it('clears a need/want choice when the category changes', () => {
    const clothes: ExistingSpend = { ...groceries, category: 'clothes', intent: 'need' };
    const plan = planSpendEdit(clothes, { category: 'gifts' }, null);
    expect(plan).toEqual({
      ok: true,
      changed: true,
      patch: { category: 'gifts', intent: null },
      warning: null,
    });
  });

  it('keeps a need/want choice made in the same edit as the category change', () => {
    const clothes: ExistingSpend = { ...groceries, category: 'clothes', intent: 'need' };
    const plan = planSpendEdit(clothes, { category: 'gifts', intent: 'want' }, null);
    expect(plan).toEqual({
      ok: true,
      changed: true,
      patch: { category: 'gifts', intent: 'want' },
      warning: null,
    });
  });

  it('warns when an edit leaves a bill no longer fully paid', () => {
    const plan = planSpendEdit(rentPayment, { amountPaise: 500_000 }, rent);
    expect(plan.ok && plan.changed && plan.warning).toMatch(/Rent will show as not fully paid/);
    expect(plan.ok && plan.changed && plan.warning).toContain('₹5,000 of ₹12,000');
  });

  it('does not warn when other payments still cover the bill', () => {
    const covered: LinkedCommitment = { ...rent, otherPaidPaise: 1_000_000 };
    const plan = planSpendEdit(rentPayment, { amountPaise: 200_000 }, covered);
    expect(plan.ok && plan.changed && plan.warning).toBeNull();
  });

  it('does not warn about a bill that was not fully paid to begin with', () => {
    const partial: ExistingSpend = { ...rentPayment, amountPaise: 600_000 };
    const plan = planSpendEdit(partial, { amountPaise: 500_000 }, rent);
    expect(plan.ok && plan.changed && plan.warning).toBeNull();
  });

  it('warns when a bill payment moves to another month', () => {
    const plan = planSpendEdit(rentPayment, { spentOn: '2026-08-31' }, rent);
    expect(plan.ok && plan.changed && plan.warning).toMatch(/may no longer count/);
  });

  it('never warns about an ordinary spend', () => {
    const plan = planSpendEdit(groceries, { amountPaise: 1, spentOn: '2025-01-01' }, null);
    expect(plan.ok && plan.changed && plan.warning).toBeNull();
  });

  it('refuses to recategorise money added to a savings goal', () => {
    const contribution: ExistingSpend = { ...groceries, category: 'savings', savingsGoalId: 'goal-1' };
    const plan = planSpendEdit(contribution, { category: 'eating_out' }, null);
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.error).toMatch(/savings goal/);
      expect(plan.error).toMatch(/remove it and record it again/i);
    }
  });

  it('still lets a contribution’s amount and date be corrected', () => {
    const contribution: ExistingSpend = { ...groceries, category: 'savings', savingsGoalId: 'goal-1' };
    const plan = planSpendEdit(contribution, { amountPaise: 60_000, spentOn: '2026-09-11' }, null);
    expect(plan).toEqual({
      ok: true,
      changed: true,
      patch: { amountPaise: 60_000, spentOn: '2026-09-11' },
      warning: null,
    });
  });

  it('never scolds', () => {
    const plan = planSpendEdit(rentPayment, { amountPaise: 100 }, rent);
    const text = plan.ok && plan.changed ? (plan.warning ?? '') : '';
    expect(text).not.toMatch(/should|must|careful|mistake|wrong/i);
  });
});
