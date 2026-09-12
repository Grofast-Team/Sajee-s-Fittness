import { NextResponse } from 'next/server';
import { createServiceClient, serviceRoleConfigured } from '@/lib/supabase/service';
import { monthWindow } from '@/lib/engines/money';
import { summariseCommitments, type Commitment } from '@/lib/engines/commitments';
import { planCommitmentNotifications } from '@/lib/engines/notify';

/**
 * The daily job: raise anything that needs saying today.
 *
 * Separate from the weekly review because the things it watches move daily. A
 * bill due in three days cannot be caught by a job that runs on Mondays.
 *
 * Everything it creates is deduplicated by `notifications.dedupe_key`, which
 * carries a unique index. That is deliberate: a check-then-insert in this code
 * would still double up on a retry or an overlapping run, and the failure mode
 * — the same reminder every morning — is exactly what makes people mute an app
 * for good.
 */

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  // Fails closed. An unauthenticated endpoint that writes to every user's
  // notifications is a spam vector, not merely a bug.
  if (!secret) {
    console.error('CRON_SECRET is not set; refusing to run the daily job.');
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  if (!serviceRoleConfigured) {
    return NextResponse.json({ error: 'Service role key is not configured.' }, { status: 503 });
  }

  const supabase = createServiceClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  let raised = 0;
  let scanned = 0;

  try {
    // Only users who actually have commitments. There is nothing to say to
    // anyone else, and walking every profile would scale badly for no gain.
    const { data: rows } = await supabase
      .from('commitments')
      .select(
        'id, user_id, label, amount_paise, category, cadence, due_day, started_on, ended_on, note',
      )
      .is('ended_on', null);

    const byUser = new Map<string, Commitment[]>();
    for (const row of rows ?? []) {
      const userId = row.user_id as string;
      const list = byUser.get(userId) ?? [];
      list.push({
        id: row.id as string,
        label: row.label as string,
        amountPaise: Number(row.amount_paise),
        category: row.category as string,
        cadence: row.cadence as Commitment['cadence'],
        dueDay: Number(row.due_day),
        startedOn: row.started_on as string,
        endedOn: (row.ended_on as string) ?? null,
        note: (row.note as string) ?? null,
      });
      byUser.set(userId, list);
    }

    for (const [userId, commitments] of byUser) {
      scanned += 1;

      const { data: settings } = await supabase
        .from('money_settings')
        .select('month_start_day')
        .eq('user_id', userId)
        .maybeSingle();

      const window = monthWindow(today, settings?.month_start_day ?? 1);

      const { data: payments } = await supabase
        .from('spends')
        .select('commitment_id, amount_paise')
        .eq('user_id', userId)
        .not('commitment_id', 'is', null)
        .gte('spent_on', window.start)
        .lt('spent_on', window.end);

      const paidByCommitment: Record<string, number> = {};
      for (const payment of payments ?? []) {
        const key = payment.commitment_id as string;
        paidByCommitment[key] = (paidByCommitment[key] ?? 0) + Number(payment.amount_paise);
      }

      /*
       * Only the due dates and paid state matter here, so the money figures
       * are passed as zero. This job decides what to say about bills, not
       * what is left to spend.
       */
      const summary = summariseCommitments({
        commitments,
        paidByCommitment,
        windowStart: window.start,
        windowEnd: window.end,
        today: todayIso,
        limitPaise: null,
        spentPaise: 0,
        daysLeft: window.daysLeft,
      });

      const planned = planCommitmentNotifications(summary.statuses);
      if (planned.length === 0) continue;

      /*
       * Insert and let the unique index reject repeats.
       *
       * `ignoreDuplicates` turns a conflict into a no-op rather than an error,
       * so a second run on the same day is silently correct instead of
       * throwing and aborting the rest of the batch.
       */
      const { data: inserted, error } = await supabase
        .from('notifications')
        .upsert(
          planned.map((n) => ({
            user_id: userId,
            kind: n.kind,
            title: n.title,
            body: n.body,
            deep_link: n.deepLink,
            dedupe_key: n.dedupeKey,
            scheduled_at: new Date().toISOString(),
            sent_at: new Date().toISOString(),
            status: 'sent',
          })),
          { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
        )
        // Counting what came back, not what was attempted. Reporting "raised 2"
        // on a run that inserted nothing would make the log useless for the one
        // thing it is for: knowing whether this job is actually doing anything.
        .select('id');

      if (error) console.error('notification insert failed', userId, error);
      else raised += inserted?.length ?? 0;
    }

    console.log(`daily job: ${scanned} users scanned, up to ${raised} notifications raised`);
    return NextResponse.json({ ok: true, scanned, raised });
  } catch (error) {
    console.error('daily job failed', error);
    return NextResponse.json({ error: 'The daily job failed.' }, { status: 500 });
  }
}
