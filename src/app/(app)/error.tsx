'use client';

import { useEffect } from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';
import { Button, Card } from '@/components/ui';

/**
 * Error boundary for the app screens.
 *
 * Two rules: never show a stack trace to someone tracking their weight, and
 * never imply their data is gone. A failed render is almost always a transient
 * network or query problem, and the logs are safe on the server.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('app route error', error);
  }, [error]);

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <div className="flex gap-2.5">
          <CircleAlert size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--signal)' }} aria-hidden />
          <div>
            <h1 className="text-base font-semibold">This screen did not load</h1>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
              Something went wrong on our side. Your logs, weight history and plan are safe — this
              is a display problem, not lost data.
            </p>
            <Button className="mt-4" onClick={reset}>
              <RotateCw size={16} aria-hidden /> Try again
            </Button>
            {error.digest ? (
              <p className="mt-3 text-xs" style={{ color: 'var(--fg-subtle)' }}>
                Reference: {error.digest}
              </p>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
