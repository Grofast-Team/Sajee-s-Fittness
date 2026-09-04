import { describe, expect, it } from 'vitest';
import {
  assessFitnessLevel,
  checkReadiness,
  decideProgression,
  shouldProgressExercise,
  type ProgressionSignals,
} from '@/lib/engines/progression';

const ready: ProgressionSignals = {
  sessionsAtLevel: 5,
  recentDifficulty: [2, 2, 3, 2],
  recentPain: ['none', 'none', 'none', 'none'],
  consistency: 0.85,
  daysAtLevel: 14,
};

describe('assessFitnessLevel', () => {
  it('places someone who has never trained at the first level', () => {
    const r = assessFitnessLevel({
      recentTraining: 'never',
      squats10: 'no',
      plank20: 'no',
      liftedBefore: 'no',
    });
    expect(r.level).toBe(1);
  });

  it('places a consistent, capable trainee near the top', () => {
    const r = assessFitnessLevel({
      recentTraining: 'four_plus',
      squats10: 'yes',
      plank20: 'yes',
      liftedBefore: 'yes',
    });
    expect(r.level).toBe(4);
  });

  it('reads capability, not just frequency', () => {
    // Someone who trains occasionally but can do both movements is further
    // along than the frequency alone suggests.
    const occasionalButCapable = assessFitnessLevel({
      recentTraining: 'occasional',
      squats10: 'yes',
      plank20: 'yes',
    });
    const frequentButNot = assessFitnessLevel({
      recentTraining: 'two_three',
      squats10: 'no',
      plank20: 'no',
    });
    expect(occasionalButCapable.level).toBeGreaterThanOrEqual(frequentButNot.level);
  });

  it('treats "not sure" as softer than a flat no', () => {
    const unsure = assessFitnessLevel({ recentTraining: 'occasional', squats10: 'unsure', plank20: 'unsure' });
    const no = assessFitnessLevel({ recentTraining: 'occasional', squats10: 'no', plank20: 'no' });
    expect(unsure.score).toBeGreaterThan(no.score);
  });

  it('never labels anyone as merely a beginner', () => {
    for (const training of ['never', 'occasional', 'two_three', 'four_plus'] as const) {
      const r = assessFitnessLevel({ recentTraining: training });
      expect(r.name.toLowerCase()).not.toContain('beginner');
      expect(r.name.toLowerCase()).not.toContain('absolute');
    }
  });

  it('explains the placement rather than just asserting it', () => {
    const r = assessFitnessLevel({ recentTraining: 'never', squats10: 'no', plank20: 'no' });
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.message.length).toBeGreaterThan(40);
    // Level 1 must not read as a failure.
    expect(r.message).toMatch(/not a setback/i);
  });
});

describe('checkReadiness', () => {
  it('passes when every signal lines up', () => {
    expect(checkReadiness(ready).ready).toBe(true);
  });

  it('holds until enough sessions are done', () => {
    const r = checkReadiness({ ...ready, sessionsAtLevel: 2 });
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.label === 'Sessions completed')?.passed).toBe(false);
  });

  it('holds when the current level still feels hard', () => {
    const r = checkReadiness({ ...ready, recentDifficulty: [4, 5, 4, 4] });
    expect(r.ready).toBe(false);
  });

  it('holds when pain was reported', () => {
    const r = checkReadiness({ ...ready, recentPain: ['none', 'pain', 'none', 'none'] });
    expect(r.ready).toBe(false);
    expect(r.checks.find((c) => c.label === 'No pain reported')?.passed).toBe(false);
  });

  it('holds when adaptation has not had time', () => {
    const r = checkReadiness({ ...ready, daysAtLevel: 3 });
    expect(r.ready).toBe(false);
  });

  it('does not report 0% adherence when nothing was ever scheduled', () => {
    // "0% of planned sessions done" reads as an accusation. With nothing
    // planned there is nothing to have missed, and the checklist has to say so.
    const r = checkReadiness({ ...ready, consistency: 0, plannedSessions: 0 });
    const consistency = r.checks.find((c) => c.label === 'Consistency');
    expect(consistency?.detail).not.toMatch(/0%/);
    expect(consistency?.detail).toMatch(/nothing scheduled/i);
  });

  it('still reports a real miss rate when sessions were planned', () => {
    const r = checkReadiness({ ...ready, consistency: 0.25, plannedSessions: 4 });
    expect(r.checks.find((c) => c.label === 'Consistency')?.detail).toMatch(/25%/);
  });

  it('is blocked outright by a safety restriction', () => {
    const r = checkReadiness({ ...ready, restrictions: ['high_intensity_training'] });
    expect(r.ready).toBe(false);
    expect(r.verdict).toMatch(/safety note/i);
  });

  it('shows the whole checklist so "not yet" is legible', () => {
    const r = checkReadiness({ ...ready, sessionsAtLevel: 1 });
    expect(r.checks).toHaveLength(5);
    expect(r.verdict).toMatch(/that is fine/i);
  });
});

