'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { formatRupees, parseAmountToPaise } from '@/lib/engines/money';
import { formatQuantity, unitsFromLog, type PantryItem, type PantryUnit } from '@/lib/engines/pantry';

/**
 * Keeping track of what is in the kitchen.
 *
 * Every change is a movement row; nothing here ever writes a stock figure.
 * Buying something can also record what it cost, as an ordinary groceries
 * spend — the same row "Add a spend" writes — so the money screen sees it
 * without a second set of books.
 */

export type PantryResult = { ok: true; message: string } | { ok: false; error: string };

type Client = Awaited<ReturnType<typeof createClient>>;

const MAX_QUANTITY = 1_000_000;
const todayIso = () => new Date().toISOString().slice(0, 10);

const quantity = z.number().positive().max(MAX_QUANTITY);

function refresh() {
  revalidatePath('/food/kitchen');
}

async function signedIn(): Promise<{ supabase: Client; userId: string } | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  return auth.user ? { supabase, userId: auth.user.id } : null;
}

async function loadItem(supabase: Client, userId: string, id: string): Promise<PantryItem | null> {
  const { data } = await supabase
    .from('pantry_items')
    .select('id, label, food_id, unit, grams_per_unit')
    .eq('id', id)
    .eq('user_id', userId)
    .is('archived_on', null)
    .maybeSingle();

  return data
    ? {
        id: data.id as string,
        label: data.label as string,
        foodId: (data.food_id as string) ?? null,
        unit: data.unit as PantryUnit,
        gramsPerUnit: data.grams_per_unit == null ? null : Number(data.grams_per_unit),
      }
    : null;
}

/* ------------------------------------------------------------------ */

const itemSchema = z.strictObject({
  label: z.string().trim().min(1).max(60),
  foodId: z.string().uuid().optional(),
  unit: z.enum(['piece', 'g', 'ml']),
  gramsPerUnit: z.number().positive().max(10_000).optional(),
  /** What is there now. Recorded as a count, not a purchase. */
  onHand: z.number().min(0).max(MAX_QUANTITY).optional(),
});

export async function addPantryItem(input: unknown): Promise<PantryResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };

  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not read that. Check the amount.' };
  const { label, foodId, unit, onHand } = parsed.data;

  const session = await signedIn();
  if (!session) return { ok: false, error: 'You need to be signed in.' };
  const { supabase, userId } = session;

  // The weight of one piece comes from the food's own serving, when it has one,
  // so a weighed log of eggs can be turned into eggs without asking.
  let gramsPerUnit = unit === 'piece' ? (parsed.data.gramsPerUnit ?? null) : null;
  if (unit === 'piece' && gramsPerUnit === null && foodId) {
    const { data: serving } = await supabase
      .from('food_servings')
      .select('grams')
      .eq('food_id', foodId)
      .eq('unit_label', 'piece')
      .maybeSingle();
    if (serving) gramsPerUnit = Number(serving.grams);
  }

  const { data: item, error } = await supabase
    .from('pantry_items')
    .insert({ user_id: userId, label, food_id: foodId ?? null, unit, grams_per_unit: gramsPerUnit })
    .select('id')
    .single();

  if (error || !item) {
    console.error('pantry item insert failed', error);
    return {
      ok: false,
      error:
        error?.code === '23505'
          ? 'That food is already in your kitchen. Add to the one that is there.'
          : 'We could not add that.',
    };
  }

  if (onHand && onHand > 0) {
    const { error: countError } = await supabase.from('pantry_movements').insert({
      user_id: userId,
      item_id: item.id,
      kind: 'counted',
      quantity: onHand,
      occurred_on: todayIso(),
    });
    if (countError) console.error('pantry opening count failed', countError);
  }

  refresh();
  return { ok: true, message: `${label} added.` };
}

/* ------------------------------------------------------------------ */

const purchaseSchema = z.strictObject({
  itemId: z.string().uuid(),
  quantity,
  /** Rupees as typed. When present, also recorded as a groceries spend. */
  cost: z.string().max(20).optional(),
});

