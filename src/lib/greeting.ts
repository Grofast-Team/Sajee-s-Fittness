/**
 * The greeting on the home screen.
 *
 * Computed against the user's own timezone, not the server's. These pages
 * render on a machine that could be anywhere, and "Good morning" at nine in the
 * evening is the fastest way to tell someone the app is not really paying
 * attention to them.
 */
export function greeting(name: string, timezone: string, now: Date = new Date()): string {
  let hour: number;

  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: timezone,
      }).format(now),
    );
  } catch {
    // An unrecognised zone should not take the page down over a greeting.
    hour = now.getHours();
  }

  const part =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return name ? `${part}, ${name}` : part;
}
