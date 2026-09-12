import type { CommitmentStatus } from '@/lib/engines/commitments';

/**
 * Deciding what is worth interrupting someone about.
 *
 * The default for every candidate here is silence. An app that notifies daily
 * gets its notifications turned off within a week, and then it cannot reach
 * the person even when something genuinely matters — so each rule below has to
 * earn its place against that cost, not against "would this be nice to know".
 *
 * Three tests a notification has to pass:
 *
 * 1. **Actionable.** There is something to do, now, that the person would
 *    otherwise miss. "Your rent is due in three days" passes. "You have logged
 *    food for five days running" does not: it is pleasant and changes nothing.
 * 2. **Timely.** It could not simply be seen next time they open the app.
 * 3. **Not already said.** Enforced by `dedupe_key` in the database rather
 *    than trusted to this code.
 */

export type NotificationKind = 'commitment_due' | 'commitment_overdue';

export interface PlannedNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  deepLink: string;
  /** Identity of the *event*, so the same one is never raised twice. */
  dedupeKey: string;
}

/** How far ahead a bill is worth mentioning. */
export const DUE_WARNING_DAYS = 3;

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

/**
 * What to raise about recurring commitments.
 *
 * Deliberately narrow. Only two situations qualify: something falls due within
 * a few days, or something is past its date and still unpaid. A bill due in
 * three weeks is not news.
 */
export function planCommitmentNotifications(
  statuses: CommitmentStatus[],
): PlannedNotification[] {
  const planned: PlannedNotification[] = [];

  for (const status of statuses) {
    // Nothing to say about something already settled.
    if (status.paid) continue;

    const { commitment } = status;

    if (status.overdue) {
      planned.push({
        kind: 'commitment_overdue',
        title: `${commitment.label} is past its date`,
        /*
         * Phrased to allow for the far likelier explanation.
         *
         * Most of the time the bill was paid and simply not recorded here.
         * Opening with "you have not paid" would be wrong more often than
         * right, and being told off for something you did do is how an app
         * loses someone's trust in one message.
         */
        body:
          `${rupees(commitment.amountPaise)} was due on the ${ordinal(commitment.dueDay)}. ` +
          `If you have already paid it, marking it keeps what is left accurate.`,
        deepLink: '/money',
        // The due date, not today's date: one notification per missed bill,
        // not one per day it stays unmarked.
        dedupeKey: `commitment-overdue:${commitment.id}:${status.dueOn}`,
      });
      continue;
    }

    if (status.daysUntilDue >= 0 && status.daysUntilDue <= DUE_WARNING_DAYS) {
      planned.push({
        kind: 'commitment_due',
        title:
          status.daysUntilDue === 0
            ? `${commitment.label} is due today`
            : `${commitment.label} is due in ${status.daysUntilDue} day${status.daysUntilDue === 1 ? '' : 's'}`,
        body: `${rupees(commitment.amountPaise)}, on the ${ordinal(commitment.dueDay)}.`,
        deepLink: '/money',
        dedupeKey: `commitment-due:${commitment.id}:${status.dueOn}`,
      });
    }
  }

  return planned;
}

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  return `${day}${{ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th'}`;
}
