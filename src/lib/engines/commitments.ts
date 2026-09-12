/**
 * Money already promised, and what that leaves genuinely free.
 *
 * The month summary answers "what has gone out". For someone living alone the
 * question that actually decides a Tuesday evening is different: **what is
 * left after what I still owe.** Eleven days in, ₹8,000 spent against a
 * ₹25,000 month looks like ₹17,000 of freedom — and if ₹12,000 of rent is
 * still due, it is nearer ₹5,000. A screen that implies the larger number is
 * not neutral; it actively encourages the overspend it will later report.
 *
 * So this separates three things that a single "remaining" figure runs
 * together:
 *
 * - **Spent** — money gone, from the ledger.
 * - **Committed** — money promised and not yet paid this period.
 * - **Free** — what is actually available to decide about.
 */

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Commitment {
  id: string;
  label: string;
  amountPaise: number;
  category: string;
  cadence: Cadence;
  dueDay: number;
  startedOn: string;
  endedOn: string | null;
  note: string | null;
}

export interface CommitmentStatus {
  commitment: Commitment;
  /** Paid within the current window, from the ledger. */
  paid: boolean;
  paidPaise: number;
  /** The date it falls due inside this window. */
  dueOn: string;
  /** Negative once the date has passed. */
  daysUntilDue: number;
  overdue: boolean;
}

export interface CommitmentSummary {
  statuses: CommitmentStatus[];
  /** Everything due in this window, paid or not. */
  dueThisPeriodPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  /**
   * What is left once the outstanding commitments are set aside.
   * Null when no monthly amount has been set — there is nothing to be free of.
   */
  freePaise: number | null;
  /** Free money spread over the days remaining. Null for the same reason. */
  freePerDayPaise: number | null;
  /** Plain-language summary. States the position; never scolds. */
  message: string;
  /** Due within this many days and still unpaid. */
  dueSoon: CommitmentStatus[];
  overdue: CommitmentStatus[];
}

/** How close a due date has to be before it is worth surfacing. */
export const DUE_SOON_DAYS = 5;

const DAY_MS = 86_400_000;

/**
 * Does this commitment fall due in the window at all?
 *
 * A yearly insurance premium is a real commitment eleven months of the year
 * and irrelevant to *this* month's arithmetic. Counting it every month would
 * make someone look permanently broke; counting it in no month would let it
 * arrive as a surprise. It counts in the month it actually lands.
 */
function occursInWindow(
  commitment: Commitment,
  windowStart: Date,
  windowEnd: Date,
): Date | null {
  const started = new Date(`${commitment.startedOn}T00:00:00Z`);
  const ended = commitment.endedOn ? new Date(`${commitment.endedOn}T00:00:00Z`) : null;

  // Walk candidate due dates through the window. A window is at most ~31 days,
  // so this is a handful of iterations even for a weekly commitment.
  for (let t = windowStart.getTime(); t < windowEnd.getTime(); t += DAY_MS) {
    const day = new Date(t);
    if (day < started) continue;
    if (ended && day > ended) continue;

    if (commitment.cadence === 'weekly') {
      // Weekly commitments recur from their start date.
      const weeksSince = Math.round((day.getTime() - started.getTime()) / (7 * DAY_MS));
      const expected = new Date(started.getTime() + weeksSince * 7 * DAY_MS);
      if (sameDay(day, expected)) return day;
      continue;
    }

    if (day.getUTCDate() !== commitment.dueDay) continue;

    if (commitment.cadence === 'monthly') return day;

    // Quarterly and yearly land on the same day-of-month, in months that line
    // up with the month the commitment began.
    const monthsSince =
      (day.getUTCFullYear() - started.getUTCFullYear()) * 12 +
      (day.getUTCMonth() - started.getUTCMonth());

    if (commitment.cadence === 'quarterly' && monthsSince % 3 === 0) return day;
    if (commitment.cadence === 'yearly' && monthsSince % 12 === 0) return day;
  }

  return null;
}

const sameDay = (a: Date, b: Date) =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth() &&
  a.getUTCDate() === b.getUTCDate();

