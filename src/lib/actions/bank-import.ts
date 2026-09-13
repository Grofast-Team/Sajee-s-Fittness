'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { formatRupees, SPEND_CATEGORY_IDS, type SpendCategory } from '@/lib/engines/money';
import {
  markDuplicates,
  normalizeRows,
  suggestCategory,
  type MerchantRule,
} from '@/lib/engines/bank-import';
import { insertSpends } from '@/lib/spends/record';
import { allRows } from '@/lib/data/paged';

/**
 * Staging and confirming a bank statement.
 *
 * Staging stores every line as read and as normalised, with duplicates and a
 * suggested category — and writes nothing to the ledger. Confirming writes
 * only the lines the person kept, through `insertSpends`, the same function
 * "Add a spend" uses.
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

  const [rulesRes, existingRes] = await Promise.all([
    supabase.from('merchant_rules').select('merchant_key, category').eq('user_id', userId),
    // Every spend in the statement's range, paged: a duplicate missed because
    // it sat past the thousandth row would be recorded twice.
    dates.length === 0
      ? Promise.resolve({ rows: [], error: null })
      : allRows((lo, hi) =>
          supabase
            .from('spends')
            .select('id, spent_on, amount_paise')
            .eq('user_id', userId)
            .gte('spent_on', shift(dates[0], -1))
            .lte('spent_on', shift(dates[dates.length - 1], 1))
            .order('id', { ascending: true })
            .range(lo, hi),
        ),
  ]);

  if (rulesRes.error) {
    console.error('merchant rules read failed', rulesRes.error);
    return { ok: false, error: 'Statement import is not set up on this deployment yet.' };
  }

  const rules: MerchantRule[] = (rulesRes.data ?? []).map((r) => ({
    merchantKey: r.merchant_key as string,
    category: r.category as SpendCategory,
  }));

  const duplicates = markDuplicates(
    normalized,
    existingRes.rows.map((s) => ({
      id: s.id as string,
      spentOn: s.spent_on as string,
      amountPaise: Number(s.amount_paise),
    })),
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
    const suggestion = row.direction === 'out' ? suggestCategory(row.merchantKey, rules) : null;
    const duplicate = duplicates.get(row.rowNumber);
    return {
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
      category: suggestion ? (suggestion.category ?? 'other') : null,
      category_source: suggestion ? suggestion.source : null,
      duplicate_of_spend: duplicate?.ofSpend ?? null,
      duplicate_of_row: duplicate?.ofRow ?? null,
      status: row.problem ? 'unreadable' : 'pending',
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

  revalidatePath('/money/import');
  return { ok: true, batchId: batch.id as string };
}

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/* ------------------------------------------------------------------ */

const confirmSchema = z.strictObject({
  batchId: z.string().uuid(),
  decisions: z
    .array(
      z.strictObject({
        rowId: z.string().uuid(),
        include: z.boolean(),
        category: z.enum(SPEND_CATEGORY_IDS).optional(),
      }),
    )
    .max(MAX_ROWS),
});

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
  category: SpendCategory | null;
  category_source: string | null;
  duplicate_of_spend: string | null;
  duplicate_of_row: number | null;
}

