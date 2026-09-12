import { describe, expect, it } from 'vitest';
import { mealForHour } from '@/lib/meal-time';

/**
 * Meal inference for quick add.
 *
 * Not load-bearing — the meal is a label and can be corrected — but a quick
 * add that files everything under "other" is not much of a quick add, and the
 * boundaries are the sort of thing that gets nudged later without anyone
 * checking the ends still behave.
 */
describe('mealForHour', () => {
  it('files the usual hours where a person would expect', () => {
    expect(mealForHour(8)).toBe('breakfast');
    expect(mealForHour(13)).toBe('lunch');
    expect(mealForHour(20)).toBe('dinner');
  });

  it('covers every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      expect(typeof mealForHour(hour)).toBe('string');
      expect(mealForHour(hour).length).toBeGreaterThan(0);
    }
  });

  it('treats the small hours as an evening snack, not breakfast', () => {
    // 2am is the end of a long evening far more often than the start of a day.
    expect(mealForHour(2)).toBe('evening_snack');
    expect(mealForHour(23)).toBe('evening_snack');
  });

  it('only ever returns a meal the log schema accepts', () => {
    const allowed = new Set([
      'breakfast',
      'morning_snack',
      'lunch',
      'afternoon_snack',
      'dinner',
      'evening_snack',
      'other',
    ]);
    for (let hour = 0; hour < 24; hour += 1) {
      expect(allowed.has(mealForHour(hour))).toBe(true);
    }
  });
});
