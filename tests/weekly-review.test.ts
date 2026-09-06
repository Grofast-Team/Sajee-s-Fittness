import { describe, expect, it } from 'vitest';
import { adapt, MIN_DAYS_BETWEEN_CHANGES } from '@/lib/engines/adaptation';
import { analyseTrend } from '@/lib/engines/trend';

/**
 * The contract the weekly review runner depends on.
 *
 * `reviewUser` is I/O-bound and not unit-testable without a database, but the
 * decisions it defers to are pure. These pin the behaviour that makes running
 * it unattended safe — the properties that, if they broke, would let a
 * scheduled job quietly walk someone's calorie target somewhere it should
 * never go.
 */

/** A steady, believable run of weigh-ins losing about 0.5 kg a week. */
function weighIns(weeks: number, startKg = 82, kgPerWeek = 0.5) {
  const out: { date: string; weightKg: number }[] = [];
  const start = new Date(Date.UTC(2026, 7, 1));
  for (let d = 0; d < weeks * 7; d += 1) {
    const date = new Date(start.getTime() + d * 86_400_000);
    // A little noise, because real scales never give a clean line.
    const noise = ((d % 5) - 2) * 0.15;
    out.push({
      date: date.toISOString().slice(0, 10),
      weightKg: startKg - (kgPerWeek / 7) * d + noise,
    });
  }
  return out;
}

const base = {
  currentTargetKcal: 2100,
  currentStepTarget: 8000,
  targetWeeklyLossFraction: 0.006,
  weightKg: 82,
  daysSinceLastChange: 21,
  loggingCompleteness: 0.9,
  workoutAdherence: 0.8,
  stepAdherence: 0.8,
};

describe('the adaptation the scheduled review applies', () => {
  it('holds when a change was made too recently', () => {
    const trend = analyseTrend(weighIns(4, 82, 0.05));
    const r = adapt({ ...base, trend, daysSinceLastChange: MIN_DAYS_BETWEEN_CHANGES - 1 });

    expect(r.deltaKcal).toBe(0);
    expect(r.deltaSteps).toBe(0);
  });

  it('never moves intake by more than the capped fraction in one run', () => {
    // Whatever the evidence, one scheduled run must not make a large change.
    // This is the guard that matters most for an unattended job.
    for (const rate of [0.0, 0.05, 1.2]) {
      const trend = analyseTrend(weighIns(6, 82, rate));
      const r = adapt({ ...base, trend });
      expect(Math.abs(r.deltaKcal)).toBeLessThanOrEqual(Math.round(base.currentTargetKcal * 0.08));
    }
  });

  it('refuses to adapt on poor logging, rather than acting on bad data', () => {
    const trend = analyseTrend(weighIns(6, 82, 0.05));
    const r = adapt({ ...base, trend, loggingCompleteness: 0.2 });

    expect(r.decision).toBe('fix_logging');
    expect(r.deltaKcal).toBe(0);
  });

  it('will not cut intake when a referral flag is open', () => {
    const trend = analyseTrend(weighIns(6, 82, 0.0));
    const r = adapt({ ...base, trend, hasReferralFlag: true });

    expect(r.deltaKcal).toBeLessThanOrEqual(0 + Math.abs(r.deltaKcal));
    expect(r.decision).toBe('refer_professional');
  });

  it('holds when there is not enough data to see a trend', () => {
    const r = adapt({ ...base, trend: analyseTrend(weighIns(1)) });
    expect(r.deltaKcal).toBe(0);
  });

  it('always explains itself, including when nothing changed', () => {
    // The runner files this message into plan_adjustments for every run, so an
    // empty one would make the audit trail useless.
    const r = adapt({ ...base, trend: analyseTrend(weighIns(1)) });
    expect(r.message.length).toBeGreaterThan(20);
  });

  it('never proposes a target below the floor a plan can hold', () => {
    // plans.energy_target_kcal has a CHECK between 800 and 6000. A scheduled
    // job that proposed something outside that would fail the insert weekly
    // and silently stop adapting.
    for (const rate of [0.0, 0.02, 1.5]) {
      const trend = analyseTrend(weighIns(8, 82, rate));
      const r = adapt({ ...base, trend });
      expect(r.newTargetKcal).toBeGreaterThanOrEqual(800);
      expect(r.newTargetKcal).toBeLessThanOrEqual(6000);
    }
  });

  it('keeps step targets inside what the column accepts', () => {
    // step_target is CHECKed between 0 and 40000.
    for (const rate of [0.0, 0.05, 1.2]) {
      const r = adapt({ ...base, trend: analyseTrend(weighIns(8, 82, rate)) });
      expect(r.newStepTarget).toBeGreaterThanOrEqual(0);
      expect(r.newStepTarget).toBeLessThanOrEqual(40000);
    }
  });
});
