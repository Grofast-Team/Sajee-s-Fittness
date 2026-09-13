/**
 * What is in the kitchen, and how long it lasts.
 *
 * ## A ledger, not a number
 *
 * The same shape as the money side. An item is a plan — eggs, counted in
 * pieces — and what is on hand is the sum of what happened to it: bought, used,
 * thrown out, or counted. A count records the *difference* from what the
 * ledger said, so it corrects everything before it without erasing any of it.
 *
 * ## What it refuses to guess
 *
 * Food is logged as dishes and stocked as ingredients. A logged dosa used rice
 * and dal, but saying how much needs recipes, which the app does not have yet.
 * So only a food logged *as itself* — eggs, milk, curd, fruit — is ever offered
 * as coming out of stock, and only once the person says it came from home: a
 * food log does not record whether a meal was eaten out, and food eaten out
 * must never empty the kitchen.
 *
 * "About four days left" needs a rate, and a rate needs history: at least
 * MIN_USES uses spread over at least MIN_SPAN_DAYS, from the last four weeks.
 * With less, it says so rather than extrapolating a single breakfast.
 */

export type PantryUnit = 'piece' | 'g' | 'ml';

export interface PantryItem {
  id: string;
  label: string;
  /** The food this is, so logging it can take it out of stock. */
  foodId: string | null;
  unit: PantryUnit;
  /** Weight of one piece, for turning a logged weight into pieces. */
  gramsPerUnit: number | null;
}

export type MovementKind = 'bought' | 'used' | 'discarded' | 'counted' | 'skipped';

export interface Movement {
  kind: MovementKind;
  /** Signed, in the item's unit: bought is positive; used and discarded negative. */
  quantity: number;
  /** YYYY-MM-DD. */
  occurredOn: string;
}

export type StockStatus = 'out' | 'low' | 'ok' | 'unknown';

export interface StockLevel {
  onHand: number;
  /** Units used a day, over recent use. Null without enough history. */
  perDay: number | null;
  daysLeft: number | null;
  status: StockStatus;
  /** The most recent day anything was used. */
  lastUsedOn: string | null;
  message: string;
}

/** How far back use counts towards the rate. */
export const RATE_WINDOW_DAYS = 28;
export const MIN_USES = 3;
export const MIN_SPAN_DAYS = 7;
/** At or below this many days left, an item is running low. */
export const LOW_DAYS = 2;

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Two decimal places at most, and no trailing zeros. */
const tidy = (n: number) => String(Math.round(n * 100) / 100);

export function formatQuantity(item: Pick<PantryItem, 'unit'>, quantity: number): string {
  if (item.unit === 'piece') return tidy(quantity);
  if (quantity >= 1000) {
    return `${tidy(Math.round(quantity / 100) / 10)} ${item.unit === 'g' ? 'kg' : 'L'}`;
  }
  return `${tidy(Math.round(quantity))} ${item.unit}`;
}

/** A rate is not exact: whole pieces above one a day, otherwise a rounder figure. */
function formatRate(item: PantryItem, perDay: number): string {
  if (item.unit === 'piece') {
    return perDay >= 1 ? tidy(Math.round(perDay * 2) / 2) : tidy(Math.round(perDay * 10) / 10);
  }
  return formatQuantity(item, perDay >= 100 ? Math.round(perDay / 50) * 50 : Math.round(perDay / 10) * 10);
}

export function stockLevel(item: PantryItem, movements: Movement[], today: string): StockLevel {
  const total = movements.reduce((sum, m) => sum + m.quantity, 0);
  // A food log confirmed after the count that should have included it can
  // take the ledger below zero. The shelf cannot go below empty.
  const onHand = Math.max(0, Math.round(total * 100) / 100);

  const uses = movements.filter((m) => m.kind === 'used' && m.quantity < 0);
  const lastUsedOn = uses.map((m) => m.occurredOn).sort().at(-1) ?? null;

  const windowStart = addDays(today, -(RATE_WINDOW_DAYS - 1));
  const recent = uses.filter((m) => m.occurredOn >= windowStart && m.occurredOn <= today);
  const firstRecent = recent.map((m) => m.occurredOn).sort()[0];
  const span = firstRecent ? daysBetween(firstRecent, today) + 1 : 0;

  let perDay: number | null = null;
  if (recent.length >= MIN_USES && span >= MIN_SPAN_DAYS) {
    perDay = recent.reduce((sum, m) => sum - m.quantity, 0) / span;
  }

  const daysLeft = perDay && perDay > 0 ? Math.floor(onHand / perDay) : null;

  const status: StockStatus =
    onHand <= 0 ? 'out' : daysLeft === null ? 'unknown' : daysLeft <= LOW_DAYS ? 'low' : 'ok';

  const here = formatQuantity(item, onHand);

  let message: string;
  if (status === 'out') {
    message = lastUsedOn ? `None left — the last was used on ${dayLabel(lastUsedOn)}.` : 'None left.';
  } else if (daysLeft === null) {
    message = `${here} here. Not enough use recorded yet to say how long that lasts.`;
  } else {
    const rate = `about ${formatRate(item, perDay!)} a day`;
    message =
      daysLeft === 0
        ? `${here} here — less than a day's worth, at ${rate}.`
        : `${here} here — about ${daysLeft} day${daysLeft === 1 ? '' : 's'} left, at ${rate}.`;
  }

  return { onHand, perDay, daysLeft, status, lastUsedOn, message };
}

export interface LoggedFood {
  id: string;
  foodId: string | null;
  description: string;
  /** YYYY-MM-DD. */
  logDate: string;
  grams: number | null;
  quantity: number;
  unitLabel: string;
}

/**
 * How much of an item a food log used, in the item's unit.
 *
 * Null when it cannot be said — grams logged against an item counted in pieces
 * with no known weight per piece. Never a guess.
 */
export function unitsFromLog(
  item: PantryItem,
  log: Pick<LoggedFood, 'grams' | 'quantity' | 'unitLabel'>,
): number | null {
  if (item.unit === 'piece') {
    if (log.unitLabel === 'piece') return log.quantity;
    if (log.grams === null || !item.gramsPerUnit) return null;
    return Math.round((log.grams / item.gramsPerUnit) * 100) / 100;
  }
  // Grams stand in for millilitres. Milk is about 3% denser than water — well
  // inside how precisely anyone knows what is left in a packet.
  return log.grams;
}

export interface PendingUse {
  log: LoggedFood;
  item: PantryItem;
  units: number;
}

/**
 * Logged foods that could have come out of stock and have not been dealt with
 * — neither taken from stock nor marked as not from home.
 */
export function pendingFromLogs(
  items: PantryItem[],
  logs: LoggedFood[],
  handledLogIds: Set<string>,
): PendingUse[] {
  const byFood = new Map(items.filter((i) => i.foodId).map((i) => [i.foodId!, i]));
  const pending: PendingUse[] = [];

  for (const log of logs) {
    if (!log.foodId || handledLogIds.has(log.id)) continue;
    const item = byFood.get(log.foodId);
    if (!item) continue;
    const units = unitsFromLog(item, log);
    if (units === null || units <= 0) continue;
    pending.push({ log, item, units });
  }

  return pending;
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
