import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell.
 *
 * ## Why this loads a remote URL instead of a bundled build
 *
 * Capacitor's default is to package a static `dist/` folder and serve it from
 * the device. That is not available to us: this app is Server Components and
 * Server Actions from top to bottom — every screen reads from Supabase on the
 * server, and `next build` with `output: 'export'` would fail on the first
 * server action it met. Converting the app to a static SPA to satisfy the
 * packaging model would mean rewriting the entire data layer and moving the
 * service-role trust boundary into the client, which is the one thing the
 * architecture is built to prevent.
 *
 * So the shell points at the deployed app. Capacitor keeps the native bridge
 * available to the remote page, which is all we actually need from it: the web
 * app stays exactly as it is, and gains the ability to call Health Connect.
 *
 * The trade-offs, stated plainly:
 *
 * - The app needs a network connection. It already did — Supabase is remote and
 *   there is no offline mode — so this costs nothing new.
 * - `androidScheme: 'https'` is required for the remote origin to be treated as
 *   secure; without it the WebView blocks the requests.
 * - Apple review is stricter about shells that only wrap a website. This one
 *   ships genuine native health integration, which is the distinction they
 *   care about, but iOS is not the first target and this is a real risk to
 *   plan for rather than discover.
 *
 * Set CAP_SERVER_URL at build time to point at a preview deployment or, with a
 * LAN address, at the local dev server while working on the native side.
 */

const serverUrl = process.env.CAP_SERVER_URL ?? 'https://sajees-fittness.vercel.app';

const config: CapacitorConfig = {
  appId: 'com.grofast.fitcoach',
  appName: 'FitCoach',

  /*
   * Required by the CLI even though nothing is served from it. It holds only
   * the fallback page shown if the remote origin cannot be reached — a shell
   * that white-screens on a dropped connection is worse than one that explains
   * itself.
   */
  webDir: 'native/public',

  server: {
    url: serverUrl,
    cleartext: false,
    androidScheme: 'https',
  },

  plugins: {
    /*
     * Health Connect permissions are requested at the moment the user turns
     * step sync on, not at launch. A permission sheet on first open, before
     * anyone knows what the app does, is the reliable way to get it denied
     * permanently.
     */
    CapacitorHealth: {
      // Read-only. This app has no business writing to someone's health record.
      read: ['steps', 'workouts'],
    },
  },
};

export default config;
