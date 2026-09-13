import { categoryLabel } from '@/lib/engines/money';

/**
 * "Where did my salary go?"
 *
 * The question someone asks on the 25th, looking at a nearly empty account and
 * a month they do not remember spending. Answering it well means more than a
 * pie chart of categories: it means saying how much went on things that had to
 * be paid, how much on choices, how much was set aside — and, honestly, how
 * much this app simply cannot see.
 *
 * ## The line most tools get wrong
 *
 * The usual breakdown ends with "Remaining: ₹7,600". That figure is income
 * minus *recorded* spending, and it silently assumes every rupee spent was
 * written down. Nobody records everything. Without a bank balance there is no
 * way to tell money still sitting in the account from money spent on a Tuesday
 * and never entered, so the last line here is **"Not accounted for"** and it
 * says, in words, that it could be either.
 *
 * Calling it "remaining" would invite someone to spend money they may already
 * have spent.
 */

export type Intent = 'need' | 'want' | 'obligation' | 'savings';

/*
 * Defaults, where the answer is not really in doubt.
 *
 * Categories that could honestly be either — clothes, gifts, education,
 * personal care, family support, other — are deliberately left out. Guessing
 * would move money in and out of "wants", which is the single figure this
 * feature leads with, on the strength of nothing.
 */
const DEFAULT_INTENT: Partial<Record<string, Intent>> = {
  rent: 'obligation',
  bills: 'obligation',
  phone_internet: 'obligation',
  groceries: 'need',
  transport: 'need',
  medical: 'need',
  household: 'need',
  eating_out: 'want',
  entertainment: 'want',
  savings: 'savings',
};

export function intentFor(category: string, override: Intent | null): Intent | null {
  return override ?? DEFAULT_INTENT[category] ?? null;
}

export interface SpendForSalary {
  amountPaise: number;
  category: string;
  intent: Intent | null;
}

export interface SalaryInput {
  /** Everything received in the window, across all sources. */
  incomePaise: number;
  spends: SpendForSalary[];
  /** How many separate payments made up the income. */
  incomeCount: number;
  /**
   * Money taken back out of savings goals in the window. Not income — it does
   * not change the savings rate or the salary trend — but it did arrive in the
   * account, so it sits beside income when working out what is not accounted for.
   */
  withdrawnPaise?: number;
}

export interface BreakdownLine {
  key: string;
  label: string;
  paise: number;
  /** Share of income, 0-1. Null when there is no income to divide by. */
  share: number | null;
}

export interface SalaryBreakdown {
  incomePaise: number;
  /** Taken back out of savings in the window. */
  withdrawnPaise: number;
  /** Income plus withdrawals: everything that arrived to be spent. */
  availablePaise: number;
  /** Money that left, excluding savings. */
  spentPaise: number;
  savedPaise: number;
  /**
   * Income and withdrawals, minus everything recorded. Not "remaining": see the
   * module comment. Negative when recorded outgoings exceed what arrived.
   */
  unaccountedPaise: number;

  byCategory: BreakdownLine[];
  byIntent: {
    obligation: number;
    need: number;
    want: number;
    savings: number;
    unclassified: number;
  };

  /** Savings as a share of income. Null without income. */
  savingsRate: number | null;
  /** Obligations as a share of income — the "already spoken for" figure. */
  obligationShare: number | null;
  /** At least this share went on wants; unclassified spends may add to it. */
  wantsShareFloor: number | null;

  /** The headline. States the position; never scolds. */
  headline: string;
  observations: string[];
  hasIncome: boolean;
}

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
const pct = (share: number) => `${Math.round(share * 100)}%`;