export interface CommitmentInput {
  commitments: Commitment[];
  /** Paise already paid against each commitment id inside the window. */
  paidByCommitment: Record<string, number>;
  windowStart: string;
  /** Exclusive. */
  windowEnd: string;
  today: string;
  /** The month's planned amount, in paise. Null when never set. */
  limitPaise: number | null;
  /** Everything spent in the window so far, including paid commitments. */
  spentPaise: number;
  daysLeft: number;
}

export function summariseCommitments(input: CommitmentInput): CommitmentSummary {
  const start = new Date(`${input.windowStart}T00:00:00Z`);
  const end = new Date(`${input.windowEnd}T00:00:00Z`);
  const today = new Date(`${input.today}T00:00:00Z`);

  const statuses: CommitmentStatus[] = [];

  for (const commitment of input.commitments) {
    const dueDate = occursInWindow(commitment, start, end);
    if (!dueDate) continue;

    const paidPaise = input.paidByCommitment[commitment.id] ?? 0;

    /*
     * Paid is a threshold, not an equality.
     *
     * A ₹12,000 rent settled as ₹11,950 by bank transfer is paid. Requiring an
     * exact match would leave it showing as outstanding for the rest of the
     * month, and the whole point of this panel is that the outstanding figure
     * can be trusted.
     */
    const paid = paidPaise >= commitment.amountPaise * 0.95;
    const daysUntilDue = Math.round((dueDate.getTime() - today.getTime()) / DAY_MS);

    statuses.push({
      commitment,
      paid,
      paidPaise,
      dueOn: dueDate.toISOString().slice(0, 10),
      daysUntilDue,
      overdue: !paid && daysUntilDue < 0,
    });
  }

  statuses.sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  const dueThisPeriodPaise = statuses.reduce((s, x) => s + x.commitment.amountPaise, 0);
  const paidPaise = statuses.filter((s) => s.paid).reduce((s, x) => s + x.commitment.amountPaise, 0);
  const outstandingPaise = dueThisPeriodPaise - paidPaise;

  /*
   * Free money.
   *
   * `spentPaise` already includes any commitment that has been paid, because
   * paying one writes an ordinary spend. Subtracting only the *outstanding*
   * amount is therefore correct — subtracting the full due figure would
   * double-count everything already settled.
   */
  const freePaise =
    input.limitPaise === null ? null : input.limitPaise - input.spentPaise - outstandingPaise;

  const freePerDayPaise =
    freePaise === null ? null : Math.floor(freePaise / Math.max(1, input.daysLeft));

  const overdue = statuses.filter((s) => s.overdue);
  const dueSoon = statuses.filter(
    (s) => !s.paid && !s.overdue && s.daysUntilDue <= DUE_SOON_DAYS,
  );

  return {
    statuses,
    dueThisPeriodPaise,
    paidPaise,
    outstandingPaise,
    freePaise,
    freePerDayPaise,
    message: messageFor({ statuses, outstandingPaise, freePaise, freePerDayPaise, overdue }),
    dueSoon,
    overdue,
  };
}

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

/**
 * What to say about the position.
 *
 * A negative figure is stated as a fact and paired with the arithmetic, not
 * with an instruction. Someone whose commitments exceed their planned amount
 * usually knows; what they need is the number, not a telling-off.
 */
function messageFor(input: {
  statuses: CommitmentStatus[];
  outstandingPaise: number;
  freePaise: number | null;
  freePerDayPaise: number | null;
  overdue: CommitmentStatus[];
}): string {
  if (input.statuses.length === 0) {
    return 'Nothing recurring set up yet. Adding your rent and bills makes the "what is left" figure mean something.';
  }

  if (input.outstandingPaise === 0) {
    return input.freePaise === null
      ? 'Everything due this month is paid.'
      : `Everything due this month is paid. ${rupees(input.freePaise)} of your plan is left.`;
  }

  const owed = `${rupees(input.outstandingPaise)} still to go out this month`;

  if (input.freePaise === null) {
    return `${owed}. Set a monthly amount and we can show what that leaves free.`;
  }

  if (input.freePaise < 0) {
    return (
      `${owed}, which is ${rupees(Math.abs(input.freePaise))} more than your plan covers. ` +
      `Worth knowing now rather than at the end of the month.`
    );
  }

  const perDay =
    input.freePerDayPaise === null ? '' : ` — about ${rupees(input.freePerDayPaise)} a day.`;

  return `${owed}, leaving ${rupees(input.freePaise)} free${perDay}`;
}
