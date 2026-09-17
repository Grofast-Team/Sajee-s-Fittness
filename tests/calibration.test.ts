import { describe, expect, it } from 'vitest';
import {
  MIN_SAMPLES_FOR_HIGH,
  TIGHT_SPREAD,
  calibrateServing,
  median,
} from '@/lib/engines/calibration';

describe('median', () => {
  it('takes the middle of an odd count and the mean of the middle two of an even one', () => {
    expect(median([84, 86, 88])).toBe(86);
    expect(median([80, 90])).toBe(85);
  });

  it('ignores values that cannot be a weight', () => {
    expect(median([0, -5, 84, Number.NaN, 86])).toBe(85);
    expect(median([])).toBeNull();
    expect(median([0, -1])).toBeNull();
  });
});

describe('calibrateServing', () => {
  it('falls back to the shared figure when nothing has been weighed', () => {
    const result = calibrateServing({ samples: [], populationGrams: 60 });
    expect(result.grams).toBe(60);
    expect(result.source).toBe('population');
    expect(result.confidence).toBe('medium');
    expect(result.explanation).toContain('not yours');
  });

  it('says it does not know rather than inventing a figure', () => {
    const result = calibrateServing({ samples: [], populationGrams: null });
    expect(result.grams).toBeNull();
    expect(result.source).toBe('unknown');
    expect(result.confidence).toBe('low');
  });

  it('prefers a single weighing of your own over the shared figure', () => {
    // The population number is a guess about everybody; one measurement is a
    // fact about this kitchen.
    const result = calibrateServing({ samples: [85], populationGrams: 60 });
    expect(result.grams).toBe(85);
    expect(result.source).toBe('yours');
  });

  it('reports a single sample as medium, not high', () => {
    const result = calibrateServing({ samples: [85], populationGrams: 60 });
    expect(result.confidence).toBe('medium');
    expect(result.explanation).toContain('one time');
  });

  it('reaches high once enough samples agree', () => {
    const result = calibrateServing({ samples: [84, 86, 85], populationGrams: 60 });
    expect(result.sampleCount).toBe(MIN_SAMPLES_FOR_HIGH);
    expect(result.confidence).toBe('high');
    expect(result.grams).toBe(85);
  });

  it('stays medium when the samples disagree, however many there are', () => {
    // Portions that genuinely vary should not be reported as precise.
    const result = calibrateServing({ samples: [60, 85, 120, 70, 110], populationGrams: 60 });
    expect(result.confidence).toBe('medium');
    expect(result.spread!).toBeGreaterThan(TIGHT_SPREAD);
    expect(result.explanation).toContain('vary');
  });

  it('is not dragged off course by one mis-tared weighing', () => {
    // 210 g is a plate left on the scale. A mean would give 127.
    const result = calibrateServing({ samples: [84, 86, 210], populationGrams: 60 });
    expect(result.grams).toBe(86);
  });

  it('keeps a lone outlier from being reported as precise', () => {
    const result = calibrateServing({ samples: [84, 86, 210], populationGrams: 60 });
    expect(result.confidence).toBe('medium');
  });

  it('discards impossible samples before deciding anything', () => {
    const result = calibrateServing({ samples: [85, 0, -12], populationGrams: 60 });
    expect(result.grams).toBe(85);
    expect(result.sampleCount).toBe(1);
  });

  it('leaves spread undefined for a single sample rather than calling it zero', () => {
    expect(calibrateServing({ samples: [85], populationGrams: null }).spread).toBeNull();
  });

  it('uses the documented spread threshold rather than a hidden one', () => {
    const mid = 100;
    // Exactly at the threshold counts as agreement.
    const atLimit = calibrateServing({
      samples: [mid - (mid * TIGHT_SPREAD) / 2, mid, mid + (mid * TIGHT_SPREAD) / 2],
      populationGrams: null,
    });
    expect(atLimit.confidence).toBe('high');
  });

  it('rounds to a tenth of a gram rather than showing float noise', () => {
    const result = calibrateServing({ samples: [85.04, 85.06], populationGrams: null });
    expect(result.grams).toBe(85.1);
  });
});
