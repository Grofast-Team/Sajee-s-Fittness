'use client';

import { useActionState, useState } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { Button, Panel } from '@/components/ui';
import { signIn, signUp, type AuthState } from '@/lib/actions/auth';

/**
 * Sign in / sign up.
 *
 * One form, two modes. Errors render next to the form rather than only at the
 * top, and the submit button reports its own pending state so a slow network
 * never looks like a dead button.
 */
export function AuthForm({ configured }: { configured: boolean }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const action = mode === 'signin' ? signIn : signUp;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {});

  const inputStyle = {
    background: 'var(--ground)',
    color: 'var(--fg)',
    borderColor: 'var(--line)',
  };

  return (
    <Panel>
      <div className="mb-5 flex gap-1 rounded-md p-1" style={{ background: 'var(--ground)' }}>
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className="min-h-10 flex-1 cursor-pointer rounded-md text-sm font-semibold transition-colors duration-200"
            style={{
              background: mode === m ? 'var(--surface)' : 'transparent',
              color: mode === m ? 'var(--fg)' : 'var(--fg-subtle)',
            }}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form action={formAction} className="space-y-4">
        {mode === 'signup' ? (
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium">
              What should we call you?
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              autoComplete="given-name"
              placeholder="First name is fine"
              className="mt-1.5 min-h-11 w-full rounded-md border px-3 text-base"
              style={inputStyle}
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            className="mt-1.5 min-h-11 w-full rounded-md border px-3 text-base"
            style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            className="mt-1.5 min-h-11 w-full rounded-md border px-3 text-base"
            style={inputStyle}
          />
          {mode === 'signup' ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--fg-subtle)' }}>
              At least 8 characters.
            </p>
          ) : null}
        </div>

        {state.error ? (
          <p role="alert" className="flex items-start gap-2 text-sm" style={{ color: 'var(--alarm)' }}>
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {state.error}
          </p>
        ) : null}

        {state.message ? (
          <p role="status" className="flex items-start gap-2 text-sm" style={{ color: 'var(--confirm)' }}>
            <CircleCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
            {state.message}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending || !configured}>
          {pending ? (
            <>
              <Loader2 size={18} className="animate-spin" aria-hidden />
              {mode === 'signin' ? 'Signing in…' : 'Creating your account…'}
            </>
          ) : mode === 'signin' ? (
            'Sign in'
          ) : (
            'Create account'
          )}
        </Button>
      </form>

      <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        Your weight, measurements and food logs are private to your account. We do not share them,
        and administrators cannot read them by default.
      </p>
    </Panel>
  );
}
