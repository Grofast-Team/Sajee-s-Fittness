/**
 * The money calculations.
 *
 * ## Everything is whole paise, as integers
 *
 * Money never touches a floating point number in this file. `0.1 + 0.2` is
 * `0.30000000000000004` in binary floating point, and a month of spending is
 * hundreds of additions — the drift is small each time and visible by the end.
 * A user who adds their receipts up on paper and gets a different answer from
 * the app is right to stop trusting it, and they would be correct to.
 *
 * Rupees exist only at the edges: parsed on the way in, formatted on the way
 * out. Everything in between is `paise: number`, an integer.
 *
 * ## The tone
 *
 * This is the same product as the calorie side and it follows the same rule:
 * no shaming. Overspending is a fact to state and work with, not a failure to
 * scold someone about. Someone who feels judged by their budget app closes it,
 * and an app they have closed cannot help them.
 */

export type SpendCategory =
  | 'groceries'
  | 'eating_out'
  | 'transport'
  | 'rent'
  | 'bills'
  | 'phone_internet'
  | 'medical'
  | 'education'
  | 'family'
  | 'clothes'
  | 'household'
  | 'entertainment'
  | 'personal_care'
  | 'gifts'
  | 'savings'
  | 'other';

export const CATEGORIES: { id: SpendCategory; label: string; emoji: string }[] = [
  { id: 'groceries', label: 'Groceries', emoji: '🥬' },
  { id: 'eating_out', label: 'Eating out', emoji: '🍽️' },
  { id: 'transport', label: 'Travel', emoji: '🚌' },
  { id: 'rent', label: 'Rent', emoji: '🏠' },
  { id: 'bills', label: 'Bills', emoji: '🧾' },
  { id: 'phone_internet', label: 'Phone & internet', emoji: '📱' },
  { id: 'medical', label: 'Medical', emoji: '💊' },
  { id: 'education', label: 'Education', emoji: '📚' },
  { id: 'family', label: 'Family', emoji: '👨‍👩‍👧' },
  { id: 'clothes', label: 'Clothes', emoji: '👕' },
  { id: 'household', label: 'Household', emoji: '🧹' },
  { id: 'entertainment', label: 'Fun', emoji: '🎬' },
  { id: 'personal_care', label: 'Personal care', emoji: '🧴' },
  { id: 'gifts', label: 'Gifts', emoji: '🎁' },
  { id: 'savings', label: 'Savings', emoji: '🏦' },
  { id: 'other', label: 'Other', emoji: '•' },
];

const LABELS = new Map(CATEGORIES.map((c) => [c.id, c.label]));

export function categoryLabel(id: string): string {
  return LABELS.get(id as SpendCategory) ?? 'Other';
}

/* ------------------------------------------------------------------ */
/* Parsing and formatting                                              */
/* ------------------------------------------------------------------ */

/**
 * Turn what someone typed into whole paise.
 *
 * Accepts "250", "250.50", "₹250", "1,250.75". Returns null rather than
 * guessing when the input is not a number — a silently-zeroed amount is worse
 * than a rejected one, because it lands in the total and cannot be spotted.
 *
 * Parsed by splitting on the decimal point rather than by multiplying a float
 * by 100: `Math.round(19.99 * 100)` is fine, but the same pattern quietly
 * fails for other values, and there is no reason to rely on rounding luck.
 */
export function parseAmountToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').trim();
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned)) return null;

  const [rupeesPart = '0', paisePart = ''] = cleaned.split('.');
  if (rupeesPart === '' && paisePart === '') return null;

  const rupees = Number(rupeesPart || '0');
  if (!Number.isFinite(rupees)) return null;

  // Pad or trim to exactly two digits: ".5" is fifty paise, not five.
  const paise = Number((paisePart + '00').slice(0, 2));
  if (!Number.isFinite(paise)) return null;

  const total = rupees * 100 + paise;
  if (total <= 0) return null;

  return Math.round(total);
}

/** Whole rupees when the paise are zero, two decimals when they are not. */
export function formatRupees(paise: number, options: { compact?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;

  if (options.compact && rupees >= 100000) {
    return `${negative ? '-' : ''}₹${(rupees / 100000).toFixed(1)} lakh`;
  }

  const body =
    remainder === 0
      ? rupees.toLocaleString('en-IN')
      : `${rupees.toLocaleString('en-IN')}.${String(remainder).padStart(2, '0')}`;

  return `${negative ? '-' : ''}₹${body}`;
}

/* ------------------------------------------------------------------ */
/* The money month                                                     */
/* ------------------------------------------------------------------ */

export interface MonthWindow {
  start: string;
  /** Exclusive. */
  end: string;
  label: string;
  daysTotal: number;
  daysElapsed: number;
  daysLeft: number;
}

/**
 * Work out which money month a date falls in.
 *
 * `monthStartDay` lets someone run their month from payday instead of the 1st,
 * which is how most people actually experience money. Capped at 28 upstream so
 * every month contains the day — a 31st start would silently skip February.
 */
export function monthWindow(today: Date, monthStartDay = 1): MonthWindow {
  const day = today.getDate();
  const start = new Date(today);

  if (day >= monthStartDay) {
    start.setDate(monthStartDay);
  } else {
    start.setMonth(start.getMonth() - 1);
    start.setDate(monthStartDay);
  }
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);

  const daysTotal = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const daysElapsed = Math.min(
    daysTotal,
    Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1,
  );

  return {
    start: iso(start),
    end: iso(end),
    label: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    daysTotal,
    daysElapsed,
    daysLeft: Math.max(0, daysTotal - daysElapsed),
  };
}