describe('decideProgression', () => {
  it('moves up when ready', () => {
    const r = decideProgression(2, ready);
    expect(r.decision).toBe('progress');
    expect(r.toLevel).toBe(3);
  });

  it('holds when not ready, and names the one thing outstanding', () => {
    const r = decideProgression(2, { ...ready, sessionsAtLevel: 1 });
    expect(r.decision).toBe('hold');
    expect(r.toLevel).toBe(2);
    expect(r.message).toMatch(/sessions completed/i);
  });

  it('steps back after two "too difficult" sessions in a row', () => {
    const r = decideProgression(3, { ...ready, recentDifficulty: [3, 5, 5] });
    expect(r.decision).toBe('regress');
    expect(r.toLevel).toBe(2);
    // Regression must never read as the user's failure.
    expect(r.message).toMatch(/normal adjustment|not a setback/i);
  });

  it('does not regress below level 1 — it shortens instead', () => {
    const r = decideProgression(1, { ...ready, recentDifficulty: [5, 5] });
    expect(r.decision).toBe('hold');
    expect(r.toLevel).toBe(1);
    expect(r.message).toMatch(/shorten/i);
  });

  it('pain overrides everything, including a passing checklist', () => {
    const r = decideProgression(2, { ...ready, recentPain: ['none', 'none', 'pain'] });
    expect(r.decision).toBe('hold_for_pain');
    expect(r.toLevel).toBe(2);
    expect(r.message).toMatch(/pain is a signal to stop|have it looked at/i);
  });

  /*
   * The evidence that earns a promotion must not also earn the next one.
   *
   * This came from a real bug: signals were derived from the user's *total*
   * feedback count, so the eight sessions that moved someone 2 -> 3 were still
   * on the books immediately afterwards and satisfied the checklist again.
   * Two page loads took a consistent beginner to level 4. The fix was to count
   * from `profiles.fitness_level_set_at`; these tests pin the contract that
   * `readLevelState` has to satisfy for the engine to behave.
   */
  it('holds at a freshly reached level, because the evidence resets with it', () => {
    const justPromoted = { ...ready, sessionsAtLevel: 0, recentDifficulty: [], recentPain: [], daysAtLevel: 0 };
    const r = decideProgression(3, justPromoted);
    expect(r.decision).toBe('hold');
    expect(r.toLevel).toBe(3);
  });

  it('does not promote twice on the same sessions', () => {
    // Enough evidence to leave level 2.
    const first = decideProgression(2, ready);
    expect(first.decision).toBe('progress');
    expect(first.toLevel).toBe(3);

    // The counters restart at the new level, so the very next evaluation holds
    // rather than handing an advanced session to someone two levels below it.
    const second = decideProgression(first.toLevel, {
      ...ready,
      sessionsAtLevel: 0,
      recentDifficulty: [],
      recentPain: [],
      daysAtLevel: 0,
    });
    expect(second.decision).toBe('hold');
    expect(second.toLevel).toBe(3);
  });

  it('never pushes past the top level', () => {
    const r = decideProgression(4, ready);
    expect(r.toLevel).toBe(4);
    expect(r.decision).toBe('hold');
  });

  it('never suggests training through pain', () => {
    const r = decideProgression(3, { ...ready, recentPain: ['pain', 'pain', 'pain'] });
    expect(r.message).not.toMatch(/push through|work through it|keep going/i);
  });
});

describe('shouldProgressExercise', () => {
  it('waits for three sessions before deciding', () => {
    const r = shouldProgressExercise({ sessions: [12, 12], targetHigh: 12 });
    expect(r.progress).toBe(false);
    expect(r.reason).toMatch(/we have 2/i);
  });

  it('progresses after three sessions at the top of the range', () => {
    const r = shouldProgressExercise({ sessions: [12, 12, 12], targetHigh: 12 });
    expect(r.progress).toBe(true);
    expect(r.reason).toMatch(/three sessions running/i);
  });

  it('holds while reps are still short of the target', () => {
    const r = shouldProgressExercise({ sessions: [8, 10, 11], targetHigh: 12 });
    expect(r.progress).toBe(false);
    expect(r.reason).toMatch(/11 of 12/);
  });

  it('makes the movement harder rather than adding endless reps', () => {
    const r = shouldProgressExercise({ sessions: [15, 15, 15], targetHigh: 12 });
    expect(r.progress).toBe(true);
    expect(r.reason).toMatch(/harder rather than just doing more/i);
  });
});
