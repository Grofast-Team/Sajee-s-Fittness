import { describe, expect, it } from 'vitest';
import { analyseTrend, explainShortTermChange, fitRate, smooth, windowAverage } from '@/lib/engines/trend';
import type { WeighIn } from '@/lib/engines/types';

/** Build a series starting at `start` kg, changing by `perDay`, with noise. */
function series(days: number, start: number, perDay: number, noise: number[] = []): WeighIn[] {
  const out: WeighIn[] = [];
  const t0 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < days; i++) {
    const date = new Date(t0 + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, weightKg: start + perDay * i + (noise[i] ?? 0) });
  }
  return out;
}

describe('smooth', () => {
  it('damps a single spike far below its raw size', () => {
    const readings = series(10, 80, 0, [0, 0, 0, 0, 0, 2.0]);
    const points = smooth(readings);
    const spike = points[5];
    expect(spike.raw).toBe(82);
    // A 2 kg jump must not become a 2 kg jump in the trend line.
    expect(spike.smoothed - points[4].smoothed).toBeLessThan(0.7);
  });

  it('follows a sustained change', () => {
    const points = smooth(series(30, 90, -0.1));
    expect(points[29].smoothed).toBeLessThan(points[0].smoothed - 2);
  });
});

describe('fitRate', () => {
  it('recovers a known rate of change', () => {
    // -0.1 kg/day is -0.7 kg/week.
    const fit = fitRate(series(28, 90, -0.1));
    expect(fit).not.toBeNull();
    expect(fit!.kgPerWeek).toBeCloseTo(-0.7, 5);
  });

  it('returns null below three readings', () => {
    expect(fitRate(series(2, 90, -0.1))).toBeNull();
  });

  it('produces a wider confidence interval for noisier data', () => {
    const clean = fitRate(series(21, 90, -0.05))!;
    const noisy = fitRate(series(21, 90, -0.05, Array.from({ length: 21 }, (_, i) => (i % 2 ? 1.2 : -1.2))))!;
    expect(noisy.margin).toBeGreaterThan(clean.margin);
  });
});

describe('analyseTrend', () => {
  it('refuses to call a direction from two days of data', () => {
    const result = analyseTrend(series(2, 90, -0.3));
    expect(result.direction).toBe('unclear');
    expect(result.kgPerWeek).toBeNull();
  });

  it('says "too early to tell" when noise exceeds the signal', () => {
    const noisy = series(10, 90, -0.01, Array.from({ length: 10 }, (_, i) => (i % 2 ? 1.5 : -1.5)));
    const result = analyseTrend(noisy);
    expect(result.direction).toBe('unclear');
    expect(result.message).toMatch(/too early/i);
  });

  it('reports loss when the interval excludes zero', () => {
    const result = analyseTrend(series(28, 90, -0.09));
    expect(result.direction).toBe('losing');
    expect(result.kgPerWeek).toBeLessThan(0);
    expect(result.kgPerWeekMargin).not.toBeNull();
  });

  it('distinguishes a genuine hold from insufficient data', () => {
    const result = analyseTrend(series(28, 90, 0, Array.from({ length: 28 }, (_, i) => (i % 3) * 0.05)));
    expect(result.direction).toBe('holding');
    expect(result.message).toMatch(/holding steady/i);
  });

  it('handles an empty history without throwing', () => {
    const result = analyseTrend([]);
    expect(result.direction).toBe('unclear');
    expect(result.latestSmoothed).toBeNull();
  });
});

describe('windowAverage', () => {
  it('averages only the requested window', () => {
    const readings = series(14, 80, 0);
    readings[13].weightKg = 90;
    const avg = windowAverage(readings, '2026-01-14', 7);
    expect(avg).not.toBeNull();
    expect(avg!).toBeGreaterThan(80);
    expect(avg!).toBeLessThan(90);
  });
});

describe('explainShortTermChange', () => {
  it('uses arithmetic to show a two-day rise cannot be fat', () => {
    const result = explainShortTermChange(1.4, 2, { sodiumHeavyMeal: true });
    expect(result.causes.length).toBeGreaterThan(0);
    // 1.4 kg over 2 days implies ~5,390 kcal/day of surplus.
    expect(result.reassurance).toMatch(/5,390|5390/);
    expect(result.reassurance).toMatch(/water/i);
  });

  it('always offers at least one explanation even with no context', () => {
    expect(explainShortTermChange(0.8, 1).causes.length).toBeGreaterThan(0);
  });

  it('does not blame the user', () => {
    const result = explainShortTermChange(1.0, 2, { alcohol: true });
    expect(result.headline).not.toMatch(/fail|bad|cheat/i);
  });
});
