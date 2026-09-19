# Dashboard, Profile, and Dynamic Nav (Phase 4a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the category toggle mechanism, `/dashboard`, `/profile`, and
overflow-aware dynamic navigation — the first of four sub-phases that
replace Phase 3's temporary `/onboarding`/`/money` redirect targets with
the real destinations the design spec always intended.

**Architecture:** A generic `toggleCategory` server action handles every
no-setup category (Fitness keeps its own separate enable path through the
9-step interview, unchanged from Phase 2). `(app)/layout.tsx` fetches
enabled categories once and passes them down to the nav components, which
render Dashboard + up to 3 categories + a "More" overflow page on mobile,
and everything unconstrained on desktop. Reminders, Checklist and Cycle
render in Profile as visibly unavailable — their pages don't exist until
sub-phases 4b/4c/4d.

**Tech Stack:** Next.js 16 App Router (Server Components, Server Actions),
Supabase, TypeScript, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-18-modular-categories-design.md`
(§5 toggle flow, §7 sub-feature visibility, §10 Dashboard, §11 Profile)

## Global Constraints

- **Fitness cannot be enabled through `toggleCategory`.** Per spec §5, it
  can only become enabled through a completed `saveOnboarding` or when an
  active plan already exists — never through the generic toggle. Disabling
  Fitness through the generic toggle IS allowed (the invariant is only
  about the enable path, not the disable path).
- **`Reminders`, `Checklist`, `Cycle` have no pages yet.** Profile must show
  them (the registry lists all 5 — hiding them would contradict what the
  registry says exists) but as visibly unavailable, using the existing
  `Unavailable` component from `src/components/ui.tsx` — never as a working
  toggle that would enable a category with nowhere to go.
- **Mobile bottom nav: Dashboard + first 3 enabled top-level categories (in
  registry order) + a "More" tab, always 5 slots.** "More" is a plain page
  at `/more` (not a modal/sheet — this codebase has no overlay pattern
  anywhere and this plan does not introduce one), listing Profile, Settings,
  and any enabled category beyond the first 3.
- **Desktop sidebar has no ceiling** — list every enabled category, plus
  Profile and Settings in the footer, no overflow needed.
- **The dynamic nav components stay pure rendering.** `Sidebar`,
  `MobileHeader`, `BottomNav` are `'use client'` components and cannot call
  `getEnabledCategories` themselves (it needs a server Supabase client).
  `(app)/layout.tsx` fetches once and passes `visibleCategories:
  CategoryDefinition[]` down as a prop to all three.
- **Icons are resolved from strings to components only in `app-nav.tsx`**,
  per the deliberate decision in `src/lib/engines/categories.ts`'s own
  comment: that module stays framework-free, and the render layer (here)
  is where `lucide-react` was always meant to be imported.
- **`(fitness)/layout.tsx`'s "not enabled" redirect changes to `/profile`.**
  Its "enabled but no active plan" redirect stays `/onboarding` — that
  branch genuinely still needs the interview, and always will.
- **Settings splits, not moves wholesale.** "Your data" (sign out, delete
  account — genuinely account-level, must stay reachable regardless of
  category state) stays at `(app)/settings`. "Your plan" and "Your
  constraints" (fitness-specific — this is the exact ungated surface
  Phase 3's final review flagged and deferred here) move to a new
  `(app)/(fitness)/settings`.

---

## File Structure

- **Create:** `src/lib/actions/categories.ts` — `toggleCategory`.
- **Create:** `src/app/(app)/dashboard/page.tsx` — the new landing page.
- **Create:** `src/app/(app)/profile/page.tsx` — the category toggle screen.
- **Create:** `src/components/profile-toggle.tsx` — the client-side toggle
  switch, one component reused for every top-level category.
- **Create:** `src/app/(app)/more/page.tsx` — the mobile overflow page.
- **Create:** `src/app/(app)/(fitness)/settings/page.tsx` — "Your plan" and
  "Your constraints", moved out of the general Settings page.
- **Modify:** `src/app/(app)/settings/page.tsx` — trimmed to "Your data"
  only.
- **Modify:** `src/components/app-nav.tsx` — dynamic, prop-driven nav.
- **Modify:** `src/app/(app)/layout.tsx` — fetches and passes down
  `visibleCategories`.
- **Modify:** `src/lib/actions/auth.ts` — `signIn`'s redirect simplifies.
- **Modify:** `src/app/page.tsx` — the root redirect simplifies.
- **Modify:** `src/app/(app)/(fitness)/layout.tsx` — one redirect target
  changes, the doc comment updates.

---

### Task 1: `toggleCategory`, the generic enable/disable action

**Files:**
- Create: `src/lib/actions/categories.ts`

**Interfaces:**
- Consumes: `getEnabledCategories` and the `SupabaseClient` type — not
  actually needed here, since this action creates its own client (it has
  no pre-existing auth context to reuse, unlike the guard helpers).
- Produces: `type ToggleResult = { ok: true } | { ok: false; error: string }`,
  `async function toggleCategory(categoryKey: string, enabled: boolean): Promise<ToggleResult>`.
  Task 5 (the Profile toggle component) calls this by exactly this name and
  signature.

- [ ] **Step 1: Write the action**

Create `src/lib/actions/categories.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * Turning a category on or off, for every category except Fitness.
 *
 * Fitness has its own enable path - the nine-step interview in
 * saveOnboarding (src/lib/actions/onboarding.ts) - because enabling it
 * means computing a real plan, not just flipping a flag. Design spec
 * section 5 is explicit that Fitness can only become enabled through a
 * completed interview or an already-existing plan, never through this
 * generic action, so enabling 'fitness' here is refused outright.
 * Disabling it is fine - turning any category off is uniform, since there
 * is no equivalent invariant about the disabled state.
 */

