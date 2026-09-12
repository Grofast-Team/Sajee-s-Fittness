/**
 * Looking for real patterns across everything the app records.
 *
 * Sleep, steps, energy, session difficulty, weight and spending are all keyed
 * by date and never looked at together. "The sessions you rate hardest follow
 * your shortest nights" is the kind of thing a person cannot see in their own
 * data and that this app is well placed to notice.
 *
 * It is also the single easiest feature in the whole product to do
 * dishonestly, so most of what follows is restraint rather than cleverness.
 *
 * ## Four rules
 *
 * **1. Hypotheses are pre-specified.** Testing every pair of a dozen series is
 * fishing: ~66 comparisons will hand you something "significant" from pure
 * noise every time. The list below is plausible relationships only, decided in
 * advance.
 *
 * **2. Multiple comparisons are corrected.** Even twelve honest tests at
 * p < 0.05 carry a ~46% chance of at least one false positive. Benjamini-
 * Hochberg controls the false discovery rate across the whole batch.
 *
 * **3. Significance is not enough — effect size gates too.** With sixty days a
 * correlation of 0.26 can be "significant" and still mean nothing anyone
 * should act on. Findings must clear |r| >= 0.35 as well.
 *
 * **4. Nothing claims causation.** Every phrasing is "goes with" or "tends
 * to". Short sleep and hard sessions may share a cause — a stressful week —
 * and the data cannot separate that from either causing the other.
 *
 * The test itself is a permutation test rather than the usual t-approximation:
 * difficulty ratings are ordinal and 1-5, weight changes are not normal, and
 * shuffling makes no distributional assumption at all.
 */

export interface Series {
  key: string;
  label: string;
  /** One entry per day in the window. Null where there is no reading. */
  values: (number | null)[];
}

export interface Finding {
  aKey: string;
  bKey: string;
  /** Spearman's rho, -1 to 1. */
  r: number;
  /** Complete pairs the correlation was computed from. */
  n: number;
  p: number;
  direction: 'together' | 'opposite';
  /** Shown verbatim. Correlational language only. */
  message: string;
}

export interface CorrelationResult {
  findings: Finding[];
  /**
   * Hypotheses that had enough overlapping days to actually examine.
   *
   * Counted *before* the effect-size gate, on purpose. Counting only the ones
   * strong enough to be candidates meant a run that looked at nine
   * relationships and found them all weak reported "not enough data" — which
   * is the exact confusion this field exists to prevent.
   */
  tested: number;
  /** Named so "we found nothing" can be told from "we could not look". */
  skippedForData: string[];
  summary: string;
}

/* ------------------------------------------------------------------ */
/* What we are willing to look for                                     */
/* ------------------------------------------------------------------ */

export interface Hypothesis {
  a: string;
  b: string;
  /** Written for the case where the two move together. */
  together: string;
  /** Written for the case where one rises as the other falls. */
  opposite: string;
}

/*
 * Pre-specified, and deliberately short.
 *
 * Each one is a relationship someone might plausibly act on. "Spending on
 * phone bills versus protein intake" is not on the list, and adding it would
 * cost statistical power for every other test through the correction.
 */
export const HYPOTHESES: Hypothesis[] = [
  {
    a: 'sleepHours',
    b: 'sessionDifficulty',
    together: 'Longer nights go with sessions that felt harder.',
    opposite: 'Your sessions tend to feel harder after shorter nights.',
  },
  {
    a: 'sleepHours',
    b: 'steps',
    together: 'You tend to walk more on days after a longer night.',
    opposite: 'You tend to walk more after shorter nights.',
  },
  {
    a: 'sleepHours',
    b: 'kcal',
    together: 'You tend to eat more after longer nights.',
    opposite: 'You tend to eat more after shorter nights.',
  },
  {
    a: 'steps',
    b: 'kcal',
    together: 'Days you move more are days you eat more.',
    opposite: 'Days you move more are days you eat less.',
  },
  {
    a: 'kcal',
    b: 'weightChange',
    together: 'Days you eat more are followed by the scale moving up.',
    opposite: 'Days you eat more are followed by the scale moving down.',
  },
  {
    a: 'steps',
    b: 'weightChange',
    together: 'Days you walk more go with the scale moving up.',
    opposite: 'Days you walk more go with the scale moving down.',
  },
  {
    a: 'sessionDifficulty',
    b: 'steps',
    together: 'Harder sessions go with days you also walk more.',
    opposite: 'Harder sessions go with days you walk less.',
  },
  {
    a: 'eatingOutSpend',
    b: 'kcal',
    together: 'Days you spend on eating out are days you eat more.',
    opposite: 'Days you spend on eating out are days you eat less.',
  },
  {
    a: 'waterMl',
    b: 'steps',
    together: 'You drink more on days you move more.',
    opposite: 'You drink less on days you move more.',
  },
];

/* ------------------------------------------------------------------ */
/* Thresholds                                                          */
/* ------------------------------------------------------------------ */

/** Fewer complete pairs than this and we do not test at all. */
export const MIN_PAIRS = 14;
/** Correlations weaker than this are not worth anyone's attention. */
export const MIN_EFFECT = 0.35;
/** False discovery rate across the batch. */
export const FDR_Q = 0.1;
const PERMUTATIONS = 2000;

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG, so a finding is reproducible and testable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ranks, with ties averaged.
 *
 * Tie handling matters more here than it looks: difficulty is a 1-5 scale, so
 * a fortnight of ratings is mostly ties. Assigning them sequential ranks would
 * invent an ordering that is not in the data.
 */
