/**
 * Loading skeleton.
 *
 * These screens query the database on the server, and on a slow mobile
 * connection that is otherwise a blank white page with no sign anything is
 * happening. The skeleton reserves roughly the real layout so content does not
 * jump when it arrives.
 */
function Block({ height, width = '100%' }: { height: number; width?: string }) {
  return (
    <div
      className="animate-pulse rounded-xl"
      style={{ height, width, background: 'var(--surface-2)' }}
    />
  );
}

export default function Loading() {
  return (
    <div className="space-y-4 pt-1" aria-busy="true" aria-label="Loading your day">
      <div className="space-y-2">
        <Block height={14} width="40%" />
        <Block height={28} width="55%" />
      </div>
      <Block height={150} />
      <Block height={190} />
      <Block height={120} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
