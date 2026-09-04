import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OWNER_TABLES,
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUser,
  isTestAccount,
  rlsConfigured,
  sweepOrphanedTestUsers,
  type TestUser,
} from './harness';

/**
 * Row Level Security.
 *
 * Health data is the most sensitive category this app touches, and RLS is the
 * only thing standing between one user's records and another's. An application
 * bug should not be able to become a data breach, which is the entire reason
 * these policies live in the database rather than in a `where` clause someone
 * can forget.
 *
 * Requires a live Supabase project. Run with `npm run test:rls`.
 */

const suite = rlsConfigured ? describe : describe.skip;

suite('Row Level Security', () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([createTestUser('alice'), createTestUser('bob')]);
  }, 60_000);

  afterAll(async () => {
    await Promise.all([alice && deleteTestUser(alice), bob && deleteTestUser(bob)]);
    // Catches anything an interrupted run left behind.
    await sweepOrphanedTestUsers();
  }, 60_000);

  it('only ever considers @example.test addresses deletable', () => {
    // This project holds real accounts, so the cleanup guard is itself tested.
    expect(isTestAccount('rls-alice-123@example.test')).toBe(true);
    expect(isTestAccount('someone@gmail.com')).toBe(false);
    expect(isTestAccount('attacker@example.test.evil.com')).toBe(false);
    expect(isTestAccount(undefined)).toBe(false);
  });

  // --- bootstrap ----------------------------------------------------------

  describe('new user bootstrap', () => {
    it('creates the profile rows so onboarding never meets a missing row', async () => {
      for (const table of ['profiles', 'lifestyle', 'food_profile']) {
        const { data, error } = await alice.client.from(table).select('user_id');
        expect(error, `${table} errored`).toBeNull();
        expect(data, `${table} was not bootstrapped`).toHaveLength(1);
        expect(data![0].user_id).toBe(alice.id);
      }
    });
  });

  // --- anonymous access ---------------------------------------------------

  describe('anonymous access', () => {
    it('reaches no user-owned table', async () => {
      const anon = anonClient();
      for (const table of OWNER_TABLES) {
        const { data } = await anon.from(table).select('*').limit(1);
        expect(data ?? [], `anon could read ${table}`).toHaveLength(0);
      }
    }, 90_000);

    it('cannot read the food database either', async () => {
      // Reference data is `to authenticated`, not public.
      const anon = anonClient();
      const { data } = await anon.from('foods').select('id').limit(1);
      expect(data ?? []).toHaveLength(0);
    });

    it('cannot insert a row on someone else’s behalf', async () => {
      const { error } = await anonClient()
        .from('measurements')
        .insert({ user_id: '00000000-0000-0000-0000-000000000000', weight_kg: 70 });
      expect(error).not.toBeNull();
    });
  });

  // --- cross-user reads ---------------------------------------------------

  describe('one user cannot read another', () => {
    beforeAll(async () => {
      // Give Alice something worth stealing across several tables.
      await alice.client.from('measurements').insert({
        user_id: alice.id,
        measured_on: '2026-01-15',
        weight_kg: 82.4,
        waist_cm: 94.5,
        notes: 'alice private note',
      });
      await alice.client.from('goals').insert({
        user_id: alice.id,
        goal: 'fat_loss',
        starting_weight_kg: 82.4,
        target_weight_kg: 72,
      });
      await alice.client.from('safety_flags').insert({
        user_id: alice.id,
        code: 'test_flag',
        severity: 'info',
        reason: 'alice private reason',
        guidance: 'alice private guidance',
      });
      // Session feedback carries the most sensitive free text in the schema:
      // where it hurt. It arrived with the video/progression migration, so it
      // is exercised explicitly rather than only through the table sweep.
      await alice.client.from('session_feedback').insert({
        user_id: alice.id,
        performed_on: '2026-01-15',
        difficulty: 4,
        pain: 'pain',
        pain_location: 'alice private left knee',
        completed: true,
      });
    }, 30_000);

    it('returns nothing from Alice’s measurements when Bob asks', async () => {
      const { data } = await bob.client.from('measurements').select('*');
      expect(data ?? []).toHaveLength(0);
    });

    it('never leaks Alice’s rows through any owner table', async () => {
      for (const table of OWNER_TABLES) {
        const { data } = await bob.client.from(table).select('user_id');
        const foreign = (data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id);
        expect(foreign, `${table} leaked rows to another user`).toHaveLength(0);
      }
    }, 90_000);

    it('does not leak health details even in free-text columns', async () => {
      const { data } = await bob.client.from('safety_flags').select('reason, guidance');
      const text = JSON.stringify(data ?? []);
      expect(text).not.toContain('alice private');
    });

    it('does not leak where another user reported pain', async () => {
      // An injury location is health data about a named body part. It is also
      // the field the progression engine reads to withhold load, so it will be
      // queried often — which is exactly when a missing policy gets noticed.
      const { data } = await bob.client
        .from('session_feedback')
        .select('pain, pain_location, difficulty');
      expect(data ?? [], 'session_feedback leaked rows').toHaveLength(0);
      expect(JSON.stringify(data ?? [])).not.toContain('alice private');
    });

    /**
     * Control.
     *
     * Every assertion above is "Bob sees nothing". Those would all pass just as
     * happily against an empty table, a broken query, or a typo'd table name —
     * so this proves the rows genuinely exist and are genuinely being withheld.
     * Without it the suite is decorative.
     */
    it('confirms the withheld rows actually exist (RLS is doing the work)', async () => {
      const admin = adminClient();

      const { data: allMeasurements } = await admin
        .from('measurements')
        .select('user_id, notes')
        .eq('user_id', alice.id);
      expect(allMeasurements ?? [], 'Alice has no measurement to withhold').not.toHaveLength(0);
      expect(JSON.stringify(allMeasurements)).toContain('alice private note');

      const { data: allFlags } = await admin
        .from('safety_flags')
        .select('reason')
        .eq('user_id', alice.id);
      expect(allFlags ?? []).not.toHaveLength(0);

      const { data: allFeedback } = await admin
        .from('session_feedback')
        .select('pain_location')
        .eq('user_id', alice.id);
      expect(allFeedback ?? [], 'Alice has no session feedback to withhold').not.toHaveLength(0);
      expect(JSON.stringify(allFeedback)).toContain('alice private left knee');

      // Same query, same rows present — but through Bob's session it is empty.
      const { data: bobsView } = await bob.client.from('measurements').select('user_id, notes');
      expect(bobsView ?? []).toHaveLength(0);
    });
  });

  // --- cross-user writes --------------------------------------------------

  describe('one user cannot write as another', () => {
    it('refuses an insert carrying someone else’s user_id', async () => {
      const { error } = await bob.client.from('measurements').insert({
        user_id: alice.id,
        measured_on: '2026-01-16',
        weight_kg: 99,
      });
      expect(error).not.toBeNull();
      // 42501 is Postgres' insufficient_privilege — the RLS check, not a
      // constraint or a typo.
      expect(error!.code).toBe('42501');
    });

    it('silently affects nothing when updating another user’s row', async () => {
      const { data } = await bob.client
        .from('profiles')
        .update({ display_name: 'HACKED' })
        .eq('user_id', alice.id)
        .select();
      expect(data ?? []).toHaveLength(0);

      const { data: after } = await alice.client.from('profiles').select('display_name');
      expect(after![0].display_name).toBe('alice');
    });

    it('cannot delete another user’s rows', async () => {
      await bob.client.from('measurements').delete().eq('user_id', alice.id);
      const { data } = await alice.client.from('measurements').select('id');
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  });

  // --- reference data -----------------------------------------------------

  describe('shared reference data', () => {
    it('is readable by any signed-in user', async () => {
      const { data } = await alice.client.from('foods').select('id, name').limit(5);
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it('cannot be edited by an ordinary user', async () => {
      const { data: food } = await alice.client.from('foods').select('id').limit(1).single();
      const { data } = await alice.client
        .from('foods')
        .update({ kcal_per_100g: 1 })
        .eq('id', food!.id)
        .select();
      expect(data ?? []).toHaveLength(0);
    });

    it('lets a user add a private custom food but not publish it', async () => {
      const { error } = await alice.client.from('foods').insert({
        slug: `alice-custom-${Date.now()}`,
        name: 'Alice custom food',
        category: 'other',
        food_state: 'cooked',
        is_vegetarian: true,
        kcal_per_100g: 100,
        source: 'user submitted',
        created_by: alice.id,
        is_public: true, // the attempt that must fail
      });
      expect(error).not.toBeNull();
    });

    it('accepts the same custom food when kept private', async () => {
      const { error } = await alice.client.from('foods').insert({
        slug: `alice-private-${Date.now()}`,
        name: 'Alice private food',
        category: 'other',
        food_state: 'cooked',
        is_vegetarian: true,
        kcal_per_100g: 100,
        source: 'user submitted',
        created_by: alice.id,
        is_public: false,
        is_verified: false,
      });
      expect(error).toBeNull();
    });

    it('keeps one user’s custom food invisible to another', async () => {
      const { data } = await bob.client.from('foods').select('name').ilike('name', 'Alice%');
      expect(data ?? []).toHaveLength(0);
    });
  });

  // --- deletion -----------------------------------------------------------

  describe('account deletion', () => {
    it('removes every trace of a user', async () => {
      const doomed = await createTestUser('doomed');

      // Give them data across the tables that cascade.
      await doomed.client
        .from('measurements')
        .insert({ user_id: doomed.id, measured_on: '2026-01-17', weight_kg: 70 });
      const { data: food } = await doomed.client.from('foods').select('id').limit(1).single();
      await doomed.client.from('food_logs').insert({
        user_id: doomed.id,
        food_id: food!.id,
        log_date: '2026-01-17',
        meal: 'lunch',
        description: 'test',
        quantity: 100,
        grams: 100,
        kcal: 130,
      });
      await doomed.client
        .from('step_logs')
        .insert({ user_id: doomed.id, log_date: '2026-01-17', steps: 5000 });

      // This is the case that used to fail: the AFTER DELETE rollup trigger
      // tried to re-insert a daily_logs row for a user that no longer existed.
      const { error } = await adminClient().auth.admin.deleteUser(doomed.id);
      expect(error, 'account deletion failed').toBeNull();

      const admin = adminClient();
      for (const table of ['profiles', 'measurements', 'food_logs', 'daily_logs', 'step_logs']) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', doomed.id);
        expect(data ?? [], `${table} retained data after deletion`).toHaveLength(0);
      }
    }, 60_000);
  });
});
