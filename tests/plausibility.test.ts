import { describe, expect, it } from 'vitest';
import { checkPlausibility } from '@/lib/engines/portion';

/**
 * Catching a slipped finger without editorialising about the meal.
 *
 * Found by typing 180 into the household-measure box while testing something
 * else: the app logged 180 dosas — 14.4 kg, roughly 25,000 kcal — into the
 * day's total with no comment at all.
 */

describe('checkPlausibility', () => {
  it('accepts ordinary portions without comment', () => {
    for (const grams of [30, 180, 350, 800]) {
      expect(checkPlausibility({ grams }).plausible).toBe(true);
      expect(checkPlausibility({ grams }).question).toBeNull();
    }
  });

  it('queries a single entry of several kilograms', () => {
    const r = checkPlausibility({ grams: 14400 });
    expect(r.plausible).toBe(false);
    expect(r.question).toContain('14.4 kg');
  });

  it('queries an implausible household count', () => {
    const r = checkPlausibility({ grams: 14400, householdCount: 180, unitLabel: 'piece' });
    expect(r.plausible).toBe(false);
    expect(r.question).toContain('180 pieces');
  });

  it('lets a large but believable portion through', () => {
    // A litre of buttermilk, a big bowl of watermelon. Not worth interrupting.
    expect(checkPlausibility({ grams: 900 }).plausible).toBe(true);
  });

  it('pluralises the unit, and does not mangle ones ending in s', () => {
    expect(checkPlausibility({ grams: 9000, householdCount: 30, unitLabel: 'piece' }).question)
      .toContain('30 pieces');
    expect(checkPlausibility({ grams: 9000, householdCount: 30, unitLabel: 'glass' }).question)
      .toContain('30 glasses');
  });

  it('leaves a missing quantity alone', () => {
    // Nothing has been entered yet; there is nothing to question.
    expect(checkPlausibility({ grams: null }).plausible).toBe(true);
  });

  it('questions the entry, never the appetite', () => {
    // This must never read as a comment on how much someone is eating.
    const r = checkPlausibility({ grams: 14400 });
    expect(r.question).not.toMatch(/too much|excessive|unhealthy|really\?|sure you|that much food/i);
    // It should point at the number on screen instead.
    expect(r.question).toMatch(/number|second look|checking/i);
  });

  it('never refuses the entry', () => {
    // The user is the authority on what they ate. A surprising figure is
    // questioned once and then accepted.
    const r = checkPlausibility({ grams: 20000 });
    expect(r.question).toMatch(/before you add it|carry on|checking/i);
    expect(r.question).not.toMatch(/cannot|not allowed|refus/i);
  });

  it('formats weights readably at both scales', () => {
    expect(checkPlausibility({ grams: 1600 }).question).toContain('1.6 kg');
    expect(checkPlausibility({ grams: 1500 }).question).toContain('1.5 kg');
  });
});
