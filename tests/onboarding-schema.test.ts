import { describe, expect, it } from 'vitest';
import { answersSchema } from '@/lib/onboarding-schema';
import { STEPS } from '@/lib/onboarding-steps';

/**
 * Every question the wizard asks must have somewhere to land.
 *
 * This exists because of a real bug. The onboarding wizard asked four fitness
 * questions — "could you do ten squats right now?", "could you hold a plank
 * for twenty seconds?" — and the schema that saves the interview did not
 * accept those keys, so Zod stripped them silently. Every user was assessed
 * from nothing and landed on the default level, while the interface implied
 * their answers had shaped the plan.
 *
 * Nothing failed. No error was logged. The only symptom was that a carefully
 * built assessment engine never ran, which is the kind of defect that survives
 * indefinitely because it looks like everything is working.
 */

const schemaKeys = new Set(Object.keys(answersSchema.shape));

/**
 * Questions that are deliberately asked but not persisted from this schema.
 *
 * Each entry needs a reason. An empty allowlist would be ideal; an
 * unexplained one is how the original bug would come back wearing a hat.
 */
const NOT_PERSISTED: Record<string, string> = {
  // Asked to make the safety screen feel like a conversation rather than an
  // interrogation; the screen reads `conditions` for the actual decision.
  conditions: 'consumed via the safety screen, stored as derived flags',
};

describe('onboarding schema covers the wizard', () => {
  const asked = STEPS.flatMap((step) => step.fields.map((f) => f.id));

  it('asks at least the fields we expect, so this test cannot pass vacuously', () => {
    expect(asked.length).toBeGreaterThan(30);
  });

  it.each(asked)('accepts the answer to "%s"', (id) => {
    if (NOT_PERSISTED[id]) return;
    expect(schemaKeys.has(id)).toBe(true);
  });

  it('has no unique field ids colliding across steps', () => {
    // Two steps sharing an id would silently overwrite each other in the flat
    // answers object the wizard builds.
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('carries the fitness assessment through to the schema', () => {
    // The specific fields whose loss caused the bug. Named explicitly so the
    // intent survives even if the generic check above is ever relaxed.
    for (const id of ['recentTraining', 'squats10', 'plank20', 'liftedBefore']) {
      expect(schemaKeys.has(id)).toBe(true);
    }
  });

  it('parses a realistic interview without dropping the assessment', () => {
    const parsed = answersSchema.parse({
      age: 31,
      sex: 'male',
      heightCm: 172,
      weightKg: 82,
      goal: 'fat_loss',
      pace: 'steady',
      recentTraining: 'four_plus',
      squats10: 'yes',
      plank20: 'yes',
      liftedBefore: 'yes',
      apartmentOnly: 'yes',
    });

    expect(parsed.recentTraining).toBe('four_plus');
    expect(parsed.squats10).toBe('yes');
    expect(parsed.plank20).toBe('yes');
    expect(parsed.liftedBefore).toBe('yes');
    expect(parsed.apartmentOnly).toBe('yes');
  });
});
