/**
 * Runtime capability detection.
 *
 * The app is built to degrade honestly. If Supabase is not configured, screens
 * say so and fall back to a clearly-labelled sample profile rather than
 * rendering invented numbers that look real. If the AI provider is not
 * configured, the photo and coach features report themselves as unavailable
 * and manual logging carries on working.
 *
 * Rule: never show a plausible-looking number the user cannot distinguish from
 * their own data.
 */

export const supabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Server-only. AI calls go through the Vercel AI Gateway. */
export const aiConfigured = !!process.env.AI_GATEWAY_API_KEY || !!process.env.VERCEL_OIDC_TOKEN;

export const MODELS = {
  vision: process.env.AI_MODEL_VISION ?? 'anthropic/claude-sonnet-4.5',
  coach: process.env.AI_MODEL_COACH ?? 'anthropic/claude-sonnet-4.5',
  fast: process.env.AI_MODEL_FAST ?? 'anthropic/claude-haiku-4.5',
} as const;
