import { describe, expect, it } from 'vitest';
import { assessSteps, summarise, type StepSegment } from '@/lib/engines/step-validity';

/** Build a segment running `minutes` from a fixed hour, so times are readable. */
function seg(hour: number, minutes: number, steps: number, sourceName?: string): StepSegment {
  const start = new Date(Date.UTC(2026, 8, 5, hour, 0, 0));
  const end = new Date(start.getTime() + minutes * 60_000);
  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    steps,
    sourceName,
  };
}

describe('assessSteps — ordinary days are left alone', () => {
  it('counts a normal walking day in full', () => {
    const r = assessSteps([
      seg(7, 30, 3200, 'Google Fit'),
      seg(12, 20, 1900, 'Google Fit'),
      seg(18, 25, 2600, 'Google Fit'),
    ]);

    expect(r.validatedSteps).toBe(7700);
    expect(r.excludedSteps).toBe(0);
    expect(r.confidence).toBe('high');
  });

  it('leaves a genuine run alone', () => {
    // 180 steps a minute for 30 minutes is a real runner, not noise.
    const r = assessSteps([seg(6, 30, 5400, 'Google Fit')]);
    expect(r.validatedSteps).toBe(5400);
    expect(r.segments[0].cadence).toBe(180);
    expect(r.segments[0].counted).toBe(true);
  });

  it('never reports more validated than raw steps', () => {
    const r = assessSteps([seg(9, 10, 900, 'Fitbit'), seg(10, 10, 800, 'Fitbit')]);
    expect(r.validatedSteps).toBeLessThanOrEqual(r.rawSteps);
    expect(r.validatedSteps + r.excludedSteps).toBe(r.rawSteps);
  });

  it('keeps the device total untouched even when it excludes things', () => {
    const r = assessSteps([seg(8, 1, 900, 'Google Fit'), seg(9, 30, 3000, 'Google Fit')]);
    // The raw figure is what the phone said, regardless of our opinion of it.
    expect(r.rawSteps).toBe(3900);
    expect(r.validatedSteps).toBe(3000);
  });
});

describe('assessSteps — double counting across apps', () => {
  it('does not count the same walk twice', () => {
    const r = assessSteps([
      seg(7, 60, 6000, 'Google Fit'),
      seg(7, 60, 6000, 'Samsung Health'),
    ]);

    // One walk happened. The total must reflect one walk.
    expect(r.validatedSteps).toBe(6000);
    expect(r.excludedSteps).toBe(6000);
    expect(r.segments.some((s) => s.reason === 'duplicate_source')).toBe(true);
  });

  it('picks the app with the most coverage, not the highest count', () => {
    // Samsung reports a wildly inflated number over a short window; Google Fit
    // covers the actual day. Choosing on step count would reward the inflation.
    const r = assessSteps([
      seg(7, 120, 8000, 'Google Fit'),
      seg(7, 10, 30000, 'Samsung Health'),
    ]);

    expect(r.validatedSteps).toBe(8000);
    expect(r.segments.find((s) => s.sourceName === 'Samsung Health')?.counted).toBe(false);
  });

  it('does not apply the duplicate rule when only one app is writing', () => {
    const r = assessSteps([seg(7, 30, 3000, 'Google Fit'), seg(9, 30, 3000, 'Google Fit')]);
    expect(r.segments.every((s) => s.counted)).toBe(true);
    expect(r.excludedSteps).toBe(0);
  });

  it('explains a dropped duplicate without implying steps were lost', () => {
    const r = assessSteps([seg(7, 60, 6000, 'Google Fit'), seg(7, 60, 6000, 'Samsung Health')]);
    const dropped = r.segments.find((s) => !s.counted);
    expect(dropped?.note).toMatch(/nothing was lost/i);
  });
});

