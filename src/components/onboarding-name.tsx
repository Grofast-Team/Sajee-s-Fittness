'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import { completeMinimalSignup } from '@/lib/actions/onboarding-name';

/**
 * The one screen between confirming an account and reaching the app.
 *
 * `initialName` comes from profiles.display_name - see
 * src/lib/actions/onboarding-name.ts. When it is already set (the signup
 * form's name field was filled in), this is a single confirm-and-continue
 * tap. When it is not, this is the only place a name is genuinely required.
 */
export function OnboardingName({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const result = await completeMinimalSignup({ displayName: name });
    if (result.ok) {
      // Not /dashboard - that route does not exist yet. This is the same
      // destination the old nine-step interview sent people to, and stays
      // correct until Phase 4 introduces a generic dashboard to send people
      // to instead.
      router.push('/today');
      return;
    }
    setError(result.error);
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">
          {initialName ? `Welcome, ${initialName}` : 'What should we call you?'}
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
          That&rsquo;s the only thing we need right now. Fitness, Money and everything else
          are things you switch on later, from your profile.
        </p>
      </div>

      <Field label="Your name" htmlFor="displayName">
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          autoComplete="given-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </Field>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button type="submit" variant="primary" fullWidth disabled={pending}>
        {pending ? <Loader2 className="animate-spin" size={16} aria-hidden /> : 'Continue'}
      </Button>
    </form>
  );
}
