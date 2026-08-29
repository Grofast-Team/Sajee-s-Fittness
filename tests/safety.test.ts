import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  bmi,
  deficitBlocked,
  requiresReferral,
  restrictionsFrom,
  screen,
} from '@/lib/engines/safety';
import { computeEnergyTarget } from '@/lib/engines/targets';
import type { BodyInput } from '@/lib/engines/types';

const base: BodyInput = { weightKg: 85, heightCm: 175, ageYears: 35, sex: 'male' };

describe('screen', () => {
  it('raises nothing for a straightforward profile', () => {
    expect(screen(base)).toHaveLength(0);
  });

  it('blocks a deficit during pregnancy but keeps the app usable', () => {
    const flags = screen({ ...base, sex: 'female', pregnant: true });
    expect(flags.map((f) => f.code)).toContain('pregnancy');
    expect(deficitBlocked(flags)).toBe(true);
    expect(requiresReferral(flags)).toBe(true);
    // Not a refusal: the guidance still offers the tracking features.
    expect(flags[0].guidance).toMatch(/tracking/i);
  });

  it('restricts aggressive deficits while breastfeeding without blocking entirely', () => {
    const flags = screen({ ...base, sex: 'female', breastfeeding: true });
    const r = restrictionsFrom(flags);
    expect(r.has(CAPABILITIES.AGGRESSIVE)).toBe(true);
    expect(r.has(CAPABILITIES.DEFICIT)).toBe(false);
  });

  it('turns off weight gamification for disordered eating history', () => {
    const flags = screen({ ...base, eatingDisorderHistory: true });
    const r = restrictionsFrom(flags);
    expect(r.has(CAPABILITIES.WEIGHT_GAMIFICATION)).toBe(true);
    expect(r.has(CAPABILITIES.DEFICIT)).toBe(true);
  });

  it('flags underweight from BMI', () => {
    const thin: BodyInput = { weightKg: 45, heightCm: 175, ageYears: 25, sex: 'male' };
    expect(bmi(thin)).toBeLessThan(18.5);
    expect(screen(thin).map((f) => f.code)).toContain('underweight');
  });

  it('cautions on medicated diabetes and tells the user to involve their prescriber', () => {
    const flags = screen({ ...base, diabetesOnMedication: true });
    const flag = flags.find((f) => f.code === 'diabetes_medicated');
    expect(flag).toBeDefined();
    expect(flag!.guidance).toMatch(/doctor/i);
  });

  it('stacks restrictions across multiple conditions', () => {
    const flags = screen({ ...base, recentSurgery: true, cardiovascularCondition: true });
    const r = restrictionsFrom(flags);
    expect(r.has(CAPABILITIES.HIGH_INTENSITY)).toBe(true);
    expect(r.has(CAPABILITIES.AGGRESSIVE)).toBe(true);
  });
});

describe('unrealistic timeline handling', () => {
  it('does not accept 10 kg in 4 weeks, and offers a real date instead', () => {
    const flags = screen({
      ...base,
      requestedTargetWeightKg: 75,
      requestedWeeks: 4,
    });
    const flag = flags.find((f) => f.code === 'unrealistic_timeline');
    expect(flag).toBeDefined();
    // Keeps the destination, moves the date.
    expect(flag!.guidance).toMatch(/weeks/);
    expect(flag!.guidance).toMatch(/goal weight the same/i);
  });

  it('accepts a reasonable timeline silently', () => {
    const flags = screen({ ...base, requestedTargetWeightKg: 80, requestedWeeks: 12 });
    expect(flags.find((f) => f.code === 'unrealistic_timeline')).toBeUndefined();
  });
});

describe('safety flags actually constrain the calorie engine', () => {
  it('a screening restriction changes the computed target, not just the copy', () => {
    const flags = screen({ ...base, sex: 'female', breastfeeding: true });
    const restrictions = [...restrictionsFrom(flags)];

    const unrestricted = computeEnergyTarget(base, 1774, 2750, 'firm');
    const restricted = computeEnergyTarget(base, 1774, 2750, 'firm', { restrictions });

    expect(restricted.targetKcal).toBeGreaterThan(unrestricted.targetKcal);
  });
});
