import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { DAY_NAMES, dateForDay, weekStart } from '@/lib/engines/training';

/**
 * This week's training sessions.
 *
 * Kept separate from the day view because it has a different shape and a
 * different cadence — the dashboard reads a day, the activity screen reads a
 * week — and merging them would mean every page paid for both.
 */

export interface WeekSession {
  id: string | null;
  dayName: string;
  date: string;
  label: string;
  kind: string;
  plannedMinutes: number | null;
  status: string;
  isToday: boolean;
  isPast: boolean;
}

export interface WeekView {
  isSample: boolean;
  weekStartIso: string;
  /** Days in the last 7 the step goal was met, or null if we cannot tell yet. */
  stepDaysMet: number | null;
  sessions: WeekSession[];
  /** The next thing to actually do, or null if the week is done. */
  todaySession: WeekSession | null;
  missed: WeekSession[];
  completedCount: number;
  plannedCount: number;
}

/** The fixed sample week, used before Supabase is configured. */
const SAMPLE_WEEK: Omit<WeekSession, 'isToday' | 'isPast'>[] = [
  { id: null, dayName: 'Mon', date: '', label: 'Strength session', kind: 'strength', plannedMinutes: 25, status: 'completed' },
  { id: null, dayName: 'Tue', date: '', label: 'Recovery walk', kind: 'walk', plannedMinutes: 25, status: 'completed' },
  { id: null, dayName: 'Wed', date: '', label: 'Strength session', kind: 'strength', plannedMinutes: 25, status: 'skipped' },
  { id: null, dayName: 'Thu', date: '', label: 'Recovery walk', kind: 'walk', plannedMinutes: 25, status: 'planned' },
  { id: null, dayName: 'Fri', date: '', label: 'Strength session', kind: 'strength', plannedMinutes: 25, status: 'planned' },
  { id: null, dayName: 'Sat', date: '', label: 'Recovery walk', kind: 'walk', plannedMinutes: 25, status: 'planned' },
  { id: null, dayName: 'Sun', date: '', label: 'Rest', kind: 'rest', plannedMinutes: 0, status: 'rest' },
];

function sampleWeek(): WeekView {
  const sessions: WeekSession[] = SAMPLE_WEEK.map((s, i) => ({
    ...s,
    isToday: i === 3,
    isPast: i < 3,
  }));

  return {
    isSample: true,
    weekStartIso: weekStart(new Date()),
    stepDaysMet: 4,
    sessions,
    todaySession: sessions[3],
    missed: sessions.filter((s) => s.status === 'skipped'),
    completedCount: 2,
    plannedCount: 6,
  };
}

export async function getWeekView(): Promise<WeekView> {
  if (!supabaseConfigured) return sampleWeek();

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return sampleWeek();

  const today = new Date().toISOString().slice(0, 10);
  const monday = weekStart(new Date());
  const sunday = dateForDay(monday, 6);

  const { data } = await supabase
    .from('workout_plans')
    .select('id, plan_date, label, activity_kind, planned_minutes, status')
    .eq('user_id', auth.user.id)
    .gte('plan_date', monday)
    .lte('plan_date', sunday)
    .order('plan_date', { ascending: true });

  if (!data || data.length === 0) return sampleWeek();

  const sessions: WeekSession[] = data.map((row) => {
    const date = row.plan_date as string;
    const dayIndex = Math.round(
      (Date.parse(date) - Date.parse(monday)) / 86_400_000,
    );
    return {
      id: row.id as string,
      dayName: DAY_NAMES[Math.max(0, Math.min(6, dayIndex))],
      date,
      label: (row.label as string) ?? 'Session',
      kind: row.activity_kind as string,
      plannedMinutes: row.planned_minutes as number | null,
      status: row.status as string,
      isToday: date === today,
      isPast: date < today,
    };
  });

  // Real step adherence over the trailing week, used to decide whether the
  // step goal should go up, hold, or come back down.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [stepRows, planRow] = await Promise.all([
    supabase
      .from('daily_logs')
      .select('log_date, steps')
      .eq('user_id', auth.user.id)
      .gte('log_date', weekAgo)
      .not('steps', 'is', null),
    supabase
      .from('plans')
      .select('step_target')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  const target = planRow.data?.step_target ?? null;
  const stepDaysMet =
    target === null || (stepRows.data ?? []).length === 0
      ? null
      : (stepRows.data ?? []).filter((r) => Number(r.steps) >= target).length;

  return {
    isSample: false,
    weekStartIso: monday,
    stepDaysMet,
    sessions,
    todaySession: sessions.find((s) => s.isToday) ?? null,
    // A session only counts as missed once its day has passed. Today's
    // unfinished session is not a failure yet.
    missed: sessions.filter((s) => s.isPast && s.status === 'planned' && s.kind !== 'rest'),
    completedCount: sessions.filter((s) => s.status === 'completed').length,
    plannedCount: sessions.filter((s) => s.kind !== 'rest').length,
  };
}
