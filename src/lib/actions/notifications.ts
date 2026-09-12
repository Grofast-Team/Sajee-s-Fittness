'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * Dismissing a notification.
 *
 * Dismissed rather than deleted: the row is what stops the daily job raising
 * the same event again, so removing it would bring the reminder straight back
 * tomorrow.
 */
export async function dismissNotification(id: string): Promise<{ ok: boolean }> {
  if (!supabaseConfigured) return { ok: false };

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false };

  const { error } = await supabase
    .from('notifications')
    .update({ dismissed_at: new Date().toISOString(), status: 'dismissed' })
    .eq('id', parsed.data)
    .eq('user_id', auth.user.id);

  revalidatePath('/today');
  return { ok: !error };
}
