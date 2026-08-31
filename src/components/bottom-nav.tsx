'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Apple, Footprints, House, MessageCircleHeart, TrendingUp } from 'lucide-react';

/**
 * Primary navigation. Five destinations, which is the practical ceiling for a
 * bottom bar before targets get too narrow to hit reliably.
 *
 * Icons are paired with visible text labels. Icon-only navigation is a
 * recognition problem for exactly the beginner audience this app is for.
 */
const ITEMS = [
  { href: '/today', label: 'Today', Icon: House },
  { href: '/food', label: 'Food', Icon: Apple },
  { href: '/activity', label: 'Activity', Icon: Footprints },
  { href: '/progress', label: 'Progress', Icon: TrendingUp },
  { href: '/coach', label: 'Coach', Icon: MessageCircleHeart },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur"
      style={{
        background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="mx-auto flex max-w-lg">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-200"
                style={{ color: active ? 'var(--fg)' : 'var(--fg-subtle)' }}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
