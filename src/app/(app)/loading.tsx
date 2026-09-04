import { Skeleton } from '@/components/ui';

/**
 * Loading skeleton.
 *
 * These screens query the database on the server, and on a slow mobile
 * connection that is otherwise a blank page with no sign anything is happening.
 * The skeleton reserves roughly the real layout — including the two-column
 * desktop shape — so content does not jump when it arrives.
 */
export default function Loading() {
  return (
    <div className="pt-6" aria-busy="true" aria-label="Loading your day">
      <div className="space-y-2.5">
        <Skeleton className="h-8 w-[55%] max-w-xs" />
        <Skeleton className="h-4 w-[40%] max-w-[14rem]" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          <Skeleton className="h-52 rounded-[20px]" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <div className="space-y-4 lg:space-y-5">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </div>
  );
}
