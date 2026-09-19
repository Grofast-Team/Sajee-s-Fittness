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
    ...overflow.map((c) => ({ href: c.route, label: c.label, Icon: null as null })),
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
