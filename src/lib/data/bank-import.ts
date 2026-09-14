import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { allRows } from '@/lib/data/paged';
import type { SpendCategory } from '@/lib/engines/money';
import type { LineKind } from '@/lib/engines/bank-import';

export interface BatchSummary {
  id: string;
  fileName: string | null;
  createdAt: string;
  confirmedAt: string | null;
  counts: Record<'pending' | 'imported' | 'skipped' | 'unreadable', number>;
}

export type ImportsView =
  | { state: 'sample' }
  | { state: 'unavailable' }
  | { state: 'ready'; batches: BatchSummary[] };

export interface ReviewRow {
  id: string;
  rowNumber: number;
  occurredOn: string | null;
  description: string;
  amountPaise: number | null;
  direction: 'in' | 'out' | null;
  problem: string | null;
  merchantKey: string;
  category: SpendCategory | null;
  categorySource: 'rule' | 'keyword' | 'none' | 'person' | null;
  kind: LineKind | null;
  kindSource: 'rule' | 'keyword' | 'pair' | 'none' | 'person' | null;
  /** Why it was read as this kind, when a pattern or a pairing decided. */
  kindReason: string | null;
  savingsGoalId: string | null;
  incomeSourceId: string | null;
  duplicateOfSpend: { id: string; spentOn: string; amountPaise: number; category: string; note: string | null } | null;
  duplicateOfIncome: { id: string; receivedOn: string; amountPaise: number; note: string | null } | null;
  duplicateOfRow: number | null;
  /** The other leg of a transfer, in this file or an earlier import. */
  pairRowNumber: number | null;
  pairRowId: string | null;
  status: 'pending' | 'imported' | 'skipped' | 'unreadable';
}

export type ReviewView =
  | { state: 'missing' }
  | {
      state: 'ready';
      batch: BatchSummary;
      rows: ReviewRow[];
      /** Open goals a saving can go to. */
      goals: { id: string; label: string }[];
      /** Where income can be filed. */
      sources: { id: string; label: string }[];
    };

async function session() {
  if (!supabaseConfigured) return null;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  return auth.user ? { supabase, userId: auth.user.id } : null;
}

const emptyCounts = () => ({ pending: 0, imported: 0, skipped: 0, unreadable: 0 });

/** Recent imports, newest first, with how many lines ended up where. */
export async function getImports(): Promise<ImportsView> {
  const s = await session();
  if (!s) return { state: 'sample' };

  const { data: batches, error } = await s.supabase
    .from('import_batches')
    .select('id, file_name, created_at, confirmed_at')
    .eq('user_id', s.userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('import batches read failed', error);
    return { state: 'unavailable' };
  }
  if (!batches || batches.length === 0) return { state: 'ready', batches: [] };

  const { rows } = await allRows((lo, hi) =>
    s.supabase
      .from('import_rows')
      .select('batch_id, status')
      .eq('user_id', s.userId)
      .in(
        'batch_id',
        batches.map((b) => b.id as string),
      )
      .order('id', { ascending: true })
      .range(lo, hi),
  );

  const counts = new Map<string, BatchSummary['counts']>();
  for (const row of rows) {
    const c = counts.get(row.batch_id as string) ?? emptyCounts();
    c[row.status as keyof BatchSummary['counts']] += 1;
    counts.set(row.batch_id as string, c);
  }

  return {
    state: 'ready',
    batches: batches.map((b) => ({
      id: b.id as string,
      fileName: (b.file_name as string) ?? null,
      createdAt: b.created_at as string,
      confirmedAt: (b.confirmed_at as string) ?? null,
      counts: counts.get(b.id as string) ?? emptyCounts(),
    })),
  };
}

