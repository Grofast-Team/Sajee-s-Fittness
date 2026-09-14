import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Panel, PageHeader } from '@/components/ui';
import { ImportReview } from '@/components/import-review';
import { getImportReview } from '@/lib/data/bank-import';

export const metadata = { title: 'Review an import — FitCoach' };

export default async function ImportReviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const review = await getImportReview(batchId);
  if (review.state === 'missing') notFound();

  const { batch, rows, goals, sources } = review;

  return (
    <>
      <PageHeader
        title="Review the import"
        lede={`${batch.fileName ?? 'Statement'} — ${rows.length} line${rows.length === 1 ? '' : 's'}. Nothing is recorded until you confirm.`}
        action={
          <Link
            href="/money/import"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium"
            style={{ color: 'var(--primary-dark)' }}
          >
            <ArrowLeft size={16} aria-hidden /> Imports
          </Link>
        }
      />

      <Panel>
        <ImportReview
          batchId={batch.id}
          rows={rows}
          confirmed={batch.confirmedAt !== null}
          goals={goals}
          sources={sources}
        />
      </Panel>
    </>
  );
}
