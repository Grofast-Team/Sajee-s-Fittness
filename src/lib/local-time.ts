/**
 * The current time where the user is.
 *
 * These pages render on a machine that could be anywhere, so anything that
 * reasons about "now" from the user's point of view — which meal is overdue,
 * which greeting to show — has to ask for their timezone explicitly. The
 * server clock is not a proxy for it.
 *
 * Kept out of `src/lib/engines` deliberately: this reads a clock, and nothing
 * in engines is allowed to. Engines take the string this produces.
 */
export function localClock(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(now);
  } catch {
    // An unrecognised zone should degrade to server time rather than take the
    // page down. Same call this file's sibling `greeting.ts` makes.
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
}
