import { categoryLabel, countsAsSpending, formatRupees } from '@/lib/engines/money';
import { intentFor, type Intent } from '@/lib/engines/salary';
import type { Commitment } from '@/lib/engines/commitments';

/**
 * Money over time: how this month compares, what changed, and whether the
 * picture is getting clearer.
 *
 * ## Only whole, fully-recorded months are compared
 *
 * The same rule `salaryTrend` and savings goals already follow, applied to
 * spending. Two kinds of month are shown and never compared:
 *
 * - **The current month.** Half of September is not a cheap September. It is
 *   compared only against the *same point* of last month — spending by day 13
 *   against spending by day 13.
 * - **The month recording began in**, unless it began in the first few days.
 *   Someone who started on 20 July has a July that looks cheap only because
 *   most of it was never written down, and a trend drawn from it reports a
 *   rise in spending that did not happen.
 *
 * ## It describes; it does not judge
 *
 * A change is a number of rupees and the categories behind it. More spending
 * is not called a problem, and less is not called a success — rent paid on the
 * 30th instead of the 1st moves money between months without anything real
 * changing.
 */

export interface TrendsInput {
  spends: { amountPaise: number; category: string; intent: Intent | null; spentOn: string }[];
  incomes: { amountPaise: number; receivedOn: string }[];
  withdrawals: { amountPaise: number; withdrawnOn: string }[];
  commitments: Commitment[];
  monthStartDay: number;
  /** YYYY-MM-DD. */
  today: string;
  /**
   * Whether anything was recorded before the earliest date the caller loaded.
   * When true, the first month in the data was recorded from its start.
   */
  recordedBefore: boolean;
}

export type MonthStatus = 'complete' | 'partial' | 'current';

export interface MonthStat {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, exclusive. */
  end: string;
  /** "Aug", or "25 Jul" for a month that starts on payday. */
  shortLabel: string;
  /** "August", or "25 July" for a month that starts on payday. */
  label: string;
  status: MonthStatus;
  /** Spending only; savings are in savedPaise. */
  spendingPaise: number;
  savedPaise: number;
  incomePaise: number;
  withdrawnPaise: number;
  byIntent: Record<Exclude<Intent, 'savings'> | 'unclassified', number>;
  byCategory: Record<string, number>;
  /** Income and withdrawals minus everything recorded. Null without income. */
  unaccountedPaise: number | null;
}

export interface PaceComparison {
  /** How many days of the current month have passed, today included. */
  day: number;
  currentPaise: number;
  previousPaise: number;
  previousLabel: string;
  message: string;
}

export interface CategoryMove {
  category: string;
  label: string;
  fromPaise: number;
  toPaise: number;
}

export interface MonthChange {
  from: MonthStat;
  to: MonthStat;
  differencePaise: number;
  /** Largest movements first, at most three. */
  movers: CategoryMove[];
  message: string;
}

export interface MoneyTrends {
  /** Oldest first; the current month is last. */
  months: MonthStat[];
  /** At least one full, fully-recorded month exists to say anything about. */
  enoughHistory: boolean;
  headline: string;
  pace: PaceComparison | null;
  change: MonthChange | null;
  /** Average spending over full months. Null below two of them. */
  usualSpendingPaise: number | null;
  savingsRate: { average: number; latest: number; latestLabel: string; months: number; message: string } | null;
  unaccounted: {
    direction: 'shrinking' | 'growing' | 'steady';
    firstShare: number;
    latestShare: number;
    message: string;
  } | null;
  wants: { direction: 'up' | 'down' | 'steady'; latestShare: number; earlierShare: number; message: string } | null;
  fixedCosts: {
    monthlyPaise: number;
    /** Of usual income. Null with no income in a full month. */
    share: number | null;
    items: { label: string; monthlyPaise: number }[];
    message: string;
  } | null;
  subscriptions: {
    items: { id: string; label: string; monthlyPaise: number; yearlyPaise: number }[];
    monthlyPaise: number;
    yearlyPaise: number;
    message: string;
  } | null;
}

/** How many full months back the screen looks. */
export const TREND_MONTHS = 6;

/** A month counts as recorded from its start when records began this many days in. */
const START_GRACE_DAYS = 2;

