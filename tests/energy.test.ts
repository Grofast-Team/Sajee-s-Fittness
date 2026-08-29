import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FACTORS,
  activityKcal,
  deriveActivityLevel,
  estimateBmr,
  estimateTdee,
  hasReliableBodyFat,
} from '@/lib/engines/energy';
import type { BodyInput } from '@/lib/engines/types';

const male35: BodyInput = { weightKg: 85, heightCm: 175, ageYears: 35, sex: 'male' };
const female30: BodyInput = { weightKg: 68, heightCm: 160, ageYears: 30, sex: 'female' };

describe('estimateBmr', () => {
  it('matches Mifflin-St Jeor by hand for a male', () => {
    // 10*85 + 6.25*175 - 5*35 + 5 = 850 + 1093.75 - 175 + 5 = 1773.75
    expect(estimateBmr(male35).kcal).toBe(1774);
    expect(estimateBmr(male35).equation).toBe('mifflin_st_jeor');
  });

  it('matches Mifflin-St Jeor by hand for a female', () => {
    // 10*68 + 6.25*160 - 5*30 - 161 = 680 + 1000 - 150 - 161 = 1369
    expect(estimateBmr(female30).kcal).toBe(1369);
  });

  it('returns a plus/minus 10% band rather than a bare number', () => {
    const est = estimateBmr(male35);
    expect(est.lowKcal).toBeLessThan(est.kcal);
    expect(est.highKcal).toBeGreaterThan(est.kcal);
    expect(est.highKcal - est.kcal).toBe(Math.round(est.kcal * 0.1));
  });

  it('uses Katch-McArdle only when body fat came from a reliable method', () => {
    const reliable = { ...male35, bodyFatPct: 22, bodyFatMethod: 'dexa' as const };
    expect(estimateBmr(reliable).equation).toBe('katch_mcardle');
    // 370 + 21.6 * (85 * 0.78) = 370 + 21.6 * 66.3 = 1802.08
    expect(estimateBmr(reliable).kcal).toBe(1802);
  });

  it('ignores a self-guessed body fat percentage', () => {
    const guessed = { ...male35, bodyFatPct: 22, bodyFatMethod: 'visual_estimate' as const };
    expect(hasReliableBodyFat(guessed)).toBe(false);
    expect(estimateBmr(guessed).equation).toBe('mifflin_st_jeor');
  });

  it('averages the sex terms rather than assuming one', () => {
    const unspecified = { ...male35, sex: 'prefer_not_to_say' as const };
    const value = estimateBmr(unspecified).kcal;
    expect(value).toBeLessThan(estimateBmr(male35).kcal);
    expect(value).toBeGreaterThan(estimateBmr({ ...male35, sex: 'female' }).kcal);
  });
});

describe('deriveActivityLevel', () => {
  it('classifies a low-step desk worker as sedentary', () => {
    const result = deriveActivityLevel({
      workPattern: 'desk',
      sittingHours: 11,
      baselineSteps: 2800,
      trainingDaysPerWeek: 0,
    });
    expect(result.level).toBe('sedentary');
    expect(result.factor).toBe(ACTIVITY_FACTORS.sedentary);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('classifies a physical worker who trains as active or above', () => {
    const result = deriveActivityLevel({
      workPattern: 'physical',
      baselineSteps: 12000,
      trainingDaysPerWeek: 5,
    });
    expect(['active', 'very_active']).toContain(result.level);
  });

  it('gives every classification a stated reason', () => {
    const result = deriveActivityLevel({ workPattern: 'mixed', baselineSteps: 8000, trainingDaysPerWeek: 3 });
    expect(result.level).toBe('moderate');
    expect(result.reasons.join(' ')).toContain('8,000');
  });
});

describe('estimateTdee', () => {
  it('multiplies BMR by the activity factor', () => {
    expect(estimateTdee(1774, 'sedentary')).toBe(Math.round(1774 * 1.2));
    expect(estimateTdee(1774, 'moderate')).toBe(Math.round(1774 * 1.55));
  });
});

describe('activityKcal', () => {
  it('subtracts resting expenditure so burn is not double counted', () => {
    // A 5 MET activity nets (5-1), not 5.
    const net = activityKcal(5, 80, 30);
    const naive = Math.round(((5 * 3.5 * 80) / 200) * 30);
    expect(net).toBeLessThan(naive);
    expect(net).toBe(Math.round(((4 * 3.5 * 80) / 200) * 30));
  });

  it('returns zero for resting-level activity', () => {
    expect(activityKcal(1, 80, 60)).toBe(0);
    expect(activityKcal(5, 80, 0)).toBe(0);
  });
});
