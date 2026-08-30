import { redirect } from 'next/navigation';

/**
 * Root.
 *
 * Normally just a doorway to /today, but it also has to catch auth codes.
 * Supabase falls back to the project's Site URL — this page — whenever a
 * redirect target is missing from the allow-list, so a confirmation link can
 * legitimately arrive here as `/?code=...`. Redirecting to /today without
 * forwarding that code silently throws the session away and leaves the user
 * staring at a login screen right after confirming their email.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const { code, next } = await searchParams;

  if (code) {
    const target = new URLSearchParams({ code });
    if (next && next.startsWith('/') && !next.startsWith('//')) target.set('next', next);
    redirect(`/auth/callback?${target.toString()}`);
  }

  redirect('/today');
}
