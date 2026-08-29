import { z } from 'zod';

/**
 * AI output schemas.
 *
 * The single most important property of this file: **no schema here contains a
 * calorie, macro or price field.** The model is structurally incapable of
 * hallucinating a nutrition number, because there is nowhere for it to put one.
 *
 * The model identifies. The food database and the calculation engine quantify.
 */

/**
 * What the vision model can see on a kitchen scale.
 *
 * `displayReadable: false` is a first-class, expected outcome - glare on an LCD
 * is common. A guessed digit is worse than no digit, because it arrives with
 * unearned confidence and silently poisons the day's totals.
 */
export const scaleReadingSchema = z.object({
  present: z.boolean().describe('Is a kitchen weighing scale visible in the photo at all?'),
  displayReadable: z
    .boolean()
    .describe('Are the digits on the display legible enough to read with certainty?'),
  value: z
    .number()
    .nullable()
    .describe('The number shown on the display, exactly as displayed. Null if not readable.'),
  unit: z
    .enum(['g', 'kg', 'oz', 'lb'])
    .nullable()
    .describe('The unit shown on the display. Null if not readable.'),
  containerOnScale: z
    .boolean()
    .describe('Is the food in a plate or bowl that is also sitting on the scale?'),
  notes: z
    .string()
    .nullable()
    .describe('Anything affecting the reading, e.g. "display partially obscured by glare".'),
});

/** One identified food. Quantity is expressed only in countable or visual
 *  terms - never as energy. */
export const identifiedFoodSchema = z.object({
  name: z.string().describe('Common English name of the food, e.g. "dosa", "sambar".'),
  localName: z
    .string()
    .nullable()
    .describe('Regional name if recognisable, e.g. "thayir sadam".'),
  count: z
    .number()
    .nullable()
    .describe('Number of discrete items if countable (2 idli, 1 chapati). Null otherwise.'),
  approxGrams: z
    .number()
    .nullable()
    .describe(
      'A rough visual weight guess in grams, used ONLY as the midpoint of a wide range when no ' +
        'scale reading is available. Null if you genuinely cannot tell.',
    ),
  preparation: z
    .enum(['fried', 'deep_fried', 'grilled', 'roasted', 'steamed', 'boiled', 'raw', 'curry', 'unknown'])
    .describe('Visible cooking method, which affects added fat.'),
  visibleOil: z
    .enum(['none', 'light', 'moderate', 'heavy', 'unknown'])
    .describe('How much added oil or ghee is visible.'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Confidence in this identification.'),
});

export const foodPhotoAnalysisSchema = z.object({
  isFood: z.boolean().describe('Does this image contain food at all?'),
  scale: scaleReadingSchema,
  items: z.array(identifiedFoodSchema).max(12),
  overallConfidence: z.enum(['high', 'medium', 'low']),
  clarifyingQuestions: z
    .array(z.string())
    .max(3)
    .describe(
      'Short questions whose answers would most improve the estimate. Ask about portion size, ' +
        'oil, and whether the plate was on the scale - never about calories.',
    ),
});

export type FoodPhotoAnalysis = z.infer<typeof foodPhotoAnalysisSchema>;
export type IdentifiedFood = z.infer<typeof identifiedFoodSchema>;

/** Voice and free-text logging: "I ate two idli and a bowl of sambar". */
export const parsedFoodEntrySchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.number().nullable(),
        unit: z
          .string()
          .nullable()
          .describe('The unit as the user said it: "bowl", "katori", "piece", "g", "cup".'),
      }),
    )
    .max(15),
  meal: z
    .enum(['breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack', 'other'])
    .nullable(),
  unparsed: z
    .string()
    .nullable()
    .describe('Any part of the input that could not be understood, echoed back for confirmation.'),
});

export type ParsedFoodEntry = z.infer<typeof parsedFoodEntrySchema>;

/**
 * Coach replies.
 *
 * `safetyConcern` lets the model escalate rather than improvise: if a user
 * describes purging, or asks for a 700 kcal target, the server intercepts the
 * turn instead of letting the model negotiate.
 */
export const coachReplySchema = z.object({
  reply: z.string(),
  safetyConcern: z
    .enum(['none', 'disordered_eating', 'extreme_restriction', 'medical', 'self_harm'])
    .describe('Escalate rather than answering if the user raises any of these.'),
  suggestedActions: z
    .array(z.object({ label: z.string(), action: z.string() }))
    .max(3)
    .describe('Optional deep links, e.g. log a meal, view today plan.'),
  rememberedFacts: z
    .array(
      z.object({
        kind: z.enum(['preference', 'constraint', 'pattern', 'context']),
        key: z.string(),
        value: z.string(),
      }),
    )
    .max(3)
    .describe('Durable facts worth storing, e.g. dislikes oats. The user can view and delete these.'),
});

export type CoachReply = z.infer<typeof coachReplySchema>;

/** Weekly review synthesis. Pattern-finding, not number-repeating - the metrics
 *  are already computed and are passed *into* the model, not produced by it. */
export const weeklyReviewSchema = z.object({
  narrative: z.string().describe('Two to four sentences. Supportive, specific, never shaming.'),
  wentWell: z.array(z.string()).max(3),
  wasHard: z.array(z.string()).max(3),
  biggestLever: z.string().describe('The single highest-impact change for next week.'),
  nextGoal: z.string().describe('One concrete, small goal.'),
});

export type WeeklyReview = z.infer<typeof weeklyReviewSchema>;