/** Below this a difference is "about the same": 5%, or ₹200, whichever is larger. */
const SAME_SHARE = 0.05;
const SAME_FLOOR_PAISE = 20_000;

/** A category has to move by both of these to be named. */
const MOVER_MIN_PAISE = 50_000;
const MOVER_MIN_SHARE = 0.2;

/** Percentage points before a share is said to have moved. */
const SHARE_POINTS = 0.05;

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** Averages are not exact; shown to the rupee. */
const about = (paise: number) => formatRupees(Math.round(paise / 100) * 100);

/* ------------------------------------------------------------------ */
/* Dates as strings — no timezone can move a day                       */
/* ------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function monthStartFor(date: string, startDay: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  if (d >= startDay) return ymd(y, m, startDay);
  return m === 1 ? ymd(y - 1, 12, startDay) : ymd(y, m - 1, startDay);
}

function addMonths(start: string, n: number): string {
  const index = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1 + n;
  return ymd(Math.floor(index / 12), (index % 12) + 1, Number(start.slice(8, 10)));
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function labels(start: string, startDay: number) {
  const date = new Date(`${start}T00:00:00Z`);
  const month = (style: 'short' | 'long') =>
    date.toLocaleString('en-IN', { month: style, timeZone: 'UTC' });
  return startDay === 1
    ? { shortLabel: month('short'), label: month('long') }
    : { shortLabel: `${startDay} ${month('short')}`, label: `${startDay} ${month('long')}` };
}

/** The earliest date `moneyTrends` looks at: the start of the oldest month it can show. */
export function trendsFrom(today: string, monthStartDay: number): string {
  return addMonths(monthStartFor(today, monthStartDay), -TREND_MONTHS);
}

/* ------------------------------------------------------------------ */

export function moneyTrends(input: TrendsInput): MoneyTrends {
  const { monthStartDay: startDay, today } = input;
  const currentStart = monthStartFor(today, startDay);

  const recordDates = [...input.spends.map((s) => s.spentOn), ...input.incomes.map((i) => i.receivedOn)]
    .filter((d) => d < addMonths(currentStart, 1))
    .sort();
  const firstRecord = recordDates[0] ?? null;

  // From the month of the first record, capped at TREND_MONTHS full months back.
  const earliest = addMonths(currentStart, -TREND_MONTHS);
  let cursor = firstRecord ? monthStartFor(firstRecord, startDay) : currentStart;
  if (cursor < earliest) cursor = earliest;

  const months: MonthStat[] = [];
  for (; cursor <= currentStart; cursor = addMonths(cursor, 1)) {
    const start = cursor;
    const end = addMonths(cursor, 1);

    let status: MonthStatus = 'complete';
    if (start === currentStart) status = 'current';
    else if (
      !input.recordedBefore &&
      firstRecord !== null &&
      firstRecord > addDays(start, START_GRACE_DAYS)
    ) {
      status = 'partial';
    }

    months.push(summarise(input, start, end, status, labels(start, startDay)));
  }

  const complete = months.filter((m) => m.status === 'complete');
  const current = months[months.length - 1];

  const pace = paceFor(input, months, current, today);
  const change = changeFor(complete);
  const usualSpendingPaise =
    complete.length >= 2
      ? Math.round(complete.reduce((sum, m) => sum + m.spendingPaise, 0) / complete.length)
      : null;

  const withIncome = complete.filter((m) => m.incomePaise > 0);
  const savingsRate = savingsRateFor(withIncome);
  const unaccounted = unaccountedFor(withIncome);
  const wants = wantsFor(complete);
  const usualIncomePaise =
    withIncome.length > 0
      ? Math.round(withIncome.reduce((sum, m) => sum + m.incomePaise, 0) / withIncome.length)
      : null;
  const fixedCosts = fixedCostsFor(input.commitments, today, usualIncomePaise);
  const subscriptions = subscriptionsFor(input.commitments, today);

  const enoughHistory = complete.length > 0;

  return {
    months,
    enoughHistory,
    headline: headlineFor({ enoughHistory, pace, change, current, firstRecord }),
    pace,
    change,
    usualSpendingPaise,
    savingsRate,
    unaccounted,
    wants,
    fixedCosts,
    subscriptions,
  };
}

