'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Alert, Badge, Button, Section } from '@/components/ui';
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
 *
 * The week reads as a list on a phone and as seven columns from tablet up. A
 * seven-column grid squeezed onto a 320px screen puts two characters in each
 * cell, which is how a week planner becomes unreadable.
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
      <Section title="This week" meta={`${week.completedCount} of ${week.plannedCount} done`}>
        {/* Phone: one row per day. */}
        <ul className="space-y-2 md:hidden">
          {week.sessions.map((s) => (
            <li key={s.date || s.dayName} className="flex items-center gap-3 text-sm">
              <span
                className="w-9 shrink-0 font-semibold"
                style={{ color: s.isToday ? 'var(--primary-dark)' : 'var(--fg-subtle)' }}
              >
                {s.dayName}
              </span>
              <span className="flex-1">{s.label}</span>
              <StatusChip session={s} />
            </li>
          ))}
        </ul>

        {/* Tablet and up: the week as seven columns. */}
        <ul className="hidden gap-2 md:grid md:grid-cols-7">
          {week.sessions.map((s) => (
            <li
              key={s.date || s.dayName}
              className="flex flex-col gap-2 border p-3 text-center"
              style={{
                borderRadius: 'var(--radius-control)',
                borderColor: s.isToday ? 'var(--primary-border)' : 'var(--line)',
                background: s.isToday ? 'var(--primary-light)' : 'var(--surface)',
              }}
            >
              <span
                className="text-[13px] font-semibold"
                style={{ color: s.isToday ? 'var(--primary-dark)' : 'var(--fg-subtle)' }}
              >
                {s.dayName}
              </span>
              <span className="min-h-8 text-[13px] leading-snug">{s.label}</span>
              <span className="mt-auto flex justify-center">
                <StatusChip session={s} />
              </span>
            </li>
          ))}
        </ul>

        {error ? (
          <div className="mt-3">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
      </Section>

      {/* Missed sessions come before today's, because unresolved guilt about
          yesterday is what stops people starting today. */}
      {missed ? (
        <Section title={`You missed ${missed.dayName}`}>
          <MissedPanel
            session={missed}
            canSave={canSave}
            busy={pending && busyId === missed.id}
            onAction={(input) => missed.id && run(missed.id, input)}
          />
        </Section>
      ) : null}

      {today && today.kind !== 'rest' && today.status === 'planned' ? (
        <Section
          title={`Today: ${today.label}`}
          meta={today.plannedMinutes ? `${today.plannedMinutes} min` : undefined}
        >
          {/*
           * Completing today goes through the feedback form, not a bare
           * "Mark as done".
           *
           * Two reasons this stopped being a pair of buttons here. A plain
           * completion records no difficulty and no pain, so a user who always
           * pressed it would starve the progression engine of the only signal
           * it runs on — the plan would never adapt and nobody would know why.
           * And "I did some of it" wrote a hardcoded ten minutes, which is a
           * number nobody measured.
           *
           * One route to done, and it always captures the signal.
           */}
          <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            Finished it, or some of it? Record how it went — that rating is what decides your next
            session.
          </p>
          <a
            href="#how-did-it-go"
            className="mt-3 inline-flex min-h-11 items-center gap-2 px-4 text-sm font-medium transition-opacity duration-200 hover:opacity-90"
            style={{
              background: 'var(--primary)',
              color: 'var(--on-primary)',
              borderRadius: 'var(--radius-control)',
            }}
          >
            <Check size={16} aria-hidden /> Record how it went
          </a>

          {!canSave ? (
            <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
              Sign in and finish setup to track your sessions.
            </p>
          ) : null}
        </Section>
      ) : today?.kind === 'rest' ? (
        <Section title="Today: rest">
          <p className="measure text-sm leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
            Rest is part of the plan, not a gap in it. Your muscles adapt during recovery, not
            during the session. A gentle walk is fine if you want one.
          </p>
        </Section>
      ) : null}
    </>
  );
}

function StatusChip({ session }: { session: WeekSession }) {
  const { status, isToday, kind } = session;

  const config: { text: string; tone: 'neutral' | 'primary' | 'confirm' | 'signal' } =
    status === 'completed'
      ? { text: 'Done', tone: 'confirm' }
      : status === 'partial'
        ? { text: 'Partial', tone: 'confirm' }
        : status === 'skipped'
          ? { text: 'Skipped', tone: 'neutral' }
          : status === 'moved'
            ? { text: 'Moved', tone: 'neutral' }
            : status === 'rest' || kind === 'rest'
              ? { text: 'Rest', tone: 'neutral' }
              : isToday
                ? { text: 'Today', tone: 'primary' }
                : session.isPast
                  ? { text: 'Missed', tone: 'signal' }
                  : { text: 'Planned', tone: 'neutral' };

  return <Badge tone={config.tone}>{config.text}</Badge>;
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
  onAction: (input: {
    id: string;
    status: 'moved' | 'skipped' | 'partial';
    movedTo?: string;
    actualMinutes?: number;
  }) => void;
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
          <li key={s} className="flex gap-2.5 text-sm" style={{ color: 'var(--fg-muted)' }}>
            <span aria-hidden style={{ color: 'var(--fg-subtle)' }}>
              —
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
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
          /* No `actualMinutes` here. It used to write a flat 10, which is a
             duration nobody measured — and it would then be read back as if it
             were recorded fact. Marking it partial is the honest claim; the
             real length is captured by the feedback form if the user gives it. */
          onClick={() => onAction({ id: session.id!, status: 'partial' })}
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
      <p className="mt-4 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        There is no option to double up tomorrow, and that is deliberate. Trying to make up missed
        sessions reliably leads to more missed sessions.
      </p>
    </>
  );
}
