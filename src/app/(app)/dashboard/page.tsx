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
