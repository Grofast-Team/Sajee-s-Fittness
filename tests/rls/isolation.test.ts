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
        const { data, error } = await bob.client.from(table).select('user_id');
        // Without this a missing or misspelt table returns data: null, which
        // reads as "nothing leaked" and passes.
        expect(error, `${table} errored`).toBeNull();
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

  // --- money --------------------------------------------------------------

  describe('money stays with its owner', () => {
    const MONEY_TABLES = [
      'spends',
      'money_settings',
      'commitments',
      'income_sources',
      'incomes',
      'step_segments',
      'step_validations',
      'savings_goals',
      'savings_withdrawals',
    ] as const;

    let aliceSpendId: string;

    beforeAll(async () => {
      const { data: spend, error: spendError } = await alice.client
        .from('spends')
        .insert({
          user_id: alice.id,
          spent_on: '2026-01-15',
          amount_paise: 45_000,
          category: 'medical',
          note: 'alice private pharmacy',
        })
        .select('id')
        .single();
      expect(spendError).toBeNull();
      aliceSpendId = spend!.id as string;

      const seeds = await Promise.all([
        alice.client
          .from('money_settings')
          .upsert({ user_id: alice.id, monthly_limit_paise: 5_000_000 }, { onConflict: 'user_id' }),
        alice.client
          .from('commitments')
          .insert({ user_id: alice.id, label: 'alice rent', amount_paise: 1_200_000, category: 'rent' }),
        alice.client
          .from('income_sources')
          .insert({ user_id: alice.id, label: 'alice salary', kind: 'salary' }),
        alice.client
          .from('incomes')
          .insert({ user_id: alice.id, amount_paise: 5_000_000, received_on: '2026-01-01' }),
        alice.client.from('step_segments').insert({
          user_id: alice.id,
          log_date: '2026-01-15',
          started_at: '2026-01-15T08:00:00Z',
          ended_at: '2026-01-15T08:30:00Z',
          steps: 3000,
          platform_id: `rls-${alice.id}`,
        }),
        alice.client.from('step_validations').insert({
          user_id: alice.id,
          log_date: '2026-01-15',
          raw_steps: 3000,
          validated_steps: 3000,
          excluded_steps: 0,
          confidence: 'high',
        }),
        alice.client
          .from('savings_goals')
          .insert({ user_id: alice.id, label: 'alice deposit', target_paise: 50_000_000 }),
      ]);
      for (const seed of seeds) expect(seed.error).toBeNull();

      // A withdrawal needs a goal holding something, so it cannot join the
      // parallel seeds above.
      const { data: held, error: heldError } = await alice.client
        .from('savings_goals')
        .insert({ user_id: alice.id, label: 'alice rainy day', target_paise: 1_000_000, opening_paise: 500_000 })
        .select('id')
        .single();
      expect(heldError).toBeNull();
      const { error: withdrawalError } = await alice.client
        .from('savings_withdrawals')
        .insert({ user_id: alice.id, savings_goal_id: held!.id, amount_paise: 100_000, note: 'alice private reason' });
      expect(withdrawalError).toBeNull();
    }, 60_000);

    it('has something of Alice’s in every money table, so the checks below mean something', async () => {
      const admin = adminClient();
      for (const table of MONEY_TABLES) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', alice.id);
        expect((data ?? []).length, `${table} has no row for Alice`).toBeGreaterThan(0);
      }
    });

    it('never shows Bob a row of Alice’s money', async () => {
      for (const table of MONEY_TABLES) {
        const { data } = await bob.client.from(table).select('user_id');
        const foreign = (data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id);
        expect(foreign, `${table} leaked rows to another user`).toHaveLength(0);
      }
    }, 60_000);

    it('silently changes nothing when Bob edits Alice’s spend', async () => {
      const { data } = await bob.client
        .from('spends')
        .update({ amount_paise: 1 })
        .eq('id', aliceSpendId)
        .select();
      expect(data ?? []).toHaveLength(0);

      const { data: after } = await alice.client
        .from('spends')
        .select('amount_paise')
        .eq('id', aliceSpendId)
        .single();
      expect(Number(after!.amount_paise)).toBe(45_000);
    });

    it('refuses to move Bob’s own spend onto Alice’s account', async () => {
      const { data: own } = await bob.client
        .from('spends')
        .insert({ user_id: bob.id, amount_paise: 100, category: 'other' })
        .select('id')
        .single();

      const { error } = await bob.client
        .from('spends')
        .update({ user_id: alice.id })
        .eq('id', own!.id);
      expect(error).not.toBeNull();
      // The row would fail the policy's WITH CHECK after the update.
      expect(error!.code).toBe('42501');
    });

    it('cannot delete Alice’s spend', async () => {
      await bob.client.from('spends').delete().eq('id', aliceSpendId);
      const { data } = await alice.client.from('spends').select('id').eq('id', aliceSpendId);
      expect(data ?? []).toHaveLength(1);
    });

    it('refuses income recorded on Alice’s behalf', async () => {
      const { error } = await bob.client
        .from('incomes')
        .insert({ user_id: alice.id, amount_paise: 100 });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });
  });

  describe('money edits are guarded and remembered', () => {
    let aliceCommitmentId: string;
    let aliceSourceId: string;

    beforeAll(async () => {
      const [{ data: commitment }, { data: source }] = await Promise.all([
        alice.client
          .from('commitments')
          .insert({
            user_id: alice.id,
            label: 'alice internet',
            amount_paise: 89_900,
            category: 'phone_internet',
          })
          .select('id')
          .single(),
        alice.client
          .from('income_sources')
          .insert({ user_id: alice.id, label: 'alice freelance', kind: 'freelance' })
          .select('id')
          .single(),
      ]);
      aliceCommitmentId = commitment!.id as string;
      aliceSourceId = source!.id as string;
    }, 60_000);

    // Found 2026-09-13. Foreign-key checks run with the table owner's rights
    // and ignore RLS, so both inserts were accepted even though Bob could not
    // read either row.
    it('refuses a spend that settles another user’s commitment', async () => {
      const { error } = await bob.client.from('spends').insert({
        user_id: bob.id,
        amount_paise: 100,
        category: 'phone_internet',
        commitment_id: aliceCommitmentId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('refuses income attributed to another user’s income source', async () => {
      const { error } = await bob.client.from('incomes').insert({
        user_id: bob.id,
        amount_paise: 100,
        source_id: aliceSourceId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('still lets Alice settle her own commitment', async () => {
      const { error } = await alice.client.from('spends').insert({
        user_id: alice.id,
        amount_paise: 89_900,
        category: 'phone_internet',
        commitment_id: aliceCommitmentId,
      });
      expect(error).toBeNull();
    });

    it('will not recategorise a payment that settled a commitment', async () => {
      const { data: payment } = await alice.client
        .from('spends')
        .insert({
          user_id: alice.id,
          amount_paise: 89_900,
          category: 'phone_internet',
          commitment_id: aliceCommitmentId,
        })
        .select('id')
        .single();

      const { error } = await alice.client
        .from('spends')
        .update({ category: 'groceries' })
        .eq('id', payment!.id);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
    });

    it('stamps updated_at on an edit', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 500, category: 'other' })
        .select('id')
        .single();

      await new Promise((resolve) => setTimeout(resolve, 50));

      const { data: after } = await alice.client
        .from('spends')
        .update({ amount_paise: 600 })
        .eq('id', spend!.id)
        .select('created_at, updated_at')
        .single();

      expect(new Date(after!.updated_at as string).getTime()).toBeGreaterThan(
        new Date(after!.created_at as string).getTime(),
      );
    });

    it('records what a spend looked like before it was edited', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 25_000, category: 'clothes', note: 'before' })
        .select('id')
        .single();

      await alice.client
        .from('spends')
        .update({ amount_paise: 30_000, note: 'after' })
        .eq('id', spend!.id);

      const { data: revisions, error } = await alice.client
        .from('spend_revisions')
        .select('action, before, changed_fields')
        .eq('spend_id', spend!.id);

      expect(error).toBeNull();
      expect(revisions).toHaveLength(1);
      expect(revisions![0].action).toBe('update');
      const before = revisions![0].before as { amount_paise: number; note: string };
      expect(Number(before.amount_paise)).toBe(25_000);
      expect(before.note).toBe('before');
      expect([...(revisions![0].changed_fields as string[])].sort()).toEqual([
        'amount_paise',
        'note',
      ]);
    });

    it('does not record an edit that changed nothing', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 700, category: 'other' })
        .select('id')
        .single();

      await alice.client.from('spends').update({ amount_paise: 700 }).eq('id', spend!.id);

      const { data: revisions } = await alice.client
        .from('spend_revisions')
        .select('id')
        .eq('spend_id', spend!.id);
      expect(revisions ?? []).toHaveLength(0);
    });

    it('keeps a removed spend in the history', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 1_500, category: 'gifts' })
        .select('id')
        .single();

      await alice.client.from('spends').delete().eq('id', spend!.id);

      const { data: revisions } = await alice.client
        .from('spend_revisions')
        .select('action, before')
        .eq('spend_id', spend!.id);
      expect(revisions).toHaveLength(1);
      expect(revisions![0].action).toBe('delete');
      expect(Number((revisions![0].before as { amount_paise: number }).amount_paise)).toBe(1_500);
    });

    it('never shows Bob Alice’s history', async () => {
      const { data: exists } = await adminClient()
        .from('spend_revisions')
        .select('id')
        .eq('user_id', alice.id);
      expect((exists ?? []).length, 'Alice needs history for this to mean anything').toBeGreaterThan(0);

      const { data } = await bob.client.from('spend_revisions').select('user_id');
      const foreign = (data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id);
      expect(foreign).toHaveLength(0);
    });

    it('does not let Alice rewrite or erase her own history', async () => {
      const { data: spend } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 900, category: 'other' })
        .select('id')
        .single();
      await alice.client.from('spends').update({ amount_paise: 950 }).eq('id', spend!.id);

      const { data: edited } = await alice.client
        .from('spend_revisions')
        .update({ changed_fields: [] })
        .eq('spend_id', spend!.id)
        .select();
      expect(edited ?? []).toHaveLength(0);

      await alice.client.from('spend_revisions').delete().eq('spend_id', spend!.id);

      const { data: kept } = await adminClient()
        .from('spend_revisions')
        .select('id')
        .eq('spend_id', spend!.id);
      expect(kept ?? []).toHaveLength(1);
    });

    // The trap from 20260829100014: a trigger that writes a row for a user who
    // is being deleted fails the foreign key and aborts the whole deletion.
    it('still deletes an account whose spends have history', async () => {
      const doomed = await createTestUser('doomed-money');
      const { data: spend } = await doomed.client
        .from('spends')
        .insert({ user_id: doomed.id, amount_paise: 1_000, category: 'other' })
        .select('id')
        .single();
      await doomed.client.from('spends').update({ amount_paise: 1_100 }).eq('id', spend!.id);

      const { error } = await adminClient().auth.admin.deleteUser(doomed.id);
      expect(error, 'account deletion failed').toBeNull();

      const admin = adminClient();
      for (const table of ['spends', 'spend_revisions']) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', doomed.id);
        expect(data ?? [], `${table} kept rows for a deleted user`).toHaveLength(0);
      }
    }, 60_000);
  });

  describe('savings goals keep to their owner', () => {
    let aliceGoalId: string;
    let aliceOtherGoalId: string;
    let bobGoalId: string;

    beforeAll(async () => {
      const [{ data: goal }, { data: other }, { data: bobs }] = await Promise.all([
        alice.client
          .from('savings_goals')
          .insert({ user_id: alice.id, label: 'alice emergency', target_paise: 30_000_000 })
          .select('id')
          .single(),
        alice.client
          .from('savings_goals')
          .insert({ user_id: alice.id, label: 'alice trip', target_paise: 8_000_000 })
          .select('id')
          .single(),
        bob.client
          .from('savings_goals')
          .insert({ user_id: bob.id, label: 'bob bike', target_paise: 9_000_000 })
          .select('id')
          .single(),
      ]);
      aliceGoalId = goal!.id as string;
      aliceOtherGoalId = other!.id as string;
      bobGoalId = bobs!.id as string;
    }, 60_000);

    it('refuses a goal created on Alice’s behalf', async () => {
      const { error } = await bob.client
        .from('savings_goals')
        .insert({ user_id: alice.id, label: 'not yours', target_paise: 100 });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    // Foreign-key checks ignore RLS — the hole Feature 1 closed for
    // commitment_id. The same guard has to cover the new link from day one.
    it('refuses a contribution to another user’s goal', async () => {
      const { error } = await bob.client.from('spends').insert({
        user_id: bob.id,
        amount_paise: 100,
        category: 'savings',
        savings_goal_id: aliceGoalId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('refuses to move a contribution onto another user’s goal', async () => {
      const { data: own } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 1_000, category: 'savings', savings_goal_id: aliceGoalId })
        .select('id')
        .single();

      const { error } = await alice.client
        .from('spends')
        .update({ savings_goal_id: bobGoalId })
        .eq('id', own!.id);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('refuses a contribution that is not filed as savings', async () => {
      const { error } = await alice.client.from('spends').insert({
        user_id: alice.id,
        amount_paise: 1_000,
        category: 'groceries',
        savings_goal_id: aliceGoalId,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
    });

    it('will not recategorise a contribution', async () => {
      const { data: contribution } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 2_000, category: 'savings', savings_goal_id: aliceGoalId })
        .select('id')
        .single();

      const { error } = await alice.client
        .from('spends')
        .update({ category: 'eating_out' })
        .eq('id', contribution!.id);
      expect(error).not.toBeNull();
      expect(error!.code).toBe('23514');
    });

    it('records a contribution moved to another goal in the history', async () => {
      const { data: contribution } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 3_000, category: 'savings', savings_goal_id: aliceGoalId })
        .select('id')
        .single();

      const { error } = await alice.client
        .from('spends')
        .update({ savings_goal_id: aliceOtherGoalId })
        .eq('id', contribution!.id);
      expect(error).toBeNull();

      const { data: revisions } = await alice.client
        .from('spend_revisions')
        .select('changed_fields, before')
        .eq('spend_id', contribution!.id);
      expect(revisions).toHaveLength(1);
      expect(revisions![0].changed_fields).toEqual(['savings_goal_id']);
      expect((revisions![0].before as { savings_goal_id: string }).savings_goal_id).toBe(aliceGoalId);
    });

    // The money really moved, so removing the goal must not remove the record
    // of it — only the link.
    it('keeps contributions as savings when their goal is removed', async () => {
      const { data: goal } = await alice.client
        .from('savings_goals')
        .insert({ user_id: alice.id, label: 'alice abandoned', target_paise: 1_000_000 })
        .select('id')
        .single();
      const { data: contribution } = await alice.client
        .from('spends')
        .insert({ user_id: alice.id, amount_paise: 4_000, category: 'savings', savings_goal_id: goal!.id })
        .select('id')
        .single();

      const { error } = await alice.client.from('savings_goals').delete().eq('id', goal!.id);
      expect(error).toBeNull();

      const { data: after } = await alice.client
        .from('spends')
        .select('category, savings_goal_id, amount_paise')
        .eq('id', contribution!.id)
        .single();
      expect(after!.savings_goal_id).toBeNull();
      expect(after!.category).toBe('savings');
      expect(Number(after!.amount_paise)).toBe(4_000);

      const { data: revisions } = await alice.client
        .from('spend_revisions')
        .select('changed_fields')
        .eq('spend_id', contribution!.id);
      expect(revisions).toHaveLength(1);
      expect(revisions![0].changed_fields).toEqual(['savings_goal_id']);
    });

    // Taking money out has its own ledger and its own guard, and both have to
    // hold without the application in the way.
    it('refuses to take money out of another user’s goal', async () => {
      const { error } = await bob.client.from('savings_withdrawals').insert({
        user_id: bob.id,
        savings_goal_id: aliceGoalId,
        amount_paise: 1,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe('42501');
    });

    it('refuses to take out more than a goal holds, counting what went in and came out', async () => {
      const { data: goal } = await alice.client
        .from('savings_goals')
        .insert({ user_id: alice.id, label: 'alice holds 7000', target_paise: 1_000_000, opening_paise: 5_000 })
        .select('id')
        .single();
      const { error: contributionError } = await alice.client.from('spends').insert({
        user_id: alice.id,
        amount_paise: 2_000,
        category: 'savings',
        savings_goal_id: goal!.id,
      });
      expect(contributionError).toBeNull();

      const attempt = (amount: number) =>
        alice.client
          .from('savings_withdrawals')
          .insert({ user_id: alice.id, savings_goal_id: goal!.id, amount_paise: amount });

      const tooMuch = await attempt(7_001);
      expect(tooMuch.error?.code).toBe('23514');

      expect((await attempt(4_000)).error).toBeNull();

      // ₹30 is left; the first withdrawal counts against the second.
      const nowTooMuch = await attempt(3_001);
      expect(nowTooMuch.error?.code).toBe('23514');

      expect((await attempt(3_000)).error).toBeNull();
    });

    it('does not let a withdrawal be edited, or removed by someone else', async () => {
      const { data: goal } = await alice.client
        .from('savings_goals')
        .insert({ user_id: alice.id, label: 'alice fixed', target_paise: 1_000_000, opening_paise: 10_000 })
        .select('id')
        .single();
      const { data: withdrawal } = await alice.client
        .from('savings_withdrawals')
        .insert({ user_id: alice.id, savings_goal_id: goal!.id, amount_paise: 1_000 })
        .select('id')
        .single();

      // No update policy: correcting one means removing it and recording it
      // again, so the balance guard is the only way in.
      const { data: edited } = await alice.client
        .from('savings_withdrawals')
        .update({ amount_paise: 999_999 })
        .eq('id', withdrawal!.id)
        .select('id');
      expect(edited ?? []).toHaveLength(0);

      const { data: removedByBob } = await bob.client
        .from('savings_withdrawals')
        .delete()
        .eq('id', withdrawal!.id)
        .select('id');
      expect(removedByBob ?? []).toHaveLength(0);

      const { data: removed, error } = await alice.client
        .from('savings_withdrawals')
        .delete()
        .eq('id', withdrawal!.id)
        .select('id');
      expect(error).toBeNull();
      expect(removed).toHaveLength(1);
    });

    // Deleting a user cascades to goals (setting spends.savings_goal_id to
    // null, which fires the revision trigger) and to spends. The trap from
    // 20260829100014 in a new shape.
    it('still deletes an account with goals and contributions', async () => {
      const doomed = await createTestUser('doomed-savings');
      const { data: goal } = await doomed.client
        .from('savings_goals')
        .insert({ user_id: doomed.id, label: 'doomed', target_paise: 1_000_000 })
        .select('id')
        .single();
      await doomed.client.from('spends').insert({
        user_id: doomed.id,
        amount_paise: 1_000,
        category: 'savings',
        savings_goal_id: goal!.id,
      });
      // Setting savings_withdrawals.savings_goal_id to null fires the guard
      // mid-deletion; it has to let that through.
      const { error: withdrawalError } = await doomed.client
        .from('savings_withdrawals')
        .insert({ user_id: doomed.id, savings_goal_id: goal!.id, amount_paise: 500 });
      expect(withdrawalError).toBeNull();

      const { error } = await adminClient().auth.admin.deleteUser(doomed.id);
      expect(error, 'account deletion failed').toBeNull();

      const admin = adminClient();
      for (const table of ['savings_goals', 'spends', 'spend_revisions', 'savings_withdrawals']) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', doomed.id);
        expect(data ?? [], `${table} kept rows for a deleted user`).toHaveLength(0);
      }
    }, 60_000);
  });

  // --- kitchen stock ------------------------------------------------------

  describe('kitchen stock keeps to its owner', () => {
    let eggFoodId: string;
    let aliceEggsId: string;
    let aliceLogId: string;
    let bobLogId: string;
    let bobSpendId: string;

    beforeAll(async () => {
      const { data: egg } = await alice.client.from('foods').select('id').eq('slug', 'egg-whole-boiled').single();
      eggFoodId = egg!.id as string;

      const [{ data: eggs, error: eggsError }, { data: aliceLog }, { data: bobLog }, { data: bobSpend }] =
        await Promise.all([
          alice.client
            .from('pantry_items')
            .insert({ user_id: alice.id, label: 'alice eggs', food_id: eggFoodId, unit: 'piece', grams_per_unit: 50 })
            .select('id')
            .single(),
          alice.client
            .from('food_logs')
            .insert({ user_id: alice.id, food_id: eggFoodId, description: '2 eggs', quantity: 2, unit_label: 'piece', grams: 100, kcal: 155 })
            .select('id')
            .single(),
          bob.client
            .from('food_logs')
            .insert({ user_id: bob.id, food_id: eggFoodId, description: 'bob eggs', quantity: 2, unit_label: 'piece', grams: 100, kcal: 155 })
            .select('id')
            .single(),
          bob.client
            .from('spends')
            .insert({ user_id: bob.id, amount_paise: 8_400, category: 'groceries' })
            .select('id')
            .single(),
        ]);
      expect(eggsError).toBeNull();
      aliceEggsId = eggs!.id as string;
      aliceLogId = aliceLog!.id as string;
      bobLogId = bobLog!.id as string;
      bobSpendId = bobSpend!.id as string;

      const { error } = await alice.client
        .from('pantry_movements')
        .insert({ user_id: alice.id, item_id: aliceEggsId, kind: 'bought', quantity: 12, note: 'alice private shop' });
      expect(error).toBeNull();
    }, 60_000);

    it('never shows Bob Alice’s kitchen', async () => {
      for (const table of ['pantry_items', 'pantry_movements']) {
        const { data, error } = await bob.client.from(table).select('user_id');
        expect(error, `${table} errored`).toBeNull();
        expect((data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id), `${table} leaked`).toHaveLength(0);
      }
    });

    it('refuses a movement on another user’s item', async () => {
      const { error } = await bob.client
        .from('pantry_movements')
        .insert({ user_id: bob.id, item_id: aliceEggsId, kind: 'bought', quantity: 1 });
      expect(error?.code).toBe('42501');
    });

    it('refuses a purchase linked to another user’s spend', async () => {
      const { error } = await alice.client
        .from('pantry_movements')
        .insert({ user_id: alice.id, item_id: aliceEggsId, kind: 'bought', quantity: 1, spend_id: bobSpendId });
      expect(error?.code).toBe('42501');
    });

    it('refuses to take another user’s food log from stock', async () => {
      const { error } = await alice.client
        .from('pantry_movements')
        .insert({ user_id: alice.id, item_id: aliceEggsId, kind: 'used', quantity: -2, food_log_id: bobLogId });
      expect(error?.code).toBe('42501');
    });

    it('refuses the wrong sign for what happened', async () => {
      const { error } = await alice.client
        .from('pantry_movements')
        .insert({ user_id: alice.id, item_id: aliceEggsId, kind: 'used', quantity: 5 });
      expect(error?.code).toBe('23514');
    });

    it('takes a food log from stock once, and gives it back when the log is edited', async () => {
      const take = () =>
        alice.client
          .from('pantry_movements')
          .insert({ user_id: alice.id, item_id: aliceEggsId, kind: 'used', quantity: -2, food_log_id: aliceLogId });

      expect((await take()).error).toBeNull();
      expect((await take()).error?.code).toBe('23505');

      const { error: editError } = await alice.client.from('food_logs').update({ quantity: 3, grams: 150 }).eq('id', aliceLogId);
      expect(editError).toBeNull();

      const { data: after } = await alice.client.from('pantry_movements').select('id').eq('food_log_id', aliceLogId);
      expect(after ?? []).toHaveLength(0);
    });

    it('allows only one live item per food', async () => {
      const { error } = await alice.client
        .from('pantry_items')
        .insert({ user_id: alice.id, label: 'more eggs', food_id: eggFoodId, unit: 'piece' });
      expect(error?.code).toBe('23505');
    });

    it('still deletes an account with a stocked kitchen', async () => {
      const doomed = await createTestUser('doomed-kitchen');
      const [{ data: item }, { data: spend }, { data: log }] = await Promise.all([
        doomed.client
          .from('pantry_items')
          .insert({ user_id: doomed.id, label: 'eggs', food_id: eggFoodId, unit: 'piece' })
          .select('id')
          .single(),
        doomed.client.from('spends').insert({ user_id: doomed.id, amount_paise: 8_400, category: 'groceries' }).select('id').single(),
        doomed.client
          .from('food_logs')
          .insert({ user_id: doomed.id, food_id: eggFoodId, description: 'eggs', quantity: 1, unit_label: 'piece', grams: 50, kcal: 78 })
          .select('id')
          .single(),
      ]);
      // A purchase linked to a spend: deleting the account sets spend_id to
      // null, which fires the movement guard mid-deletion.
      const movements = await Promise.all([
        doomed.client.from('pantry_movements').insert({ user_id: doomed.id, item_id: item!.id, kind: 'bought', quantity: 12, spend_id: spend!.id }),
        doomed.client.from('pantry_movements').insert({ user_id: doomed.id, item_id: item!.id, kind: 'used', quantity: -1, food_log_id: log!.id }),
      ]);
      for (const m of movements) expect(m.error).toBeNull();

      const { error } = await adminClient().auth.admin.deleteUser(doomed.id);
      expect(error, 'account deletion failed').toBeNull();

      const admin = adminClient();
      for (const table of ['pantry_items', 'pantry_movements', 'spends', 'food_logs']) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', doomed.id);
        expect(data ?? [], `${table} kept rows for a deleted user`).toHaveLength(0);
      }
    }, 60_000);
  });

  // --- statement import ---------------------------------------------------

  describe('statement imports keep to their owner', () => {
    let aliceBatchId: string;
    let bobSpendId: string;
    let bobIncomeId: string;

    beforeAll(async () => {
      const [{ data: batch, error }, { data: spend }, { data: income }] = await Promise.all([
        alice.client.from('import_batches').insert({ user_id: alice.id, file_name: 'alice.csv', row_count: 1 }).select('id').single(),
        bob.client.from('spends').insert({ user_id: bob.id, amount_paise: 25_000, category: 'eating_out' }).select('id').single(),
        bob.client.from('incomes').insert({ user_id: bob.id, amount_paise: 5_000_000 }).select('id').single(),
      ]);
      expect(error).toBeNull();
      aliceBatchId = batch!.id as string;
      bobSpendId = spend!.id as string;
      bobIncomeId = income!.id as string;

      const seeds = await Promise.all([
        alice.client.from('import_rows').insert({
          user_id: alice.id,
          batch_id: aliceBatchId,
          row_number: 5,
          raw: ['01/09/2026', 'UPI/1/ALICE PHARMACY', '450.00'],
          occurred_on: '2026-09-01',
          description: 'UPI/1/ALICE PHARMACY',
          amount_paise: 45_000,
          direction: 'out',
          merchant_key: 'alice pharmacy',
          category: 'medical',
          category_source: 'none',
        }),
        alice.client.from('merchant_rules').insert({ user_id: alice.id, merchant_key: 'alice pharmacy', category: 'medical' }),
      ]);
      for (const s of seeds) expect(s.error).toBeNull();
    }, 60_000);

    it('never shows Bob Alice’s statement lines or what she taught it', async () => {
      for (const table of ['import_batches', 'import_rows', 'merchant_rules']) {
        const { data, error } = await bob.client.from(table).select('user_id');
        expect(error, `${table} errored`).toBeNull();
        expect((data ?? []).filter((r: { user_id: string }) => r.user_id !== bob.id), `${table} leaked`).toHaveLength(0);
      }
    });

    it('refuses a line added to another user’s batch', async () => {
      const { error } = await bob.client.from('import_rows').insert({
        user_id: bob.id,
        batch_id: aliceBatchId,
        row_number: 99,
        raw: [],
        status: 'unreadable',
      });
      expect(error?.code).toBe('42501');
    });

    it('refuses to link a line to another user’s spend or income', async () => {
      const { data: row } = await alice.client
        .from('import_rows')
        .select('id')
        .eq('batch_id', aliceBatchId)
        .eq('row_number', 5)
        .single();

      for (const change of [{ spend_id: bobSpendId }, { duplicate_of_spend: bobSpendId }, { income_id: bobIncomeId }]) {
        const { error } = await alice.client.from('import_rows').update(change).eq('id', row!.id);
        expect(error?.code, JSON.stringify(change)).toBe('42501');
      }
    });

    it('refuses a pending line with no amount', async () => {
      const { error } = await alice.client.from('import_rows').insert({
        user_id: alice.id,
        batch_id: aliceBatchId,
        row_number: 6,
        raw: ['Opening balance'],
        status: 'pending',
      });
      expect(error?.code).toBe('23514');
    });

    it('still deletes an account with an imported statement', async () => {
      const doomed = await createTestUser('doomed-import');
      const [{ data: batch }, { data: spend }] = await Promise.all([
        doomed.client.from('import_batches').insert({ user_id: doomed.id, row_count: 1 }).select('id').single(),
        doomed.client.from('spends').insert({ user_id: doomed.id, amount_paise: 1_000, category: 'groceries' }).select('id').single(),
      ]);
      // A recorded line points at its spend; deleting the account sets that
      // link to null while the guard is watching.
      const { error: rowError } = await doomed.client.from('import_rows').insert({
        user_id: doomed.id,
        batch_id: batch!.id,
        row_number: 2,
        raw: [],
        occurred_on: '2026-09-01',
        amount_paise: 1_000,
        direction: 'out',
        status: 'imported',
        spend_id: spend!.id,
        duplicate_of_spend: spend!.id,
      });
      expect(rowError).toBeNull();

      const { error } = await adminClient().auth.admin.deleteUser(doomed.id);
      expect(error, 'account deletion failed').toBeNull();

      const admin = adminClient();
      for (const table of ['import_batches', 'import_rows', 'merchant_rules', 'spends']) {
        const { data } = await admin.from(table).select('user_id').eq('user_id', doomed.id);
        expect(data ?? [], `${table} kept rows for a deleted user`).toHaveLength(0);
      }
    }, 60_000);
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
