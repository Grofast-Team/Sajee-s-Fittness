import { describe, expect, it } from 'vitest';
import { resolvePortion, scaleToGrams } from '@/lib/engines/portion';
import { estimateNutrition, nutritionForGrams, remainingForDay } from '@/lib/engines/nutrition';
import type { FoodDensity } from '@/lib/engines/nutrition';

const dosa: FoodDensity = {
  name: 'Dosa',
  kcalPer100g: 168,
  proteinPer100g: 3.9,
  carbPer100g: 29.0,
  fatPer100g: 3.7,
  fibrePer100g: 1.2,
  foodState: 'cooked',
};

describe('scaleToGrams', () => {
  it('converts each supported unit', () => {
    expect(scaleToGrams({ present: true, displayReadable: true, value: 180, unit: 'g', containerOnScale: false })).toBe(180);
    expect(scaleToGrams({ present: true, displayReadable: true, value: 0.18, unit: 'kg', containerOnScale: false })).toBe(180);
  });

  it('returns null when the display could not be read', () => {
    expect(scaleToGrams({ present: true, displayReadable: false, value: null, unit: null, containerOnScale: false })).toBeNull();
  });

  it('rejects an implausible reading rather than logging it', () => {
    // A misread decimal point should fall through to estimation, not log 8 kg of rice.
    expect(scaleToGrams({ present: true, displayReadable: true, value: 8000, unit: 'g', containerOnScale: false })).toBeNull();
  });
});

describe('resolvePortion: scale-first protocol', () => {
  it('treats a tared scale reading as measured, with high confidence', () => {
    const result = resolvePortion({
      scale: { present: true, displayReadable: true, value: 180, unit: 'g', containerOnScale: true },
      tareConfirmed: true,
    });
    expect(result.basis).toBe('kitchen_scale');
    expect(result.confidence).toBe('high');
    expect(result.grams).toBe(180);
    expect(result.questions).toHaveLength(0);
    expect(result.explanation).toMatch(/measured, not estimated/i);
  });

  it('asks about the tare instead of guessing a vessel weight', () => {
    const result = resolvePortion({
      scale: { present: true, displayReadable: true, value: 430, unit: 'g', containerOnScale: true },
    });
    expect(result.confidence).toBe('medium');
    expect(result.questions.map((q) => q.id)).toContain('tare');
    expect(result.gramsHigh).toBe(430);
  });

  it('subtracts only a vessel weight the user supplied', () => {
    const result = resolvePortion({
      scale: { present: true, displayReadable: true, value: 430, unit: 'g', containerOnScale: true },
      vesselGrams: 250,
    });
    expect(result.grams).toBe(180);
    expect(result.confidence).toBe('high');
  });

  it('falls back to a range when the display is unreadable', () => {
    const result = resolvePortion({
      scale: { present: true, displayReadable: false, value: null, unit: null, containerOnScale: false },
      visual: { grams: 200 },
    });
    expect(result.basis).toBe('visual_estimate');
    expect(result.confidence).toBe('low');
    expect(result.grams).toBeNull();
    expect(result.gramsLow).toBe(130);
    expect(result.gramsHigh).toBe(270);
  });

  it('offers the scale tip when no scale was used', () => {
    const result = resolvePortion({ visual: { grams: 200 } });
    expect(result.questions.map((q) => q.id)).toContain('scale_tip');
  });

  it('prefers user-entered grams over a household measure', () => {
    const result = resolvePortion({
      userGrams: 210,
      household: { unitLabel: 'katori', grams: 150, count: 1 },
    });
    expect(result.basis).toBe('user_input');
    expect(result.grams).toBe(210);
  });

  it('maps a household measure with a wider band than a scale', () => {
    const result = resolvePortion({ household: { unitLabel: 'katori', grams: 150, count: 2 } });
    expect(result.grams).toBe(300);
    expect(result.confidence).toBe('medium');
    expect(result.gramsHigh! - result.gramsLow!).toBeGreaterThan(0);
  });

  it('asks for a quantity when it has nothing to work with', () => {
    const result = resolvePortion({});
    expect(result.grams).toBeNull();
    expect(result.questions).toHaveLength(1);
  });
});

describe('nutrition', () => {
  it('scales density by grams', () => {
    const n = nutritionForGrams(dosa, 180);
    expect(n.kcal).toBe(302);
    expect(n.proteinG).toBe(7);
  });

  it('gives a point estimate only when the portion was measured', () => {
    const portion = resolvePortion({ userGrams: 180 });
    const est = estimateNutrition(dosa, portion);
    expect(est.confidence).toBe('high');
    expect(est.kcalLow).toBeNull();
    expect(est.display).toBe('302 kcal');
  });

  it('renders a range, never false precision, for a visual estimate', () => {
    const portion = resolvePortion({ visual: { grams: 200 } });
    const est = estimateNutrition(dosa, portion);
    expect(est.confidence).toBe('low');
    expect(est.kcalLow).not.toBeNull();
    expect(est.display).toMatch(/^Estimated \d+–\d+ kcal$/);
    expect(est.kcalHigh! - est.kcalLow!).toBeGreaterThan(0);
  });

  it('handles a portion it could not resolve at all', () => {
    const est = estimateNutrition(dosa, resolvePortion({}));
    expect(est.display).toMatch(/not enough information/i);
  });
});

describe('remainingForDay', () => {
  it('reports what is left without moralising', () => {
    const r = remainingForDay(
      { kcal: 1200, proteinG: 60, carbG: 150, fatG: 40, fibreG: 12 },
      1750,
      95,
    );
    expect(r.kcalRemaining).toBe(550);
    expect(r.proteinRemaining).toBe(35);
    expect(r.kcalOver).toBe(false);
  });

  it('responds to going over target without shame or compensation advice', () => {
    const r = remainingForDay(
      { kcal: 2400, proteinG: 100, carbG: 300, fatG: 90, fibreG: 20 },
      1750,
      95,
    );
    expect(r.kcalOver).toBe(true);
    expect(r.message).toMatch(/does not undo your progress/i);
    expect(r.message).not.toMatch(/fast|skip|burn it off|punish/i);
  });
});
