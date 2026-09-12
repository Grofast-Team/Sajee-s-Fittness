'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Bell, X } from 'lucide-react';
import { Panel } from '@/components/ui';
import { dismissNotification } from '@/lib/actions/notifications';
import type { InboxItem } from '@/lib/data/notifications';

/**
 * Things the app needs to tell you, unprompted.
 *
 * Renders nothing at all when there is nothing to say, which will be most
 * days. A panel that is always present and usually empty trains people to
 * scroll past the one morning it matters.
 *
 * Dismissing is optimistic: the row is what stops the daily job raising the
 * same event again, so a slow network should not leave someone tapping twice.
 */
export function Inbox({ items }: { items: InboxItem[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const visible = items.filter((i) => !dismissed.includes(i.id));
  if (visible.length === 0) return null;

  function dismiss(id: string) {
    setDismissed((current) => [...current, id]);
    startTransition(async () => {
      const result = await dismissNotification(id);
      // Put it back if the write did not land, rather than quietly losing it.
      if (!result.ok) setDismissed((current) => current.filter((x) => x !== id));
    });
  }

  return (
    <div className="mb-4 lg:mb-5">
      <Panel tone="primary">
        <ul className="space-y-3">
          {visible.map((item) => {
            const content = (
              <>
                <p className="text-sm font-semibold" style={{ color: 'var(--primary-dark)' }}>
                  {item.title}
                </p>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
                  {item.body}
                </p>
              </>
            );

            return (
              <li key={item.id} className="flex items-start gap-3">
                <Bell
                  size={16}
                  aria-hidden
                  className="mt-0.5 shrink-0"
                  style={{ color: 'var(--primary)' }}
                />

                <div className="min-w-0 flex-1">
                  {item.deepLink ? (
                    <Link href={item.deepLink} className="block">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  aria-label={`Dismiss: ${item.title}`}
                  className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full"
                  style={{ color: 'var(--fg-subtle)' }}
                >
                  <X size={15} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