export function rank(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
  const ranks = new Array<number>(values.length);

  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j += 1;

    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k].i] = average;
    i = j + 1;
  }

  return ranks;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;

  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;

  let num = 0;
  let devA = 0;
  let devB = 0;

  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    devA += da * da;
    devB += db * db;
  }

  const denom = Math.sqrt(devA * devB);
  // A flat series has no correlation with anything; saying so beats dividing
  // by zero and reporting NaN as a finding.
  return denom === 0 ? 0 : num / denom;
}

/** Spearman's rho: Pearson on ranks. Robust to outliers and monotonic but
 *  non-linear relationships, both of which this data has. */
export function spearman(a: number[], b: number[]): number {
  return pearson(rank(a), rank(b));
}

/**
 * How often pure chance produces a correlation this strong.
 *
 * Shuffling one series breaks any real relationship while preserving both
 * distributions exactly, which is what makes this assumption-free. The `+1`s
 * are the standard correction that stops a p-value of exactly zero — no finite
 * number of shuffles can prove impossibility.
 */
export function permutationP(a: number[], b: number[], seed = 42): number {
  const observed = Math.abs(spearman(a, b));
  const random = mulberry32(seed);
  const shuffled = [...b];

  let atLeastAsExtreme = 0;

  for (let iteration = 0; iteration < PERMUTATIONS; iteration += 1) {
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (Math.abs(spearman(a, shuffled)) >= observed) atLeastAsExtreme += 1;
  }

  return (atLeastAsExtreme + 1) / (PERMUTATIONS + 1);
}

/**
 * Benjamini-Hochberg: which p-values survive once the batch is accounted for.
 *
 * Controls the expected share of *reported* findings that are false, which is
 * the quantity a user actually cares about. Bonferroni would control the
 * chance of any false positive at all and, at this sample size, would reject
 * everything including the true findings.
 */
export function benjaminiHochberg(pValues: number[], q = FDR_Q): boolean[] {
  const m = pValues.length;
  if (m === 0) return [];

  const ordered = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);

  let largestPassing = -1;
  for (let k = 0; k < m; k += 1) {
    if (ordered[k].p <= ((k + 1) / m) * q) largestPassing = k;
  }

  const survives = new Array<boolean>(m).fill(false);
  // Everything ranked at or below the largest passing p-value survives, which
  // is what makes the procedure a step-up rather than a simple threshold.
  for (let k = 0; k <= largestPassing; k += 1) survives[ordered[k].i] = true;

  return survives;
}

/* ------------------------------------------------------------------ */
/* The search                                                          */
/* ------------------------------------------------------------------ */

/** Days where both series have a reading. */
function completePairs(a: Series, b: Series): { a: number[]; b: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];

  const length = Math.min(a.values.length, b.values.length);
  for (let i = 0; i < length; i += 1) {
    const x = a.values[i];
    const y = b.values[i];
    if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }

  return { a: xs, b: ys };
}

export function findCorrelations(
  series: Series[],
  hypotheses: Hypothesis[] = HYPOTHESES,
  seed = 42,
): CorrelationResult {
  const byKey = new Map(series.map((s) => [s.key, s]));

  const candidates: { hypothesis: Hypothesis; r: number; n: number; p: number }[] = [];
  const skippedForData: string[] = [];
  let examined = 0;

  for (const hypothesis of hypotheses) {
    const a = byKey.get(hypothesis.a);
    const b = byKey.get(hypothesis.b);
    if (!a || !b) {
      skippedForData.push(`${hypothesis.a}/${hypothesis.b}`);
      continue;
    }

    const pairs = completePairs(a, b);
    if (pairs.a.length < MIN_PAIRS) {
      skippedForData.push(`${a.label} and ${b.label}`);
      continue;
    }

    examined += 1;
    const r = spearman(pairs.a, pairs.b);

    /*
     * Effect size first, and only then significance.
     *
     * Testing everything and filtering afterwards would inflate the batch the
     * correction has to account for, throwing away power on relationships we
     * had already decided were too weak to report.
     */
    if (Math.abs(r) < MIN_EFFECT) continue;

    candidates.push({
      hypothesis,
      r,
      n: pairs.a.length,
      p: permutationP(pairs.a, pairs.b, seed),
    });
  }

  const survives = benjaminiHochberg(candidates.map((c) => c.p));

  const findings: Finding[] = candidates
    .filter((_, i) => survives[i])
    .map((c) => ({
      aKey: c.hypothesis.a,
      bKey: c.hypothesis.b,
      r: Math.round(c.r * 100) / 100,
      n: c.n,
      p: Math.round(c.p * 1000) / 1000,
      direction: c.r > 0 ? ('together' as const) : ('opposite' as const),
      message: `${c.r > 0 ? c.hypothesis.together : c.hypothesis.opposite} ${strength(c.r)}, across ${c.n} days.`,
    }))
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  return {
    findings,
    tested: examined,
    skippedForData,
    summary: summarise(findings.length, examined, skippedForData.length),
  };
}

/** Plain words for a correlation coefficient. Never "proves" or "causes". */
function strength(r: number): string {
  const magnitude = Math.abs(r);
  if (magnitude >= 0.7) return 'That is a strong pattern';
  if (magnitude >= 0.5) return 'That is a clear pattern';
  return 'That is a mild pattern';
}

function summarise(found: number, tested: number, skipped: number): string {
  if (tested === 0) {
    return (
      'Not enough overlapping data yet to look for patterns. This needs a couple of weeks of ' +
      'days where more than one thing was recorded.'
    );
  }

  if (found === 0) {
    return (
      `Nothing stood out this time. We checked ${tested} possible pattern${tested === 1 ? '' : 's'} ` +
      `and none was strong enough to be worth telling you about — which is a real result, not a ` +
      `failure to find one.`
    );
  }

  const tail = skipped > 0 ? ` ${skipped} more need more days before we can look.` : '';
  return `${found} pattern${found === 1 ? '' : 's'} worth knowing about.${tail}`;
}
