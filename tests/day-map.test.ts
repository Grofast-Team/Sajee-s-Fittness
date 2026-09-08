import { describe, expect, it } from 'vitest';
import { derivePalFromDay, type DayEntry } from '@/lib/engines/day-map';

/** Shorthand: an entry in hours rather than minutes, for readable tests. */
const h = (activityId: string, hours: number, slot: DayEntry['slot'] = 'morning'): DayEntry => ({
  slot,
  activityId,
  minutes: hours * 60,
});

/** A software developer who drives to an office and does nothing else. */
const deskDay: DayEntry[] = [
  h('sleeping', 7.5, 'night'),
  h('eating', 1, 'early_morning'),
  h('driving', 1, 'morning'),
  h('desk_work', 8, 'midday'),
  h('sitting_screen', 5, 'evening'),
  h('cooking', 0.5, 'evening'),
];

/** A homemaker: no gym, no steps counted, but genuinely on her feet. */
const homemakerDay: DayEntry[] = [
  h('sleeping', 7, 'night'),
  h('cooking', 3, 'early_morning'),
  h('cleaning', 2, 'morning'),
  h('laundry', 1, 'morning'),
  h('childcare', 4, 'afternoon'),
  h('shopping', 1, 'midday'),
  h('walking_slow', 1, 'midday'),
  h('sitting_screen', 3, 'evening'),
  h('dishes', 1, 'evening'),
];

/** Construction work. */
const labourerDay: DayEntry[] = [
  h('sleeping', 7, 'night'),
  h('heavy_manual', 8, 'midday'),
  h('walking_brisk', 1.5, 'morning'),
  h('passenger', 1, 'morning'),
  h('eating', 1, 'midday'),
  h('sitting_screen', 4, 'evening'),
  h('cooking', 1, 'evening'),
];

describe('derivePalFromDay', () => {
  it('reads a desk day as mostly seated', () => {
    const r = derivePalFromDay(deskDay);
    expect(r.insufficient).toBe(false);
    expect(r.level).toBe('sedentary');
    expect(r.pal).toBeLessThan(1.5);
  });

  /*
   * The case the old question got wrong.
   *
   * Asked to rate herself, a homemaker with no gym membership and no step
   * count picks "not very active". Her actual day is four hours of childcare,
   * three of cooking and three of housework, which is materially more than the
   * developer who drives to a desk. The whole point of describing the day is
   * that this stops being invisible.
   */
  it('does not mistake a homemaker for a sedentary person', () => {
    const home = derivePalFromDay(homemakerDay);
    const desk = derivePalFromDay(deskDay);

    expect(home.pal).toBeGreaterThan(desk.pal);
    expect(home.level).not.toBe('sedentary');
  });

  it('recognises physically demanding work as the highest band', () => {
    const r = derivePalFromDay(labourerDay);
    expect(r.pal).toBeGreaterThan(derivePalFromDay(homemakerDay).pal);
    expect(['active', 'very_active']).toContain(r.level);
  });

  it('holds the result inside physiologically sane bounds', () => {
    // Someone mis-enters twelve hours of stair climbing.
    const absurd = [h('sleeping', 7, 'night'), h('stairs', 12), h('running', 5)];
    const r = derivePalFromDay(absurd);
    expect(r.pal).toBeLessThanOrEqual(2.4);
    expect(r.pal).toBeGreaterThanOrEqual(1.2);
  });

  it('says so rather than guessing when too little of the day is described', () => {
    const r = derivePalFromDay([h('desk_work', 3)]);
    expect(r.insufficient).toBe(true);
    expect(r.reasons[0]).toMatch(/not enough|add a few more/i);
  });

  it('scales an overlapping day back to 24 hours instead of rejecting it', () => {
    // Cooking while minding children is one block of time, described twice.
    const overlapping = [
      h('sleeping', 8, 'night'),
      h('cooking', 6, 'morning'),
      h('childcare', 8, 'afternoon'),
      h('cleaning', 4, 'midday'),
      h('sitting_screen', 4, 'evening'),
    ];
    const r = derivePalFromDay(overlapping);

    expect(r.insufficient).toBe(false);
    expect(r.pal).toBeLessThanOrEqual(2.4);
    expect(r.reasons.join(' ')).toMatch(/overlap/i);
  });

  it('assumes light activity for undescribed hours, not nothing', () => {
    const sparse = [h('sleeping', 8, 'night'), h('desk_work', 6, 'midday')];
    const r = derivePalFromDay(sparse);

    expect(r.unaccountedHours).toBeGreaterThan(0);
    // Filling with rest would drag this below a liveable PAL.
    expect(r.pal).toBeGreaterThan(1.2);
    expect(r.reasons.join(' ')).toMatch(/not described/i);
  });

  it('explains itself by naming what actually drove the number', () => {
    const r = derivePalFromDay(labourerDay);
    expect(r.reasons[0].toLowerCase()).toContain('heavy manual work');
  });

  it('never presents the factor as measured', () => {
    const r = derivePalFromDay(deskDay);
    expect(r.reasons.join(' ')).toMatch(/estimate|not a measurement/i);
    expect(r.palLow).toBeLessThan(r.pal);
    expect(r.palHigh).toBeGreaterThan(r.pal);
  });

  it('ignores unknown activities rather than throwing', () => {
    const r = derivePalFromDay([...deskDay, h('paragliding_backwards', 2)]);
    expect(r.insufficient).toBe(false);
  });

  it('accounts for every described hour in the breakdown', () => {
    const r = derivePalFromDay(homemakerDay);
    const summed = r.breakdown.reduce((s, b) => s + b.hours, 0);
    expect(summed).toBeCloseTo(r.accountedHours, 1);
  });
});

describe('the explanation names real movement', () => {
  it('does not tell someone their movement comes from sleeping', () => {
    // Sleep is the longest block in almost every day, so ranking by raw
    // MET-hours put it top and produced a nonsense sentence.
    const day: DayEntry[] = [
      h('sleeping', 8, 'night'),
      h('desk_work', 8, 'midday'),
      h('walking_brisk', 1, 'morning'),
      h('cooking', 1, 'evening'),
      h('sitting_screen', 4, 'evening'),
    ];
    const r = derivePalFromDay(day);
    expect(r.reasons[0].toLowerCase()).not.toContain('sleeping');
    expect(r.reasons[0].toLowerCase()).toContain('walking');
  });

  it('ranks a short intense block above a long passive one', () => {
    const r = derivePalFromDay([
      h('sleeping', 8, 'night'),
      h('sitting_screen', 10, 'evening'),
      h('running', 1, 'morning'),
      h('desk_work', 4, 'midday'),
    ]);
    expect(r.reasons[0].toLowerCase()).toContain('running');
  });
});
