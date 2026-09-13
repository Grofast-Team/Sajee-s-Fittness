/** PostgREST returns at most 1,000 rows a request. */
const PAGE = 1000;

/**
 * Every row of a query, a page at a time.
 *
 * A silently truncated read is the worst kind of wrong: months of someone
 * recording bus fares pass a thousand rows, and the oldest would quietly look
 * emptier than they were. The query must have a stable order for paging to be
 * exact.
 */
export async function allRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error || !data) return { rows, error: error ?? new Error('no data') };
    rows.push(...data);
    if (data.length < PAGE) return { rows, error: null };
  }
}
