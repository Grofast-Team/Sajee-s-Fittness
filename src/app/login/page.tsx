import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { supabaseConfigured } from '@/lib/config';

export const metadata = { title: 'Sign in — FitCoach' };

/**
 * The front door.
 *
 * It makes one claim, and it is the claim the product can actually keep: this
 * app tells you what it knows and admits what it does not. No stock photos of
 * people running, no "transform your body" — the audience is a nervous beginner,
 * and overpromising to them is how every other app in this category starts.
 *
 * On a phone the pitch stacks above the form. From 1024px the two sit side by
 * side, with the form in the right column where a returning user's eye and
 * cursor already are — they are not here to read the pitch again.
 */
export default function LoginPage() {
  return (
    <main id="main" className="gutter mx-auto min-h-dvh max-w-6xl py-10 lg:py-20">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-16">
        {/* ---------------- The pitch ---------------- */}
        <div>
          <p className="text-[15px] font-semibold" style={{ color: 'var(--primary)' }}>
            FitCoach
          </p>

          {/* No hardcoded breaks — they orphaned a word at some widths. */}
          <h1
            className="display mt-6"
            style={{ fontSize: 'clamp(2rem, 5.5vw, 3rem)' }}
          >
            A plan built around your food, your budget and your actual week.
          </h1>

          <p
            className="measure mt-5 text-[15px] leading-relaxed"
            style={{ color: 'var(--fg-muted)' }}
          >
            Not a calorie counter. It asks what you eat, what you can spend and when you have time,
            then adapts from what actually happens.
          </p>

          {/* Three promises, each one a thing the app genuinely enforces in code
              rather than a marketing line. */}
          <ul className="mt-10 space-y-6 border-t pt-8" style={{ borderColor: 'var(--line)' }}>
            {[
              [
                'Weighed, not guessed',
                'Photograph food on a kitchen scale and the grams are read, not estimated. No scale, and you get a range — never a made-up number.',
              ],
              [
                'A floor it will not cross',
                'Your minimum intake is enforced in code. Nothing you or the app can do will push a target below it.',
              ],
              [
                'Honest about doubt',
                'When there is not enough data to call a trend, it says so instead of drawing a confident line through noise.',
              ],
            ].map(([title, body]) => (
              <li key={title} className="measure">
                <h2 className="text-[15px] font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* ---------------- The form ---------------- */}
        <div className="lg:sticky lg:top-20">
          <AuthForm configured={supabaseConfigured} />

          {!supabaseConfigured ? (
            <p className="mt-6 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              Accounts are switched off on this deployment — no database is configured, so sign-in
              is disabled rather than pretending to work.{' '}
              <Link
                href="/today"
                className="underline underline-offset-4"
                style={{ color: 'var(--primary-dark)' }}
              >
                Explore with a sample profile
              </Link>
              .
            </p>
          ) : null}

          <p className="mt-8 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
            General wellness, nutrition and activity guidance. Not a substitute for a doctor or a
            registered dietitian.
          </p>
        </div>
      </div>
    </main>
  );
}