export async function recordPurchase(input: unknown): Promise<PantryResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };

  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter how much you bought.' };

  const costPaise = parsed.data.cost?.trim() ? parseAmountToPaise(parsed.data.cost) : null;
  if (parsed.data.cost?.trim() && (costPaise === null || costPaise > 100_000_000_000)) {
    return { ok: false, error: 'Check what it cost, or leave it empty.' };
  }

  const session = await signedIn();
  if (!session) return { ok: false, error: 'You need to be signed in.' };
  const { supabase, userId } = session;

  const item = await loadItem(supabase, userId, parsed.data.itemId);
  if (!item) return { ok: false, error: 'We could not find that item.' };

  const today = todayIso();
  let spendId: string | null = null;

  if (costPaise !== null) {
    const { data: spend, error: spendError } = await supabase
      .from('spends')
      .insert({
        user_id: userId,
        amount_paise: costPaise,
        category: 'groceries',
        note: item.label,
        spent_on: today,
      })
      .select('id')
      .single();
    if (spendError || !spend) {
      console.error('pantry purchase spend failed', spendError);
      return { ok: false, error: 'We could not record what it cost, so nothing was saved.' };
    }
    spendId = spend.id as string;
  }

  const { error } = await supabase.from('pantry_movements').insert({
    user_id: userId,
    item_id: item.id,
    kind: 'bought',
    quantity: parsed.data.quantity,
    occurred_on: today,
    spend_id: spendId,
  });

  if (error) {
    console.error('pantry purchase failed', error);
    // Never leave half a purchase: a spend with no stock behind it would be
    // money recorded for something the kitchen does not know arrived.
    if (spendId) await supabase.from('spends').delete().eq('id', spendId).eq('user_id', userId);
    return { ok: false, error: 'We could not record that.' };
  }

  refresh();
  revalidatePath('/money');
  const bought = formatQuantity(item, parsed.data.quantity);
  return {
    ok: true,
    message:
      costPaise !== null
        ? `${bought} ${item.label} added, and ${formatRupees(costPaise)} recorded under groceries.`
        : `${bought} ${item.label} added.`,
  };
}

/* ------------------------------------------------------------------ */

const changeSchema = z.strictObject({
  itemId: z.string().uuid(),
  kind: z.enum(['used', 'discarded']),
  quantity,
});

/** Used, or thrown out, without a food log behind it. */
export async function recordRemoval(input: unknown): Promise<PantryResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };

  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter how much.' };

  const session = await signedIn();
  if (!session) return { ok: false, error: 'You need to be signed in.' };
  const { supabase, userId } = session;

  const item = await loadItem(supabase, userId, parsed.data.itemId);
  if (!item) return { ok: false, error: 'We could not find that item.' };

  const { error } = await supabase.from('pantry_movements').insert({
    user_id: userId,
    item_id: item.id,
    kind: parsed.data.kind,
    quantity: -parsed.data.quantity,
    occurred_on: todayIso(),
  });

  if (error) {
    console.error('pantry removal failed', error);
    return { ok: false, error: 'We could not record that.' };
  }

  refresh();
  const amount = formatQuantity(item, parsed.data.quantity);
  return {
    ok: true,
    message: parsed.data.kind === 'used' ? `${amount} ${item.label} used.` : `${amount} ${item.label} thrown out.`,
  };
}

const countSchema = z.strictObject({
  itemId: z.string().uuid(),
  counted: z.number().min(0).max(MAX_QUANTITY),
});

/**
 * What is actually there. Stored as the difference from what the ledger says,
 * so the count corrects every earlier movement without erasing any of them.
 */
export async function recordCount(input: unknown): Promise<PantryResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };

  const parsed = countSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Enter how much is there.' };

  const session = await signedIn();
  if (!session) return { ok: false, error: 'You need to be signed in.' };
  const { supabase, userId } = session;

  const item = await loadItem(supabase, userId, parsed.data.itemId);
  if (!item) return { ok: false, error: 'We could not find that item.' };

  const { data: rows, error: readError } = await supabase
    .from('pantry_movements')
    .select('quantity')
    .eq('user_id', userId)
    .eq('item_id', item.id);
  if (readError) return { ok: false, error: 'We could not read what is there now.' };

  // Hundredths, as stored, so the difference is exact.
  const ledger = (rows ?? []).reduce((sum, r) => sum + Math.round(Number(r.quantity) * 100), 0);
  const difference = (Math.round(parsed.data.counted * 100) - ledger) / 100;

  if (difference === 0) return { ok: true, message: `${item.label}: that matches what was recorded.` };

  const { error } = await supabase.from('pantry_movements').insert({
    user_id: userId,
    item_id: item.id,
    kind: 'counted',
    quantity: difference,
    occurred_on: todayIso(),
  });

  if (error) {
    console.error('pantry count failed', error);
    return { ok: false, error: 'We could not record that.' };
  }

  refresh();
  return { ok: true, message: `${item.label}: ${formatQuantity(item, parsed.data.counted)} there now.` };
}