export function whereDidItGo(input: SalaryInput): SalaryBreakdown {
  const income = input.incomePaise;
  const withdrawnPaise = input.withdrawnPaise ?? 0;
  const availablePaise = income + withdrawnPaise;
  const hasIncome = income > 0;
  const share = (paise: number) => (hasIncome ? paise / income : null);

  const byIntent = { obligation: 0, need: 0, want: 0, savings: 0, unclassified: 0 };
  const byCategoryMap = new Map<string, number>();

  for (const spend of input.spends) {
    const intent = intentFor(spend.category, spend.intent);
    if (intent === null) byIntent.unclassified += spend.amountPaise;
    else byIntent[intent] += spend.amountPaise;

    byCategoryMap.set(spend.category, (byCategoryMap.get(spend.category) ?? 0) + spend.amountPaise);
  }

  const savedPaise = byIntent.savings;
  const totalOut = input.spends.reduce((s, x) => s + x.amountPaise, 0);
  const spentPaise = totalOut - savedPaise;
  const unaccountedPaise = availablePaise - totalOut;

  const byCategory: BreakdownLine[] = [...byCategoryMap.entries()]
    .map(([key, paise]) => ({ key, label: categoryLabel(key), paise, share: share(paise) }))
    .sort((a, b) => b.paise - a.paise);

  const observations: string[] = [];

  if (hasIncome && byIntent.obligation > 0) {
    observations.push(
      `${pct(byIntent.obligation / income)} of what came in was already spoken for — rent, bills ` +
        `and the like — before you chose to spend anything.`,
    );
  }

  if (hasIncome && byIntent.want > 0) {
    const floor = `${rupees(byIntent.want)} (${pct(byIntent.want / income)})`;
    observations.push(
      byIntent.unclassified > 0
        ? `At least ${floor} went on wants. ${rupees(byIntent.unclassified)} is not classified, ` +
            `so the real figure may be higher.`
        : `${floor} went on wants.`,
    );
  }

  if (hasIncome && savedPaise > 0) {
    observations.push(`You set aside ${rupees(savedPaise)} — ${pct(savedPaise / income)} of your income.`);
  }

  if (withdrawnPaise > 0) {
    observations.push(
      `You took ${rupees(withdrawnPaise)} back out of savings. It is counted as money that arrived, ` +
        `not as income.`,
    );
  }

  // The largest single category is the most useful one-line answer to the
  // question as people actually ask it.
  const biggest = byCategory.find((line) => line.key !== 'savings');
  if (hasIncome && biggest) {
    observations.push(`Your largest single outgoing was ${biggest.label.toLowerCase()}, at ${rupees(biggest.paise)}.`);
  }

  return {
    incomePaise: income,
    withdrawnPaise,
    availablePaise,
    spentPaise,
    savedPaise,
    unaccountedPaise,
    byCategory,
    byIntent,
    savingsRate: share(savedPaise),
    obligationShare: share(byIntent.obligation),
    wantsShareFloor: share(byIntent.want),
    headline: headlineFor({
      income,
      withdrawnPaise,
      spentPaise,
      savedPaise,
      unaccountedPaise,
      hasIncome,
      spendCount: input.spends.length,
    }),
    observations,
    hasIncome,
  };
}

function headlineFor(input: {
  income: number;
  withdrawnPaise: number;
  spentPaise: number;
  savedPaise: number;
  unaccountedPaise: number;
  hasIncome: boolean;
  spendCount: number;
}): string {
  if (!input.hasIncome) {
    return input.spendCount === 0
      ? 'Record what came in this month and what went out, and this will show where it went.'
      : 'Record what came in this month and we can show what share of it each thing took.';
  }

  const available = input.income + input.withdrawnPaise;
  const arrived =
    input.withdrawnPaise > 0
      ? `${rupees(input.income)} came in and ${rupees(input.withdrawnPaise)} was taken from savings`
      : `${rupees(input.income)} came in`;

  if (input.unaccountedPaise < 0) {
    // Spending more than arrived is common and usually has an innocent
    // explanation — last month's money, savings drawn down, a bonus not yet
    // recorded. Say the arithmetic and stop.
    return (
      `${arrived}, and ${rupees(available - input.unaccountedPaise)} is recorded ` +
      `going out — ${rupees(Math.abs(input.unaccountedPaise))} more than arrived this month.`
    );
  }

  const parts = [`${rupees(input.spentPaise)} spent`];
  if (input.savedPaise > 0) parts.push(`${rupees(input.savedPaise)} saved`);

  const of =
    input.withdrawnPaise > 0
      ? `Of ${rupees(input.income)} income and ${rupees(input.withdrawnPaise)} taken from savings`
      : `Of ${rupees(input.income)}`;

  return (
    `${of}: ${parts.join(', ')}, and ${rupees(input.unaccountedPaise)} not ` +
    `accounted for — either still with you, or spent and not recorded here.`
  );
}

/* ------------------------------------------------------------------ */
/* Salary over time                                                    */
/* ------------------------------------------------------------------ */

export interface IncomeMonth {
  /** YYYY-MM. */
  month: string;
  paise: number;
}

export interface SalaryTrend {
  months: IncomeMonth[];
  /** Change from the first to the latest *complete* month, as a share. */
  change: number | null;
  message: string | null;
}

/**
 * How income has moved.
 *
 * Compares complete months only. The current month is usually partial — a
 * salary on the 1st and freelance on the 20th — and comparing a half-received
 * September against a full August reports a pay cut that has not happened.
 */
export function salaryTrend(incomes: { receivedOn: string; amountPaise: number }[], today: string): SalaryTrend {
  const byMonth = new Map<string, number>();
  for (const income of incomes) {
    const month = income.receivedOn.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + income.amountPaise);
  }

  const currentMonth = today.slice(0, 7);
  const months = [...byMonth.entries()]
    .map(([month, paise]) => ({ month, paise }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const complete = months.filter((m) => m.month < currentMonth);

  if (complete.length < 2) {
    return { months, change: null, message: null };
  }

  const first = complete[0];
  const last = complete[complete.length - 1];
  const change = (last.paise - first.paise) / first.paise;

  // A few percent either way is bonuses, deductions and rounding — not a trend
  // worth a sentence.
  if (Math.abs(change) < 0.05) {
    return { months, change, message: 'Your income has been steady.' };
  }

  return {
    months,
    change,
    message:
      change > 0
        ? `Income is up ${pct(change)} since ${monthName(first.month)} — from ${rupees(first.paise)} to ${rupees(last.paise)}.`
        : `Income is down ${pct(Math.abs(change))} since ${monthName(first.month)} — from ${rupees(first.paise)} to ${rupees(last.paise)}.`,
  };
}

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' });
}
