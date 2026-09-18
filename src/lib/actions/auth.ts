'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/config';
import { getEnabledCategories } from '@/lib/data/categories';
import { isCategoryVisible } from '@/lib/engines/categories';

/**
 * Auth server actions.
 *
 * Error messages are deliberately non-specific about *which* credential was
 * wrong. "No account with that email" is a free account-enumeration oracle, and
 * it does not help the honest user any more than "those details did not match"
 * does.
 */

export type AuthState = { error?: string; message?: string };

function readCredentials(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  return { email, password };
}

function validate(email: string, password: string): string | null {
  if (!email.includes('@') || email.length < 5) return 'Please enter a valid email address.';
  if (password.length < 8) return 'Your password needs to be at least 8 characters.';
  return null;
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!supabaseConfigured) {
    return { error: 'Accounts are not available on this deployment — Supabase is not configured.' };
  }

  const { email, password } = readCredentials(formData);
  const invalid = validate(email, password);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: 'Those details did not match an account. Check them and try again.' };
  }

  revalidatePath('/', 'layout');

  // /today is gated on Fitness being enabled (see (app)/(fitness)/layout.tsx).
  // Sending every sign-in there unconditionally would bounce a Fitness-disabled
  // user into /onboarding, which has no navigation at all - a dead end. /money
  // is never gated and always has full nav, so it is the safe default landing
  // page for anyone who hasn't enabled Fitness.
  const enabled = data.user ? await getEnabledCategories(supabase, data.user.id) : new Set<string>();
  redirect(isCategoryVisible('fitness', enabled) ? '/today' : '/money');
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!supabaseConfigured) {
    return { error: 'Accounts are not available on this deployment — Supabase is not configured.' };
  }

  const { email, password } = readCredentials(formData);
  const displayName = String(formData.get('displayName') ?? '').trim();
  const invalid = validate(email, password);
  if (invalid) return { error: invalid };

  const origin = (await headers()).get('origin') ?? '';
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // `private.handle_new_user()` reads this to seed the profile row, so the
      // onboarding UI never has to handle a missing-row state.
      data: { display_name: displayName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding-name`,
    },
  });

  if (error) {
    // Real failures worth surfacing (weak password, rate limit) without
    // confirming whether the address is already registered.
    return { error: 'We could not create that account. If you already have one, try signing in.' };
  }

  return {
    message:
      'Check your email for a confirmation link. Once you confirm, we will take you through setup.',
  };
}

export async function signOut() {
  if (!supabaseConfigured) redirect('/');
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
