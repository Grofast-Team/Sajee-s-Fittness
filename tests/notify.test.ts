import { describe, expect, it } from 'vitest';
import { planCommitmentNotifications, DUE_WARNING_DAYS } from '@/lib/engines/notify';
import type { Commitment, CommitmentStatus } from '@/lib/engines/commitments';

const rent: Commitment = {
  id: 'rent-1',
  label: 'Rent',
  amountPaise: 1_200_000,
  category: 'rent',
  cadence: 'monthly',
  dueDay: 5,
  startedOn: '2026-01-01',
  endedOn: null,
  note: null,
};

const status = (over: Partial<CommitmentStatus> = {}): CommitmentStatus => ({
  commitment: rent,
  paid: false,
  paidPaise: 0,
  dueOn: '2026-09-05',
  daysUntilDue: 2,
  overdue: false,
  ...over,
});

describe('planCommitmentNotifications', () => {
  it('raises one for a bill falling due shortly', () => {
    const planned = planCommitmentNotifications([status()]);
    expect(planned).toHaveLength(1);
    expect(planned[0].title).toMatch(/due in 2 days/i);
  });

  it('says nothing about a bill still weeks away', () => {
    // The default is silence. An app that notifies daily gets muted, and then
    // cannot reach anyone when it matters.
    expect(planCommitmentNotifications([status({ daysUntilDue: 20 })])).toHaveLength(0);
  });

  it('says nothing about something already paid', () => {
    expect(
      planCommitmentNotifications([status({ paid: true, daysUntilDue: 1 })]),
    ).toHaveLength(0);
  });

  it('handles the day it falls due', () => {
    const planned = planCommitmentNotifications([status({ daysUntilDue: 0 })]);
    expect(planned[0].title).toMatch(/due today/i);
  });

  it('raises a different kind once the date has passed', () => {
    const planned = planCommitmentNotifications([
      status({ overdue: true, daysUntilDue: -4 }),
    ]);
    expect(planned[0].kind).toBe('commitment_overdue');
  });

  /*
   * The wording matters more than it looks. Most of the time an "overdue" bill
   * was paid and simply not recorded here, so opening with "you have not paid"
   * would be wrong more often than right.
   */
  it('does not accuse someone of missing a payment they may have made', () => {
    const planned = planCommitmentNotifications([status({ overdue: true, daysUntilDue: -4 })]);
    const text = `${planned[0].title} ${planned[0].body}`.toLowerCase();

    expect(text).toMatch(/if you have already paid/);
    expect(text).not.toMatch(/you have not paid|you missed|you forgot|late fee/);
  });

  it('keys dedupe on the due date, not on today', () => {
    // Otherwise a daily job raises the same overdue bill every morning.
    const monday = planCommitmentNotifications([status({ overdue: true, daysUntilDue: -1 })]);
    const friday = planCommitmentNotifications([status({ overdue: true, daysUntilDue: -5 })]);

    expect(monday[0].dedupeKey).toBe(friday[0].dedupeKey);
  });

  it('treats next month as a genuinely new event', () => {
    const september = planCommitmentNotifications([status({ dueOn: '2026-09-05' })]);
    const october = planCommitmentNotifications([status({ dueOn: '2026-10-05' })]);

    expect(september[0].dedupeKey).not.toBe(october[0].dedupeKey);
  });

  it('does not raise both a warning and an overdue notice for one bill', () => {
    const planned = planCommitmentNotifications([status({ overdue: true, daysUntilDue: -1 })]);
    expect(planned).toHaveLength(1);
  });

  it('respects the warning window exactly at its edge', () => {
    expect(planCommitmentNotifications([status({ daysUntilDue: DUE_WARNING_DAYS })])).toHaveLength(1);
    expect(
      planCommitmentNotifications([status({ daysUntilDue: DUE_WARNING_DAYS + 1 })]),
    ).toHaveLength(0);
  });

  it('writes ordinals a person would actually say', () => {
    const on = (dueDay: number) =>
      planCommitmentNotifications([status({ commitment: { ...rent, dueDay } })])[0].body;

    expect(on(1)).toContain('1st');
    expect(on(2)).toContain('2nd');
    expect(on(3)).toContain('3rd');
    expect(on(4)).toContain('4th');
    // The exception everyone's first implementation gets wrong.
    expect(on(11)).toContain('11th');
    expect(on(12)).toContain('12th');
    expect(on(13)).toContain('13th');
    expect(on(21)).toContain('21st');
  });
});
