import Link from 'next/link';

export const metadata = { title: 'Not found — FitCoach' };

export default function NotFound() {
  return (
    <main id="main" className="gutter mx-auto flex min-h-dvh max-w-lg flex-col justify-center">
      <h1 className="display text-[1.75rem]">That page does not exist</h1>
      <p className="mt-2 text-[15px]" style={{ color: 'var(--fg-muted)' }}>
        The link may be out of date, or the page may have moved.
      </p>
      <Link
        href="/today"
        className="mt-6 flex min-h-11 max-w-48 items-center justify-center text-sm font-semibold transition-opacity duration-200 hover:opacity-90"
        style={{
          background: 'var(--primary)',
          color: 'var(--on-primary)',
          borderRadius: 'var(--radius-control)',
        }}
      >
        Go to today
      </Link>
    </main>
  );
}
