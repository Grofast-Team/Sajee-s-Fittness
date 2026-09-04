import { Alert } from '@/components/ui';

/**
 * The sample-data banner.
 *
 * Driven by the data layer's `isSample` flag rather than by a build-time
 * constant, because there are three separate ways to end up looking at the
 * sample profile: no Supabase, no session, or a signed-in user who has not
 * finished setup. All three need the same warning.
 */
export function SampleBanner({ isSample }: { isSample: boolean }) {
  if (!isSample) return null;

  return (
    <div role="status" className="pt-4">
      <Alert tone="warning" title="Sample profile — this is not your data">
        The numbers are real output from the calculation engines, computed from a sample person.
      </Alert>
    </div>
  );
}