function summarise(
  input: TrendsInput,
  start: string,
  end: string,
  status: MonthStatus,
  names: { shortLabel: string; label: string },
): MonthStat {
  const inWindow = (date: string) => date >= start && date < end;

  let spendingPaise = 0;
  let savedPaise = 0;
  const byIntent = { obligation: 0, need: 0, want: 0, unclassified: 0 };
  const byCategory: Record<string, number> = {};

  for (const s of input.spends) {
    if (!inWindow(s.spentOn)) continue;
    if (!countsAsSpending(s.category)) {
      savedPaise += s.amountPaise;
      continue;
    }
    spendingPaise += s.amountPaise;
    byCategory[s.category] = (byCategory[s.category] ?? 0) + s.amountPaise;

    const intent = intentFor(s.category, s.intent);
    // A spend someone marked as savings but filed under another category is
    // still spending on this screen; its category decides, as on the ring.
    if (intent === null || intent === 'savings') byIntent.unclassified += s.amountPaise;
    else byIntent[intent] += s.amountPaise;
  }

  const incomePaise = input.incomes
    .filter((i) => inWindow(i.receivedOn))
    .reduce((sum, i) => sum + i.amountPaise, 0);
  const withdrawnPaise = input.withdrawals
    .filter((w) => inWindow(w.withdrawnOn))
    .reduce((sum, w) => sum + w.amountPaise, 0);

  return {
    start,
    end,
    ...names,
    status,
    spendingPaise,
    savedPaise,
    incomePaise,
    withdrawnPaise,
    byIntent,
    byCategory,
    unaccountedPaise:
      incomePaise > 0 ? incomePaise + withdrawnPaise - spendingPaise - savedPaise : null,
  };
}

function paceFor(
  input: TrendsInput,
  months: MonthStat[],
  current: MonthStat,
  today: string,
): PaceComparison | null {
  const previous = months.find((m) => m.end === current.start);
  if (!previous || previous.status !== 'complete') return null;

  const day = daysBetween(current.start, today) + 1;
  // A 31st day has no counterpart in a 30-day month; the whole month stands in.
  const previousCutoff = [addDays(previous.start, day), previous.end].sort()[0];

  const spentBetween = (from: string, to: string) =>
    input.spends
      .filter((s) => countsAsSpending(s.category) && s.spentOn >= from && s.spentOn < to)
      .reduce((sum, s) => sum + s.amountPaise, 0);

  const currentPaise = spentBetween(current.start, addDays(today, 1));
  const previousPaise = spentBetween(previous.start, previousCutoff);
  if (currentPaise === 0 && previousPaise === 0) return null;

  const difference = currentPaise - previousPaise;
  const so = `${formatRupees(currentPaise)} spent in the first ${day} day${day === 1 ? '' : 's'}`;

  let message: string;
  if (Math.abs(difference) <= Math.max(previousPaise * SAME_SHARE, SAME_FLOOR_PAISE)) {
    message = `${so} — about the same as by this point last month (${formatRupees(previousPaise)}).`;
  } else {
    message =
      `${so} — ${formatRupees(Math.abs(difference))} ${difference < 0 ? 'less' : 'more'} than by ` +
      `the same point last month (${formatRupees(previousPaise)}).`;
  }

  // Early in a month, one bill landing on a different day decides the answer.
  if (day <= 10) message += ' This early, a bill paid on a different day can swing it either way.';

  return { day, currentPaise, previousPaise, previousLabel: previous.label, message };
}

