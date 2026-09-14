'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { formatRupees, SPEND_CATEGORY_IDS, type SpendCategory } from '@/lib/engines/money';
import {
  classifyLine,
  KINDS_FOR,
  markDuplicates,
  normalizeRows,
  pairTransfers,
  type LineKind,
  type MerchantRule,
} from '@/lib/engines/bank-import';
import { insertSpends } from '@/lib/spends/record';
import { allRows } from '@/lib/data/paged';

/**
 * Staging and confirming a bank statement.
 *
 * Staging stores every line as read and as normalised, with what kind of
 * movement it looks like, duplicates, and the other leg of a transfer — and
 * writes nothing to the ledger. Confirming writes only the lines the person
 * kept, each to the one place its kind belongs:
 *
 *   spending → a spend (`insertSpends`, the same insert "Add a spend" uses)
 *   saving   → a spend filed as savings, to a goal; or a withdrawal from one
 *   income   → income, from a source
 *   transfer → nothing, because it is neither
 *   refund   → nothing yet
 */

export type StageResult = { ok: true; batchId: string } | { ok: false; error: string };
export type ImportResult = { ok: true; message: string } | { ok: false; error: string };

type Client = Awaited<ReturnType<typeof createClient>>;

const MAX_ROWS = 3000;
const CHUNK = 500;

const mappingSchema = z.strictObject({
  date: z.number().int().min(0).max(39),
  description: z.number().int().min(0).max(39),
  debit: z.number().int().min(0).max(39).nullable(),
  credit: z.number().int().min(0).max(39).nullable(),
  amount: z.number().int().min(0).max(39).nullable(),
  type: z.number().int().min(0).max(39).nullable(),
  dateOrder: z.enum(['dmy', 'mdy', 'ymd']),
  positiveIs: z.enum(['in', 'out']),
});

