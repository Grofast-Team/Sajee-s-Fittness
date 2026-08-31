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
    <div
      role="status"
      className="rounded-md px-3 py-2 text-xs font-medium"
      style={{ background: 'var(--signal-wash)', color: 'var(--signal)' }}
    >
      Sample profile — this is not your data. The numbers are real output from the calculation
      engines, computed from a sample person.
    </div>
  );
}
