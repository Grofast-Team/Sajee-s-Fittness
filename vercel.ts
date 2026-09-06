import { type VercelConfig } from '@vercel/config/v1';

/**
 * Project configuration.
 *
 * Exists for one reason: the weekly review needs to actually run. The
 * adaptation engine was written and tested long before anything called it, so
 * intake and step targets stayed at whatever onboarding computed on day one.
 */
export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [
    {
      /*
       * Monday morning, before most people open the app.
       *
       * Weekly rather than daily because the engine will not move a target
       * more often than `MIN_DAYS_BETWEEN_CHANGES` anyway — running it daily
       * would just file six extra "no change" audit rows a week. Monday
       * because a review that lands mid-week explains a change against a
       * half-finished week of data.
       *
       * 02:30 UTC is 08:00 in India, which is the audience this is for.
       */
      path: '/api/cron/review',
      schedule: '30 2 * * 1',
    },
  ],
};

export default config;
