import { PAID_THRESHOLD } from '@/lib/engines/commitments';
import { formatRupees, type SpendCategory } from '@/lib/engines/money';

/**
 * What an edit to a recorded spend means.
 *
 * The database decides what an edit is *allowed* to do. This decides what it
 * *does*: which fields really changed, and whether the change has a
 * consequence the person should hear about before they see it somewhere else —
 * a rent payment edited down to ₹5,000 leaves the rent unpaid, and the daily
 * job will raise an overdue reminder the next morning.
 */

export type SpendIntent = 'need' | 'want' | 'obligation' | 'savings';

export interface ExistingSpend {
  id: string;
  amountPaise: number;
  category: SpendCategory;
  note: string | null;
  /** YYYY-MM-DD. */
  spentOn: string;
  intent: SpendIntent | null;
  commitmentId: string | null;
  /** Set when this spend was money added to a savings goal. Always savings. */
  savingsGoalId: string | null;
}

export interface SpendChange {
  amountPaise?: number;
  category?: SpendCategory;
  note?: string | null;
  spentOn?: string;
  intent?: SpendIntent | null;
}

export interface LinkedCommitment {
  label: string;
  amountPaise: number;
  /** Paid against the commitment in the same window by other spends. */
  otherPaidPaise: number;
}

export type SpendEditPlan =
  | { ok: true; changed: false }
  | { ok: true; changed: true; patch: SpendChange; warning: string | null }
  | { ok: false; error: string };

export function planSpendEdit(
  existing: ExistingSpend,
  change: SpendChange,
  linked: LinkedCommitment | null,
): SpendEditPlan {
  const patch: SpendChange = {};

  if (change.amountPaise !== undefined) {
    if (!Number.isInteger(change.amountPaise) || change.amountPaise <= 0) {
      return { ok: false, error: 'Enter an amount greater than zero.' };
    }
    if (change.amountPaise !== existing.amountPaise) patch.amountPaise = change.amountPaise;
  }

  if (change.category !== undefined && change.category !== existing.category) {
    if (existing.commitmentId !== null) {
      const bill = linked ? linked.label : 'a recurring bill';
      return {
        ok: false,
        error: `This payment settled ${bill}, so it stays filed with it. To file it differently, remove it and record it again.`,
      };
    }

    if (existing.savingsGoalId !== null) {
      return {
        ok: false,
        error:
          'This went into a savings goal, so it stays filed as savings. To file it differently, remove it and record it again.',
      };
    }

    patch.category = change.category;

    // A need/want choice answered a question about the old category. Carried
    // onto a new one it would silently decide that category's classification,
    // so it is cleared unless this same edit makes the choice again.
    if (change.intent === undefined && existing.intent !== null) patch.intent = null;
  }

  if (change.note !== undefined) {
    const note = change.note === null ? null : change.note.trim() || null;
    if (note !== existing.note) patch.note = note;
  }

  if (change.spentOn !== undefined && change.spentOn !== existing.spentOn) {
    patch.spentOn = change.spentOn;
  }

  if (change.intent !== undefined && change.intent !== existing.intent) {
    patch.intent = change.intent;
  }

  if (Object.keys(patch).length === 0) return { ok: true, changed: false };

  return { ok: true, changed: true, patch, warning: warningFor(existing, patch, linked) };
}

function warningFor(
  existing: ExistingSpend,
  patch: SpendChange,
  linked: LinkedCommitment | null,
): string | null {
  if (existing.commitmentId === null || linked === null) return null;

  const threshold = linked.amountPaise * PAID_THRESHOLD;
  const before = linked.otherPaidPaise + existing.amountPaise;
  const after = linked.otherPaidPaise + (patch.amountPaise ?? existing.amountPaise);

  if (before >= threshold && after < threshold) {
    return (
      `${linked.label} will show as not fully paid: ` +
      `${formatRupees(after)} of ${formatRupees(linked.amountPaise)} recorded.`
    );
  }

  // Month-level rather than exact money-month, which depends on the user's
  // start day — hence "may".
  if (patch.spentOn !== undefined && patch.spentOn.slice(0, 7) !== existing.spentOn.slice(0, 7)) {
    return `This payment settled ${linked.label}. In another month it may no longer count as paid for this one.`;
  }

  return null;
}
