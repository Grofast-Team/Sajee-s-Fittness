'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { supabaseConfigured } from '@/lib/config';

/**
 * Account-level actions.
 *
 * Deleting an account is a privacy obligation, not a feature. Every row is
 * removed by the `on delete cascade` chain — profile, plan, food logs, weight
 * history, coach memory, the lot. There is no soft delete and no archive: if
 * someone asks to be forgotten, they are forgotten.
 */

export async function signOutAction() {
  if (!supabaseConfigured) redirect('/login');

  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/login');
}

export type DeleteResult = { ok: false; error: string };

/**
 * Delete the signed-in user's account and all their data.
 *
 * Deleting an `auth.users` row needs the service role — a user cannot remove
 * their own auth record through the anon client — so this is one of the very
 * few places the admin client is used. The user id comes from the verified
 * session, never from the request body, so this can only ever delete the
 * caller's own account.
 */
export async function deleteAccountAction(confirmation: string): Promise<DeleteResult | never> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Accounts are not available on this deployment.' };
  }

  // Deliberate friction on an irreversible action that destroys health history.
  if (confirmation.trim().toUpperCase() !== 'DELETE') {
    return { ok: false, error: 'Type DELETE to confirm.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  const userId = auth.user.id;

  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;
  } catch (error) {
    console.error('account deletion failed', error);
    return {
      ok: false,
      error:
        'We could not delete your account just now. Nothing has been removed. Please try again, ' +
        'or contact support if this keeps happening.',
    };
  }

  // Clear the local session too, so the browser is not left holding a token for
  // a user that no longer exists.
  await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/login?deleted=1');
}
