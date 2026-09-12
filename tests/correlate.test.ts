import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  findCorrelations,
  permutationP,
  rank,
  spearman,
  MIN_PAIRS,
  type Hypothesis,
  type Series,
} from '@/lib/engines/correlate';

/** A reproducible pseudo-random stream, so "noise" means the same thing each run. */
function noise(n: number, seed = 7): number[] {
  let a = seed >>> 0;
  return Array.from({ length: n }, () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}

const series = (key: string, values: (number | null)[]): Series => ({ key, label: key, values });

describe('rank', () => {
  it('averages ties rather than inventing an order', () => {
    // Difficulty is a 1-5 scale, so a fortnight of ratings is mostly ties.
    // Sequential ranks would fabricate an ordering that is not in the data.
    expect(rank([3, 1, 3, 2])).toEqual([3.5, 1, 3.5, 2]);
  });

  it('handles a completely flat series', () => {
    expect(rank([5, 5, 5, 5])).toEqual([2.5, 2.5, 2.5, 2.5]);
  });
});

describe('spearman', () => {
  it('is 1 for a perfectly monotonic relationship, even a non-linear one', () => {
    const x = [1, 2, 3, 4, 5];
    const y = x.map((v) => v ** 3);
    expect(spearman(x, y)).toBeCloseTo(1, 5);
  });

  it('is -1 when one rises as the other falls', () => {
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 5);
  });

  it('reports zero for a flat series instead of dividing by zero', () => {
    expect(spearman([1, 2, 3, 4], [7, 7, 7, 7])).toBe(0);
    expect(Number.isNaN(spearman([1, 2, 3], [2, 2, 2]))).toBe(false);
  });
});

describe('permutationP', () => {
  it('reports a strong relationship as unlikely by chance', () => {
    const x = Array.from({ length: 30 }, (_, i) => i);
    const y = x.map((v) => v * 2 + 1);
    expect(permutationP(x, y)).toBeLessThan(0.01);
  });

  it('reports pure noise as ordinary', () => {
    const p = permutationP(noise(40, 1), noise(40, 99));
    expect(p).toBeGreaterThan(0.05);
  });

  it('never returns exactly zero, because no number of shuffles proves impossibility', () => {
    const x = Array.from({ length: 25 }, (_, i) => i);
    expect(permutationP(x, [...x])).toBeGreaterThan(0);
  });
});

describe('benjaminiHochberg', () => {
  it('rejects a batch of unremarkable p-values', () => {
    expect(benjaminiHochberg([0.2, 0.4, 0.6, 0.8], 0.1).every((s) => !s)).toBe(true);
  });

  it('keeps a clearly strong result', () => {
    expect(benjaminiHochberg([0.0001, 0.5, 0.6, 0.7], 0.1)[0]).toBe(true);
  });

  /*
   * The reason the correction exists. A single p = 0.04 among twenty tests is
   * exactly what noise produces, and reporting it as a discovery is the most
   * common way this kind of feature misleads people.
   */
  it('discards a lone borderline result hiding in a large batch', () => {
    const batch = [0.04, ...Array.from({ length: 19 }, (_, i) => 0.3 + i * 0.03)];
    expect(benjaminiHochberg(batch, 0.1)[0]).toBe(false);
  });

  it('is a step-up procedure: a weaker p survives alongside a stronger one', () => {
    // 0.02 alone would fail against 0.1 × 2/4; it survives because 0.001 does.
    const survives = benjaminiHochberg([0.001, 0.02, 0.9, 0.95], 0.1);
    expect(survives[0]).toBe(true);
    expect(survives[1]).toBe(true);
  });
});