const iso = (d: Date) => {
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
};

/* ------------------------------------------------------------------ */
/* The month's picture                                                 */
/* ------------------------------------------------------------------ */

export interface Spend {
  amountPaise: number;
  category: string;
  spentOn: string;
}

export interface CategoryTotal {
  category: string;
  label: string;
  paise: number;
  /** Share of the month's spending, 0-1. */
  share: number;
}

export interface MonthSummary {
  totalPaise: number;
  /** Null when no limit has been set — different from a limit of zero. */
  limitPaise: number | null;
  remainingPaise: number | null;
  byCategory: CategoryTotal[];
  /** What is safe to spend a day for the rest of the month. */
  dailyAllowancePaise: number | null;
  /** Spend per day so far this month. */
  averagePerDayPaise: number;
  /** Projected month-end total at the current rate. */
  projectedPaise: number;
  message: string;
  /** True only when a limit exists and has been passed. */
  overBudget: boolean;
}

/**
 * Summarise a month of spending.
 *
 * The projection is a straight-line run rate, which is a genuinely useful
 * early warning and also a crude one — a month with rent already paid projects
 * far too high. So it is reported alongside the actual total rather than
 * instead of it, and the wording never states it as what *will* happen.
 */
export function summariseMonth(
  spends: Spend[],
  window: MonthWindow,
  limitPaise: number | null,
): MonthSummary {
  const totalPaise = spends.reduce((sum, s) => sum + s.amountPaise, 0);

  const grouped = new Map<string, number>();
  for (const s of spends) {
    grouped.set(s.category, (grouped.get(s.category) ?? 0) + s.amountPaise);
  }

  const byCategory: CategoryTotal[] = [...grouped.entries()]
    .map(([category, paise]) => ({
      category,
      label: categoryLabel(category),
      paise,
      share: totalPaise > 0 ? paise / totalPaise : 0,
    }))
    .sort((a, b) => b.paise - a.paise);

  const elapsed = Math.max(1, window.daysElapsed);
  const averagePerDayPaise = Math.round(totalPaise / elapsed);
  const projectedPaise = averagePerDayPaise * window.daysTotal;

  const remainingPaise = limitPaise === null ? null : limitPaise - totalPaise;
  const overBudget = remainingPaise !== null && remainingPaise < 0;

  const dailyAllowancePaise =
    remainingPaise === null || window.daysLeft === 0
      ? null
      : Math.max(0, Math.floor(remainingPaise / Math.max(1, window.daysLeft)));

  return {
    totalPaise,
    limitPaise,
    remainingPaise,
    byCategory,
    dailyAllowancePaise,
    averagePerDayPaise,
    projectedPaise,
    overBudget,
    message: buildMessage({
      totalPaise,
      limitPaise,
      remainingPaise,
      projectedPaise,
      dailyAllowancePaise,
      window,
      spendCount: spends.length,
    }),
  };
}

function buildMessage(input: {
  totalPaise: number;
  limitPaise: number | null;
  remainingPaise: number | null;
  projectedPaise: number;
  dailyAllowancePaise: number | null;
  window: MonthWindow;
  spendCount: number;
}): string {
  const { totalPaise, limitPaise, remainingPaise, projectedPaise, window } = input;

  if (input.spendCount === 0) {
    return 'Nothing recorded this month yet. Add the last thing you paid for — even a small one.';
  }

  if (limitPaise === null) {
    return (
      `${formatRupees(totalPaise)} spent so far this month. Set a monthly amount and this will ` +
      `start showing you what is left.`
    );
  }

  /*
   * Over budget.
   *
   * Stated as a fact with the number, and then something useful. No "you have
   * failed", no red warnings about being irresponsible. The calorie side of
   * this app does not shame people for eating and the money side does not
   * shame them for spending.
   */
  if (remainingPaise !== null && remainingPaise < 0) {
    return (
      `You are ${formatRupees(Math.abs(remainingPaise))} past your limit with ` +
      `${window.daysLeft} day${window.daysLeft === 1 ? '' : 's'} to go. Worth knowing rather ` +
      `than worth panicking about — the next month starts fresh, and the list below shows where ` +
      `it went.`
    );
  }

  if (window.daysLeft === 0) {
    return `${formatRupees(totalPaise)} spent this month, out of ${formatRupees(limitPaise)}.`;
  }

  // On pace to overshoot, but not there yet — the useful moment to say so.
  if (projectedPaise > limitPaise * 1.05) {
    return (
      `${formatRupees(remainingPaise ?? 0)} left for ${window.daysLeft} more days. At the rate ` +
      `you have been going this month you would finish around ${formatRupees(projectedPaise)}, ` +
      `which is over your limit. That is a projection, not a prediction — rent and one-off bills ` +
      `push it up early in the month.`
    );
  }

  return (
    `${formatRupees(remainingPaise ?? 0)} left for the next ${window.daysLeft} ` +
    `day${window.daysLeft === 1 ? '' : 's'} — about ` +
    `${formatRupees(input.dailyAllowancePaise ?? 0)} a day.`
  );
}
