import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFSET_MINUTES,
  GRACE_MINUTES,
  formatClock,
  minutesSinceWake,
  parseClock,
  pendingMeal,
  resolveSchedule,
} from '@/lib/engines/meal-times';
import type { MealSchedule } from '@/lib/engines/meal-times';

const dayShift: MealSchedule = {
  breakfast: '08:00',
  lunch: '13:00',
  dinner: '20:00',
};

describe('parseClock', () => {
  it('reads both the time and timetz shapes Postgres returns', () => {
    expect(parseClock('08:00')).toBe(480);
    expect(parseClock('08:00:00')).toBe(480);
  });

  it('treats anything unparseable as not set rather than throwing', () => {
    // A malformed column value should degrade to a default, not break the page.
    expect(parseClock(null)).toBeNull();
    expect(parseClock('')).toBeNull();
    expect(parseClock('not a time')).toBeNull();
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('08:74')).toBeNull();
  });
});

describe('formatClock', () => {
  it('pads and wraps past midnight', () => {
    expect(formatClock(480)).toBe('08:00');
    expect(formatClock(9 * 60 + 5)).toBe('09:05');
    expect(formatClock(25 * 60)).toBe('01:00');
  });
});

describe('minutesSinceWake', () => {
  it('measures forward from waking, not from midnight', () => {
    expect(minutesSinceWake(9 * 60, 7 * 60)).toBe(120);
  });

  it('wraps for a day that crosses midnight', () => {
    // Wakes at 20:00, it is now 02:00 — that is six hours into their day.
    expect(minutesSinceWake(2 * 60, 20 * 60)).toBe(360);
  });
});

describe('resolveSchedule', () => {
  it('keeps the times the user actually gave', () => {
    const resolved = resolveSchedule(dayShift, '07:00');
    expect(resolved.map((r) => r.atMinutes)).toEqual([8 * 60, 13 * 60, 20 * 60]);
    expect(resolved.every((r) => !r.isDefault)).toBe(true);
  });

  it('derives missing meals from wake time rather than a fixed hour', () => {
    const early = resolveSchedule(null, '05:00');
    const late = resolveSchedule(null, '11:00');

    expect(early[0].atMinutes).toBe(5 * 60 + DEFAULT_OFFSET_MINUTES.breakfast);
    expect(late[0].atMinutes).toBe(11 * 60 + DEFAULT_OFFSET_MINUTES.breakfast);
    // Someone up at 05:00 and someone up at 11:00 do not eat at the same time.
    expect(early[0].atMinutes).not.toBe(late[0].atMinutes);
    expect(early.every((r) => r.isDefault)).toBe(true);
  });

  it('fills only the gaps when some times are set', () => {
    const resolved = resolveSchedule({ breakfast: '09:30', lunch: null, dinner: null }, '07:00');
    expect(resolved[0].isDefault).toBe(false);
    expect(resolved[0].atMinutes).toBe(9 * 60 + 30);
    expect(resolved[1].isDefault).toBe(true);
  });

  it('falls back to a default wake time when that was never answered either', () => {
    const resolved = resolveSchedule(null, null);
    expect(resolved[0].atMinutes).toBe(7 * 60 + DEFAULT_OFFSET_MINUTES.breakfast);
  });
});

describe('pendingMeal', () => {
  it('says nothing before the grace period is up', () => {
    // Lunch is at 13:00; at 13:20 they are probably still eating it.
    expect(
      pendingMeal({ now: '13:20', schedule: dayShift, wakeTime: '07:00', logged: ['breakfast'] }),
    ).toBeNull();
  });

  it('asks once the grace period has passed', () => {
    const result = pendingMeal({
      now: '13:45',
      schedule: dayShift,
      wakeTime: '07:00',
      logged: ['breakfast'],
    });
    expect(result?.meal).toBe('lunch');
    expect(result?.atClock).toBe('13:00');
    expect(result?.minutesLate).toBe(45);
  });

  it('says nothing when everything due has been logged', () => {
    expect(
      pendingMeal({
        now: '21:00',
        schedule: dayShift,
        wakeTime: '07:00',
        logged: ['breakfast', 'lunch', 'dinner'],
      }),
    ).toBeNull();
  });

  it('leads with the most recent miss, not the oldest', () => {
    // Both lunch and dinner are missing at 21:00. Dinner is the one they can
    // still recall accurately, and opening with the older failure is how a
    // thin day becomes a reason to stop opening the app.
    const result = pendingMeal({
      now: '21:00',
      schedule: dayShift,
      wakeTime: '07:00',
      logged: [],
    });
    expect(result?.meal).toBe('dinner');
  });

  it('ignores snacks, which are had rather than missed', () => {
    const result = pendingMeal({
      now: '13:45',
      schedule: dayShift,
      wakeTime: '07:00',
      logged: ['breakfast', 'afternoon_snack'],
    });
    expect(result?.meal).toBe('lunch');
  });

  it('works for a night shift, where the clock comparison would fail', () => {
    // Wakes 20:00, eats at 21:00 / 01:00 / 05:00. At 02:00 a naive clock
    // comparison says breakfast is eighteen hours away; it was five hours ago.
    const nights: MealSchedule = { breakfast: '21:00', lunch: '01:00', dinner: '05:00' };
    const result = pendingMeal({
      now: '02:00',
      schedule: nights,
      wakeTime: '20:00',
      logged: ['breakfast'],
    });
    expect(result?.meal).toBe('lunch');
    expect(result?.minutesLate).toBe(60);
  });

  it('does not raise tomorrow morning as though it were overdue tonight', () => {
    // 22:00 for a 07:00 riser: dinner is behind them, breakfast is ahead.
    const result = pendingMeal({
      now: '22:00',
      schedule: dayShift,
      wakeTime: '07:00',
      logged: ['breakfast', 'lunch', 'dinner'],
    });
    expect(result).toBeNull();
  });

  it('reports when the time was assumed, so the UI can offer to correct it', () => {
    const result = pendingMeal({ now: '14:00', schedule: null, wakeTime: '07:00', logged: [] });
    expect(result?.isDefault).toBe(true);
  });

  it('returns nothing rather than guessing when the clock is unreadable', () => {
    expect(
      pendingMeal({ now: 'nonsense', schedule: dayShift, wakeTime: '07:00', logged: [] }),
    ).toBeNull();
  });

  it('uses the documented grace constant rather than a hidden one', () => {
    const justBefore = pendingMeal({
      now: formatClock(8 * 60 + GRACE_MINUTES - 1),
      schedule: dayShift,
      wakeTime: '07:00',
      logged: [],
    });
    const justAfter = pendingMeal({
      now: formatClock(8 * 60 + GRACE_MINUTES),
      schedule: dayShift,
      wakeTime: '07:00',
      logged: [],
    });
    expect(justBefore).toBeNull();
    expect(justAfter?.meal).toBe('breakfast');
  });
});