/* ------------------------------------------------------------------ */

const logSchema = z.strictObject({
  foodLogId: z.string().uuid(),
  fromHome: z.boolean(),
});

/**
 * Settle a logged food against the kitchen: it came from home, and comes out
 * of stock — or it did not, and the log stops being offered.
 *
 * Only the person can say which. The log does not record where it was eaten,
 * and food eaten out must never empty the kitchen.
 */
export async function settleLoggedFood(input: unknown): Promise<PantryResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };

  const parsed = logSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'We could not find that entry.' };

  const session = await signedIn();
  if (!session) return { ok: false, error: 'You need to be signed in.' };
  const { supabase, userId } = session;

  const { data: log } = await supabase
    .from('food_logs')
    .select('id, food_id, description, log_date, grams, quantity, unit_label')
    .eq('id', parsed.data.foodLogId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!log || !log.food_id) return { ok: false, error: 'We could not find that entry.' };

  const { data: itemRow } = await supabase
    .from('pantry_items')
    .select('id')
    .eq('user_id', userId)
    .eq('food_id', log.food_id)
    .is('archived_on', null)
    .maybeSingle();
  const item = itemRow ? await loadItem(supabase, userId, itemRow.id as string) : null;
  if (!item) return { ok: false, error: 'That food is not kept in your kitchen.' };

  let units = 0;
  if (parsed.data.fromHome) {
    const used = unitsFromLog(item, {
      grams: log.grams == null ? null : Number(log.grams),
      quantity: Number(log.quantity),
      unitLabel: log.unit_label as string,
    });
    if (used === null || used <= 0) {
      return { ok: false, error: `We cannot tell how many ${item.label.toLowerCase()} that was. Record it with Used instead.` };
    }
    units = used;
  }

  const { error } = await supabase.from('pantry_movements').insert({
    user_id: userId,
    item_id: item.id,
    kind: parsed.data.fromHome ? 'used' : 'skipped',
    quantity: parsed.data.fromHome ? -units : 0,
    occurred_on: log.log_date as string,
    food_log_id: log.id,
  });

  if (error) {
    console.error('pantry log settle failed', error);
    return {
      ok: false,
      error: error.code === '23505' ? 'That entry has already been dealt with.' : 'We could not record that.',
    };
  }

  refresh();
  return {
    ok: true,
    message: parsed.data.fromHome
      ? `${formatQuantity(item, units)} ${item.label} taken from stock.`
      : 'Noted — not from home, so nothing was taken from stock.',
  };
}

/** Undo one movement recorded by mistake. */
export async function removeMovement(id: string): Promise<PantryResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'We could not find that.' };

  const session = await signedIn();
  if (!session) return { ok: false, error: 'You need to be signed in.' };

  const { data, error } = await session.supabase
    .from('pantry_movements')
    .delete()
    .eq('id', id)
    .eq('user_id', session.userId)
    .select('id');

  if (error || !data || data.length !== 1) return { ok: false, error: 'We could not remove that.' };

  refresh();
  return { ok: true, message: 'Removed.' };
}

/** Stop keeping an item. Its history is kept, not deleted. */
export async function archivePantryItem(id: string): Promise<PantryResult> {
  if (!supabaseConfigured) return { ok: false, error: 'Supabase is not configured on this deployment.' };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'We could not find that item.' };

  const session = await signedIn();
  if (!session) return { ok: false, error: 'You need to be signed in.' };

  const { data, error } = await session.supabase
    .from('pantry_items')
    .update({ archived_on: todayIso() })
    .eq('id', id)
    .eq('user_id', session.userId)
    .is('archived_on', null)
    .select('label');

  if (error || !data || data.length !== 1) return { ok: false, error: 'We could not remove that item.' };

  refresh();
  return { ok: true, message: `${data[0].label} is no longer tracked.` };
}
