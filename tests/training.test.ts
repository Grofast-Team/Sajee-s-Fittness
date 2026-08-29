import { describe, expect, it } from 'vitest';
import {
  STRENGTH_DAY_CAP,
  buildWeek,
  dateForDay,
  weekStart,
  type TrainingPlanInput,
} from '@/lib/engines/training';

const base: TrainingPlanInput = {
  requestedDays: 3,
  experience: 'none',
  equipment: 'none',
};

const strengthDays = (input: TrainingPlanInput) =>
  buildWeek(input).sessions.filter((s) => s.kind === 'strength').map((s) => s.dayIndex);

describe('buildWeek layout', () => {
  it('always returns exactly seven days', () => {
    for (const days of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(buildWeek({ ...base, requestedDays: days, experience: 'advanced' }).sessions).toHaveLength(7);
    }
  });

  it('spreads three sessions across the week rather than stacking them', () => {
    expect(strengthDays({ ...base, requestedDays: 3 })).toEqual([0, 2, 4]);
  });

  it('never schedules two consecutive strength days for a beginner', () => {
    const days = strengthDays({ ...base, requestedDays: 3, experience: 'none' });
    for (let i = 1; i < days.length; i++) {
      expect(days[i] - days[i - 1]).toBeGreaterThan(1);
    }
  });

  it('always leaves at least one rest day', () => {
    const plan = buildWeek({ ...base, requestedDays: 7, experience: 'advanced' });
    expect(plan.sessions.some((s) => s.kind === 'rest')).toBe(true);
  });

  it('fills non-strength days with walking', () => {
    const plan = buildWeek({ ...base, requestedDays: 2 });
    const walks = plan.sessions.filter((s) => s.kind === 'walk');
    expect(walks.length).toBeGreaterThan(0);
  });
});

describe('experience caps what gets scheduled', () => {
  it('caps a complete beginner at three strength days however many they ask for', () => {
    const plan = buildWeek({ ...base, requestedDays: 6, experience: 'none' });
    expect(plan.strengthDays).toBe(STRENGTH_DAY_CAP.none);
    expect(plan.wasReduced).toBe(true);
  });

  it('lets an advanced user have more', () => {
    const plan = buildWeek({ ...base, requestedDays: 6, experience: 'advanced' });
    expect(plan.strengthDays).toBe(6);
    expect(plan.wasReduced).toBe(false);
  });

  it('explains the reduction rather than silently overriding the user', () => {
    const plan = buildWeek({ ...base, requestedDays: 6, experience: 'none' });
    expect(plan.explanation).toContain('You asked for 6 days');
    expect(plan.explanation).toMatch(/still be training/i);
  });

  it('does not reduce when the request is already within the cap', () => {
    const plan = buildWeek({ ...base, requestedDays: 2, experience: 'none' });
    expect(plan.wasReduced).toBe(false);
    expect(plan.explanation).not.toContain('You asked for');
  });
});

describe('safety restrictions', () => {
  it('removes strength work entirely when high-intensity training is withheld', () => {
    const plan = buildWeek({
      ...base,
      requestedDays: 4,
      restrictions: ['high_intensity_training'],
    });
    expect(plan.strengthDays).toBe(0);
    expect(plan.sessions.some((s) => s.kind === 'strength')).toBe(false);
    expect(plan.explanation).toMatch(/clearance from your doctor/i);
  });

  it('still gives a usable week when strength is withheld', () => {
    const plan = buildWeek({ ...base, restrictions: ['high_intensity_training'] });
    // Restricted does not mean empty: walking and rest still make a plan.
    expect(plan.sessions.filter((s) => s.kind === 'walk').length).toBeGreaterThan(0);
  });
});

describe('equipment and preferences', () => {
  it('picks the dumbbell workout when equipment allows', () => {
    const plan = buildWeek({ ...base, equipment: 'dumbbells' });
    const slugs = plan.sessions.filter((s) => s.kind === 'strength').map((s) => s.workoutSlug);
    expect(slugs.every((s) => s === 'dumbbell-full-body')).toBe(true);
  });

  it('alternates two bodyweight workouts so the week is not monotonous', () => {
    const plan = buildWeek({ ...base, requestedDays: 3, equipment: 'none' });
    const slugs = plan.sessions.filter((s) => s.kind === 'strength').map((s) => s.workoutSlug);
    expect(new Set(slugs).size).toBeGreaterThan(1);
  });

  it('schedules a sport the user actually enjoys', () => {
    const plan = buildWeek({ ...base, enjoys: ['badminton'] });
    const sport = plan.sessions.find((s) => s.kind === 'sport');
    expect(sport?.label).toBe('Badminton');
  });

  it('ignores enjoyed activities that are not schedulable sports', () => {
    const plan = buildWeek({ ...base, enjoys: ['walking'] });
    expect(plan.sessions.some((s) => s.kind === 'sport')).toBe(false);
  });

  it('respects the time the user actually has', () => {
    const plan = buildWeek({ ...base, sessionMinutes: 15 });
    const strength = plan.sessions.find((s) => s.kind === 'strength');
    expect(strength?.minutes).toBe(15);
  });

  it('caps a session at an hour even if the user offers more', () => {
    const plan = buildWeek({ ...base, sessionMinutes: 180 });
    expect(plan.sessions.find((s) => s.kind === 'strength')?.minutes).toBe(60);
  });
});

describe('week date helpers', () => {
  it('finds the Monday of a week from any day in it', () => {
    // 2026-08-27 is a Thursday.
    expect(weekStart(new Date('2026-08-27T12:00:00Z'))).toBe('2026-08-24');
  });

  it('treats Sunday as the end of the week, not the start', () => {
    // 2026-08-30 is a Sunday; its week began Monday the 24th.
    expect(weekStart(new Date('2026-08-30T12:00:00Z'))).toBe('2026-08-24');
  });

  it('returns the Monday itself unchanged', () => {
    expect(weekStart(new Date('2026-08-24T00:00:00Z'))).toBe('2026-08-24');
  });

  it('maps day indices onto real dates', () => {
    expect(dateForDay('2026-08-24', 0)).toBe('2026-08-24');
    expect(dateForDay('2026-08-24', 6)).toBe('2026-08-30');
  });

  it('crosses a month boundary correctly', () => {
    expect(dateForDay('2026-08-31', 3)).toBe('2026-09-03');
  });
});
