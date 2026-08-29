import { describe, expect, it } from 'vitest';
import { MAX_ADJUSTMENT_FRACTION, adapt, detectPlateau } from '@/lib/engines/adaptation';
import { recoveryPlan, scoreAdherence } from '@/lib/engines/adherence';
import { initialStepGoal, progressStepGoal } from '@/lib/engines/steps';
import type { AdaptationInput } from '@/lib/engines/adaptation';
import type { TrendResult } from '@/lib/engines/types';

function trend(kgPerWeek: number | null, overrides: Partial<TrendResult> = {}): TrendResult {
  return {
    points: [],
    latestSmoothed: 85,
    kgPerWeek,
    kgPerWeekMargin: 0.1,
    direction: kgPerWeek === null ? 'unclear' : kgPerWeek < 0 ? 'losing' : 'gaining',
    daysOfData: 28,
    readingCount: 20,
    message: '',
    ...overrides,
  };
}

const healthy: AdaptationInput = {
  trend: trend(-0.5),
  currentTargetKcal: 2200,
  currentStepTarget: 8000,
  targetWeeklyLossFraction: 0.006,
  weightKg: 85,
  daysSinceLastChange: 21,
  loggingCompleteness: 0.9,
  workoutAdherence: 0.9,
  stepAdherence: 0.9,
};

describe('adapt gates', () => {
  it('does nothing within 14 days of the last change', () => {
    const r = adapt({ ...healthy, daysSinceLastChange: 5 });
    expect(r.decision).toBe('hold');
    expect(r.deltaKcal).toBe(0);
  });

  it('does nothing without enough weigh-ins', () => {
    const r = adapt({ ...healthy, trend: trend(-0.5, { readingCount: 4 }) });
    expect(r.decision).toBe('insufficient_data');
  });

  it('fixes logging before touching calories', () => {
    const r = adapt({ ...healthy, trend: trend(-0.02), loggingCompleteness: 0.4 });
    expect(r.decision).toBe('fix_logging');
    expect(r.newTargetKcal).toBe(healthy.currentTargetKcal);
    expect(r.message).toMatch(/nothing to feel bad about/i);
  });

  it('refuses to auto-adjust while a referral flag is open', () => {
    const r = adapt({ ...healthy, hasReferralFlag: true, trend: trend(-0.02) });
    expect(r.decision).toBe('refer_professional');
    expect(r.deltaKcal).toBe(0);
  });
});

describe('adapt decisions', () => {
  it('holds and says so when progress is on target', () => {
    const r = adapt(healthy);
    expect(r.decision).toBe('hold');
    expect(r.message).toMatch(/right where we want it/i);
  });

  it('raises intake when loss is too fast', () => {
    const r = adapt({ ...healthy, trend: trend(-1.5) });
    expect(r.decision).toBe('increase_intake');
    expect(r.deltaKcal).toBeGreaterThan(0);
    expect(r.message).toMatch(/faster than we want/i);
  });

  it('asks what got in the way rather than cutting food when adherence is poor', () => {
    const r = adapt({ ...healthy, trend: trend(-0.02), stepAdherence: 0.3, workoutAdherence: 0.3 });
    expect(r.decision).toBe('investigate_adherence');
    expect(r.newTargetKcal).toBe(healthy.currentTargetKcal);
  });

  it('adds steps rather than cutting food when the user is hungry', () => {
    const r = adapt({ ...healthy, trend: trend(-0.02), hunger: 5 });
    expect(r.decision).toBe('increase_steps');
    expect(r.deltaKcal).toBe(0);
    expect(r.deltaSteps).toBeGreaterThan(0);
  });

  it('cuts intake only when adherence is good and the user feels fine', () => {
    const r = adapt({ ...healthy, trend: trend(-0.02), hunger: 2, energy: 4 });
    expect(r.decision).toBe('reduce_intake');
    expect(r.deltaKcal).toBeLessThan(0);
  });

  it('never adjusts by more than the hard cap', () => {
    const r = adapt({ ...healthy, trend: trend(-0.02), hunger: 2, energy: 4, currentTargetKcal: 3000 });
    expect(Math.abs(r.deltaKcal)).toBeLessThanOrEqual(3000 * MAX_ADJUSTMENT_FRACTION);
  });

  it('changes exactly one lever at a time', () => {
    const cases = [trend(-1.5), trend(-0.02), trend(-0.5)];
    for (const t of cases) {
      const r = adapt({ ...healthy, trend: t, hunger: 2, energy: 4 });
      const levers = [r.deltaKcal !== 0, r.deltaSteps !== 0].filter(Boolean).length;
      expect(levers).toBeLessThanOrEqual(1);
    }
  });
});