describe('assessSteps — implausible cadence', () => {
  it('drops a stretch no person could produce', () => {
    // 900 steps in one minute.
    const r = assessSteps([seg(8, 1, 900, 'Google Fit')]);
    expect(r.segments[0].counted).toBe(false);
    expect(r.segments[0].reason).toBe('impossible_cadence');
  });

  it('does not judge cadence on segments too short to mean anything', () => {
    // 30 steps in 10 seconds reads as 180/min, but ten seconds of data cannot
    // support any accusation.
    const start = new Date(Date.UTC(2026, 8, 5, 8, 0, 0));
    const r = assessSteps([
      {
        startDate: start.toISOString(),
        endDate: new Date(start.getTime() + 10_000).toISOString(),
        steps: 30,
        sourceName: 'Google Fit',
      },
    ]);
    expect(r.segments[0].cadence).toBeNull();
    expect(r.segments[0].counted).toBe(true);
  });

  it('keeps a fast but human cadence', () => {
    // 235/min — right below the bound. A real sprint interval survives.
    const r = assessSteps([seg(8, 2, 470, 'Google Fit')]);
    expect(r.segments[0].counted).toBe(true);
  });
});

describe('assessSteps — wheel-based workouts', () => {
  it('does not count steps recorded during a cycling session', () => {
    const r = assessSteps(
      [seg(17, 45, 900, 'Google Fit')],
      [
        {
          startDate: new Date(Date.UTC(2026, 8, 5, 17, 0, 0)).toISOString(),
          endDate: new Date(Date.UTC(2026, 8, 5, 18, 0, 0)).toISOString(),
          workoutType: 'cycling',
        },
      ],
    );

    expect(r.validatedSteps).toBe(0);
    expect(r.segments[0].reason).toBe('wheel_based_workout');
    expect(r.segments[0].note).toMatch(/cycling/);
  });

  it('leaves steps during a walking workout alone', () => {
    const r = assessSteps(
      [seg(17, 45, 4800, 'Google Fit')],
      [
        {
          startDate: new Date(Date.UTC(2026, 8, 5, 17, 0, 0)).toISOString(),
          endDate: new Date(Date.UTC(2026, 8, 5, 18, 0, 0)).toISOString(),
          workoutType: 'walking',
        },
      ],
    );
    expect(r.validatedSteps).toBe(4800);
  });
});

describe('assessSteps — confidence and wording', () => {
  it('is high when one app covered the day cleanly', () => {
    expect(assessSteps([seg(7, 60, 6000, 'Google Fit')]).confidence).toBe('high');
  });

  it('drops to low when most of the day could not be confirmed', () => {
    const r = assessSteps([seg(8, 1, 5000, 'Google Fit'), seg(9, 30, 1000, 'Google Fit')]);
    expect(r.confidence).toBe('low');
  });

  it('reports low confidence rather than zero steps when there is no data', () => {
    const r = assessSteps([]);
    expect(r.rawSteps).toBe(0);
    expect(r.confidence).toBe('low');
    expect(r.confidenceReasons[0]).toMatch(/no step data/i);
  });

  it('always gives a reason for anything less than high confidence', () => {
    const r = assessSteps([seg(7, 60, 6000, 'Google Fit'), seg(7, 60, 6000, 'Samsung Health')]);
    expect(r.confidence).not.toBe('high');
    expect(r.confidenceReasons.length).toBeGreaterThan(0);
  });

  it('never claims excluded steps were definitely false', () => {
    const r = assessSteps([seg(8, 1, 900, 'Google Fit'), seg(9, 30, 3000, 'Google Fit')]);
    const line = summarise(r);
    expect(line).toMatch(/could not confirm/i);
    // "fake", "invalid" and "wrong" all assert more than the data supports.
    expect(line).not.toMatch(/fake|invalid|wrong|false/i);
  });

  it('shows the device total alongside ours so the numbers can be reconciled', () => {
    const r = assessSteps([seg(8, 1, 900, 'Google Fit'), seg(9, 30, 3000, 'Google Fit')]);
    expect(summarise(r)).toContain('3,900');
    expect(summarise(r)).toContain('3,000');
  });
});
