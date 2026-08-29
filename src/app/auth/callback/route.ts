import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Email confirmation and OAuth landing point.
 *
 * The `next` parameter is validated as a same-origin relative path before being
 * used, so a crafted confirmation link cannot bounce a freshly-authenticated
 * user to an attacker's site.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const requested = url.searchParams.get('next') ?? '/today';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/today';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=expired_link', url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
