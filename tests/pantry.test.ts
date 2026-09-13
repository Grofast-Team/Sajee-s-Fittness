import { describe, expect, it } from 'vitest';
import {
  formatQuantity,
  pendingFromLogs,
  stockLevel,
  unitsFromLog,
  type Movement,
  type PantryItem,
} from '@/lib/engines/pantry';

const TODAY = '2026-09-14';

const eggs: PantryItem = { id: 'eggs', label: 'Eggs', foodId: 'food-egg', unit: 'piece', gramsPerUnit: 50 };
const milk: PantryItem = { id: 'milk', label: 'Milk', foodId: 'food-milk', unit: 'ml', gramsPerUnit: null };
const rice: PantryItem = { id: 'rice', label: 'Rice', foodId: null, unit: 'g', gramsPerUnit: null };

const move = (kind: Movement['kind'], quantity: number, occurredOn: string): Movement => ({
  kind,
  quantity,
  occurredOn,
});

describe('what is on hand', () => {
  it('adds up the ledger rather than trusting a stored count', () => {
    const s = stockLevel(
      eggs,
      [move('bought', 12, '2026-09-01'), move('used', -2, '2026-09-02'), move('discarded', -1, '2026-09-03')],
      TODAY,
    );
    expect(s.onHand).toBe(9);
  });

  it('lets a count correct everything before it', () => {
    const s = stockLevel(
      eggs,
      [move('bought', 12, '2026-09-01'), move('used', -2, '2026-09-02'), move('counted', -4, '2026-09-10')],
      TODAY,
    );
    expect(s.onHand).toBe(6);
  });

  it('never shows less than nothing', () => {
    const s = stockLevel(eggs, [move('bought', 2, '2026-09-01'), move('used', -3, '2026-09-02')], TODAY);
    expect(s.onHand).toBe(0);
    expect(s.status).toBe('out');
  });
});

describe('how long it lasts', () => {
  /*
   * Two eggs a day for a week, confirmed from the food log. Six are left, so
   * about three days.
   */
  const week: Movement[] = [
    move('bought', 20, '2026-09-07'),
    ...['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14'].map((d) =>
      move('used', -2, d),
    ),
  ];

  it('estimates days left from the usual rate of use', () => {
    const s = stockLevel(eggs, week, TODAY);
    expect(s.onHand).toBe(6);
    expect(s.perDay).toBeCloseTo(2, 5);
    expect(s.daysLeft).toBe(3);
    expect(s.message).toMatch(/about 3 days/i);
    expect(s.message).toMatch(/2 a day/);
  });

  it('flags it as running low within two days', () => {
    const s = stockLevel(eggs, [...week, move('used', -3, TODAY)], TODAY);
    expect(s.onHand).toBe(3);
    expect(s.status).toBe('low');
  });

  it('refuses to estimate from a few days of use', () => {
    const s = stockLevel(
      eggs,
      [move('bought', 12, '2026-09-11'), move('used', -2, '2026-09-12'), move('used', -2, '2026-09-13'), move('used', -2, TODAY)],
      TODAY,
    );
    expect(s.daysLeft).toBeNull();
    expect(s.status).toBe('unknown');
    expect(s.message).toMatch(/not enough use recorded/i);
  });

  it('does not count what was thrown out as use', () => {
    const s = stockLevel(eggs, [...week, move('discarded', -4, '2026-09-13')], TODAY);
    expect(s.perDay).toBeCloseTo(2, 5);
  });

  it('ignores use from more than four weeks ago', () => {
    const old = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-10'].map((d) => move('used', -10, d));
    const s = stockLevel(eggs, [move('bought', 50, '2026-06-30'), ...old], TODAY);
    expect(s.daysLeft).toBeNull();
  });

  it('says when something has run out', () => {
    const s = stockLevel(milk, [move('bought', 1000, '2026-09-10'), move('used', -1000, '2026-09-12')], TODAY);
    expect(s.status).toBe('out');
    expect(s.message).toMatch(/none left/i);
  });
});

describe('from the food log', () => {
  it('counts pieces when the log was in pieces', () => {
    expect(unitsFromLog(eggs, { grams: 100, quantity: 2, unitLabel: 'piece' })).toBe(2);
  });

  it('turns grams into pieces with the weight of one', () => {
    expect(unitsFromLog(eggs, { grams: 150, quantity: 150, unitLabel: 'g' })).toBe(3);
  });

  it('cannot turn grams into pieces without the weight of one', () => {
    expect(unitsFromLog({ ...eggs, gramsPerUnit: null }, { grams: 150, quantity: 150, unitLabel: 'g' })).toBeNull();
  });

  it('takes grams as millilitres for liquids', () => {
    expect(unitsFromLog(milk, { grams: 200, quantity: 1, unitLabel: 'glass' })).toBe(200);
  });

  it('offers only logs of stocked foods that have not been dealt with', () => {
    const pending = pendingFromLogs(
      [eggs, milk, rice],
      [
        { id: 'l1', foodId: 'food-egg', description: '2 piece Egg', logDate: TODAY, grams: 100, quantity: 2, unitLabel: 'piece' },
        { id: 'l2', foodId: 'food-milk', description: 'Milk', logDate: TODAY, grams: 200, quantity: 1, unitLabel: 'glass' },
        { id: 'l3', foodId: 'food-dosa', description: 'Dosa', logDate: TODAY, grams: 80, quantity: 1, unitLabel: 'piece' },
      ],
      new Set(['l2']),
    );
    expect(pending.map((p) => [p.log.id, p.item.id, p.units])).toEqual([['l1', 'eggs', 2]]);
  });
});

describe('quantities in words', () => {
  it('reads naturally', () => {
    expect(formatQuantity(eggs, 6)).toBe('6');
    expect(formatQuantity(eggs, 2.5)).toBe('2.5');
    expect(formatQuantity(rice, 750)).toBe('750 g');
    expect(formatQuantity(rice, 2500)).toBe('2.5 kg');
    expect(formatQuantity(milk, 1500)).toBe('1.5 L');
  });
});