function changeFor(complete: MonthStat[]): MonthChange | null {
  if (complete.length < 2) return null;
  const to = complete[complete.length - 1];
  const from = complete[complete.length - 2];
  // Only neighbours: a gap between them is a month that was not fully recorded.
  if (from.end !== to.start) return null;

  const differencePaise = to.spendingPaise - from.spendingPaise;

  const categories = new Set([...Object.keys(from.byCategory), ...Object.keys(to.byCategory)]);
  const movers: CategoryMove[] = [...categories]
    .map((category) => ({
      category,
      label: categoryLabel(category),
      fromPaise: from.byCategory[category] ?? 0,
      toPaise: to.byCategory[category] ?? 0,
    }))
    .filter((m) => {
      const moved = Math.abs(m.toPaise - m.fromPaise);
      return moved >= MOVER_MIN_PAISE && (m.fromPaise === 0 || moved / m.fromPaise >= MOVER_MIN_SHARE);
    })
    .sort((a, b) => Math.abs(b.toPaise - b.fromPaise) - Math.abs(a.toPaise - a.fromPaise))
    .slice(0, 3);

  const same =
    Math.abs(differencePaise) <= Math.max(from.spendingPaise * SAME_SHARE, SAME_FLOOR_PAISE);
  const message = same
    ? `${to.label}: ${formatRupees(to.spendingPaise)} spent — about the same as ${from.label}.`
    : `${to.label}: ${formatRupees(to.spendingPaise)} spent, ${formatRupees(Math.abs(differencePaise))} ` +
      `${differencePaise < 0 ? 'less' : 'more'} than ${from.label}.`;

  return { from, to, differencePaise, movers, message };
}

function savingsRateFor(withIncome: MonthStat[]): MoneyTrends['savingsRate'] {
  if (withIncome.length < 2) return null;
  const saved = withIncome.reduce((sum, m) => sum + m.savedPaise, 0);
  const income = withIncome.reduce((sum, m) => sum + m.incomePaise, 0);
  const latestMonth = withIncome[withIncome.length - 1];
  const average = saved / income;
  const latest = latestMonth.savedPaise / latestMonth.incomePaise;

  return {
    average,
    latest,
    latestLabel: latestMonth.label,
    months: withIncome.length,
    message:
      `Across ${withIncome.length} full months with income recorded, ${pct(average)} of what came in ` +
      `was set aside. ${latestMonth.label}: ${pct(latest)}.`,
  };
}

function unaccountedFor(withIncome: MonthStat[]): MoneyTrends['unaccounted'] {
  if (withIncome.length < 3) return null;

  // More recorded going out than arrived is nothing unaccounted, not less.
  const share = (m: MonthStat) =>
    Math.max(0, (m.unaccountedPaise ?? 0) / (m.incomePaise + m.withdrawnPaise));

  const first = withIncome[0];
  const latest = withIncome[withIncome.length - 1];
  const firstShare = share(first);
  const latestShare = share(latest);
  const moved = latestShare - firstShare;

  const direction = moved <= -SHARE_POINTS ? 'shrinking' : moved >= SHARE_POINTS ? 'growing' : 'steady';
  const span = `from ${pct(firstShare)} of what arrived in ${first.label} to ${pct(latestShare)} in ${latest.label}`;

  const message =
    direction === 'shrinking'
      ? `Money with no recorded destination went ${span}. Either more of where it goes is being ` +
        `recorded, or more of it is staying in the account.`
      : direction === 'growing'
        ? `Money with no recorded destination went ${span}. Either more is staying in the account, ` +
          `or more is being spent without being recorded.`
        : `Money with no recorded destination has held at about ${pct(latestShare)} of what arrives each month.`;

  return { direction, firstShare, latestShare, message };
}

function wantsFor(complete: MonthStat[]): MoneyTrends['wants'] {
  const months = complete.filter((m) => m.spendingPaise > 0);
  if (months.length < 3) return null;

  const share = (m: MonthStat) => m.byIntent.want / m.spendingPaise;
  const latest = months[months.length - 1];
  const earlier = months.slice(0, -1);
  const latestShare = share(latest);
  const earlierShare = earlier.reduce((sum, m) => sum + share(m), 0) / earlier.length;
  const moved = latestShare - earlierShare;

  const direction = moved >= SHARE_POINTS ? 'up' : moved <= -SHARE_POINTS ? 'down' : 'steady';
  const floor = latest.byIntent.unclassified > 0 ? 'at least ' : '';

  const message =
    direction === 'steady'
      ? `Wants have been ${floor}about ${pct(latestShare)} of spending, much as in the months before.`
      : `Wants were ${floor}${pct(latestShare)} of spending in ${latest.label}, ` +
        `${direction === 'up' ? 'up' : 'down'} from about ${pct(earlierShare)} in the months before.`;

  return { direction, latestShare, earlierShare, message };
}

