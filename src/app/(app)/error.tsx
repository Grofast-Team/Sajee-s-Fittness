'use client';

import { useEffect } from 'react';
import { RotateCw } from 'lucide-react';
import { Alert, Button } from '@/components/ui';

/**
 * Error boundary for the app screens.
 *
 * Two rules: never show a stack trace to someone tracking their weight, and
 * never imply their data is gone. A failed render is almost always a transient
 * network or query problem, and the logs are safe on the server. The reference
 * code stays visible because it is the one thing that helps if they write in.
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
    <div className="measure pt-8">
      <Alert
        tone="error"
        title="This screen did not load"
        action={
          <Button onClick={reset}>
            <RotateCw size={16} aria-hidden /> Try again
          </Button>
        }
      >
        <p>
          Something went wrong on our side. Your logs, weight history and plan are safe — this is a
          display problem, not lost data.
        </p>
        {error.digest ? (
          <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
            Reference: {error.digest}
          </p>
        ) : null}
      </Alert>
    </div>
  );
}