/** One import's lines, with the spend each possible duplicate matched, for review. */
export async function getImportReview(batchId: string): Promise<ReviewView> {
  const s = await session();
  if (!s || !/^[0-9a-f-]{36}$/i.test(batchId)) return { state: 'missing' };

  const { data: batch, error } = await s.supabase
    .from('import_batches')
    .select('id, file_name, created_at, confirmed_at')
    .eq('id', batchId)
    .eq('user_id', s.userId)
    .maybeSingle();
  if (error || !batch) return { state: 'missing' };

  const { rows } = await allRows((lo, hi) =>
    s.supabase
      .from('import_rows')
      .select(
        'id, row_number, occurred_on, description, amount_paise, direction, problem, merchant_key, category, category_source, kind, kind_source, kind_reason, savings_goal_id, income_source_id, duplicate_of_spend, duplicate_of_income, duplicate_of_row, pair_row_id, pair_row_number, status',
      )
      .eq('batch_id', batchId)
      .eq('user_id', s.userId)
      .order('row_number', { ascending: true })
      .range(lo, hi),
  );

  const spendIds = [...new Set(rows.map((r) => r.duplicate_of_spend as string | null).filter((id): id is string => !!id))];
  const { data: spends } =
    spendIds.length > 0
      ? await s.supabase
          .from('spends')
          .select('id, spent_on, amount_paise, category, note')
          .eq('user_id', s.userId)
          .in('id', spendIds)
      : { data: [] };
  const spendById = new Map((spends ?? []).map((sp) => [sp.id as string, sp]));

  const incomeIds = [...new Set(rows.map((r) => r.duplicate_of_income as string | null).filter((id): id is string => !!id))];
  const [incomesRes, goalsRes, sourcesRes] = await Promise.all([
    incomeIds.length > 0
      ? s.supabase.from('incomes').select('id, received_on, amount_paise, note').eq('user_id', s.userId).in('id', incomeIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    s.supabase
      .from('savings_goals')
      .select('id, label')
      .eq('user_id', s.userId)
      .is('closed_on', null)
      .order('created_at', { ascending: true }),
    s.supabase
      .from('income_sources')
      .select('id, label')
      .eq('user_id', s.userId)
      .is('ended_on', null)
      .order('created_at', { ascending: true }),
  ]);
  const incomeById = new Map((incomesRes.data ?? []).map((i) => [i.id as string, i]));

  const counts = emptyCounts();
  const review: ReviewRow[] = rows.map((r) => {
    counts[r.status as keyof typeof counts] += 1;
    const dup = r.duplicate_of_spend ? spendById.get(r.duplicate_of_spend as string) : undefined;
    const dupIncome = r.duplicate_of_income ? incomeById.get(r.duplicate_of_income as string) : undefined;
    return {
      id: r.id as string,
      rowNumber: Number(r.row_number),
      occurredOn: (r.occurred_on as string) ?? null,
      description: (r.description as string) ?? '',
      // bigint arrives as a string from PostgREST.
      amountPaise: r.amount_paise == null ? null : Number(r.amount_paise),
      direction: (r.direction as ReviewRow['direction']) ?? null,
      problem: (r.problem as string) ?? null,
      merchantKey: (r.merchant_key as string) ?? 'unknown',
      category: (r.category as SpendCategory) ?? null,
      categorySource: (r.category_source as ReviewRow['categorySource']) ?? null,
      kind: (r.kind as LineKind) ?? null,
      kindSource: (r.kind_source as ReviewRow['kindSource']) ?? null,
      kindReason: (r.kind_reason as string) ?? null,
      savingsGoalId: (r.savings_goal_id as string) ?? null,
      incomeSourceId: (r.income_source_id as string) ?? null,
      duplicateOfIncome: dupIncome
        ? {
            id: dupIncome.id as string,
            receivedOn: dupIncome.received_on as string,
            amountPaise: Number(dupIncome.amount_paise),
            note: (dupIncome.note as string) ?? null,
          }
        : null,
      pairRowNumber: r.pair_row_number == null ? null : Number(r.pair_row_number),
      pairRowId: (r.pair_row_id as string) ?? null,
      duplicateOfSpend: dup
        ? {
            id: dup.id as string,
            spentOn: dup.spent_on as string,
            amountPaise: Number(dup.amount_paise),
            category: dup.category as string,
            note: (dup.note as string) ?? null,
          }
        : null,
      duplicateOfRow: r.duplicate_of_row == null ? null : Number(r.duplicate_of_row),
      status: r.status as ReviewRow['status'],
    };
  });

  return {
    state: 'ready',
    batch: {
      id: batch.id as string,
      fileName: (batch.file_name as string) ?? null,
      createdAt: batch.created_at as string,
      confirmedAt: (batch.confirmed_at as string) ?? null,
      counts,
    },
    rows: review,
    goals: (goalsRes.data ?? []).map((g) => ({ id: g.id as string, label: g.label as string })),
    sources: (sourcesRes.data ?? []).map((src) => ({ id: src.id as string, label: src.label as string })),
  };
}
