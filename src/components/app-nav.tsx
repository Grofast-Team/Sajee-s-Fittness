'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Apple,
  Footprints,
  House,
  MessageCircleHeart,
  Settings,
  TrendingUp,
} from 'lucide-react';
import { clsx } from 'clsx';

/**
 * Primary navigation.
 *
 * Five destinations, which is the practical ceiling for a bottom bar before
 * targets get too narrow to hit reliably, and enough for a sidebar to stay
 * scannable. Recipes, groceries and insights deliberately live inside these
 * five rather than beside them — a sidebar that grows with the backend is how
 * an app ends up with fourteen destinations and no obvious starting point.
 *
 * Icons always carry visible text labels. Icon-only navigation is a recognition
 * problem for exactly the beginner audience this app is for.
 */
const ITEMS = [
  { href: '/today', label: 'Today', Icon: House },
  { href: '/food', label: 'Food', Icon: Apple },
  { href: '/activity', label: 'Activity', Icon: Footprints },
  { href: '/progress', label: 'Progress', Icon: TrendingUp },
  { href: '/coach', label: 'Coach', Icon: MessageCircleHeart },
] as const;

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** The brand mark. A ring, because the ring is what the app is. */
function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <span
        className="flex size-7 items-center justify-center rounded-lg"
        style={{ background: 'var(--primary)' }}
        aria-hidden
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="5.5" stroke="var(--on-primary)" strokeWidth="2.5" opacity="0.35" />
          <path
            d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"
            stroke="var(--on-primary)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="display text-[17px]">FitCoach</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop                                                             */
/* ------------------------------------------------------------------ */

/**
 * The desktop sidebar, from 1024px up.
 *
 * Settings sits at the foot rather than in the main list: it is a rare visit
 * compared to the daily five, and putting it in the same group would imply it
 * is somewhere you go every day.
 */
export function Sidebar() {
  const isActive = useIsActive();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-w) flex-col border-r lg:flex"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="px-5 py-6">
        <Link href="/today" className="inline-flex" aria-label="FitCoach, go to today">
          <Wordmark />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 px-3">
        <ul className="space-y-1">
          {ITEMS.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] transition-colors duration-200',
                    active ? 'font-semibold' : 'font-medium hover:bg-[var(--bg)]',
                  )}
                  style={{
                    background: active ? 'var(--primary-light)' : undefined,
                    color: active ? 'var(--primary-dark)' : 'var(--fg-muted)',
                  }}
                >
                  <Icon size={19} strokeWidth={active ? 2.3 : 1.9} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t px-3 py-3" style={{ borderColor: 'var(--line)' }}>
        <Link
          href="/settings"
          aria-current={isActive('/settings') ? 'page' : undefined}
          className="flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors duration-200 hover:bg-[var(--bg)]"
          style={{
            background: isActive('/settings') ? 'var(--primary-light)' : undefined,
            color: isActive('/settings') ? 'var(--primary-dark)' : 'var(--fg-muted)',
          }}
        >
          <Settings size={19} strokeWidth={1.9} aria-hidden />
          Settings
        </Link>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile and tablet                                                   */
/* ------------------------------------------------------------------ */

/** The compact top bar, below 1024px. The sidebar carries the brand above that. */
export function MobileHeader() {
  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur lg:hidden"
      style={{
        background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
        borderColor: 'var(--line)',
      }}
    >
      <div className="gutter flex h-14 items-center justify-between">
        <Link href="/today" className="inline-flex" aria-label="FitCoach, go to today">
          <Wordmark />
        </Link>
        <Link
          href="/settings"
          aria-label="Settings"
          className="-mr-2 flex size-11 items-center justify-center rounded-[10px] transition-colors duration-200"
          style={{ color: 'var(--fg-muted)' }}
        >
          <Settings size={20} aria-hidden />
        </Link>
      </div>
    </header>
  );
}

export function BottomNav() {
  const isActive = useIsActive();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur lg:hidden"
      style={{
        background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
        borderColor: 'var(--line)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className="flex min-h-[3.75rem] flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors duration-200"
                style={{ color: active ? 'var(--primary)' : 'var(--fg-subtle)' }}
              >
                <Icon size={21} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
