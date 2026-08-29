import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_FLOOR_KCAL,
  computeEnergyTarget,
  computeMacros,
  referenceWeightKg,
  waterTargetMl,
} from '@/lib/engines/targets';
import type { BodyInput } from '@/lib/engines/types';

const male: BodyInput = { weightKg: 85, heightCm: 175, ageYears: 35, sex: 'male' };
const smallFemale: BodyInput = { weightKg: 50, heightCm: 152, ageYears: 45, sex: 'female' };

describe('computeEnergyTarget safety floors', () => {
  it('applies the requested pace when nothing binds', () => {
    const t = computeEnergyTarget(male, 1774, 2750, 'steady');
    // 2750 x 0.82 = 2255, rounded to the nearest 10 kcal.
    expect(t.targetKcal).toBe(2260);
    expect(t.bindingConstraint).toBe('requested_pace');
  });

  it('never plans below the absolute floor', () => {
    // Small person, low maintenance: a 25% cut would breach the floor.
    const t = computeEnergyTarget(smallFemale, 1150, 1450, 'firm');
    expect(t.targetKcal).toBeGreaterThanOrEqual(ABSOLUTE_FLOOR_KCAL.female);
  });

  it('never plans a sustained intake below resting expenditure', () => {
    const t = computeEnergyTarget(male, 1900, 2200, 'firm');
    expect(t.targetKcal).toBeGreaterThanOrEqual(1900);
    expect(['bmr_floor', 'max_weekly_loss', 'absolute_energy_floor']).toContain(t.bindingConstraint);
  });

  it('caps weekly loss at about 1% of bodyweight', () => {
    const t = computeEnergyTarget(male, 1774, 4000, 'firm');
    expect(t.projectedWeeklyLossKg).toBeLessThanOrEqual(85 * 0.01 + 0.02);
  });

  it('downgrades an aggressive pace when a safety flag restricts it', () => {
    const firm = computeEnergyTarget(male, 1774, 2750, 'firm');
    const restricted = computeEnergyTarget(male, 1774, 2750, 'firm', {
      restrictions: ['aggressive_deficit'],
    });
    expect(restricted.targetKcal).toBeGreaterThan(firm.targetKcal);
    expect(restricted.bindingConstraint).toBe('safety_flag');
  });

  it('always explains which limit bound the number', () => {
    const t = computeEnergyTarget(smallFemale, 1150, 1450, 'firm');
    expect(t.explanation.length).toBeGreaterThan(50);
    expect(t.explanation).toContain('kcal');
  });

  it('never returns a target above maintenance for a deficit plan', () => {
    const t = computeEnergyTarget(male, 1774, 2000, 'gentle');
    expect(t.targetKcal).toBeLessThanOrEqual(2000);
  });
});

describe('computeMacros', () => {
  it('doses protein against goal weight rather than scale weight in obesity', () => {
    const heavy: BodyInput = { weightKg: 130, heightCm: 170, ageYears: 40, sex: 'male' };
    const ref = referenceWeightKg(heavy);
    expect(ref).toBeLessThan(heavy.weightKg);
    // 1.8 g/kg of 130 kg would be 234 g, which is neither needed nor affordable.
    const macros = computeMacros(heavy, 2200);
    expect(macros.proteinG).toBeLessThan(200);
  });

  it('uses actual weight when BMI is in range', () => {
    expect(referenceWeightKg(male)).toBe(85);
  });

  it('keeps macros consistent with the energy target', () => {
    const target = 2100;
    const m = computeMacros(male, target);
    const fromMacros = m.proteinG * 4 + m.carbG * 4 + m.fatG * 9;
    expect(Math.abs(fromMacros - target)).toBeLessThan(30);
  });

  it('never lets carbohydrate go negative at a low target', () => {
    const m = computeMacros(smallFemale, 1200);
    expect(m.carbG).toBeGreaterThanOrEqual(0);
    expect(m.proteinG).toBeGreaterThan(0);
    expect(m.fatG).toBeGreaterThan(0);
  });

  it('caps protein at 40% of energy', () => {
    const m = computeMacros(male, 1500);
    expect(m.proteinG * 4).toBeLessThanOrEqual(1500 * 0.4 + 4);
  });

  it('scales fibre with energy and caps it', () => {
    expect(computeMacros(male, 2000).fibreG).toBe(28);
    expect(computeMacros(male, 4000).fibreG).toBe(40);
  });
});

describe('waterTargetMl', () => {
  it('personalises rather than giving everyone the same number', () => {
    expect(waterTargetMl(male)).not.toBe(waterTargetMl(smallFemale));
  });

  it('stays within sane bounds', () => {
    const huge: BodyInput = { weightKg: 200, heightCm: 190, ageYears: 30, sex: 'male' };
    expect(waterTargetMl(huge, 120, true)).toBeLessThanOrEqual(4000);
    expect(waterTargetMl(smallFemale)).toBeGreaterThanOrEqual(1500);
  });
});
