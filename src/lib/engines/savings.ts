import { formatRupees } from '@/lib/engines/money';

/**
 * Savings goals: how far along, what it takes, and — only once there is
 * enough history to say — how the actual pace compares.
 *
 * ## A goal is a plan; the ledger is spends
 *
 * Money added to a goal is an ordinary spend filed as savings and carrying
 * `savings_goal_id`, the same way paying a bill carries `commitment_id`. This
 * file never sees a stored balance, so a goal's total cannot drift away from
 * the records it is built from.
 *
 * Taking money back out is the one thing that is not a spend: it is a row in
 * `savings_withdrawals`, because money leaving savings is neither spending nor
 * income. What a goal holds is the opening balance, plus what went in, minus
 * what came out.
 *
 * ## What it refuses to guess
 *
 * A pace needs history. One deposit in the week a goal was created is not a
 * monthly habit, and a finish date projected from it would state a guess as a
 * forecast. So the average is taken only over *full calendar months* since the
 * goal began — the month it was created and the current month are both
 * partial and left out, the same rule `salaryTrend` applies to income — and
 * with fewer than two such months there is no average and no projected date.
 *
 * ## One model for "needs" and "likely"
 *
 * Contributions are assumed once a month, starting next month; whatever was
 * added this month is already in the saved total. The monthly amount a date
 * needs and the month the usual pace reaches are both worked out on that
 * basis, so "on track" and "₹X a month more" cannot contradict each other.
 */

export const MIN_FULL_MONTHS = 2;

export interface SavingsGoal {
  id: string;
  label: string;
  targetPaise: number;
  /** Saved before the goal was recorded here. Not a contribution. */
  openingPaise: number;
  /** YYYY-MM-DD. */
  startedOn: string;
  /** YYYY-MM-DD, or null for a goal with no deadline. */
  targetDate: string | null;
}

export interface Contribution {
  amountPaise: number;
  /** YYYY-MM-DD. */
  spentOn: string;
}

export interface Withdrawal {
  amountPaise: number;
  /** YYYY-MM-DD. */
  withdrawnOn: string;
}