describe('findCorrelations', () => {
  const hypotheses: Hypothesis[] = [
    { a: 'sleepHours', b: 'sessionDifficulty', together: 'Together.', opposite: 'Opposite.' },
  ];

  it('finds a real relationship and describes its direction', () => {
    // Long nights, easy sessions: the two move opposite ways.
    const sleep = Array.from({ length: 40 }, (_, i) => 5 + (i % 4));
    const difficulty = sleep.map((h) => 6 - h);

    const r = findCorrelations(
      [series('sleepHours', sleep), series('sessionDifficulty', difficulty)],
      hypotheses,
    );

    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].direction).toBe('opposite');
    expect(r.findings[0].message).toContain('Opposite.');
  });

  /* The single most important test here. */
  it('finds nothing in pure noise', () => {
    const r = findCorrelations(
      [series('sleepHours', noise(60, 3)), series('sessionDifficulty', noise(60, 500))],
      hypotheses,
    );
    expect(r.findings).toHaveLength(0);
  });

  it('refuses to test a relationship with too few overlapping days', () => {
    const short = Array.from({ length: MIN_PAIRS - 1 }, (_, i) => i);
    const r = findCorrelations(
      [series('sleepHours', short), series('sessionDifficulty', short)],
      hypotheses,
    );

    expect(r.findings).toHaveLength(0);
    expect(r.tested).toBe(0);
    // "We could not look" must be distinguishable from "we looked and found nothing".
    expect(r.skippedForData.length).toBe(1);
    expect(r.summary).toMatch(/not enough overlapping data/i);
  });

  it('only pairs days where both values exist', () => {
    // Nulls interleaved must not shift one series against the other.
    // Long enough that the complete pairs clear MIN_PAIRS on their own.
    const sleep: (number | null)[] = [];
    const difficulty: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const hours = 5 + (i % 4);
      // Every other day has no sleep reading; the difficulty rating is always
      // present, so a naive implementation would slide the two out of step.
      sleep.push(i % 2 === 0 ? hours : null);
      difficulty.push(i % 2 === 0 ? 6 - hours : 9);
    }

    const r = findCorrelations(
      [series('sleepHours', sleep), series('sessionDifficulty', difficulty)],
      hypotheses,
    );

    // Every complete pair has long sleep with easy sessions.
    expect(r.findings[0]?.direction).toBe('opposite');
    expect(r.findings[0]?.n).toBe(sleep.filter((v) => v !== null).length);
  });

  it('ignores a statistically clean but trivially weak relationship', () => {
    // Mostly noise with a faint signal: significant is not the same as useful.
    const base = noise(80, 11);
    const weak = base.map((v, i) => v * 0.2 + noise(80, 77)[i] * 0.8);

    const r = findCorrelations(
      [series('sleepHours', base), series('sessionDifficulty', weak)],
      hypotheses,
    );

    for (const f of r.findings) expect(Math.abs(f.r)).toBeGreaterThanOrEqual(0.35);
  });

  it('never uses causal language', () => {
    const sleep = Array.from({ length: 40 }, (_, i) => 5 + (i % 4));
    const r = findCorrelations(
      [series('sleepHours', sleep), series('sessionDifficulty', sleep.map((h) => 6 - h))],
      hypotheses,
    );

    const text = [r.summary, ...r.findings.map((f) => f.message)].join(' ').toLowerCase();
    expect(text).not.toMatch(/because|causes?\b|caused|proves|leads to|makes you/);
  });

  it('treats finding nothing as a result rather than a failure', () => {
    const r = findCorrelations(
      [series('sleepHours', noise(60, 3)), series('sessionDifficulty', noise(60, 500))],
      hypotheses,
    );
    expect(r.summary).toMatch(/real result, not a failure/i);
  });

  it('is reproducible: the same data gives the same answer', () => {
    const sleep = noise(50, 21);
    const difficulty = sleep.map((v, i) => v * 0.8 + noise(50, 22)[i] * 0.2);
    const input = [series('sleepHours', sleep), series('sessionDifficulty', difficulty)];

    expect(findCorrelations(input, hypotheses)).toEqual(findCorrelations(input, hypotheses));
  });
});
