import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { Unavailable } from '@/components/ui';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Sign in — FitCoach' };

export default function LoginPage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold">FitCoach</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
          A plan built around your food, your budget and the time you actually have.
        </p>
      </header>

      <AuthForm configured={supabaseConfigured} />

      {!supabaseConfigured ? (
        <div className="mt-4">
          <Unavailable
            title="Accounts are switched off here"
            detail={
              'This deployment has no Supabase project configured, so sign-in is disabled rather ' +
              'than pretending to work. You can still explore the app with a sample profile.'
            }
            action={
              <Link
                href="/today"
                className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold"
                style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
              >
                Explore with sample data
              </Link>
            }
          />
        </div>
      ) : null}
    </main>
  );
}
