import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { allRows } from '@/lib/data/paged';
import {
  pendingFromLogs,
  stockLevel,
  type LoggedFood,
  type Movement,
  type MovementKind,
  type PantryItem,
  type PantryUnit,
  type PendingUse,
  type StockLevel,
} from '@/lib/engines/pantry';

export interface KitchenEntry {
  id: string;
  kind: MovementKind;
  quantity: number;
  occurredOn: string;
  note: string | null;
  /** Came from a food log, so it is undone by removing or editing the log. */
  fromLog: boolean;
}

export interface KitchenItemView {
  item: PantryItem;
  level: StockLevel;
  /** Newest first, a handful — enough to find and undo a mistake. */
  recent: KitchenEntry[];
}

export type KitchenView =
  | { state: 'sample' }
  /** The tables are not on this database yet. */
  | { state: 'unavailable' }
  | { state: 'ready'; items: KitchenItemView[]; pending: PendingUse[] };

/** How far back the food log is offered for taking from stock. */
export const PENDING_DAYS = 3;
const RECENT_SHOWN = 6;

/**
 * The kitchen: what is kept, what is on hand, and which recent food logs could
 * have come out of it.
 *
 * On hand is summed from every movement an item has ever had, never read from
 * a stored figure.
 */
export async function getKitchen(): Promise<KitchenView> {
  if (!supabaseConfigured) return { state: 'sample' };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { state: 'sample' };
  const userId = auth.user.id;

  const { data: itemRows, error: itemsError } = await supabase
    .from('pantry_items')
    .select('id, label, food_id, unit, grams_per_unit')
    .eq('user_id', userId)
    .is('archived_on', null)
    .order('label', { ascending: true });

  if (itemsError) {
    // PGRST205 when the migration has not been applied. Anything else is a real
    // error, and still should not take the page down with it.
    console.error('kitchen items failed', itemsError);
    return { state: 'unavailable' };
  }

  const items: PantryItem[] = (itemRows ?? []).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    foodId: (r.food_id as string) ?? null,
    unit: r.unit as PantryUnit,
    // numeric arrives as a string from PostgREST.
    gramsPerUnit: r.grams_per_unit == null ? null : Number(r.grams_per_unit),
  }));

  if (items.length === 0) return { state: 'ready', items: [], pending: [] };

  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - (PENDING_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const foodIds = items.map((i) => i.foodId).filter((id): id is string => id !== null);

  const [movementsRes, logsRes] = await Promise.all([
    allRows((lo, hi) =>
      supabase
        .from('pantry_movements')
        .select('id, item_id, kind, quantity, occurred_on, note, food_log_id')
        .eq('user_id', userId)
        .in(
          'item_id',
          items.map((i) => i.id),
        )
        .order('occurred_on', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(lo, hi),
    ),
    foodIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('food_logs')
          .select('id, food_id, description, log_date, grams, quantity, unit_label')
          .eq('user_id', userId)
          .gte('log_date', since)
          .in('food_id', foodIds)
          .order('logged_at', { ascending: false }),
  ]);

  const byItem = new Map<string, { movements: Movement[]; recent: KitchenEntry[] }>();
  const handledLogs = new Set<string>();

  for (const row of movementsRes.rows) {
    const key = row.item_id as string;
    const bucket = byItem.get(key) ?? { movements: [], recent: [] };
    const movement = {
      kind: row.kind as MovementKind,
      quantity: Number(row.quantity),
      occurredOn: row.occurred_on as string,
    };
    bucket.movements.push(movement);
    // A "not from home" marker changes nothing, so it is not history worth showing.
    if (movement.kind !== 'skipped' && bucket.recent.length < RECENT_SHOWN) {
      bucket.recent.push({
        id: row.id as string,
        ...movement,
        note: (row.note as string) ?? null,
        fromLog: row.food_log_id != null,
      });
    }
    byItem.set(key, bucket);
    if (row.food_log_id) handledLogs.add(row.food_log_id as string);
  }

  const logs: LoggedFood[] = (logsRes.data ?? []).map((r) => ({
    id: r.id as string,
    foodId: (r.food_id as string) ?? null,
    description: r.description as string,
    logDate: r.log_date as string,
    grams: r.grams == null ? null : Number(r.grams),
    quantity: Number(r.quantity),
    unitLabel: r.unit_label as string,
  }));

  return {
    state: 'ready',
    items: items.map((item) => {
      const bucket = byItem.get(item.id) ?? { movements: [], recent: [] };
      return { item, level: stockLevel(item, bucket.movements, today), recent: bucket.recent };
    }),
    pending: pendingFromLogs(items, logs, handledLogs),
  };
}
