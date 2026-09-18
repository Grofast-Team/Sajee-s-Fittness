'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';

/**
 * The one thing required before reaching the app at all.
 *
 * Deliberately separate from src/lib/actions/onboarding.ts, which owns the
 * nine-step Fitness interview. That is a different, much larger flow with a
 * different job - compute a plan - and this one's only job is to stamp
 * profiles.onboarding_done_at. See design spec section 3: each piece of
 * onboarding state now has exactly one writer, and this is this column's.
 *
 * profiles.display_name may already be set - the signup form's name field
 * is optional, and private.handle_new_user() writes whatever was given
 * before this ever runs. The caller (OnboardingName) prefills from that
 * value; this action does not care whether the name changed or was already
 * correct, it just saves whatever it is given.
 */

export type MinimalSignupResult = { ok: true } | { ok: false; error: string };

export const minimalSignupSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export async function completeMinimalSignup(input: unknown): Promise<MinimalSignupResult> {
  if (!supabaseConfigured) {
    return { ok: false, error: 'Supabase is not configured on this deployment.' };
  }

  const parsed = minimalSignupSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Tell us what to call you first.' };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'You need to be signed in.' };

  // An update, not an upsert: private.handle_new_user() guarantees a
  // profiles row exists for every signed-in user, created at signup.
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: parsed.data.displayName,
      onboarding_done_at: new Date().toISOString(),
    })
    .eq('user_id', auth.user.id);

  if (error) {
    return { ok: false, error: 'We could not save that. Please try again.' };
  }

  // This changes what (app)/layout.tsx's gate decides on every route, so it
  // follows the account.ts/auth.ts precedent for a shell-wide change rather
  // than a single-path revalidate.
  revalidatePath('/', 'layout');
  return { ok: true };
}