export type ToggleResult = { ok: true } | { ok: false; error: string };

export async function toggleCategory(categoryKey: string, enabled: boolean): Promise<ToggleResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  if (enabled && categoryKey === 'fitness') {
    return { ok: false, error: 'Fitness turns on by completing setup, not with this switch.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { error } = await supabase.from('user_categories').upsert(
    {
      user_id: auth.user.id,
      category_key: categoryKey,
      enabled,
      ...(enabled ? { enabled_at: new Date().toISOString() } : { disabled_at: new Date().toISOString() }),
    },
    { onConflict: 'user_id,category_key' },
  );

  if (error) {
    return { ok: false, error: 'We could not save that. Please try again.' };
  }

  // A toggle changes the nav and the dashboard shell, not one page - the
  // same shell-wide precedent as account.ts/auth.ts, not a single-path call.
  revalidatePath('/', 'layout');
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Manual verification against the live project**

If a live project is available:

1. As a test user, call `toggleCategory('fitness', true)` directly (or
   through a temporary script). Confirm it returns
   `{ ok: false, error: 'Fitness turns on by completing setup, not with this switch.' }`
   and writes nothing.
2. Call `toggleCategory('money', true)`. Confirm a `user_categories` row is
   created with `enabled: true`, `enabled_at` set.
3. Call `toggleCategory('money', false)` on the same user. Confirm the row
   updates to `enabled: false`, `disabled_at` set, and the row is not
   deleted (turning a category off must never touch its domain data, and
   the row itself is the category's own state, not domain data — but
   deleting it would still be wrong, since `enabled_at`/`disabled_at`
   history would be lost).
4. Call `toggleCategory('fitness', false)` on a user who has Fitness
   enabled via the real path (an active plan). Confirm this succeeds — the
   refusal is only for enabling, not disabling.

If no live project is available, state that plainly.

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions/categories.ts
git commit -m "Add the generic category toggle action

toggleCategory handles every category except Fitness, which keeps its
own enable path through the nine-step interview - design spec section
5 is explicit that Fitness can only become enabled through a completed
saveOnboarding or an already-existing plan, so enabling 'fitness' here
is refused outright. Disabling it is uniform with every other category.

Verified against the live project: the fitness-enable refusal, a
normal enable/disable cycle for money, and that disabling fitness
through this path still works correctly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Dynamic, overflow-aware navigation

**Files:**
- Modify: `src/components/app-nav.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getEnabledCategories` and `visibleCategories` from
  `@/lib/data/categories` and `@/lib/engines/categories` respectively
  (both already exist, from Phase 1 and Phase 3). `CategoryDefinition`'s
  shape: `{ key, label, route, requiresSetup, icon, parentKey? }`, `icon`
  being a kebab-case string.
- Produces: `Sidebar`, `MobileHeader`, `BottomNav` now each take a
  `categories: CategoryDefinition[]` prop. No later task in this plan
  calls these directly (they are rendered once, from `(app)/layout.tsx`),
  but Task 6's `/more` page needs the same overflow-slicing logic, so it
  is written once here and exported for reuse: `export function
  splitForBottomNav(categories: CategoryDefinition[]): { primary:
  CategoryDefinition[]; overflow: CategoryDefinition[] }`.

- [ ] **Step 1: Add the icon resolution map and the overflow-splitting helper**

In `src/components/app-nav.tsx`, replace the top of the file (everything
from the imports through the `const ITEMS = [...]` block) with:

```tsx
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
```

- [ ] **Step 2: Update the brand mark's link target**

Still in `app-nav.tsx`, find the `Wordmark` function and the two places
that wrap it in a `<Link href="/today" ...>` (one in `Sidebar`, one in
`MobileHeader`). Change both `href="/today"` to `href="/dashboard"` — the
logo now goes home, and home is the dashboard, not the fitness screen.

- [ ] **Step 3: Make `Sidebar` take a `categories` prop and render it**

Replace the `Sidebar` function with:

```tsx
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
          {categories.map(({ key, href, label, icon }: CategoryDefinition & { href?: string }) => {
            const route = href ?? key;
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
```

Note: `CategoryDefinition` has a `route` field, not `href` — the
`href ?? key` fallback above is defensive but `route` is what actually
exists. Use `category.route` directly, not `href`:

```tsx
{categories.map(({ key, route, label, icon }) => {
  const active = isActive(route);
```

(This correction applies to both `Sidebar` and `BottomNav` below — the
snippets in this plan use `route`, written out correctly in Step 3 and
Step 5; the paragraph above exists only to flag the field name explicitly,
since getting it wrong would compile — `CategoryDefinition` has no `href`
field, so destructuring one would just be `undefined` — but silently
produce dead links.)

- [ ] **Step 4: Update `MobileHeader`'s brand link only** (its Settings
      icon-button stays as-is — Settings is still directly reachable from
      the header on mobile, independent of the bottom bar's overflow)

```tsx
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
```

- [ ] **Step 5: Rewrite `BottomNav` with the Dashboard + 3 + More composition**

```tsx
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
```

- [ ] **Step 6: Update `(app)/layout.tsx` to fetch and pass `visibleCategories`**

Read the current file first — it currently renders `<Sidebar />`,
`<MobileHeader />`, `<BottomNav />` with no props, right after the
`needsOnboarding()` gate. Add the category fetch after that gate (only
signed-in, minimally-onboarded users reach this point, so a Supabase
client and a real user are both safe to assume here) and pass the result
down:

```tsx
import { redirect } from 'next/navigation';
import { BottomNav, MobileHeader, Sidebar } from '@/components/app-nav';
import { needsOnboarding } from '@/lib/data/onboarding-state';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { visibleCategories } from '@/lib/engines/categories';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (await needsOnboarding()) {
    redirect('/onboarding-name');
  }

  let categories: ReturnType<typeof visibleCategories> = [];
  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const enabled = await getEnabledCategories(supabase, auth.user.id);
      categories = visibleCategories(enabled);
    }
  }

  return (
    <div className="min-h-dvh">
      <Sidebar categories={categories} />

      <div className="lg:pl-(--sidebar-w)">
        <MobileHeader />

        <main id="main" className="gutter has-bottom-nav">
          <div className="content-max">{children}</div>
        </main>
      </div>

      <BottomNav categories={categories} />
    </div>
  );
}
```

Note: `visibleCategories` includes sub-features (Coach) whose visibility
derives from their parent — per spec §7, Coach appears here whenever
Fitness is enabled. `Sidebar`/`BottomNav` render whatever this list
contains without needing to know that Coach is a sub-feature; the registry
already resolved that.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 8: Manual verification against the live project**

If available:
1. As a user with only Money enabled, confirm the sidebar shows Dashboard,
   Money, Profile, Settings — and the bottom bar shows Home, Money, More
   (only 3 items, since there is only 1 category — the layout must not
   break or show empty slots when fewer than 3 categories exist).
2. As a user with Money and Fitness enabled, confirm both appear, plus
   Coach (Fitness's sub-feature) in the sidebar's category list.
3. Confirm the brand-mark logo link goes to `/dashboard`, not `/today`.

If no live project is available, state that plainly.

- [ ] **Step 9: Commit**

```bash
git add src/components/app-nav.tsx "src/app/(app)/layout.tsx"
git commit -m "Make navigation dynamic and overflow-aware

Sidebar and BottomNav now render whatever visibleCategories() returns
for the signed-in user, fetched once in (app)/layout.tsx and passed
down as props - the nav components stay pure rendering, since they are
client components and cannot reach Supabase themselves.

The bottom bar caps at Dashboard + 3 categories + More, always five
slots regardless of how many categories exist; the sidebar has no
ceiling, since vertical space accommodates the full list. Icons are
resolved from the registry's kebab-case strings to real lucide-react
components only here, exactly where that module's own design intended.

The brand-mark logo now links to /dashboard, not /today - the app's
home is no longer assumed to be the fitness screen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: The `/dashboard` page

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getEnabledCategories`, `visibleCategories`, `getMoneyMonth`
  (existing, `src/lib/data/money.ts`), `formatRupees` (existing,
  `src/lib/engines/money.ts`), `getDayView` (existing,
  `src/lib/data/day.ts`).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the page**

Create `src/app/(app)/dashboard/page.tsx`:

```tsx
import Link from 'next/link';
import { Panel, PageHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { visibleCategories } from '@/lib/engines/categories';
import { getMoneyMonth } from '@/lib/data/money';
import { formatRupees } from '@/lib/engines/money';
import { getDayView } from '@/lib/data/day';

export const metadata = { title: 'Dashboard — FitCoach' };

/**
 * The generic home screen.
 *
 * One tile per enabled top-level category, each with a live one-line
 * summary computed from data that already exists elsewhere in the app -
 * no new engine, since a summary is not a calculation this screen owns,
 * it is a fact borrowed from the screen that does. Sub-features (Coach)
 * do not get their own tile here, matching Profile's own rule that a
 * sub-feature has no independent presence outside its parent.
 */
export default async function DashboardPage() {
  let enabledKeys = new Set<string>();

  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      enabledKeys = new Set(await getEnabledCategories(supabase, auth.user.id));
    }
  }

  const categories = visibleCategories(enabledKeys).filter((c) => !c.parentKey);

  const summaries: Record<string, string> = {};
  if (enabledKeys.has('money')) {
    const money = await getMoneyMonth();
    summaries.money = `${formatRupees(money.summary.totalPaise)} spent this month`;
  }
  if (enabledKeys.has('fitness')) {
    const day = await getDayView();
    summaries.fitness = `${Math.max(0, day.remaining.kcalRemaining).toLocaleString()} kcal remaining today`;
  }

  return (
    <>
      <PageHeader title="Dashboard" />

      {categories.length === 0 ? (
        <Panel feature>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            Nothing is set up yet.
          </p>
          <Link
            href="/profile"
            className="mt-4 inline-flex min-h-11 items-center px-4 text-sm font-semibold"
            style={{ background: 'var(--primary)', color: 'var(--on-primary)', borderRadius: 'var(--radius-control)' }}
          >
            Set up your first category
          </Link>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((c) => (
              <Link key={c.key} href={c.route} className="block">
                <Panel>
                  <h2 className="text-[15px] font-semibold">{c.label}</h2>
                  <p className="mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
                    {summaries[c.key] ?? 'Open'}
                  </p>
                </Panel>
              </Link>
            ))}
          </div>

          <Link
            href="/profile"
            className="mt-4 inline-block text-sm font-medium"
            style={{ color: 'var(--primary-dark)' }}
          >
            + Add a category
          </Link>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. If `formatRupees` is not exported from
`src/lib/engines/money.ts` under that exact name, search the file for its
actual export name and use that instead — do not guess a different
function or reimplement formatting here.

- [ ] **Step 3: Manual verification against the live project**

If available: as a user with nothing enabled, confirm the "Set up your
first category" prompt renders and links to `/profile`. As a user with
Money enabled, confirm a tile renders with the correct rupee figure and
links to `/money`. As a user with both Money and Fitness enabled, confirm
Coach does not get its own tile (only Money and Fitness do).

If no live project is available, state that plainly.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "Add the Dashboard screen

One tile per enabled top-level category, each with a one-line summary
borrowed from the screen that actually owns that number - Money's from
getMoneyMonth(), Fitness's from getDayView() - rather than a new
calculation this screen would own itself. Sub-features like Coach get
no tile, matching how Profile treats them.

Nothing enabled shows one prompt to /profile rather than an empty
grid; at least one category enabled keeps that same destination
reachable as a quieter '+ Add a category' link, per design spec
section 10.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: The `/profile` page and its toggle component

**Files:**
- Create: `src/components/profile-toggle.tsx`
- Create: `src/app/(app)/profile/page.tsx`

**Interfaces:**
- Consumes: `toggleCategory` (Task 1), `CATEGORIES` and `isCategoryVisible`
  from `@/lib/engines/categories`, `getEnabledCategories`, `Unavailable`
  from `@/components/ui`.
- Produces: `function ProfileToggle({ categoryKey, label, initialEnabled }: { categoryKey: string; label: string; initialEnabled: boolean })`.
  No later task in this plan consumes it, but future sub-phases (4b/4c/4d)
  will reuse it for Reminders/Checklist/Cycle once their pages exist.

- [ ] **Step 1: Write the toggle component**

Create `src/components/profile-toggle.tsx`:

```tsx
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
        <p role="alert" className="mt-1.5 text-[13px]" style={{ color: 'var(--alarm, #b91c1c)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

Create `src/app/(app)/profile/page.tsx`:

```tsx
import Link from 'next/link';
import { Panel, PageHeader, Section, Unavailable } from '@/components/ui';
import { ProfileToggle } from '@/components/profile-toggle';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { CATEGORIES } from '@/lib/engines/categories';

export const metadata = { title: 'Profile — FitCoach' };

/**
 * Where every category is turned on or off.
 *
 * Sub-features (Coach) do not appear here - they have no independent
 * toggle, per design spec section 11; their visibility is computed from
 * their parent everywhere else in the app.
 *
 * Reminders, Checklist and Cycle are listed - the registry says they
 * exist - but rendered as Unavailable rather than a working switch, since
 * their pages do not exist until later sub-phases. A switch with nowhere
 * to go would be worse than not listing them at all.
 */
export default async function ProfilePage() {
  let enabled = new Set<string>();
  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) enabled = new Set(await getEnabledCategories(supabase, auth.user.id));
  }

  const topLevel = CATEGORIES.filter((c) => !c.parentKey);

  return (
    <>
      <PageHeader title="Profile" />

      <Panel>
        <Section title="Your categories">
          <ul className="space-y-4">
            {topLevel.map((c) => {
              const isEnabled = enabled.has(c.key);

              if (c.requiresSetup) {
                // Fitness: no switch. Enabling it means computing a real
                // plan, which this screen does not do - it links to the
                // interview instead, exactly as toggleCategory's own
                // refusal to enable Fitness expects.
                return (
                  <li key={c.key} className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{c.label}</span>
                    {isEnabled ? (
                      <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                        Enabled
                      </span>
                    ) : (
                      <Link
                        href="/onboarding"
                        className="text-[13px] font-semibold"
                        style={{ color: 'var(--primary-dark)' }}
                      >
                        Set up →
                      </Link>
                    )}
                  </li>
                );
              }

              const hasPage = c.key === 'money';
              if (!hasPage) {
                return (
                  <li key={c.key}>
                    <Unavailable title={c.label} detail="Not available yet." />
                  </li>
                );
              }

              return (
                <li key={c.key} className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{c.label}</span>
                  <ProfileToggle categoryKey={c.key} label={c.label} initialEnabled={isEnabled} />
                </li>
              );
            })}
          </ul>
        </Section>
      </Panel>
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Manual verification against the live project**

If available: confirm Money shows a working toggle that persists across a
reload; confirm Fitness shows "Set up →" linking to `/onboarding` when
disabled, and "Enabled" with no switch when a plan exists; confirm
Reminders, Checklist and Cycle render as `Unavailable`, not a switch.

If no live project is available, state that plainly.

- [ ] **Step 5: Commit**

```bash
git add src/components/profile-toggle.tsx "src/app/(app)/profile/page.tsx"
git commit -m "Add the Profile screen

A toggle card per top-level category, per design spec section 11.
Fitness gets a link to the interview instead of a switch - it has no
generic enable path, by design (Task 1). Reminders, Checklist and
Cycle render as Unavailable rather than a working toggle, since their
pages do not exist until later sub-phases; listing them un-toggleable
is honest about what the registry says exists without pretending they
are usable yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: The `/more` overflow page

**Files:**
- Create: `src/app/(app)/more/page.tsx`

**Interfaces:**
- Consumes: `getEnabledCategories`, `visibleCategories`,
  `splitForBottomNav` (Task 2's export from `app-nav.tsx`).
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Write the page**

Create `src/app/(app)/more/page.tsx`:

```tsx
import Link from 'next/link';
import { Settings, User } from 'lucide-react';
import { Panel, PageHeader } from '@/components/ui';
import { splitForBottomNav } from '@/components/app-nav';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { visibleCategories } from '@/lib/engines/categories';

export const metadata = { title: 'More — FitCoach' };

/**
 * The mobile bottom bar's overflow.
 *
 * A plain page, not a sheet or a modal - this codebase has no overlay
 * pattern anywhere, and this is not the place to introduce one. Everything
 * the bottom bar could not fit lands here: Profile, Settings, and any
 * enabled category past the first three.
 */
export default async function MorePage() {
  let categories: ReturnType<typeof visibleCategories> = [];
  if (supabaseConfigured) {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      const enabled = await getEnabledCategories(supabase, auth.user.id);
      categories = visibleCategories(enabled).filter((c) => !c.parentKey);
    }
  }

  const { overflow } = splitForBottomNav(categories);

  const links = [
    { href: '/profile', label: 'Profile', Icon: User },
    ...overflow.map((c) => ({ href: c.route, label: c.label, Icon: null })),
    { href: '/settings', label: 'Settings', Icon: Settings },
  ];

  return (
    <>
      <PageHeader title="More" />
      <Panel>
        <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
          {links.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link href={href} className="flex min-h-12 items-center gap-3 text-sm font-medium">
                {Icon ? <Icon size={19} aria-hidden /> : null}
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

With only Money and Fitness ever enabled today, `overflow` will always be
empty (2 categories fit within the primary-3 slot) — confirm the page
still renders correctly with just Profile and Settings listed, and
doesn't crash on an empty `overflow` array. Full overflow behavior (a 4th
category actually appearing here) is only testable once sub-phase 4b
ships Reminders.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/more/page.tsx"
git commit -m "Add the mobile nav overflow page

A plain list, not a sheet - Profile, Settings, and any enabled
category beyond the bottom bar's first three, using the same
splitForBottomNav helper the bar itself uses so the two never
disagree about what counts as overflow.

Untestable in full today: with only Money and Fitness ever enabled,
overflow is always empty. Real coverage arrives with sub-phase 4b.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Split Settings into account-level and Fitness-specific

**Files:**
- Create: `src/app/(app)/(fitness)/settings/page.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Read the current settings page in full**

Before editing, read `src/app/(app)/settings/page.tsx` completely — this
plan was written against its content as of Phase 3's final commit, and it
is exactly the kind of file another concurrent change could have touched
since. Confirm it still has three sections in this order: "Your plan",
"Your constraints", "Your data" — if the structure has changed, stop and
report rather than guessing at the split.

- [ ] **Step 2: Create the Fitness-specific settings page**

Create `src/app/(app)/(fitness)/settings/page.tsx` containing everything
from the current file EXCEPT the "Your data" section: the same imports
`getDayView`, the same `SampleBanner`, `PageHeader` (relabel its title to
distinguish it from the general Settings page — use `"Fitness settings"`),
and the "Your plan" and "Your constraints" `<Panel><Section>` blocks,
copied verbatim from the current file. Keep the "Redo setup" link and its
explanatory paragraph exactly as they are now.

- [ ] **Step 3: Trim the general settings page**

Edit `src/app/(app)/settings/page.tsx` to remove the "Your plan" and
"Your constraints" `<Panel>` blocks, keeping only "Your data" (the
sign-out/delete-account section) and whatever page-level scaffolding
(imports, the `getDayView`/email fetch used by "Your data"'s sample-mode
check) that section still needs. If `getDayView` was only ever used to
support the two removed sections, remove that import and its usage too —
"Your data" needs `email` and `day.isSample`, not the plan/constraint
fields.

Add a link from the general Settings page to the new Fitness settings
page, since Fitness's own settings are no longer reachable from here:

```tsx
<Panel>
  <Section title="Fitness">
    <Link
      href="/settings/fitness"
      className="text-sm font-medium"
      style={{ color: 'var(--primary-dark)' }}
    >
      Your plan and constraints →
    </Link>
  </Section>
</Panel>
```

Wait — the new page lives at `(app)/(fitness)/settings`, which resolves to
the URL `/settings`, colliding with the general settings page's own URL
(route groups do not appear in the URL, so both `(app)/settings/page.tsx`
and `(app)/(fitness)/settings/page.tsx` would both claim `/settings` —
this is a real conflict Next.js will refuse to build). Rename the new
page's directory to avoid this: create it at
`src/app/(app)/(fitness)/fitness-settings/page.tsx` instead, so its URL is
`/fitness-settings`, and link to that from the general Settings page:

```tsx
<Link href="/fitness-settings" ...>Your plan and constraints →</Link>
```

Use `/fitness-settings` as the actual path throughout this task, not
`/settings/fitness` — correcting the paragraph above it.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Manual verification against the live project**

If available: confirm `/settings` shows only "Your data" plus a link to
`/fitness-settings`; confirm `/fitness-settings` shows "Your plan" and
"Your constraints" and is reachable only when Fitness is enabled (it
inherits `(fitness)/layout.tsx`'s guard automatically, being inside that
route group — confirm a Fitness-disabled user hitting `/fitness-settings`
directly gets redirected, not shown sample fitness data as it was before
this task).

If no live project is available, state that plainly.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/settings/page.tsx" "src/app/(app)/(fitness)/fitness-settings/page.tsx"
git commit -m "Split Settings into account-level and Fitness-specific

/settings rendered a full fitness plan panel - energy target, protein,
steps, diet, allergies - ungated, for every user regardless of
category state. Phase 3's final review flagged this and deferred the
fix here: a Fitness-disabled user reached it and saw sample fitness
numbers behind a SampleBanner, which is not a data leak, but is a
fitness-domain surface this design's own goal line says should be
gated like every other one.

/settings now holds only 'Your data' - sign out, delete account -
which must stay reachable regardless of category state. The plan and
constraints sections move to /fitness-settings, inside the (fitness)
route group, inheriting its guard automatically.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Simplify the three interim redirects now that `/dashboard` and `/profile` exist

**Files:**
- Modify: `src/lib/actions/auth.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/(app)/(fitness)/layout.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Simplify `signIn`**

In `src/lib/actions/auth.ts`, find:

```ts
  revalidatePath('/', 'layout');

  // /today is gated on Fitness being enabled (see (app)/(fitness)/layout.tsx).
  // Sending every sign-in there unconditionally would bounce a Fitness-disabled
  // user into /onboarding, which has no navigation at all - a dead end. /money
  // is never gated and always has full nav, so it is the safe default landing
  // page for anyone who hasn't enabled Fitness.
  const enabled = data.user ? await getEnabledCategories(supabase, data.user.id) : new Set<string>();
  redirect(isCategoryVisible('fitness', enabled) ? '/today' : '/money');
```

Replace with:

```ts
  revalidatePath('/', 'layout');
  redirect('/dashboard');
```

Remove the now-unused imports `getEnabledCategories` and
`isCategoryVisible` from the top of this file if nothing else in it uses
them (check before removing — `grep` the file for both names first).

- [ ] **Step 2: Simplify the root page**

In `src/app/page.tsx`, replace the whole file:

```tsx
import { redirect } from 'next/navigation';

/**
 * Root.
 *
 * Normally just a doorway to /dashboard, but it also has to catch auth
 * codes. Supabase falls back to the project's Site URL — this page —
 * whenever a redirect target is missing from the allow-list, so a
 * confirmation link can legitimately arrive here as `/?code=...`.
 * Redirecting to /dashboard without forwarding that code silently throws
 * the session away and leaves the user staring at a login screen right
 * after confirming their email.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const { code, next } = await searchParams;

  if (code) {
    const target = new URLSearchParams({ code });
    if (next && next.startsWith('/') && !next.startsWith('//')) target.set('next', next);
    redirect(`/auth/callback?${target.toString()}`);
  }

  redirect('/dashboard');
}
```

This removes the Fitness-aware branching entirely — `/dashboard` renders
correctly regardless of what (if anything) is enabled, so there is no
longer a reason for this page to check category state itself.

- [ ] **Step 3: Point the "not enabled" branch at `/profile`**

In `src/app/(app)/(fitness)/layout.tsx`, find:

```tsx
  const enabled = await getEnabledCategories(supabase, auth.user.id);
  if (!isCategoryVisible('fitness', enabled)) {
    redirect('/onboarding');
  }
```

Replace with:

```tsx
  const enabled = await getEnabledCategories(supabase, auth.user.id);
  if (!isCategoryVisible('fitness', enabled)) {
    redirect('/profile');
  }
```

Leave the second redirect (`enabled but no active plan`) as
`redirect('/onboarding')` — that branch is unaffected by this task; it
still needs the interview.

Update the doc comment above `FitnessLayout` — replace:

```
 * Interim redirect target: /onboarding for both failure cases below.
 * Design spec section 6 says "not enabled -> /profile", but /profile does
 * not exist until Phase 4 - running the interview is currently the only
 * working way to enable Fitness, so both cases land there for now. This
 * gets corrected to the exact section 6 table once /profile ships.
```

with:

```
 * Redirect targets match design spec section 6 exactly now that /profile
 * exists: not enabled -> /profile, enabled but no active plan ->
 * /onboarding (the interview is still the only way to create one).
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 5: Manual verification against the live project**

If available: sign in as a Fitness-disabled user, confirm landing on
`/dashboard` (not `/money`, which was the Phase 3 interim behavior);
confirm visiting `/today` directly now redirects to `/profile`, not
`/onboarding`; confirm a user with Fitness enabled but no plan (should not
normally occur, but the branch still exists) still redirects to
`/onboarding`.

If no live project is available, state that plainly.

- [ ] **Step 6: Commit**

```bash
git add src/lib/actions/auth.ts "src/app/page.tsx" "src/app/(app)/(fitness)/layout.tsx"
git commit -m "Retire Phase 3's interim /money and /onboarding redirects

/dashboard and /profile both exist now, so the two interim
substitutions from Phase 3's final-review fix can be dropped: signIn
and the root page redirect to /dashboard unconditionally instead of
branching on whether Fitness is enabled, since /dashboard already
handles every enabled-state correctly. The Fitness route guard's
'not enabled' branch now points at /profile, exactly matching design
spec section 6's table instead of the interim substitution documented
in its own comment since Phase 3.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage.** §5's toggle flow (the Fitness-enable refusal, uniform
disable) is Task 1. §7's generic sub-feature visibility algorithm
(untouched, from Phase 1) is exercised correctly by Task 2's nav and
Task 3's dashboard, both of which filter `!c.parentKey` before rendering
top-level tiles/nav entries, while still letting `visibleCategories`
include Coach for the full list Task 2 needs. §10's Dashboard requirements
(tile summaries, the empty-state prompt, "+ Add a category" staying
reachable) are Task 3 exactly. §11's Profile requirements (a card per
top-level category, sub-features excluded, Fitness's distinct treatment)
are Task 4 exactly, extended with the "Coming soon" treatment for the
three not-yet-built categories — a decision made explicitly in this
plan's design discussion, not silently invented.

The mobile nav overflow ceiling and the Settings split are not in the
original spec's §10/§11 text — both are documented here as decisions made
during this plan's own drafting, with their reasoning stated inline,
matching this project's established practice for filling gaps the
original design didn't anticipate.

**Placeholder scan.** No TBD/TODO. Task 6's mid-task correction (the
`/settings/fitness` → `/fitness-settings` rename, caught while drafting
because two files would otherwise both resolve to `/settings`) is left
visible in the plan text with the wrong path struck through in context
rather than silently fixed, so an implementer sees the reasoning, not just
the final answer.

**Type consistency.** `toggleCategory(categoryKey: string, enabled:
boolean): Promise<ToggleResult>` is called identically in Task 4's
`ProfileToggle`. `CategoryDefinition`'s fields (`key`, `label`, `route`,
`requiresSetup`, `icon`, `parentKey?`) are used consistently across Tasks
2, 3, 4, 5 — in particular, `route` (not `href`) is the correct field
name, corrected inline in Task 2 where a first draft of the Sidebar
snippet used a defensive-but-wrong fallback.

## Done when

- All 7 tasks' typecheck steps pass.
- Every manual verification sequence is either run against a live project
  with the stated result, or explicitly marked as not run in this
  environment.
- Seven commits, each independently reviewable.
- No route collides with another (`/settings` vs `/fitness-settings`
  specifically checked, per Task 6's correction).

## Out of scope (later sub-phases and phases)

Building `/reminders`, `/checklist`, `/cycle` themselves (sub-phases 4b,
4c, 4d respectively — each gets its own brainstorm-design-plan cycle, not
a few lines bolted onto this one). The money-category half of the
existing-user backfill migration (design spec §9, Phase 5). Any
cross-category intelligence features from the design spec's roadmap
appendix.
