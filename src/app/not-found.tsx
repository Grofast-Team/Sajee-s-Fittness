import Link from 'next/link';

export const metadata = { title: 'Not found — FitCoach' };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold">That page does not exist</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
        The link may be out of date, or the page may have moved.
      </p>
      <Link
        href="/today"
        className="mt-6 flex min-h-11 max-w-48 items-center justify-center rounded-md text-sm font-semibold"
        style={{ background: 'var(--fg)', color: 'var(--bg)' }}
      >
        Go to today
      </Link>
    </main>
  );
}
