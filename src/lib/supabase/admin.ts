import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses Row Level Security entirely.
 *
 * The `server-only` import above makes it a build error to pull this into a
 * client bundle, which is the guarantee that matters: this key must never reach
 * a browser.
 *
 * Use it only for work that genuinely cannot run as the user - scheduled
 * notification dispatch, food database maintenance, admin tooling - and always
 * filter by user id explicitly, because nothing else will.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations are unavailable.');
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
