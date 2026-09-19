'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  CheckSquare,
  Droplet,
  Footprints,
  House,
  LayoutDashboard,
  MessageCircleHeart,
  MoreHorizontal,
  Settings,
  User,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { CategoryDefinition } from '@/lib/engines/categories';

/**
 * Primary navigation.
 *
 * Categories are code-defined (src/lib/engines/categories.ts) and their
 * icons are kebab-case strings there on purpose, so that module stays free
 * of a framework dependency - this map is where a string becomes an actual
 * component, exactly where that module's own comment said it should live.
 *
 * Icons always carry visible text labels. Icon-only navigation is a
 * recognition problem for exactly the beginner audience this app is for.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  wallet: Wallet,
  footprints: Footprints,
  bell: Bell,
  'check-square': CheckSquare,
  droplet: Droplet,
  'message-circle-heart': MessageCircleHeart,
};

function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? House;
}

/**
 * How many top-level categories the mobile bottom bar shows directly
 * before the rest move into "More". Dashboard occupies one of the five
 * slots and More occupies another, leaving three for categories - the bar
 * never grows past five items regardless of how many categories exist.
 */
const BOTTOM_NAV_PRIMARY_COUNT = 3;

export function splitForBottomNav(
  categories: CategoryDefinition[],
): { primary: CategoryDefinition[]; overflow: CategoryDefinition[] } {
  return {
    primary: categories.slice(0, BOTTOM_NAV_PRIMARY_COUNT),
    overflow: categories.slice(BOTTOM_NAV_PRIMARY_COUNT),
  };
}

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
 * No ceiling here, unlike the bottom bar - vertical space accommodates
 * every enabled category. Profile and Settings sit at the foot, alongside
 * each other rather than folded into the main list: both are rare visits
 * compared to the categories themselves.
 */
export function Sidebar({ categories }: { categories: CategoryDefinition[] }) {
  const isActive = useIsActive();

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-(--sidebar-w) flex-col border-r lg:flex"
      style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
    >
      <div className="px-5 py-6">
        <Link href="/dashboard" className="inline-flex" aria-label="FitCoach, go to dashboard">
          <Wordmark />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 px-3">
        <ul className="space-y-1">
          <li>
            <Link
              href="/dashboard"
              aria-current={isActive('/dashboard') ? 'page' : undefined}
              className={clsx(
                'flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] transition-colors duration-200',
                isActive('/dashboard') ? 'font-semibold' : 'font-medium hover:bg-[var(--bg)]',
              )}
              style={{
                background: isActive('/dashboard') ? 'var(--primary-light)' : undefined,
                color: isActive('/dashboard') ? 'var(--primary-dark)' : 'var(--fg-muted)',
              }}
            >
              <LayoutDashboard size={19} strokeWidth={isActive('/dashboard') ? 2.3 : 1.9} aria-hidden />
              Dashboard
            </Link>
          </li>
          {categories.map(({ key, route, label, icon }) => {
            const active = isActive(route);
            const Icon = resolveIcon(icon);
            return (
              <li key={key}>
                <Link
                  href={route}
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

      <div className="border-t px-3 py-3 space-y-1" style={{ borderColor: 'var(--line)' }}>
        {[
          { href: '/profile', label: 'Profile', Icon: User },
          { href: '/settings', label: 'Settings', Icon: Settings },
        ].map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? 'page' : undefined}
            className="flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors duration-200 hover:bg-[var(--bg)]"
            style={{
              background: isActive(href) ? 'var(--primary-light)' : undefined,
              color: isActive(href) ? 'var(--primary-dark)' : 'var(--fg-muted)',
            }}
          >
            <Icon size={19} strokeWidth={1.9} aria-hidden />
            {label}
          </Link>
        ))}
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
        <Link href="/dashboard" className="inline-flex" aria-label="FitCoach, go to dashboard">
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

export function BottomNav({ categories }: { categories: CategoryDefinition[] }) {
  const isActive = useIsActive();
  const { primary } = splitForBottomNav(categories);

  const items = [
    { route: '/dashboard', label: 'Home', Icon: LayoutDashboard },
    ...primary.map((c) => ({ route: c.route, label: c.label, Icon: resolveIcon(c.icon) })),
    { route: '/more', label: 'More', Icon: MoreHorizontal },
  ];

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
        {items.map(({ route, label, Icon }) => {
          const active = isActive(route);
          return (
            <li key={route} className="flex-1">
              <Link
                href={route}
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
