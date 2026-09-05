import { z } from 'zod';

/**
 * The shape of a completed onboarding interview.
 *
 * Extracted from the server action so it can be tested. It lives here for one
 * specific reason: the wizard once asked four fitness questions whose answers
 * this schema did not accept, so they were silently dropped and every user
 * landed on the default level. `tests/onboarding-schema.test.ts` now asserts
 * that every question the wizard asks has somewhere to land, which is a check
 * that cannot be written while the schema is trapped inside a 'use server'
 * module (those may only export async functions).
 */
export const answersSchema = z.object({
  name: z.string().trim().max(80).optional(),
  age: z.coerce.number().int().min(13).max(100),
  sex: z.enum(['male', 'female', 'intersex', 'prefer_not_to_say']),
  heightCm: z.coerce.number().min(90).max(250),
  weightKg: z.coerce.number().min(25).max(400),

  pregnant: z.string().optional(),
  breastfeeding: z.string().optional(),
  eatingDisorderHistory: z.string().optional(),
  conditions: z.array(z.string()).default([]),

  goal: z.string().default('fat_loss'),
  targetWeightKg: z.coerce.number().min(25).max(400).optional(),
  targetWeeks: z.coerce.number().int().min(1).max(260).optional(),
  pace: z.enum(['gentle', 'steady', 'firm']).default('steady'),

  workPattern: z.string().optional(),
  sittingHours: z.coerce.number().min(0).max(24).optional(),
  nightShift: z.string().optional(),
  // Asked of shift workers, and previously dropped here. `lifestyle` has had
  // work_start/work_end columns waiting for them the whole time.
  shiftStart: z.string().optional(),
  shiftEnd: z.string().optional(),
  wakeTime: z.string().optional(),
  sleepTime: z.string().optional(),
  sleepHours: z.coerce.number().min(0).max(16).optional(),
  baselineSteps: z.coerce.number().int().min(0).max(60000).optional(),

  diet: z.string().default('non_vegetarian'),
  cuisines: z.array(z.string()).default([]),
  allergies: z.string().optional(),
  dislikes: z.string().optional(),
  favourites: z.string().optional(),
  mealsPerDay: z.coerce.number().int().min(1).max(8).optional(),

  cooksOwnFood: z.string().optional(),
  cookIdentity: z.string().optional(),
  cookMinutes: z.coerce.number().int().min(0).max(240).optional(),
  kitchenEquipment: z.array(z.string()).default([]),
  budgetPerDay: z.string().optional(),
  sharedHousehold: z.string().optional(),

  /*
   * The fitness assessment.
   *
   * The wizard has been asking all four of these since it was written and the
   * answers were being dropped on the floor here — every user landed on the
   * default level regardless of what they said. Asking someone whether they
   * can hold a plank and then ignoring the answer is worse than not asking:
   * it promises a personalised start and delivers a constant.
   *
   * `experience` is derived from these rather than collected, because nothing
   * ever asked for it and it was defaulting to 'none' for everybody — which
   * the week planner then read as "beginner" for advanced users too.
   */
  recentTraining: z.enum(['never', 'occasional', 'two_three', 'four_plus']).optional(),
  squats10: z.enum(['yes', 'no', 'unsure']).optional(),
  plank20: z.enum(['yes', 'no', 'unsure']).optional(),
  liftedBefore: z.enum(['yes', 'no']).optional(),
  apartmentOnly: z.string().optional(),

  equipment: z.string().default('none'),
  trainingDays: z.coerce.number().int().min(0).max(7).optional(),
  sessionMinutes: z.coerce.number().int().min(0).max(240).optional(),
  activities: z.array(z.string()).default([]),
  injuries: z.string().optional(),

  previousAttempts: z.string().optional(),
  whatWentWrong: z.array(z.string()).default([]),
  stress: z.coerce.number().int().min(1).max(5).optional(),
  emotionalEating: z.string().optional(),
});

export type OnboardingAnswers = z.infer<typeof answersSchema>;
