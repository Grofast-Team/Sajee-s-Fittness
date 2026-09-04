import { WebSocket as NodeWebSocket } from 'ws';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// supabase-js constructs a realtime client eagerly, which wants a global
// WebSocket. Node 20 has none (Node 22+ does), and these tests run in bare Node
// rather than Next's runtime. We never use realtime here — this just satisfies
// the constructor.
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as { WebSocket?: unknown }).WebSocket = NodeWebSocket;
}

/**
 * Test harness for the Row Level Security suite.
 *
 * These tests run against a **real Supabase project**, because RLS cannot be
 * meaningfully tested any other way — the policies live in the database, not in
 * application code, and a mock would only test the mock.
 *
 * They are therefore not part of `npm test`. Run them with `npm run test:rls`
 * against a development project. They create users, write rows, and delete
 * everything they made.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const rlsConfigured = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SERVICE_ROLE_KEY);

/** Bypasses RLS. Used only to create and tear down test users. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** An unauthenticated client, exactly as a logged-out browser would have. */
export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/**
 * Retry transient transport failures.
 *
 * Supabase rate-limits rapid signups, and a throttled request surfaces as a
 * bare "fetch failed" rather than a 429. Without a retry this suite is flaky in
 * CI — and a flaky security test gets muted, which is worse than not having it.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // 2s, 4s, 8s.
      await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw new Error(`${what} failed after ${attempts} attempts: ${String(lastError)}`);
}

/**
 * Create a confirmed user and return a client authenticated as them.
 *
 * The client carries the user's own JWT, so every query it makes is subject to
 * exactly the policies a real session would be.
 */
export async function createTestUser(label: string): Promise<TestUser> {
  const admin = adminClient();
  const email = `rls-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = `Test-${Math.random().toString(36).slice(2, 12)}!9`;

  const { data } = await withRetry(`create user ${label}`, async () => {
    const result = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: label },
    });
    if (result.error) throw result.error;
    return result;
  });
  // withRetry rethrows on failure, so reaching here means the call succeeded.
  if (!data.user) throw new Error('user creation returned no user');

  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await withRetry(`sign in ${label}`, async () => {
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    return result;
  });

  return { id: data.user.id, email, client };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await adminClient().auth.admin.deleteUser(user.id);
}

/**
 * The only email domain this suite is ever allowed to delete.
 *
 * This project holds real accounts. A cleanup routine that deletes "test-looking"
 * users on a live project is one bad regex away from deleting somebody's health
 * history, so the guard is an exact suffix match and nothing else.
 */
const TEST_EMAIL_SUFFIX = '@example.test';

export function isTestAccount(email: string | undefined): boolean {
  return typeof email === 'string' && email.endsWith(TEST_EMAIL_SUFFIX);
}

/**
 * Remove users orphaned by an interrupted run.
 *
 * A failure partway through `beforeAll` leaves one user created and the other
 * not, so the paired teardown never runs. Without this sweep those accumulate
 * on the project.
 */
export async function sweepOrphanedTestUsers(): Promise<number> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error || !data) return 0;

  const orphans = data.users.filter((u) => isTestAccount(u.email));
  for (const user of orphans) {
    await admin.auth.admin.deleteUser(user.id);
  }
  return orphans.length;
}

/** Every table that holds user-owned data. The isolation suite walks all of
 *  them, so a table added without a policy fails the build rather than leaking
 *  quietly. */
export const OWNER_TABLES = [
  'profiles',
  'lifestyle',
  'food_profile',
  'budgets',
  'goals',
  'safety_flags',
  'plans',
  'plan_adjustments',
  'user_memory',
  'measurements',
  'daily_logs',
  'step_logs',
  'sleep_logs',
  'water_logs',
  'cycle_logs',
  'food_logs',
  'ai_food_analyses',
  'meal_plans',
  'grocery_lists',
  'workout_plans',
  'exercise_sets',
  'activity_sessions',
  'fitness_assessments',
  'session_feedback',
  'skill_unlocks',
  'user_habits',
  'habit_checkins',
  'coach_threads',
  'coach_messages',
  'reviews',
  'plan_feedback',
  'notification_prefs',
  'notifications',
] as const;
