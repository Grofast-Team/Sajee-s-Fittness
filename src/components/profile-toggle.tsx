'use client';

import { useState } from 'react';
import { toggleCategory } from '@/lib/actions/categories';

/**
 * One category's on/off switch.
 *
 * Reused across every no-setup category (currently just Money; Reminders,
 * Checklist and Cycle join once their own pages exist). Fitness does not
 * use this component at all - see the Profile page, which renders it with
 * a link to the interview instead of a switch, per toggleCategory's own
 * refusal to enable Fitness through this path.
 */
export function ProfileToggle({
  categoryKey,
  label,
  initialEnabled,
}: {
  categoryKey: string;
  label: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    const next = !enabled;
    setPending(true);
    setError(null);
    const result = await toggleCategory(categoryKey, next);
    if (result.ok) {
      setEnabled(next);
    } else {
      setError(result.error);
    }
    setPending(false);
  }

  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        onClick={handleToggle}
        disabled={pending}
        className="relative h-7 w-12 rounded-full transition-colors duration-200"
        style={{ background: enabled ? 'var(--primary)' : 'var(--line-strong)' }}
      >
        <span
          className="absolute top-1 size-5 rounded-full bg-white transition-transform duration-200"
          style={{ transform: enabled ? 'translateX(22px)' : 'translateX(4px)' }}
        />
      </button>
      {error ? (
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: 'var(--alarm)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
