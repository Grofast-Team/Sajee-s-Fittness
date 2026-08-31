'use client';

import { useState, useTransition } from 'react';
import { CircleAlert, LogOut, Trash2 } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { deleteAccountAction, signOutAction } from '@/lib/actions/account';

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      className="w-full"
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
        className="w-full"
        onClick={() => setArmed(true)}
        style={{ color: 'var(--alarm)' }}
      >
        <Trash2 size={18} aria-hidden />
        Delete my account
      </Button>
    );
  }

  return (
    <Card className="border-dashed">
      <div className="flex gap-2.5">
        <CircleAlert size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--alarm)' }} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Delete your account permanently?</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
            This removes your plan, every food log, your weight and measurement history, and
            anything the coach remembers. It cannot be undone and there is no backup.
          </p>

          <label htmlFor="confirm-delete" className="mt-3 block text-sm font-medium">
            Type <span className="font-bold">DELETE</span> to confirm
          </label>
          <input
            id="confirm-delete"
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            className="mt-1.5 min-h-11 w-full rounded-md border px-3 text-base"
            style={{
              background: 'var(--ground)',
              color: 'var(--fg)',
              borderColor: 'var(--line)',
            }}
          />

          {error ? (
            <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--alarm)' }}>
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              disabled={pending || confirmation.trim().toUpperCase() !== 'DELETE'}
              style={{ background: 'var(--alarm)', color: '#ffffff' }}
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
      </div>
    </Card>
  );
}
