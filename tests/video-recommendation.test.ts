import { describe, expect, it } from 'vitest';
import {
  recommendSession,
  type RecommendationContext,
  type VideoRecord,
} from '@/lib/engines/video-recommendation';

function video(over: Partial<VideoRecord> & { id: string }): VideoRecord {
  return {
    slug: over.id,
    title: over.id,
    durationMinutes: 20,
    track: 'strength',
    goalFit: [],
    levelMin: 1,
    levelMax: 4,
    equipment: 'none',
    impactLevel: 'low',
    apartmentFriendly: true,
    contraindications: [],
    reviewStatus: 'approved',
    ...over,
  };
}

const LIBRARY: VideoRecord[] = [
  video({ id: 'mobility-10', durationMinutes: 10, track: 'mobility', impactLevel: 'none', levelMax: 2 }),
  video({ id: 'walk-15', durationMinutes: 15, track: 'walking', impactLevel: 'low' }),
  video({ id: 'strength-20', durationMinutes: 20, track: 'strength', impactLevel: 'none' }),
  video({ id: 'strength-30', durationMinutes: 30, track: 'strength', impactLevel: 'none', levelMin: 2 }),
  video({ id: 'hiit-30', durationMinutes: 30, track: 'low_impact_cardio', impactLevel: 'high', apartmentFriendly: false, levelMin: 3 }),
  video({ id: 'dumbbell-25', durationMinutes: 25, track: 'strength', equipment: 'dumbbells', levelMin: 2 }),
  video({ id: 'knee-safe-15', durationMinutes: 15, track: 'strength', impactLevel: 'none', contraindications: [] }),
  video({ id: 'jump-20', durationMinutes: 20, track: 'low_impact_cardio', impactLevel: 'high', contraindications: ['knee_injury'] }),
];

const base: RecommendationContext = {
  level: 2,
  goal: 'fat_loss',
  equipment: 'none',
  minutesAvailable: 30,
  injuries: [],
};

describe('review gate', () => {
  it('recommends nothing when no video has been reviewed', () => {
    const unreviewed = LIBRARY.map((v) => ({ ...v, reviewStatus: 'pending' as const }));
    const r = recommendSession(unreviewed, base);
    expect(r.video).toBeNull();
    expect(r.shortfall).toMatch(/nobody here has checked/i);
  });

  it('ignores rejected and retired entries', () => {
    const mixed = [
      { ...LIBRARY[2], reviewStatus: 'rejected' as const },
      { ...LIBRARY[1], reviewStatus: 'retired' as const },
      LIBRARY[0],
    ];
    const r = recommendSession(mixed, base);
    expect(r.video?.id).toBe('mobility-10');
  });
});

describe('safety filters', () => {
  it('never recommends a video contraindicated for a stated injury', () => {
    const r = recommendSession(LIBRARY, { ...base, level: 3, injuries: ['knee_injury'] });
    expect(r.video?.id).not.toBe('jump-20');
  });

  it('keeps to low impact when high-intensity training is withheld', () => {
    const r = recommendSession(LIBRARY, {
      ...base,
      level: 3,
      restrictions: ['high_intensity_training'],
    });
    expect(['none', 'low']).toContain(r.video?.impactLevel);
    expect(r.because.join(' ')).toMatch(/safety note/i);
  });

  it('excludes jumping when the user is in a flat', () => {
    const r = recommendSession(LIBRARY, { ...base, level: 3, apartmentOnly: true });
    expect(r.video?.apartmentFriendly).toBe(true);
    expect(r.because.join(' ')).toMatch(/neighbours below/i);
  });
});

describe('time is a hard filter', () => {
  it('never returns something longer than the time available', () => {
    for (const minutes of [5, 10, 15, 20, 30, 45]) {
      const r = recommendSession(LIBRARY, { ...base, minutesAvailable: minutes });
      if (r.video) expect(r.video.durationMinutes).toBeLessThanOrEqual(minutes);
    }
  });

  it('uses most of the time when there is plenty', () => {
    const r = recommendSession(LIBRARY, { ...base, minutesAvailable: 30 });
    expect(r.video!.durationMinutes).toBeGreaterThanOrEqual(20);
  });

  it('explains the gap rather than offering something that will not be done', () => {
    const long = [video({ id: 'only-long', durationMinutes: 45 })];
    const r = recommendSession(long, { ...base, minutesAvailable: 10 });
    expect(r.video).toBeNull();
    expect(r.shortfall).toMatch(/gap in our library/i);
  });
});

describe('equipment', () => {
  it('does not recommend equipment the user does not have', () => {
    const r = recommendSession(LIBRARY, { ...base, equipment: 'none' });
    expect(r.video?.equipment).toBe('none');
  });

  it('allows bodyweight sessions to someone with a full gym', () => {
    const bodyweightOnly = [LIBRARY[2]];
    const r = recommendSession(bodyweightOnly, { ...base, equipment: 'full_gym' });
    expect(r.video?.id).toBe('strength-20');
  });
});

describe('level', () => {
  it('does not offer a session above the user’s level', () => {
    const r = recommendSession(LIBRARY, { ...base, level: 1 });
    expect(r.video!.levelMin).toBeLessThanOrEqual(1);
  });

  it('prefers the gentlest option at level 1', () => {
    const r = recommendSession(LIBRARY, { ...base, level: 1, minutesAvailable: 30 });
    expect(['none', 'low']).toContain(r.video!.impactLevel);
  });
});

describe('low motivation', () => {
  it('offers the smallest thing that still counts', () => {
    const r = recommendSession(LIBRARY, { ...base, lowMotivation: true });
    expect(r.video!.durationMinutes).toBeLessThanOrEqual(12);
    expect(r.because.join(' ')).toMatch(/beats skipping/i);
  });

  it('does not shame the user for it', () => {
    const r = recommendSession(LIBRARY, { ...base, lowMotivation: true });
    expect(r.because.join(' ')).not.toMatch(/should|excuse|lazy|discipline/i);
  });
});

describe('goal shapes the choice', () => {
  it('leads with strength for fat loss, not cardio', () => {
    const r = recommendSession(LIBRARY, { ...base, goal: 'fat_loss', level: 3 });
    expect(['strength', 'walking']).toContain(r.video!.track);
  });

  it('leads with mobility when that is the goal', () => {
    const r = recommendSession(LIBRARY, { ...base, goal: 'mobility', level: 1 });
    expect(r.video!.track).toBe('mobility');
  });
});

describe('variety', () => {
  it('steers away from what was done repeatedly this week', () => {
    const r = recommendSession(LIBRARY, {
      ...base,
      level: 3,
      recentTracks: ['strength', 'strength', 'strength'],
    });
    expect(r.video!.track).not.toBe('strength');
  });
});

describe('the recommendation explains itself', () => {
  it('always gives reasons', () => {
    const r = recommendSession(LIBRARY, base);
    expect(r.because.length).toBeGreaterThanOrEqual(3);
    expect(r.because.join(' ')).toMatch(/minutes/);
  });

  it('offers a way out rather than take-it-or-leave-it', () => {
    const r = recommendSession(LIBRARY, { ...base, level: 3, minutesAvailable: 30 });
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives.some((a) => /shorter/i.test(a.label))).toBe(true);
  });

  it('never offers an alternative that is the chosen video', () => {
    const r = recommendSession(LIBRARY, { ...base, level: 3 });
    expect(r.alternatives.every((a) => a.video.id !== r.video!.id)).toBe(true);
  });
});