/**
 * Record the lines the person kept.
 *
 * Money out becomes spends through `insertSpends`; money in becomes income
 * with no source. Each chunk's lines are marked imported straight after their
 * spends are written, so a retry after a failure cannot record them twice.
 * A category the person changed is remembered for that merchant.
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
  const { rows: rowData, error: rowsError } = await allRows((lo, hi) =>
    supabase
      .from('import_rows')
      .select(
        'id, user_id, batch_id, row_number, raw, occurred_on, description, amount_paise, direction, problem, merchant_key, category, category_source, duplicate_of_spend, duplicate_of_row',
      )
      .eq('batch_id', batchId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('row_number', { ascending: true })
      .range(lo, hi),
  );
  if (rowsError) return { ok: false, error: 'We could not read that import.' };

  const pending = rowData.map((r) => ({ ...r, amount_paise: Number(r.amount_paise) })) as PendingRow[];
  if (pending.length === 0) return { ok: true, message: 'Everything in this import has already been dealt with.' };

  const byId = new Map(decisions.map((d) => [d.rowId, d]));
  const outs: { row: PendingRow; category: SpendCategory; changed: boolean }[] = [];
  const ins: PendingRow[] = [];
  const skipped: PendingRow[] = [];

  for (const row of pending) {
    const decision = byId.get(row.id);
    if (!decision?.include) {
      skipped.push(row);
      continue;
    }
    if (row.direction === 'out') {
      const category = decision.category ?? row.category ?? 'other';
      outs.push({ row, category, changed: decision.category !== undefined && decision.category !== row.category });
    } else {
      ins.push(row);
    }
  }

  let recordedOut = 0;
  let outPaise = 0;

  for (let i = 0; i < outs.length; i += CHUNK) {
    const chunk = outs.slice(i, i + CHUNK);
    const written = await insertSpends(
      supabase,
      userId,
      chunk.map(({ row, category }) => ({
        amountPaise: row.amount_paise,
        category,
        note: (row.description ?? '').slice(0, 200) || undefined,
        spentOn: row.occurred_on,
      })),
    );
    if (!written.ok) return partial(recordedOut, `Recording stopped: ${written.error}`);

    const marked = await markRows(
      supabase,
      chunk.map(({ row, category }, j) => ({
        ...row,
        category,
        category_source: row.category !== category ? 'person' : row.category_source,
        status: 'imported',
        spend_id: written.ids[j],
      })),
    );
    if (!marked) {
      await supabase.from('spends').delete().in('id', written.ids).eq('user_id', userId);
      return partial(recordedOut, 'Recording stopped before these lines could be marked, so they were taken back out.');
    }

    recordedOut += chunk.length;
    outPaise += chunk.reduce((sum, { row }) => sum + row.amount_paise, 0);
  }

  let recordedIn = 0;
  for (let i = 0; i < ins.length; i += CHUNK) {
    const chunk = ins.slice(i, i + CHUNK);
    const incomes = chunk.map((row) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      amount_paise: row.amount_paise,
      received_on: row.occurred_on,
      note: (row.description ?? '').slice(0, 200) || null,
    }));
    const { error } = await supabase.from('incomes').insert(incomes);
    if (error) {
      console.error('import income insert failed', error);
      return partial(recordedOut, 'Money out was recorded; money in could not be.');
    }
    const marked = await markRows(
      supabase,
      chunk.map((row, j) => ({ ...row, status: 'imported', income_id: incomes[j].id })),
    );
    if (!marked) {
      await supabase.from('incomes').delete().in('id', incomes.map((x) => x.id)).eq('user_id', userId);
      return partial(recordedOut, 'Money in could not be marked, so it was taken back out.');
    }
    recordedIn += chunk.length;
  }

  if (skipped.length > 0) await markRows(supabase, skipped.map((row) => ({ ...row, status: 'skipped' })));

  await learnRules(supabase, userId, outs.filter((o) => o.changed));

  await supabase.from('import_batches').update({ confirmed_at: new Date().toISOString() }).eq('id', batchId).eq('user_id', userId);

  revalidatePath('/money');
  revalidatePath('/money/import');
  revalidatePath(`/money/import/${batchId}`);
  revalidatePath('/money/trends');

  const parts = [];
  if (recordedOut > 0) parts.push(`${recordedOut} spend${recordedOut === 1 ? '' : 's'} (${formatRupees(outPaise)})`);
  if (recordedIn > 0) parts.push(`${recordedIn} payment${recordedIn === 1 ? '' : 's'} in`);
  const left = skipped.length > 0 ? ` ${skipped.length} left out.` : '';

  return {
    ok: true,
    message: parts.length > 0 ? `Recorded ${parts.join(' and ')}.${left}` : `Nothing recorded.${left}`,
  };
}

function partial(recorded: number, reason: string): ImportResult {
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
 * Remember what the person chose for a merchant.
 *
 * Only corrections teach: accepting a suggestion is not new information. A
 * merchant chosen as two different things in one import keeps the category
 * chosen most often. Cash withdrawals and unnamed payees are never learned —
 * the same ATM funds groceries one day and a haircut the next.
 */
async function learnRules(
  supabase: Client,
  userId: string,
  corrections: { row: PendingRow; category: SpendCategory }[],
) {
  const tally = new Map<string, Map<SpendCategory, number>>();
  for (const { row, category } of corrections) {
    const key = row.merchant_key;
    if (!key || key === 'unknown' || key === 'cash withdrawal') continue;
    const counts = tally.get(key) ?? new Map<SpendCategory, number>();
    counts.set(category, (counts.get(category) ?? 0) + 1);
    tally.set(key, counts);
  }
  if (tally.size === 0) return;

  const { data: existing } = await supabase
    .from('merchant_rules')
    .select('merchant_key, category, taught')
    .eq('user_id', userId)
    .in('merchant_key', [...tally.keys()]);
  const known = new Map((existing ?? []).map((r) => [r.merchant_key as string, r]));

  const upserts = [...tally.entries()].map(([key, counts]) => {
    const [category, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const previous = known.get(key);
    return {
      user_id: userId,
      merchant_key: key,
      category,
      // A changed mind starts the count again; a confirmed one adds to it.
      taught: previous && previous.category === category ? Number(previous.taught) + count : count,
    };
  });

  const { error } = await supabase.from('merchant_rules').upsert(upserts, { onConflict: 'user_id,merchant_key' });
  if (error) console.error('merchant rules upsert failed', error);
}

/** Remove an import. Spends and income it recorded stay; only the staging lines go. */
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
