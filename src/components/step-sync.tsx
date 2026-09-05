'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { Alert, Button } from '@/components/ui';
import {
  checkAvailability,
  localDateString,
  readDay,
  requestPermissions,
  type HealthAvailability,
} from '@/lib/health/bridge';
import { syncStepSegments, type StepSyncResult } from '@/lib/actions/steps-sync';

/**
 * Reading steps from the phone's health store.
 *
 * The honest default is that this does nothing: on the web there is no step
 * counter to read, and saying so plainly is better than showing a Sync button
 * that fails when pressed. The manual entry beside it stays the working path
 * for every browser visitor.
 */
export function StepSync() {
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<StepSyncResult | null>(null);

  // Availability can only be answered on the client — it depends on whether
  // the page is running inside the native shell.
  useEffect(() => {
    let cancelled = false;
    checkAvailability().then((a) => {
      if (!cancelled) setAvailability(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function sync() {
    setSyncing(true);
    setResult(null);

    const permission = await requestPermissions();
    if (!permission.granted) {
      setResult({ ok: false, error: permission.detail });
      setSyncing(false);
      return;
    }

    const day = await readDay(new Date());
    if (!day) {
      setResult({ ok: false, error: 'We could not read step data from your phone.' });
      setSyncing(false);
      return;
    }

    // Observations only. The server decides what counts.
    setResult(
      await syncStepSegments({
        logDate: localDateString(),
        segments: day.segments,
        workouts: day.workouts,
      }),
    );
    setSyncing(false);
  }

  if (availability === null) return null;

  if (!availability.available) {
    return (
      <div className="border-l-2 py-1 pl-4" style={{ borderColor: 'var(--line-strong)' }}>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Smartphone size={14} aria-hidden style={{ color: 'var(--fg-subtle)' }} />
          Automatic step sync
        </h3>
        <p className="measure mt-1 text-sm" style={{ color: 'var(--fg-muted)' }}>
          {availability.detail}
        </p>
      </div>
    );
  }

  return (
    <div>
      <Button variant="ghost" fullWidth disabled={syncing} onClick={sync}>
        {syncing ? (
          <>
            <Loader2 size={18} className="animate-spin" aria-hidden /> Reading your phone…
          </>
        ) : (
          <>
            <RefreshCw size={16} aria-hidden /> Sync steps from Health Connect
          </>
        )}
      </Button>

      {result ? (
        <div className="mt-3">
          {result.ok ? (
            <Alert tone="success">{result.message}</Alert>
          ) : (
            <Alert tone="error">{result.error}</Alert>
          )}
        </div>
      ) : null}

      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--fg-subtle)' }}>
        We read the step totals Health Connect already holds. We do not read raw sensor data, and we
        never write anything back to your health record.
      </p>
    </div>
  );
}
