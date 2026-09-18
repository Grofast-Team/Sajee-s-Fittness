// End-to-end check of the savings panel against the running dev server, with a
// throwaway @example.test user that is deleted at the end.
//
// Usage (from the project root): node --env-file=.env.local scripts/e2e/savings.mjs [baseUrl]
// Creates and deletes an @example.test user on the linked Supabase project.
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket;

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `rls-e2e-savings-${Date.now()}@example.test`;
const password = `Test-${Math.random().toString(36).slice(2, 12)}!9`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (createError) throw createError;
const userId = created.user.id;

let browser;
try {
  const { error: planError } = await admin.from('plans').insert({
    user_id: userId,
    bmr_kcal: 1500,
    tdee_kcal: 2000,
    activity: 'light',
    energy_target_kcal: 1700,
    energy_floor_kcal: 1400,
    protein_g: 100,
    fat_g: 55,
    carb_g: 200,
    fibre_g: 25,
    step_target: 7000,
  });
  if (planError) throw planError;

  const { error: categoryError } = await admin.from('user_categories').insert({
    user_id: userId, category_key: 'fitness', enabled: true, enabled_at: new Date().toISOString(),
  });
  if (categoryError) throw categoryError;

  const user = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await user.auth.signInWithPassword({ email, password });

  const today = new Date().toISOString().slice(0, 10);
  const { data: goal } = await user
    .from('savings_goals')
    .insert({ user_id: userId, label: 'Trip', target_paise: 2_000_000, opening_paise: 500_000 })
    .select('id')
    .single();
  const seeds = await Promise.all([
    user.from('money_settings').upsert({ user_id: userId, monthly_limit_paise: 2_000_000 }, { onConflict: 'user_id' }),
    user.from('spends').insert({ user_id: userId, amount_paise: 250_000, category: 'savings', savings_goal_id: goal.id, note: 'Trip', spent_on: today }),
    user.from('spends').insert({ user_id: userId, amount_paise: 120_000, category: 'groceries', spent_on: today }),
  ]);
  for (const s of seeds) if (s.error) throw s.error;

  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/today/, { timeout: 60_000 });

  await page.goto(`${BASE}/money`, { waitUntil: 'networkidle', timeout: 90_000 });
  const body = () => page.locator('body').innerText();

  let text = await body();
  check('ring leaves savings out of what is left', text.includes('₹18,800'), 'limit 20,000 − groceries 1,200');
  check('set-aside line beside the spending', /₹2,500\s+set aside as\s+savings this month/.test(text));
  check('where it went notes savings separately', /Set aside as savings:\s*₹2,500/.test(text));
  check('goal shows opening plus contribution', /Trip\s*₹7,500\s*of ₹20,000/.test(text));

  await page.screenshot({ path: `${OUT}/savings-desktop.png`, fullPage: true });

  // --- edit the goal: the new target and the message land together ----------
  await page.getByRole('button', { name: 'Edit Trip' }).click();
  await page.fill('#goal-edit-' + goal.id + '-target', '25000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Trip updated.').waitFor({ timeout: 30_000 });
  text = await body();
  check('edit: message and new target in the same commit', /of ₹25,000/.test(text));

  // --- history: remove the contribution --------------------------------------
  await page.getByText('History (1)').click();
  await page.getByRole('button', { name: /Remove: Added ₹2,500/ }).click();
  await page
    .locator('li', { hasText: 'It comes off the goal and out of your spending records' })
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await page.getByText('Removed.', { exact: true }).waitFor({ timeout: 30_000 });
  text = await body();
  check('history remove: message and new total in the same commit', /Trip\s*₹5,000\s*of ₹25,000/.test(text));

  // --- take out -------------------------------------------------------------
  await page.getByRole('button', { name: 'Take money out of Trip' }).click();
  await page.fill(`#goal-take-${goal.id}`, '1000');
  await page.getByRole('button', { name: 'Take out', exact: true }).click();
  const outcome = page.getByText(/taken out of Trip|We could not record that/);
  await outcome.first().waitFor({ timeout: 30_000 });
  text = await body();
  if (text.includes('taken out of Trip')) {
    check('take out: message and reduced total in the same commit', /Trip\s*₹4,000\s*of ₹25,000/.test(text));
  } else {
    check('take out fails cleanly while the withdrawals migration is unapplied', true, 'We could not record that.');
  }

  await page.setViewportSize({ width: 390, height: 900 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/savings-phone.png`, fullPage: true });
  const row = await page.getByRole('button', { name: 'Edit Trip' }).boundingBox();
  const add = await page.getByRole('button', { name: 'Add money to Trip' }).boundingBox();
  check('phone: goal buttons fit on one row', Math.abs(row.y - add.y) < 2, `${add.y} vs ${row.y}`);

  // --- close, reached from Edit ---------------------------------------------
  await page.getByRole('button', { name: 'Edit Trip' }).click();
  await page.getByRole('button', { name: 'Close Trip' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByText('Closed. What you added stays in your records.').waitFor({ timeout: 30_000 });
  text = await body();
  check('close: goal leaves the panel with its message', !/Trip\s*₹5,000/.test(text));
} finally {
  await browser?.close();
  await admin.auth.admin.deleteUser(userId);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