/* ------------------------------------------------------------------ */
/* Commitments                                                         */
/* ------------------------------------------------------------------ */

const PER_YEAR: Record<Commitment['cadence'], number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

const yearly = (c: Commitment) => c.amountPaise * PER_YEAR[c.cadence];

const activeOn = (c: Commitment, today: string) =>
  c.startedOn <= today && (c.endedOn === null || c.endedOn >= today);

/*
 * Named like a subscription, whatever it was filed under. A streaming service
 * is often filed as "other" or "phone & internet"; the name is the better
 * signal. Kept to names that are not ambiguous — "prime" alone would catch a
 * prime-location rent.
 */
const SUBSCRIPTION_NAME =
  /\b(netflix|amazon prime|prime video|hotstar|disney|jiocinema|jio cinema|sonyliv|sony liv|zee5|spotify|youtube|apple music|apple tv|icloud|google one|gaana|wynk|audible|kindle unlimited|chatgpt|swiggy one|zomato gold|cult\.?fit|gym|linkedin premium|microsoft 365|office 365|adobe|canva|dropbox|notion)\b/i;

function fixedCostsFor(
  commitments: Commitment[],
  today: string,
  usualIncomePaise: number | null,
): MoneyTrends['fixedCosts'] {
  const items = commitments
    .filter((c) => activeOn(c, today) && countsAsSpending(c.category))
    .map((c) => ({ label: c.label, monthlyPaise: Math.round(yearly(c) / 12) }))
    .sort((a, b) => b.monthlyPaise - a.monthlyPaise);

  if (items.length === 0) return null;

  const monthlyPaise = items.reduce((sum, i) => sum + i.monthlyPaise, 0);
  const share = usualIncomePaise ? monthlyPaise / usualIncomePaise : null;

  const message =
    share === null
      ? `${formatRupees(monthlyPaise)} a month is already spoken for by recurring commitments. ` +
        `Record what comes in and this will show what share of it that is.`
      : `${formatRupees(monthlyPaise)} a month is already spoken for by recurring commitments — ` +
        `${pct(share)} of your usual income of ${about(usualIncomePaise!)}.`;

  return { monthlyPaise, share, items, message };
}

function subscriptionsFor(commitments: Commitment[], today: string): MoneyTrends['subscriptions'] {
  const items = commitments
    .filter(
      (c) =>
        activeOn(c, today) &&
        countsAsSpending(c.category) &&
        (c.category === 'entertainment' || SUBSCRIPTION_NAME.test(c.label)),
    )
    .map((c) => ({
      id: c.id,
      label: c.label,
      yearlyPaise: yearly(c),
      monthlyPaise: Math.round(yearly(c) / 12),
    }))
    .sort((a, b) => b.yearlyPaise - a.yearlyPaise);

  if (items.length === 0) return null;

  const yearlyPaise = items.reduce((sum, i) => sum + i.yearlyPaise, 0);
  const monthlyPaise = Math.round(yearlyPaise / 12);

  return {
    items,
    monthlyPaise,
    yearlyPaise,
    message:
      `${formatRupees(monthlyPaise)} a month on ${items.length} subscription${items.length === 1 ? '' : 's'} — ` +
      `${formatRupees(yearlyPaise)} a year.`,
  };
}

function headlineFor(input: {
  enoughHistory: boolean;
  pace: PaceComparison | null;
  change: MonthChange | null;
  current: MonthStat;
  firstRecord: string | null;
}): string {
  if (!input.enoughHistory) {
    if (input.firstRecord === null) {
      return 'Nothing recorded yet. Once there is a full month of spending, this shows how months compare.';
    }
    // Recording that began partway through this month makes next month the
    // first full one.
    const thisMonthCounts = input.firstRecord <= addDays(input.current.start, START_GRACE_DAYS);
    const firstFullEnd = thisMonthCounts ? input.current.end : addMonths(input.current.end, 1);
    return (
      `The first full month of records ends on ${dayLabel(addDays(firstFullEnd, -1))}. ` +
      `Comparisons start then — a part-month would make the rest look expensive.`
    );
  }

  return input.pace?.message ?? input.change?.message ?? `Comparisons start once there are two full months.`;
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}
