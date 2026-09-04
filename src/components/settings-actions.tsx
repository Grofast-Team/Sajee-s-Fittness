'use client';

import { useState, useTransition } from 'react';
import { LogOut, Trash2 } from 'lucide-react';
import { Alert, Button, Field, inputClass, inputStyle } from '@/components/ui';
import { deleteAccountAction, signOutAction } from '@/lib/actions/account';

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      fullWidth
      disabled={pending}
      onClick={() => startTransition(() => signOutAction())}
    >
      <LogOut size={18} aria-hidden />
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}

/**
 * Account deletion.
 *
 * Two-step, and the second step asks you to type the word. That friction is
 * deliberate: this permanently destroys someone's weight history, food logs and
 * plan, and a mis-tap should not be able to do that. Confirmation before an
 * irreversible action is the single most important interaction rule here.
 */
export function DeleteAccountButton() {
  const [armed, setArmed] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!armed) {
    return (
      <Button
        variant="quiet"
        fullWidth
        onClick={() => setArmed(true)}
        style={{ color: 'var(--alarm)' }}
      >
        <Trash2 size={18} aria-hidden />
        Delete my account
      </Button>
    );
  }

  return (
    <div
      className="border p-4"
      style={{
        background: 'var(--alarm-wash)',
        borderColor: 'var(--alarm-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--alarm)' }}>
        Delete your account permanently?
      </h3>
      <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        This removes your plan, every food log, your weight and measurement history, and anything
        the coach remembers. It cannot be undone and there is no backup.
      </p>

      <div className="mt-4">
        <Field label="Type DELETE to confirm" htmlFor="confirm-delete">
          <input
            id="confirm-delete"
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            className={inputClass}
            style={inputStyle}
          />
        </Field>
      </div>

      {error ? (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          variant="danger"
          className="flex-1"
          disabled={pending || confirmation.trim().toUpperCase() !== 'DELETE'}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await deleteAccountAction(confirmation);
              // A successful delete redirects, so anything returned is a failure.
              if (result && !result.ok) setError(result.error);
            })
          }
        >
          {pending ? 'Deleting…' : 'Delete everything'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setArmed(false);
            setConfirmation('');
            setError(null);
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
