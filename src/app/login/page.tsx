import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { Rule } from '@/components/ui';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Sign in — FitCoach' };

/**
 * The front door.
 *
 * It makes one claim, and it is the claim the product can actually keep: this
 * app tells you what it knows and admits what it does not. No stock photos of
 * people running, no "transform your body" — the audience is a nervous beginner,
 * and overpromising to them is how every other app in this category starts.
 */
export default function LoginPage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 py-10">
      <header className="mb-9">
        <p className="eyebrow mb-6">FitCoach</p>

        {/* No hardcoded breaks — they orphaned a word at some widths. Let it
            wrap, and let the accent phrase carry the emphasis instead. */}
        <h1 className="display" style={{ fontSize: 'clamp(2rem, 8vw, 2.75rem)' }}>
          A plan built around your food, your budget{' '}
          <span style={{ color: 'var(--signal)' }}>and your actual week.</span>
        </h1>

        <p className="mt-5 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          Not a calorie counter. It asks what you eat, what you can spend and when you have time,
          then adapts from what actually happens.
        </p>
      </header>

      <AuthForm configured={supabaseConfigured} />

      {/* Three promises, each one a thing the app genuinely enforces in code
          rather than a marketing line. */}
      <section className="mt-10">
        <ul className="mt-5 space-y-4">
          {[
            ['01', 'Weighed, not guessed', 'Photograph food on a kitchen scale and the grams are read, not estimated. No scale, and you get a range — never a made-up number.'],
            ['02', 'A floor it will not cross', 'Your minimum intake is enforced in code. Nothing you or the app can do will push a target below it.'],
            ['03', 'Honest about doubt', 'When there is not enough data to call a trend, it says so instead of drawing a confident line through noise.'],
          ].map(([n, title, body]) => (
            <li key={n} className="flex gap-4">
              <span className="data pt-0.5 text-xs" style={{ color: 'var(--fg-subtle)' }}>
                {n}
              </span>
              <div>
                <h2 className="text-sm font-medium">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {!supabaseConfigured ? (
        <p className="mt-8 text-sm" style={{ color: 'var(--fg-muted)' }}>
          Accounts are switched off on this deployment — no database is configured, so sign-in is
          disabled rather than pretending to work.{' '}
          <Link href="/today" className="underline underline-offset-4">
            Explore with a sample profile
          </Link>
          .
        </p>
      ) : null}

      <p className="mt-10 text-xs leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        General wellness, nutrition and activity guidance. Not a substitute for a doctor or a
        registered dietitian.
      </p>
    </main>
  );
}
