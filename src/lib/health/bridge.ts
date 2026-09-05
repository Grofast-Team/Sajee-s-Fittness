/**
 * The bridge to the platform health store.
 *
 * This module is the only place that knows Capacitor exists. Everything above
 * it sees a small interface that reports honestly when there is no health
 * store to talk to — which is the case for every browser visitor, and will
 * stay the majority case for a long time.
 *
 * The plugin is imported lazily. A static import would pull the Capacitor
 * runtime into the bundle for web users who can never use it, on an audience
 * we have assumed throughout is on a cheap phone and a metered connection.
 */

export type HealthAvailability =
  | { available: true }
  | { available: false; reason: 'not_native' | 'no_provider' | 'error'; detail: string };

export interface RawStepSegment {
  startDate: string;
  endDate: string;
  steps: number;
  sourceName?: string;
  platformId?: string;
}

export interface RawWorkout {
  startDate: string;
  endDate: string;
  workoutType: string;
}

/** True only inside the Capacitor shell on a real device. */
function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

/**
 * Can we read health data here?
 *
 * Returns a reason rather than a bare false, so the UI can say "this needs the
 * Android app" instead of the useless "unavailable".
 */
export async function checkAvailability(): Promise<HealthAvailability> {
  if (!isNative()) {
    return {
      available: false,
      reason: 'not_native',
      detail:
        'Step sync needs the Android app. A web browser has no access to your phone’s step ' +
        'counter, so on the web you can still enter your steps by hand.',
    };
  }

  try {
    const { Health } = await import('@capgo/capacitor-health');
    const result = await Health.isAvailable();
    if (result.available) return { available: true };

    return {
      available: false,
      reason: 'no_provider',
      detail:
        result.reason ??
        'Health Connect is not set up on this phone. It can be installed from the Play Store.',
    };
  } catch (error) {
    return {
      available: false,
      reason: 'error',
      detail: error instanceof Error ? error.message : 'Health Connect could not be reached.',
    };
  }
}

/**
 * Ask for read access to steps and workouts.
 *
 * Read-only, and requested at the moment the user turns sync on rather than at
 * launch. A permission sheet that appears before anyone knows what the app
 * does is the reliable way to get it denied for good.
 */
export async function requestPermissions(): Promise<{ granted: boolean; detail: string }> {
  if (!isNative()) return { granted: false, detail: 'Not running in the app.' };

  try {
    const { Health } = await import('@capgo/capacitor-health');
    const status = await Health.requestAuthorization({ read: ['steps', 'workouts'] });

    const granted = status.readAuthorized.includes('steps');
    return {
      granted,
      detail: granted
        ? 'Step access granted.'
        : 'Step access was not granted. You can change this in Health Connect settings.',
    };
  } catch (error) {
    return {
      granted: false,
      detail: error instanceof Error ? error.message : 'Could not request permission.',
    };
  }
}

/**
 * Read one day of step segments and workouts.
 *
 * Returns observations only. Nothing here decides what counts — that judgement
 * is the server's, from the raw segments, so it cannot be influenced by the
 * device.
 */
export async function readDay(
  date: Date,
): Promise<{ segments: RawStepSegment[]; workouts: RawWorkout[] } | null> {
  if (!isNative()) return null;

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  try {
    const { Health } = await import('@capgo/capacitor-health');

    const [stepResult, workoutResult] = await Promise.all([
      Health.readSamples({
        dataType: 'steps',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        // A day of Health Connect step records is tens of entries. 500 is
        // headroom for a phone with several apps writing, not an expectation.
        limit: 500,
        ascending: true,
      }),
      Health.queryWorkouts({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        limit: 50,
      }),
    ]);

    return {
      segments: stepResult.samples.map((s) => ({
        startDate: s.startDate,
        endDate: s.endDate,
        steps: Math.round(s.value),
        sourceName: s.sourceName,
        platformId: s.platformId,
      })),
      workouts: workoutResult.workouts.map((w) => ({
        startDate: w.startDate,
        endDate: w.endDate,
        workoutType: w.workoutType,
      })),
    };
  } catch (error) {
    console.error('health read failed', error);
    return null;
  }
}

/** The device's own local date, which is the one the user's day runs on. */
export function localDateString(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
