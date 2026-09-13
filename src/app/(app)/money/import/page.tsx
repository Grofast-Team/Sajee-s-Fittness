import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Badge, Panel, PageHeader, Section, Unavailable, Why } from '@/components/ui';
import { CsvUpload } from '@/components/csv-upload';
import { getImports } from '@/lib/data/bank-import';

export const metadata = { title: 'Import a statement — FitCoach' };

/**
 * Bringing a bank statement in.
 *
 * Typing every spend is the most reliable record and the one people give up
 * on. A statement fills the gaps — but only through a review: nothing from a
 * file reaches the money screen until someone has looked at it.
 */
export default async function ImportPage() {
  const imports = await getImports();

  const back = (
    <Link
      href="/money"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium"
      style={{ color: 'var(--primary-dark)' }}
    >
      <ArrowLeft size={16} aria-hidden /> Money
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Import a statement"
        lede="Fill in what you did not record, from your bank's CSV download."
        action={back}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:gap-5">
        <Panel>
          {imports.state === 'ready' ? (
            <Section title="Choose a file">
              <CsvUpload canImport />
            </Section>
          ) : (
            <Unavailable
              title={imports.state === 'sample' ? 'Sign in to import a statement' : 'Statement import is not set up yet'}
              detail={
                imports.state === 'sample'
                  ? 'Imported lines become your own spends, so this needs an account.'
                  : 'This deployment’s database does not have the import tables yet. Nothing is shown rather than made up.'
              }
            />
          )}
        </Panel>

        <div className="space-y-4 lg:space-y-5">
          {imports.state === 'ready' && imports.batches.length > 0 ? (
            <Panel>
              <Section title="Earlier imports">
                <ul>
                  {imports.batches.map((b) => (
                    <li key={b.id} className="border-b py-2.5 first:pt-0 last:border-0 last:pb-0" style={{ borderColor: 'var(--line)' }}>
                      <Link
                        href={`/money/import/${b.id}`}
                        className="flex min-h-11 items-center justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{b.fileName ?? 'Statement'}</span>
                          <span className="text-[12px]" style={{ color: 'var(--fg-subtle)' }}>
                            {new Date(b.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ·{' '}
                            {b.counts.imported} recorded · {b.counts.skipped} left out
                          </span>
                        </span>
                        {b.counts.pending > 0 ? <Badge tone="signal">{b.counts.pending} to review</Badge> : <Badge tone="confirm">Done</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
            </Panel>
          ) : null}

          <Panel>
            <Why label="What happens to the file?">
              <p>
                It is read on your device. The lines are sent to be checked and kept as an import you can
                come back to; the file itself is not stored.
              </p>
              <p className="mt-2">
                Before anything is recorded you see every line: which look already recorded — the same
                amount a day either side of a spend you have — which we could not read, and a suggested
                category for each.
              </p>
              <p className="mt-2">
                Suggestions come from categories you chose for the same merchant before, then from a short
                list of merchants whose category is not in doubt. Amazon, cash withdrawals and transfers to
                a person get no guess. No AI decides what your money was for.
              </p>
              <p className="mt-2">
                Confirmed lines become ordinary spends and can be corrected or removed like any other.
              </p>
            </Why>
          </Panel>
        </div>
      </div>
    </>
  );
}
