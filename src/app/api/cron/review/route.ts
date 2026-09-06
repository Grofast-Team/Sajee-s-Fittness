import { NextResponse } from 'next/server';
import { reviewAllDueUsers } from '@/lib/actions/weekly-review';
import { serviceRoleConfigured } from '@/lib/supabase/service';

/**
 * The scheduled weekly review.
 *
 * Runs the adaptation engine for every user with an active plan. Until this
 * existed the engine was never called at all, so intake and step targets stayed
 * at whatever onboarding first computed — for ever.
 *
 * Authentication is a shared secret rather than a user session, because there
 * is no user to authenticate: this runs on a schedule with a service-role
 * client that can see every row in the database. The check is deliberately the
 * first thing that happens, before any client is constructed.
 */

// Reviewing every user is not a two-second job as the user base grows.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  /*
   * A missing secret fails closed.
   *
   * The alternative — allowing the route when unconfigured — would leave an
   * unauthenticated endpoint that rewrites every user's targets on any
   * deployment where the variable was forgotten.
   */
  if (!secret) {
    console.error('CRON_SECRET is not set; refusing to run the scheduled review.');
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const provided = request.headers.get('authorization');
  if (provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  if (!serviceRoleConfigured) {
    return NextResponse.json({ error: 'Service role key is not configured.' }, { status: 503 });
  }

  try {
    const { reviewed, changed } = await reviewAllDueUsers();
    console.log(`weekly review: ${reviewed} reviewed, ${changed} adjusted`);
    return NextResponse.json({ ok: true, reviewed, changed });
  } catch (error) {
    console.error('weekly review failed', error);
    return NextResponse.json({ error: 'The review failed.' }, { status: 500 });
  }
}
