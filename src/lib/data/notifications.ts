import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

export interface InboxItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  deepLink: string | null;
  createdAt: string;
}

/**
 * What is waiting for this person.
 *
 * Only undismissed items, and only ones whose time has come — a notification
 * scheduled for Friday should not appear on Tuesday merely because the row
 * already exists.
 */
export async function getInbox(limit = 5): Promise<InboxItem[]> {
  if (!supabaseConfigured) return [];

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  const { data } = await supabase
    .from('notifications')
    .select('id, kind, title, body, deep_link, created_at')
    .eq('user_id', auth.user.id)
    .is('dismissed_at', null)
    .lte('scheduled_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((n) => ({
    id: n.id as string,
    kind: n.kind as string,
    title: n.title as string,
    body: n.body as string,
    deepLink: (n.deep_link as string) ?? null,
    createdAt: n.created_at as string,
  }));
}