export interface GoalProgress {
  goal: SavingsGoal;
  /** Every contribution ever made, excluding the opening balance. */
  contributedPaise: number;
  withdrawnPaise: number;
  /** Opening + contributed − withdrawn, never below zero. What can be taken out. */
  savedPaise: number;
  remainingPaise: number;
  /** 0-1, capped at 1. */
  share: number;
  reached: boolean;
  /** The target date is before today and the goal is not reached. */
  pastDate: boolean;
  /** What each month from next month to the target month needs. Null without a future date, or once reached. */
  requiredMonthlyPaise: number | null;
  /**
   * What stayed in, averaged over full months: contributions minus withdrawals.
   * Negative when more came out than went in. Null until there are
   * MIN_FULL_MONTHS of them.
   */
  averageMonthlyPaise: number | null;
  /** How many full calendar months the goal has existed for. */
  fullMonths: number;
  /** YYYY-MM the usual pace reaches the target. Null without a pace, at a pace of zero, or once reached. */
  projectedMonth: string | null;
  /** Whether the projection meets the target date. Null when either is unknown. */
  onTrack: boolean | null;
  /** Required minus average, when both are known. Positive means more is needed each month. */
  gapMonthlyPaise: number | null;
  message: string;
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

const monthFromIndex = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const dateLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** An average is not exact; it is shown to the rupee, never to the paisa. */
const about = (paise: number) => formatRupees(Math.round(paise / 100) * 100);

export function goalProgress(
  goal: SavingsGoal,
  contributions: Contribution[],
  today: string,
  withdrawals: Withdrawal[] = [],
): GoalProgress {
  const contributedPaise = contributions.reduce((sum, c) => sum + c.amountPaise, 0);
  const withdrawnPaise = withdrawals.reduce((sum, w) => sum + w.amountPaise, 0);
  // Can only go negative if a contribution was removed after money was taken
  // out against it. The records say less than nothing; the goal holds nothing.
  const savedPaise = Math.max(0, goal.openingPaise + contributedPaise - withdrawnPaise);
  const remainingPaise = Math.max(0, goal.targetPaise - savedPaise);
  const reached = savedPaise >= goal.targetPaise;
  const share = Math.min(1, savedPaise / goal.targetPaise);

  const current = monthIndex(today);

  // The first month the goal existed for the whole of.
  const firstFull = monthIndex(goal.startedOn) + (goal.startedOn.endsWith('-01') ? 0 : 1);
  const fullMonths = Math.max(0, current - firstFull);

  const inFullMonth = (date: string) => {
    const month = monthIndex(date);
    return month >= firstFull && month < current;
  };

  let averageMonthlyPaise: number | null = null;
  if (fullMonths >= MIN_FULL_MONTHS) {
    const wentIn = contributions
      .filter((c) => inFullMonth(c.spentOn))
      .reduce((sum, c) => sum + c.amountPaise, 0);
    const cameOut = withdrawals
      .filter((w) => inFullMonth(w.withdrawnOn))
      .reduce((sum, w) => sum + w.amountPaise, 0);
    averageMonthlyPaise = Math.round((wentIn - cameOut) / fullMonths);
  }

  const pastDate = !reached && goal.targetDate !== null && goal.targetDate < today;

  let requiredMonthlyPaise: number | null = null;
  if (!reached && goal.targetDate !== null && !pastDate) {
    const monthsLeft = Math.max(1, monthIndex(goal.targetDate) - current);
    requiredMonthlyPaise = Math.ceil(remainingPaise / monthsLeft / 100) * 100;
  }

  const projectedMonth =
    !reached && averageMonthlyPaise !== null && averageMonthlyPaise > 0
      ? monthFromIndex(current + Math.ceil(remainingPaise / averageMonthlyPaise))
      : null;

  const onTrack =
    projectedMonth !== null && goal.targetDate !== null && !pastDate
      ? monthIndex(projectedMonth) <= Math.max(current + 1, monthIndex(goal.targetDate))
      : null;

  const gapMonthlyPaise =
    requiredMonthlyPaise !== null && averageMonthlyPaise !== null
      ? requiredMonthlyPaise - averageMonthlyPaise
      : null;

  const progress = {
    goal,
    contributedPaise,
    withdrawnPaise,
    savedPaise,
    remainingPaise,
    share,
    reached,
    pastDate,
    requiredMonthlyPaise,
    averageMonthlyPaise,
    fullMonths,
    projectedMonth,
    onTrack,
    gapMonthlyPaise,
  };

  return { ...progress, message: messageFor(progress) };
}

/**
 * What to say. States the position and the arithmetic; never a verdict on the
 * person. A pace that falls short is a number of rupees a month, not a failing.
 */
function messageFor(p: Omit<GoalProgress, 'message'>): string {
  if (p.reached) {
    return `Reached — ${formatRupees(p.savedPaise)} saved towards ${formatRupees(p.goal.targetPaise)}.`;
  }

  const toGo = `${formatRupees(p.remainingPaise)} to go`;
  const passed = `The date you set has passed, with ${toGo}.`;
  const byDate = p.goal.targetDate ? dateLabel(p.goal.targetDate) : '';

  if (p.averageMonthlyPaise === null) {
    const later = 'After two full months of adding to it, this will show when you are likely to get there.';
    if (p.pastDate) return `${passed} ${later}`;
    if (p.requiredMonthlyPaise !== null) {
      return (
        `${toGo}. About ${formatRupees(p.requiredMonthlyPaise)} a month would get there by ${byDate}. ` +
        `After two full months of adding to it, this will also show how your actual pace compares.`
      );
    }
    return `${toGo}. ${later}`;
  }

  if (p.averageMonthlyPaise === 0 || p.projectedMonth === null) {
    const nothing =
      p.averageMonthlyPaise < 0
        ? `More has come out than gone in over the ${p.fullMonths} full months since this goal began.`
        : `Nothing has been added in the ${p.fullMonths} full months since this goal began.`;
    if (p.pastDate) return `${passed} ${nothing}`;
    if (p.requiredMonthlyPaise !== null) {
      return `${nothing} About ${formatRupees(p.requiredMonthlyPaise)} a month would get there by ${byDate}.`;
    }
    return `${toGo}. ${nothing}`;
  }

  const pace = `You have been adding about ${about(p.averageMonthlyPaise)} a month`;
  const likely = monthLabel(p.projectedMonth);

  if (p.pastDate) return `${passed} ${pace} — at that pace, around ${likely}.`;
  if (p.requiredMonthlyPaise === null) return `${toGo}. ${pace} — at that pace, around ${likely}.`;

  if (p.onTrack) {
    return `${pace}, which gets you there by ${byDate} — around ${likely} at that pace.`;
  }

  return (
    `${pace}. Getting there by ${byDate} takes about ${formatRupees(p.requiredMonthlyPaise)} a month — ` +
    `${about(p.gapMonthlyPaise ?? 0)} more. At your current pace, around ${likely}.`
  );
}
