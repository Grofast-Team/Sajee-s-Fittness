'use client';

import { useState, useTransition } from 'react';
import { Check, CircleAlert, Loader2 } from 'lucide-react';
import { Button, Card, CardTitle } from '@/components/ui';
import { updateSession } from '@/lib/actions/training';
import { recoveryPlan } from '@/lib/engines/adherence';
import type { WeekSession, WeekView } from '@/lib/data/week';

/**
 * The week grid and today's session controls.
 *
 * The missed-session panel is the important part. It offers moving, shortening,
 * or letting it go — and never a double session to make up for it. Compensation
 * behaviour is the mechanism that turns one missed day into an abandoned month,
 * so the option simply does not exist in the UI.
 */
export function WeekPlan({ week, canSave }: { week: WeekView; canSave: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(id: string, input: Parameters<typeof updateSession>[0]) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await updateSession(input);
      if (!result.ok) setError(result.error);
      setBusyId(null);
    });
  }

  const today = week.todaySession;
  const missed = week.missed[0] ?? null;

  return (
    <>
      <Card>
        <CardTitle hint={`${week.completedCount} of ${week.plannedCount} done`}>This week</CardTitle>

        <ul className="space-y-1.5">
          {week.sessions.map((s) => (
            <li key={s.date || s.dayName} className="flex items-center gap-3 text-sm">
              <span
                className="w-9 shrink-0 font-medium"
                style={{ color: s.isToday ? 'var(--primary)' : 'var(--fg-subtle)' }}
              >
                {s.dayName}
              </span>
              <span className="flex-1">{s.label}</span>
              <StatusChip session={s} />
            </li>
          ))}
        </ul>

        {error ? (
          <p role="alert" className="mt-3 flex items-start gap-2 text-sm" style={{ color: '#b91c1c' }}>
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
      </Card>

      {/* Missed sessions come before today's, because unresolved guilt about
          yesterday is what stops people starting today. */}
      {missed ? (
        <Card>
          <CardTitle>You missed {missed.dayName}</CardTitle>
          <MissedPanel
            session={missed}
            canSave={canSave}
            busy={pending && busyId === missed.id}
            onAction={(input) => missed.id && run(missed.id, input)}
          />
        </Card>
      ) : null}

      {today && today.kind !== 'rest' && today.status === 'planned' ? (
        <Card>
          <CardTitle hint={today.plannedMinutes ? `${today.plannedMinutes} min` : undefined}>
            Today: {today.label}
          </CardTitle>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canSave || (pending && busyId === today.id)}
              onClick={() =>
                today.id &&
                run(today.id, {
                  id: today.id,
                  status: 'completed',
                  actualMinutes: today.plannedMinutes ?? undefined,
                })
              }
            >
              {pending && busyId === today.id ? (
                <>
                  <Loader2 size={18} className="animate-spin" aria-hidden /> Saving…
                </>
              ) : (
                <>
                  <Check size={18} aria-hidden /> Mark as done
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              disabled={!canSave || pending}
              onClick={() =>
                today.id && run(today.id, { id: today.id, status: 'partial', actualMinutes: 10 })
              }
            >
              I did some of it
            </Button>
          </div>

          {!canSave ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--fg-subtle)' }}>
              Sign in and finish setup to track your sessions.
            </p>
          ) : null}
        </Card>
      ) : today?.kind === 'rest' ? (
        <Card>
          <CardTitle>Today: rest</CardTitle>
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Rest is part of the plan, not a gap in it. Your muscles adapt during recovery, not
            during the session. A gentle walk is fine if you want one.
          </p>
        </Card>
      ) : null}
    </>
  );
}

function StatusChip({ session }: { session: WeekSession }) {
  const { status, isToday, kind } = session;

  const config =
    status === 'completed'
      ? { text: 'Done', bg: 'rgb(5 150 105 / 0.12)', fg: 'var(--accent)' }
      : status === 'partial'
        ? { text: 'Partial', bg: 'rgb(5 150 105 / 0.10)', fg: 'var(--accent)' }
        : status === 'skipped'
          ? { text: 'Skipped', bg: 'var(--surface-2)', fg: 'var(--fg-subtle)' }
          : status === 'moved'
            ? { text: 'Moved', bg: 'var(--surface-2)', fg: 'var(--fg-subtle)' }
            : status === 'rest' || kind === 'rest'
              ? { text: 'Rest', bg: 'var(--surface-2)', fg: 'var(--fg-subtle)' }
              : isToday
                ? { text: 'Today', bg: 'rgb(8 145 178 / 0.14)', fg: 'var(--primary)' }
                : session.isPast
                  ? { text: 'Missed', bg: 'rgb(245 158 11 / 0.14)', fg: '#b45309' }
                  : { text: 'Planned', bg: 'var(--surface-2)', fg: 'var(--fg-subtle)' };

  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: config.bg, color: config.fg }}
    >
      {config.text}
    </span>
  );
}

function MissedPanel({
  session,
  canSave,
  busy,
  onAction,
}: {
  session: WeekSession;
  canSave: boolean;
  busy: boolean;
  onAction: (input: { id: string; status: 'moved' | 'skipped' | 'partial'; movedTo?: string; actualMinutes?: number }) => void;
}) {
  const recovery = recoveryPlan(1);

  // Computed at click time rather than at render: reading the clock during
  // render is impure, and a page left open overnight would otherwise reschedule
  // to a date that is no longer tomorrow.
  const tomorrowIso = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  return (
    <>
      <p className="text-sm font-medium">{recovery.headline}</p>
      <ul className="mt-2 space-y-1.5">
        {recovery.steps.map((s) => (
          <li key={s} className="flex gap-2 text-sm" style={{ color: 'var(--fg-muted)' }}>
            <span aria-hidden>·</span>
            <span>{s}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="ghost"
          disabled={!canSave || busy}
          onClick={() => onAction({ id: session.id!, status: 'moved', movedTo: tomorrowIso() })}
        >
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
          Move it to tomorrow
        </Button>
        <Button
          variant="ghost"
          disabled={!canSave || busy}
          onClick={() => onAction({ id: session.id!, status: 'partial', actualMinutes: 10 })}
        >
          Do a short version today
        </Button>
        <Button
          variant="quiet"
          disabled={!canSave || busy}
          onClick={() => onAction({ id: session.id!, status: 'skipped' })}
        >
          Let it go
        </Button>
      </div>

      {/* Stated explicitly, because "make it up" is the instinct and it is the
          wrong one. */}
      <p className="mt-3 text-xs" style={{ color: 'var(--fg-subtle)' }}>
        There is no option to double up tomorrow, and that is deliberate. Trying to make up missed
        sessions reliably leads to more missed sessions.
      </p>
    </>
  );
}
