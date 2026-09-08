'use client';

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { inputClass, inputStyle } from '@/components/ui';
import {
  ACTIVITIES,
  DAY_SLOTS,
  GROUP_LABELS,
  activitiesByGroup,
  derivePalFromDay,
  type DayEntry,
  type DaySlot,
} from '@/lib/engines/day-map';

/**
 * "Walk me through a normal day."
 *
 * This replaces asking someone to pick their own activity level. People answer
 * that question with their self-image — a homemaker on her feet for nine hours
 * says "not very active" because she does not go to a gym — and the whole
 * calorie target is built on top of the answer.
 *
 * Describing a day instead is more work for the user, so the design has to earn
 * it: quick picks per part of the day, minutes not clock times, a running total
 * of what is accounted for, and the activity level updating live so the effort
 * visibly pays off rather than disappearing into a form.
 */

const QUICK_MINUTES = [15, 30, 60, 120, 240, 480];

/** Sensible first suggestions per slot, so nobody starts at a blank list. */
const SUGGESTED: Record<DaySlot, string[]> = {
  early_morning: ['sleeping', 'cooking', 'eating', 'walking_slow'],
  morning: ['passenger', 'driving', 'two_wheeler', 'walking_brisk', 'desk_work', 'cleaning'],
  midday: ['desk_work', 'standing_work', 'heavy_manual', 'eating', 'shopping'],
  afternoon: ['desk_work', 'standing_work', 'childcare', 'light_manual', 'walking_slow'],
  evening: ['cooking', 'sitting_screen', 'childcare', 'walking_brisk', 'strength', 'dishes'],
  night: ['sitting_screen', 'sleeping', 'lying_awake'],
};

const BY_ID = new Map(ACTIVITIES.map((a) => [a.id, a]));

export function DayMapBuilder({
  value,
  onChange,
}: {
  value: DayEntry[] | undefined;
  onChange: (entries: DayEntry[]) => void;
}) {
  const entries = useMemo(() => value ?? [], [value]);
  const [openSlot, setOpenSlot] = useState<DaySlot>('early_morning');

  const result = useMemo(() => derivePalFromDay(entries), [entries]);
  const grouped = useMemo(() => activitiesByGroup(), []);

  function add(slot: DaySlot, activityId: string, minutes: number) {
    onChange([...entries, { slot, activityId, minutes }]);
  }

  function remove(index: number) {
    onChange(entries.filter((_, i) => i !== index));
  }

  function setMinutes(index: number, minutes: number) {
    onChange(entries.map((e, i) => (i === index ? { ...e, minutes } : e)));
  }

  return (
    <div>
      {/*
       * The running total leads.
       *
       * It is the only thing that tells someone how much more of this there is
       * to do, and without it a six-part form feels unbounded.
       */}
      <div
        className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3.5"
        style={{ background: 'var(--ground)', borderRadius: 'var(--radius-control)' }}
      >
        <span className="text-sm font-medium">
          {result.accountedHours < 24
            ? `${result.accountedHours} of about 24 hours described`
            : 'Your whole day is described'}
        </span>
        <span className="text-[13px]" style={{ color: 'var(--fg-muted)' }}>
          {result.insufficient ? 'Keep going — a few more blocks' : result.levelLabel}
        </span>
      </div>

      <div className="space-y-2.5">
        {DAY_SLOTS.map((slot) => {
          const slotEntries = entries
            .map((e, i) => ({ ...e, index: i }))
            .filter((e) => e.slot === slot.id);
          const isOpen = openSlot === slot.id;
          const slotMinutes = slotEntries.reduce((s, e) => s + e.minutes, 0);

          return (
            <div
              key={slot.id}
              className="border"
              style={{ borderColor: 'var(--line)', borderRadius: 'var(--radius-control)' }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenSlot(isOpen ? ('' as DaySlot) : slot.id)}
                className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-left"
              >
                <span>
                  <span className="text-sm font-medium">{slot.label}</span>
                  <span className="ml-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                    {slot.hint}
                  </span>
                </span>
                <span className="data shrink-0 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
                  {slotMinutes > 0 ? `${(slotMinutes / 60).toFixed(1)} h` : '—'}
                </span>
              </button>

              {isOpen ? (
                <div className="border-t px-3.5 pb-3.5 pt-3" style={{ borderColor: 'var(--line)' }}>
                  {slotEntries.length > 0 ? (
                    <ul className="mb-3 space-y-2">
                      {slotEntries.map((e) => (
                        <li key={e.index} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {BY_ID.get(e.activityId)?.label ?? e.activityId}
                          </span>
                          <input
                            type="number"
                            aria-label="Minutes"
                            min={0}
                            max={1440}
                            step={15}
                            value={e.minutes}
                            onChange={(ev) => setMinutes(e.index, Number(ev.target.value) || 0)}
                            className={`data ${inputClass}`}
                            style={{ ...inputStyle, width: 84 }}
                          />
                          <span className="text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
                            min
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${BY_ID.get(e.activityId)?.label ?? 'entry'}`}
                            onClick={() => remove(e.index)}
                            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full"
                            style={{ color: 'var(--fg-subtle)' }}
                          >
                            <X size={16} aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <AddActivity
                    slot={slot.id}
                    suggested={SUGGESTED[slot.id]}
                    grouped={grouped}
                    onAdd={add}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* The payoff. Shown as soon as there is enough to say something. */}
      {!result.insufficient ? (
        <div
          className="mt-4 border p-3.5"
          style={{
            background: 'var(--primary-light)',
            borderColor: 'var(--primary-border)',
            borderRadius: 'var(--radius-control)',
          }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--primary-dark)' }}>
            From your day: {result.levelLabel.toLowerCase()}
          </p>
          <ul className="mt-1.5 space-y-1 text-[13px]" style={{ color: 'var(--fg-muted)' }}>
            {result.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The picker. A select plus quick minute buttons — two taps to add a block. */
function AddActivity({
  slot,
  suggested,
  grouped,
  onAdd,
}: {
  slot: DaySlot;
  suggested: string[];
  grouped: Record<string, ReturnType<typeof activitiesByGroup>[string]>;
  onAdd: (slot: DaySlot, activityId: string, minutes: number) => void;
}) {
  const [choice, setChoice] = useState('');

  return (
    <div>
      {/* Suggestions first: most people's answer is already in this row. */}
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {suggested.map((id) => {
          const a = BY_ID.get(id);
          if (!a) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onAdd(slot, id, 60)}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1 border px-2.5 text-[13px]"
              style={{
                borderColor: 'var(--line-strong)',
                borderRadius: 'var(--radius-control)',
                color: 'var(--fg-muted)',
              }}
            >
              <Plus size={13} aria-hidden />
              {a.label}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <select
          aria-label="Add another activity"
          value={choice}
          onChange={(e) => {
            const id = e.target.value;
            if (id) {
              onAdd(slot, id, 60);
              setChoice('');
            }
          }}
          className={inputClass}
          style={inputStyle}
        >
          <option value="">Something else…</option>
          {Object.entries(grouped).map(([group, options]) => (
            <optgroup key={group} label={GROUP_LABELS[group as keyof typeof GROUP_LABELS]}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <p className="mt-2 text-[13px]" style={{ color: 'var(--fg-subtle)' }}>
        Everything starts at 60 minutes — change it to whatever is closer. Rough is fine.
      </p>
    </div>
  );
}

export { QUICK_MINUTES };