describe('detectPlateau', () => {
  const flat = trend(0.0, { direction: 'holding', daysOfData: 28 });

  it('is not a plateau after a few days', () => {
    const r = detectPlateau({
      trend: trend(0, { direction: 'holding', daysOfData: 5 }),
      loggingCompleteness: 0.9,
      stepTrendDown: false, sleepBelowTarget: false,
      cycleTracked: false, inLutealPhase: false,
      recentDietChange: false, waistChangedCm: null,
    });
    expect(r.isPlateau).toBe(false);
    expect(r.verdict).toMatch(/three weeks/i);
  });

  it('is not a plateau while weight is still moving', () => {
    const r = detectPlateau({
      trend: trend(-0.4, { direction: 'losing' }),
      loggingCompleteness: 0.9,
      stepTrendDown: false, sleepBelowTarget: false,
      cycleTracked: false, inLutealPhase: false,
      recentDietChange: false, waistChangedCm: null,
    });
    expect(r.isPlateau).toBe(false);
  });

  it('leads with waist progress when the tape disagrees with the scale', () => {
    const r = detectPlateau({
      trend: flat,
      loggingCompleteness: 0.95,
      stepTrendDown: false, sleepBelowTarget: false,
      cycleTracked: false, inLutealPhase: false,
      recentDietChange: false, waistChangedCm: -2,
    });
    expect(r.isPlateau).toBe(true);
    expect(r.checks[0].label).toMatch(/waist/i);
  });

  it('ranks metabolic adaptation last, not first', () => {
    const r = detectPlateau({
      trend: flat,
      loggingCompleteness: 0.6,
      stepTrendDown: true, sleepBelowTarget: true,
      cycleTracked: false, inLutealPhase: false,
      recentDietChange: false, waistChangedCm: null,
    });
    expect(r.checks[r.checks.length - 1].label).toMatch(/metabolic/i);
    expect(r.checks[0].label).toMatch(/logging/i);
  });
});

describe('scoreAdherence', () => {
  const week = {
    daysInPeriod: 7, daysLogged: 7, daysWithinKcalRange: 6, daysProteinMet: 5,
    daysStepGoalMet: 5, workoutsPlanned: 3, workoutsCompleted: 3,
    daysSleepTargetMet: 4, weighIns: 5,
  };

  it('scores a strong week highly', () => {
    const r = scoreAdherence(week);
    // 5/7 protein and 4/7 sleep is a good week, not a perfect one.
    expect(r.score).toBeGreaterThan(80);
    expect(r.band).toBe('good');
  });

  it('reserves the top band for a near-perfect week', () => {
    const r = scoreAdherence({
      daysInPeriod: 7, daysLogged: 7, daysWithinKcalRange: 7, daysProteinMet: 7,
      daysStepGoalMet: 6, workoutsPlanned: 3, workoutsCompleted: 3,
      daysSleepTargetMet: 6, weighIns: 7,
    });
    expect(r.band).toBe('excellent');
  });

  it('identifies the highest-leverage gap, not merely the lowest score', () => {
    const r = scoreAdherence({ ...week, daysLogged: 2, daysSleepTargetMet: 0 });
    // Sleep scores 0 but carries 5% weight; logging carries 25%.
    expect(r.biggestOpportunity?.key).toBe('logging');
  });

  it('does not penalise a week with no workouts scheduled', () => {
    const r = scoreAdherence({ ...week, workoutsPlanned: 0, workoutsCompleted: 0 });
    expect(r.score).toBeGreaterThan(80);
  });

  it('phrases a poor week without shaming', () => {
    const r = scoreAdherence({
      daysInPeriod: 7, daysLogged: 1, daysWithinKcalRange: 1, daysProteinMet: 0,
      daysStepGoalMet: 0, workoutsPlanned: 3, workoutsCompleted: 0,
      daysSleepTargetMet: 1, weighIns: 1,
    });
    expect(r.band).toBe('struggling');
    expect(r.summary).not.toMatch(/fail|lazy|bad|excuse/i);
  });
});

describe('recoveryPlan', () => {
  it('never recommends compensating for a missed day', () => {
    for (const days of [1, 3, 10]) {
      const plan = recoveryPlan(days);
      const text = [plan.headline, ...plan.steps, plan.ask ?? ''].join(' ');
      expect(text).not.toMatch(/fast(ing)? to make up|double workout|punish|burn it off/i);
    }
  });

  it('asks what went wrong after a longer gap rather than restating the plan', () => {
    expect(recoveryPlan(7).ask).toMatch(/what made it hard/i);
  });
});

describe('step goals', () => {
  it('does not hand a 2,800-step user a 10,000-step goal', () => {
    const goal = initialStepGoal({ baselineSteps: 2800 });
    expect(goal.target).toBeLessThan(5000);
    expect(goal.target).toBeGreaterThan(2800);
    expect(goal.explanation).toMatch(/10,000/);
  });

  it('caps the first increase', () => {
    const goal = initialStepGoal({ baselineSteps: 20000 });
    expect(goal.increase).toBeLessThanOrEqual(2000);
  });

  it('ramps more gently when mobility is limited', () => {
    const normal = initialStepGoal({ baselineSteps: 6000 });
    const limited = initialStepGoal({ baselineSteps: 6000, restrictions: ['high_intensity_training'] });
    expect(limited.target).toBeLessThan(normal.target);
  });

  it('steps the goal down after a bad week instead of accumulating debt', () => {
    const next = progressStepGoal({ currentTarget: 8000, baseline: 5000, daysMetLastWeek: 1 });
    expect(next.target).toBeLessThan(8000);
    expect(next.explanation).toMatch(/target you can actually hit/i);
  });

  it('progresses after a good week', () => {
    const next = progressStepGoal({ currentTarget: 8000, baseline: 5000, daysMetLastWeek: 6 });
    expect(next.target).toBe(8500);
  });

  it('never falls below the baseline', () => {
    const next = progressStepGoal({ currentTarget: 5200, baseline: 5000, daysMetLastWeek: 0 });
    expect(next.target).toBeGreaterThanOrEqual(5000);
  });
});
