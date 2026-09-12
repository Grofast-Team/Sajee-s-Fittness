/**
 * Which meal an entry logged right now most likely belongs to.
 *
 * Deliberately in its own module with no imports. It is needed by a client
 * component (quick add) and by server code, and when it lived beside the
 * `recent_foods` query the client bundle pulled in `@/lib/supabase/server`
 * with it — which reaches for `next/headers` and fails the build outright.
 * A pure function shared across the boundary has to be free of server
 * dependencies, not merely look like it is.
 *
 * The hour comes from the *browser's* clock, not the server's: this app's
 * users are in India and the server is not, so a server-side hour would file
 * breakfast as the previous evening's snack. Getting it wrong is not
 * catastrophic — the meal is a label and can be corrected — but a quick add
 * that files everything under "other" is not much of a quick add.
 */
export function mealForHour(hour: number): string {
  if (hour < 5) return 'evening_snack';
  if (hour < 11) return 'breakfast';
  if (hour < 12) return 'morning_snack';
  if (hour < 15) return 'lunch';
  if (hour < 18) return 'afternoon_snack';
  if (hour < 22) return 'dinner';
  return 'evening_snack';
}
