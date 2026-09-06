import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * A client that bypasses Row Level Security.
 *
 * This exists for exactly one job: the scheduled weekly review, which has to
 * iterate every user's plan and therefore cannot run as any single user.
 *
 * It is deliberately in its own module, separate from `server.ts`, so that
 * importing it is a visible decision in a diff rather than an autocomplete
 * accident. Every RLS policy in this project assumes `auth.uid()` scoping; a
 * client holding the service-role key sees all of it.
 *
 * Rules for anything that uses this:
 *
 * - Never construct one in response to a user request that is not
 *   secret-authenticated. The cron route checks `CRON_SECRET` before this is
 *   reached.
 * - Never pass user-supplied ids into it without deriving them from data the
 *   service itself read.
 * - Never return its results to a browser unfiltered.
 *
 * `serviceRoleConfigured` is exported so callers can degrade honestly instead
 * of throwing on a deployment where the key was never set.
 */

export const serviceRoleConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'createServiceClient requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
