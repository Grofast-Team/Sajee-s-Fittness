'use client';

import { useActionState, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Alert, Button, Field, Panel, inputClass, inputStyle } from '@/components/ui';
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
  const [showPassword, setShowPassword] = useState(false);
  const action = mode === 'signin' ? signIn : signUp;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, {});

  return (
    <Panel feature>
      <div
        className="mb-5 flex gap-1 p-1"
        style={{ background: 'var(--ground)', borderRadius: 'var(--radius-control)' }}
      >
        {(['signin', 'signup'] as const).map((m) => {
          const on = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                // Never carry a revealed password across a mode switch.
                setShowPassword(false);
              }}
              aria-pressed={on}
              className="min-h-10 flex-1 cursor-pointer rounded-lg text-sm font-semibold transition-colors duration-200"
              style={{
                background: on ? 'var(--surface)' : 'transparent',
                color: on ? 'var(--primary-dark)' : 'var(--fg-muted)',
                boxShadow: on ? 'var(--shadow-sm)' : undefined,
              }}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          );
        })}
      </div>

      <form action={formAction} className="space-y-4">
        {mode === 'signup' ? (
          <Field label="What should we call you?" htmlFor="displayName">
            <input
              id="displayName"
              name="displayName"
              type="text"
              autoComplete="given-name"
              placeholder="First name is fine"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
        ) : null}

        <Field label="Email" htmlFor="email">
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            className={inputClass}
            style={inputStyle}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          description={mode === 'signup' ? 'At least 8 characters.' : undefined}
        >
          {/*
           * Let people see what they typed.
           *
           * Masking helps nobody signing up alone on a phone: it turns a
           * mistyped character into a failed login they cannot diagnose, and a
           * long password into something people avoid choosing. Revealing is
           * opt-in, starts hidden, and resets to hidden when the form switches
           * mode so a password is never left on screen unexpectedly.
           */}
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              className={inputClass}
              // Room for the button, so a long password never runs underneath it.
              style={{ ...inputStyle, paddingRight: 48 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              // The label says what pressing it will do, and announces the
              // current state, because the icon alone carries neither.
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              // 44px target: this gets tapped one-handed.
              className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center"
              style={{ color: 'var(--fg-subtle)' }}
            >
              {showPassword ? (
                <EyeOff size={18} aria-hidden />
              ) : (
                <Eye size={18} aria-hidden />
              )}
            </button>
          </div>
        </Field>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.message ? <Alert tone="success">{state.message}</Alert> : null}

        <Button type="submit" fullWidth disabled={pending || !configured}>
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

      <p className="mt-4 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        Your weight, measurements and food logs are private to your account. We do not share them,
        and administrators cannot read them by default.
      </p>
    </Panel>
  );
}