const stageSchema = z.strictObject({
  fileName: z.string().max(200),
  /** Index of the header line in the file, so row numbers match what the person sees. */
  headerIndex: z.number().int().min(0).max(100),
  mapping: mappingSchema,
  /** The lines after the header, as cells. Parsed in the browser, re-normalised here. */
  rows: z.array(z.array(z.string().max(500)).max(40)).max(MAX_ROWS),
});

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const shortDate = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}`;

export async function stageImport(input: unknown): Promise<StageResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };

  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: `We could not read that file. It needs to be a statement of at most ${MAX_ROWS} lines.` };
  }
  const { fileName, headerIndex, mapping, rows } = parsed.data;

  const hasAmounts = (mapping.debit !== null && mapping.credit !== null) || mapping.amount !== null;
  if (!hasAmounts) return { ok: false, error: 'Choose which columns hold the amounts.' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  // Normalised again on the server: nothing the browser worked out is trusted.
  // The first line after the header is line headerIndex + 2, counting from 1.
  const normalized = normalizeRows(rows, mapping, headerIndex + 2);
  if (normalized.length === 0) return { ok: false, error: 'There are no transactions under that header.' };

  const readable = normalized.filter((r) => !r.problem);
  const dates = readable.map((r) => r.occurredOn!).sort();
  const from = dates.length > 0 ? shift(dates[0], -2) : null;
  const to = dates.length > 0 ? shift(dates[dates.length - 1], 2) : null;

  // Paged throughout: a duplicate or a transfer's other leg missed because it
  // sat past the thousandth row would be recorded twice.
  const none = Promise.resolve({ rows: [] as Record<string, unknown>[], error: null });
  const [rulesRes, spendsRes, incomesRes, othersRes] = await Promise.all([
    supabase
      .from('merchant_rules')
      .select('merchant_key, direction, kind, category, savings_goal_id, income_source_id')
      .eq('user_id', userId),
    from && to
      ? allRows((lo, hi) =>
          supabase
            .from('spends')
            .select('id, spent_on, amount_paise')
            .eq('user_id', userId)
            .gte('spent_on', from)
            .lte('spent_on', to)
            .order('id', { ascending: true })
            .range(lo, hi),
        )
      : none,
    from && to
      ? allRows((lo, hi) =>
          supabase
            .from('incomes')
            .select('id, received_on, amount_paise')
            .eq('user_id', userId)
            .gte('received_on', from)
            .lte('received_on', to)
            .order('id', { ascending: true })
            .range(lo, hi),
        )
      : none,
    from && to
      ? allRows((lo, hi) =>
          supabase
            .from('import_rows')
            .select('id, direction, amount_paise, occurred_on, kind')
            .eq('user_id', userId)
            .in('status', ['pending', 'imported'])
            .not('amount_paise', 'is', null)
            .gte('occurred_on', from)
            .lte('occurred_on', to)
            .order('id', { ascending: true })
            .range(lo, hi),
        )
      : none,
  ]);

  if (rulesRes.error) {
    console.error('merchant rules read failed', rulesRes.error);
    return { ok: false, error: 'Statement import is not set up on this deployment yet.' };
  }

  const rules: MerchantRule[] = (rulesRes.data ?? []).map((r) => ({
    merchantKey: r.merchant_key as string,
    direction: r.direction as 'in' | 'out',
    kind: r.kind as LineKind,
    category: (r.category as SpendCategory) ?? null,
    savingsGoalId: (r.savings_goal_id as string) ?? null,
    incomeSourceId: (r.income_source_id as string) ?? null,
  }));

  const duplicates = markDuplicates(
    normalized,
    spendsRes.rows.map((s) => ({ id: s.id as string, spentOn: s.spent_on as string, amountPaise: Number(s.amount_paise) })),
    incomesRes.rows.map((i) => ({ id: i.id as string, receivedOn: i.received_on as string, amountPaise: Number(i.amount_paise) })),
  );

  const others = othersRes.rows.map((o) => ({
    id: o.id as string,
    direction: o.direction as 'in' | 'out',
    amountPaise: Number(o.amount_paise),
    occurredOn: o.occurred_on as string,
    kind: (o.kind as LineKind) ?? null,
  }));
  const otherById = new Map(others.map((o) => [o.id, o]));
  // A line already in the ledger twice over is a duplicate, not half a transfer.
  const pairs = pairTransfers(
    normalized.filter((r) => !duplicates.has(r.rowNumber)),
    others,
  );

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({ user_id: userId, file_name: fileName || null, row_count: normalized.length })
    .select('id')
    .single();

  if (batchError || !batch) {
    console.error('import batch insert failed', batchError);
    return { ok: false, error: 'We could not start the import.' };
  }

  const records = normalized.map((row) => {
    const readableRow = !row.problem;
    const duplicate = duplicates.get(row.rowNumber);
    const pair = pairs.get(row.rowNumber);
    const classification = readableRow ? classifyLine(row, rules) : null;

    // A rule the person set outranks a pairing guess; a pairing outranks a pattern.
    let kind = classification?.kind ?? null;
    let kindSource: string | null = classification?.source ?? null;
    let reason = classification?.reason ?? null;
    if (pair && classification?.source !== 'rule') {
      kind = 'transfer';
      kindSource = 'pair';
      const amount = formatRupees(row.amountPaise ?? 0);
      const other = pair.otherRowId ? otherById.get(pair.otherRowId) : undefined;
      reason = pair.rowNumber
        ? `Matches ${amount} ${row.direction === 'out' ? 'coming in' : 'going out'} on line ${pair.rowNumber} of this file.`
        : other
          ? `Matches ${amount} ${other.direction === 'in' ? 'coming in' : 'going out'} on ${shortDate(other.occurredOn)} in another statement you imported${
              other.kind && other.kind !== 'transfer' ? `, where it was filed as ${other.kind}` : ''
            }.`
          : reason;
    }

    return {
      id: crypto.randomUUID(),
      user_id: userId,
      batch_id: batch.id,
      row_number: row.rowNumber,
      raw: row.cells,
      occurred_on: row.occurredOn,
      description: row.description || null,
      amount_paise: row.amountPaise,
      direction: row.direction,
      problem: row.problem,
      merchant_key: row.merchantKey.slice(0, 80),
      kind,
      kind_source: kindSource,
      kind_reason: reason,
      category: kind === 'expense' ? (classification?.category ?? 'other') : null,
      category_source: kind === 'expense' ? (classification?.category ? classification.source : 'none') : null,
      savings_goal_id: kind === 'saving' ? (classification?.savingsGoalId ?? null) : null,
      income_source_id: kind === 'income' ? (classification?.incomeSourceId ?? null) : null,
      duplicate_of_spend: duplicate?.ofSpend ?? null,
      duplicate_of_income: duplicate?.ofIncome ?? null,
      duplicate_of_row: duplicate?.ofRow ?? null,
      pair_row_id: pair?.otherRowId ?? null,
      pair_row_number: pair?.rowNumber ?? null,
      status: readableRow ? 'pending' : 'unreadable',
    };
  });

  for (let i = 0; i < records.length; i += CHUNK) {
    const { error } = await supabase.from('import_rows').insert(records.slice(i, i + CHUNK));
    if (error) {
      console.error('import rows insert failed', error);
      await supabase.from('import_batches').delete().eq('id', batch.id).eq('user_id', userId);
      return { ok: false, error: 'We could not store the statement lines, so nothing was kept.' };
    }
  }

  // Point earlier lines back at their new other leg, where they had none.
  for (const record of records) {
    if (!record.pair_row_id) continue;
    await supabase
      .from('import_rows')
      .update({ pair_row_id: record.id })
      .eq('id', record.pair_row_id)
      .eq('user_id', userId)
      .is('pair_row_id', null);
  }

  revalidatePath('/money/import');
  return { ok: true, batchId: batch.id as string };
}

/* ------------------------------------------------------------------ */

const confirmSchema = z.strictObject({
  batchId: z.string().uuid(),
  decisions: z
    .array(
      z.strictObject({
        rowId: z.string().uuid(),
        include: z.boolean(),
        kind: z.enum(['expense', 'income', 'transfer', 'saving', 'refund']).optional(),
        category: z.enum(SPEND_CATEGORY_IDS).optional(),
        savingsGoalId: z.string().uuid().nullable().optional(),
        incomeSourceId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(MAX_ROWS),
});

type Decision = z.infer<typeof confirmSchema>['decisions'][number];

interface PendingRow {
  id: string;
  user_id: string;
  batch_id: string;
  row_number: number;
  raw: unknown;
  occurred_on: string;
  description: string | null;
  amount_paise: number;
  direction: 'in' | 'out';
  problem: string | null;
  merchant_key: string | null;
  kind: LineKind | null;
  kind_source: string | null;
  kind_reason: string | null;
  category: SpendCategory | null;
  category_source: string | null;
  savings_goal_id: string | null;
  income_source_id: string | null;
  duplicate_of_spend: string | null;
  duplicate_of_income: string | null;
  duplicate_of_row: number | null;
  pair_row_id: string | null;
  pair_row_number: number | null;
}

/** What the person settled on for one line, with what it was before. */
interface Settled {
  row: PendingRow;
  kind: LineKind;
  category: SpendCategory | null;
  goalId: string | null;
  sourceId: string | null;
  changed: boolean;
}

const ROW_COLUMNS =
  'id, user_id, batch_id, row_number, raw, occurred_on, description, amount_paise, direction, problem, merchant_key, kind, kind_source, kind_reason, category, category_source, savings_goal_id, income_source_id, duplicate_of_spend, duplicate_of_income, duplicate_of_row, pair_row_id, pair_row_number';

/**
 * Record the lines the person kept, each where its kind belongs.
 *
 * Each chunk's lines are marked straight after their records are written, so a
 * retry after a failure cannot record them twice. A withdrawal is written one
 * at a time: the database checks each against what the goal holds, and a
 * refused one stays pending with the reason rather than failing the rest.
 */
export async function confirmImport(input: unknown): Promise<ImportResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read those choices.' };
  const { batchId, decisions } = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };
  const userId = auth.user.id;

  const { data: batch } = await supabase
    .from('import_batches')
    .select('id')
    .eq('id', batchId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!batch) return { ok: false, error: 'We could not find that import.' };

  // Paged: confirming a 3,000-line statement must not quietly stop at a thousand.
  const [rowsRes, goalsRes, sourcesRes] = await Promise.all([
    allRows((lo, hi) =>
      supabase
        .from('import_rows')
        .select(ROW_COLUMNS)
        .eq('batch_id', batchId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('row_number', { ascending: true })
        .range(lo, hi),
    ),
    supabase.from('savings_goals').select('id, label').eq('user_id', userId).is('closed_on', null),
    supabase.from('income_sources').select('id, label').eq('user_id', userId),
  ]);
  if (rowsRes.error) return { ok: false, error: 'We could not read that import.' };

  const goals = new Map((goalsRes.data ?? []).map((g) => [g.id as string, g.label as string]));
  const sources = new Set((sourcesRes.data ?? []).map((s) => s.id as string));

  const pending = rowsRes.rows.map((r) => ({ ...r, amount_paise: Number(r.amount_paise) })) as unknown as PendingRow[];
  if (pending.length === 0) return { ok: true, message: 'Everything in this import has already been dealt with.' };

  const byId = new Map(decisions.map((d) => [d.rowId, d]));
  const settled: Settled[] = [];
  const skipped: PendingRow[] = [];
  const problems: string[] = [];

  for (const row of pending) {
    const decision = byId.get(row.id);
    if (!decision?.include) {
      skipped.push(row);
      continue;
    }
    const result = settle(row, decision, goals, sources);
    if (typeof result === 'string') problems.push(`Line ${row.row_number}: ${result}`);
    else settled.push(result);
  }

  const spends = settled.filter((s) => s.kind === 'expense' || (s.kind === 'saving' && s.row.direction === 'out'));
  const incomes = settled.filter((s) => s.kind === 'income');
  const withdrawals = settled.filter((s) => s.kind === 'saving' && s.row.direction === 'in');
  const transfers = settled.filter((s) => s.kind === 'transfer');
  const refunds = settled.filter((s) => s.kind === 'refund');

  const done = { spent: 0, spentPaise: 0, saved: 0, savedPaise: 0, income: 0, incomePaise: 0, withdrawn: 0 };

  // --- spending and saving out: one insert path ---------------------------
  for (let i = 0; i < spends.length; i += CHUNK) {
    const chunk = spends.slice(i, i + CHUNK);
    const written = await insertSpends(
      supabase,
      userId,
      chunk.map((s) => ({
        amountPaise: s.row.amount_paise,
        category: s.kind === 'saving' ? 'savings' : s.category!,
        note: (s.row.description ?? '').slice(0, 200) || undefined,
        spentOn: s.row.occurred_on,
        savingsGoalId: s.kind === 'saving' ? s.goalId : null,
      })),
    );
    if (!written.ok) return partial(done, `Recording stopped: ${written.error}`);

    const marked = await markRows(supabase, chunk.map((s, j) => marker(s, { spend_id: written.ids[j] })));
    if (!marked) {
      await supabase.from('spends').delete().in('id', written.ids).eq('user_id', userId);
      return partial(done, 'Recording stopped before these lines could be marked, so they were taken back out.');
    }
    for (const s of chunk) {
      if (s.kind === 'saving') {
        done.saved += 1;
        done.savedPaise += s.row.amount_paise;
      } else {
        done.spent += 1;
        done.spentPaise += s.row.amount_paise;
      }
    }
  }

  // --- income ---------------------------------------------------------------
  for (let i = 0; i < incomes.length; i += CHUNK) {
    const chunk = incomes.slice(i, i + CHUNK);
    const records = chunk.map((s) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      source_id: s.sourceId,
      amount_paise: s.row.amount_paise,
      received_on: s.row.occurred_on,
      note: (s.row.description ?? '').slice(0, 200) || null,
    }));
    const { error } = await supabase.from('incomes').insert(records);
    if (error) {
      console.error('import income insert failed', error);
      return partial(done, 'Money in could not be recorded.');
    }
    const marked = await markRows(supabase, chunk.map((s, j) => marker(s, { income_id: records[j].id })));
    if (!marked) {
      await supabase.from('incomes').delete().in('id', records.map((x) => x.id)).eq('user_id', userId);
      return partial(done, 'Money in could not be marked, so it was taken back out.');
    }
    done.income += chunk.length;
    done.incomePaise += chunk.reduce((sum, s) => sum + s.row.amount_paise, 0);
  }

  // --- withdrawals, one at a time against what each goal holds --------------
  for (const s of withdrawals) {
    const id = crypto.randomUUID();
    const { error } = await supabase.from('savings_withdrawals').insert({
      id,
      user_id: userId,
      savings_goal_id: s.goalId,
      amount_paise: s.row.amount_paise,
      withdrawn_on: s.row.occurred_on,
      note: (s.row.description ?? '').slice(0, 200) || null,
    });
    if (error) {
      problems.push(
        `Line ${s.row.row_number}: ${
          error.code === '23514'
            ? `that is more than ${goals.get(s.goalId!) ?? 'the goal'} holds, so it was not taken out.`
            : 'the withdrawal could not be recorded.'
        }`,
      );
      continue;
    }
    if (await markRows(supabase, [marker(s, { withdrawal_id: id })])) done.withdrawn += 1;
    else await supabase.from('savings_withdrawals').delete().eq('id', id).eq('user_id', userId);
  }

  // --- nothing written: transfers kept out, refunds not modelled -------------
  if (transfers.length > 0) await markRows(supabase, transfers.map((s) => marker(s, {})));
  if (refunds.length > 0) await markRows(supabase, refunds.map((s) => marker(s, {}, 'skipped')));
  if (skipped.length > 0) await markRows(supabase, skipped.map((row) => ({ ...row, status: 'skipped' })));

  await learnRules(supabase, userId, settled.filter((s) => s.changed));

  await supabase.from('import_batches').update({ confirmed_at: new Date().toISOString() }).eq('id', batchId).eq('user_id', userId);

  revalidatePath('/money');
  revalidatePath('/money/import');
  revalidatePath(`/money/import/${batchId}`);
  revalidatePath('/money/trends');

  const parts: string[] = [];
  if (done.spent > 0) parts.push(`${done.spent} spend${done.spent === 1 ? '' : 's'} (${formatRupees(done.spentPaise)})`);
  if (done.saved > 0) parts.push(`${formatRupees(done.savedPaise)} saved`);
  if (done.income > 0) parts.push(`${formatRupees(done.incomePaise)} income`);
  if (done.withdrawn > 0) parts.push(`${done.withdrawn} withdrawal${done.withdrawn === 1 ? '' : 's'} from savings`);

  const notes: string[] = [];
  if (transfers.length > 0) {
    notes.push(`${transfers.length} transfer${transfers.length === 1 ? '' : 's'} kept out of spending and income.`);
  }
  if (refunds.length > 0) {
    notes.push(`${refunds.length} refund${refunds.length === 1 ? '' : 's'} not recorded — refunds are not modelled yet.`);
  }
  if (skipped.length > 0) notes.push(`${skipped.length} left out.`);

  const message = [parts.length > 0 ? `Recorded ${parts.join(', ')}.` : 'Nothing recorded.', ...notes].join(' ');

  if (problems.length > 0) {
    return { ok: false, error: `${message} Still to sort out — ${problems.join(' ')}` };
  }
  return { ok: true, message };
}

/**
 * The person's decision for one line, checked. A string is the reason it
 * cannot be recorded as chosen; the line then stays pending.
 */
function settle(
  row: PendingRow,
  decision: Decision,
  goals: Map<string, string>,
  sources: Set<string>,
): Settled | string {
  const kind = decision.kind ?? row.kind ?? (row.direction === 'out' ? 'expense' : 'income');
  if (!KINDS_FOR[row.direction].includes(kind)) return 'that kind does not fit money moving this way.';

  const category = kind === 'expense' ? (decision.category ?? row.category ?? 'other') : null;
  const goalId =
    kind === 'saving' ? (decision.savingsGoalId !== undefined ? decision.savingsGoalId : row.savings_goal_id) : null;
  const sourceId =
    kind === 'income' ? (decision.incomeSourceId !== undefined ? decision.incomeSourceId : row.income_source_id) : null;

  if (goalId && !goals.has(goalId)) return 'that savings goal is closed or no longer exists.';
  if (sourceId && !sources.has(sourceId)) return 'that income source no longer exists.';
  if (kind === 'saving' && row.direction === 'in' && !goalId) {
    return 'choose which goal the money came out of, or file it as a transfer.';
  }

  const changed =
    kind !== row.kind ||
    (kind === 'expense' && category !== row.category) ||
    (kind === 'saving' && goalId !== row.savings_goal_id) ||
    (kind === 'income' && sourceId !== row.income_source_id);

  return { row, kind, category, goalId, sourceId, changed };
}

/** The row as it will be stored once dealt with. */
function marker(s: Settled, links: Record<string, string>, status: 'imported' | 'skipped' = 'imported') {
  return {
    ...s.row,
    kind: s.kind,
    kind_source: s.changed ? 'person' : s.row.kind_source,
    category: s.category,
    category_source:
      s.kind !== 'expense' ? null : s.category !== s.row.category ? 'person' : (s.row.category_source ?? 'none'),
    savings_goal_id: s.goalId,
    income_source_id: s.sourceId,
    status,
    ...links,
  };
}

function partial(done: { spent: number; saved: number; income: number }, reason: string): ImportResult {
  const recorded = done.spent + done.saved + done.income;
  return {
    ok: false,
    error:
      recorded > 0
        ? `${reason} ${recorded} line${recorded === 1 ? ' was' : 's were'} recorded before that and ${recorded === 1 ? 'is' : 'are'} marked, so trying again will not repeat ${recorded === 1 ? 'it' : 'them'}.`
        : reason,
  };
}

/** Update rows by writing them back whole: an upsert on id, since every column is at hand. */
async function markRows(supabase: Client, rows: Record<string, unknown>[]): Promise<boolean> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from('import_rows').upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' });
    if (error) {
      console.error('import rows update failed', error);
      return false;
    }
  }
  return true;
}

/**
 * Remember what the person chose for a merchant, per direction.
 *
 * Only corrections teach: accepting a suggestion is not new information. A
 * merchant settled two different ways in one import keeps the way chosen most
 * often. Cash withdrawals and unnamed payees are never learned — the same ATM
 * funds groceries one day and a haircut the next.
 */
async function learnRules(supabase: Client, userId: string, corrections: Settled[]) {
  const tally = new Map<string, Map<string, { count: number; value: Settled }>>();
  for (const s of corrections) {
    const key = s.row.merchant_key;
    if (!key || key === 'unknown' || key === 'cash withdrawal') continue;
    const slot = `${key}|${s.row.direction}`;
    const choice = `${s.kind}|${s.category ?? ''}|${s.goalId ?? ''}|${s.sourceId ?? ''}`;
    const counts = tally.get(slot) ?? new Map();
    const entry = counts.get(choice) ?? { count: 0, value: s };
    entry.count += 1;
    counts.set(choice, entry);
    tally.set(slot, counts);
  }
  if (tally.size === 0) return;

  const { data: existing } = await supabase
    .from('merchant_rules')
    .select('merchant_key, direction, kind, category, savings_goal_id, income_source_id, taught')
    .eq('user_id', userId)
    .in(
      'merchant_key',
      [...tally.keys()].map((slot) => slot.split('|')[0]),
    );
  const known = new Map((existing ?? []).map((r) => [`${r.merchant_key}|${r.direction}`, r]));

  const upserts = [...tally.entries()].map(([slot, counts]) => {
    const { count, value } = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    const previous = known.get(slot);
    const same =
      previous &&
      previous.kind === value.kind &&
      (previous.category ?? null) === value.category &&
      (previous.savings_goal_id ?? null) === value.goalId &&
      (previous.income_source_id ?? null) === value.sourceId;
    return {
      user_id: userId,
      merchant_key: value.row.merchant_key!,
      direction: value.row.direction,
      kind: value.kind,
      category: value.category,
      savings_goal_id: value.goalId,
      income_source_id: value.sourceId,
      // A changed mind starts the count again; a confirmed one adds to it.
      taught: same ? Number(previous.taught) + count : count,
    };
  });

  const { error } = await supabase
    .from('merchant_rules')
    .upsert(upserts, { onConflict: 'user_id,merchant_key,direction' });
  if (error) console.error('merchant rules upsert failed', error);
}

/** Remove an import. Everything it recorded stays; only the staging lines go. */
export async function discardImport(batchId: string): Promise<ImportResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };
  if (!z.string().uuid().safeParse(batchId).success) return { ok: false, error: 'We could not find that import.' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const { data, error } = await supabase
    .from('import_batches')
    .delete()
    .eq('id', batchId)
    .eq('user_id', auth.user.id)
    .select('id');

  if (error || !data || data.length !== 1) return { ok: false, error: 'We could not remove that import.' };

  revalidatePath('/money/import');
  return { ok: true, message: 'Import removed. Anything it recorded is still on the money screen.' };
}
