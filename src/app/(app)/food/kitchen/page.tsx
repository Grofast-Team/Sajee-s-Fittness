import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Panel, PageHeader, Section, Unavailable, Why } from '@/components/ui';
import { FromFoodLog, StockList } from '@/components/kitchen';
import { getKitchen } from '@/lib/data/pantry';
import { formatQuantity } from '@/lib/engines/pantry';

export const metadata = { title: 'Kitchen — FitCoach' };

/**
 * What is at home, and how long it lasts.
 *
 * The food screen records what was eaten; this records what is left. The two
 * meet only where the person says they do — a logged egg comes out of stock
 * when it is confirmed as coming from home, and never on its own.
 */
export default async function KitchenPage() {
  const kitchen = await getKitchen();

  const back = (
    <Link
      href="/food"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium"
      style={{ color: 'var(--primary-dark)' }}
    >
      <ArrowLeft size={16} aria-hidden /> Food
    </Link>
  );

  if (kitchen.state !== 'ready') {
    return (
      <>
        <PageHeader title="Kitchen" lede="What is at home, and how long it lasts." action={back} />
        <Panel>
          <Unavailable
            title={kitchen.state === 'sample' ? 'Sign in to keep track of your kitchen' : 'Kitchen stock is not set up yet'}
            detail={
              kitchen.state === 'sample'
                ? 'Stock is kept per person, so there is nothing to show without an account.'
                : 'This deployment’s database does not have the kitchen tables yet. Nothing is shown rather than made up.'
            }
          />
        </Panel>
      </>
    );
  }

  const low = kitchen.items.filter((v) => v.level.status === 'low' || v.level.status === 'out');

  return (
    <>
      <PageHeader title="Kitchen" lede="What is at home, and how long it lasts." action={back} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          {kitchen.pending.length > 0 ? (
            <Panel tone="primary">
              <FromFoodLog pending={kitchen.pending} />
            </Panel>
          ) : null}

          <Panel>
            <StockList items={kitchen.items} />
          </Panel>
        </div>

        <div className="space-y-4 lg:space-y-5">
          <Panel>
            <Section title="To buy soon">
              {low.length > 0 ? (
                <ul>
                  {low.map((v) => (
                    <li
                      key={v.item.id}
                      className="flex items-baseline justify-between gap-3 border-b py-2 last:border-0"
                      style={{ borderColor: 'var(--line)' }}
                    >
                      <span className="text-sm">{v.item.label}</span>
                      <span className="text-[13px]" style={{ color: 'var(--fg-muted)' }}>
                        {v.level.status === 'out'
                          ? 'none left'
                          : v.level.daysLeft === 0
                            ? `${formatQuantity(v.item, v.level.onHand)} — under a day`
                            : `${formatQuantity(v.item, v.level.onHand)} — about ${v.level.daysLeft} day${v.level.daysLeft === 1 ? '' : 's'}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                  {kitchen.items.length === 0
                    ? 'Once you track a few things, anything running out shows up here.'
                    : 'Nothing is running out that we can tell. Items without enough use recorded yet are not guessed at.'}
                </p>
              )}
            </Section>

            <Why label="How is this worked out?">
              <p>
                What is on hand is added up from everything recorded — bought, used, thrown out, and
                counted. A count records the difference it made, so it corrects the figure without
                erasing anything before it.
              </p>
              <p className="mt-2">
                How long something lasts comes from how fast it has been used over the last four weeks,
                and only once it has been used at least three times across a week or more. Before that
                we do not guess. What was thrown out is not counted as use.
              </p>
              <p className="mt-2">
                Logged food is only taken from stock when you say it came from home. Mixed dishes — a
                dosa, sambar, a curry — do not take anything from stock yet: working out the rice and
                dal in them needs recipes, which are not in the app yet.
              </p>
            </Why>
          </Panel>
        </div>
      </div>
    </>
  );
}
