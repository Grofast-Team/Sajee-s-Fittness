// End-to-end check of /money/trends with a throwaway @example.test user.
// Usage (from the project root): node --env-file=.env.local scripts/e2e/trends.mjs [baseUrl]
// Creates and deletes an @example.test user on the linked Supabase project.
// Seeds June–September 2026 and expects September to be the current month;
// after that, move the seeded dates forward.
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

const email = `rls-e2e-trends-${Date.now()}@example.test`;
const password = `Test-${Math.random().toString(36).slice(2, 12)}!9`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createError) throw createError;
const userId = created.user.id;

let browser;
try {
  const { error: planError } = await admin.from('plans').insert({
    user_id: userId, bmr_kcal: 1500, tdee_kcal: 2000, activity: 'light', energy_target_kcal: 1700,
    energy_floor_kcal: 1400, protein_g: 100, fat_g: 55, carb_g: 200, fibre_g: 25, step_target: 7000,
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

  const s = (spent_on, rupees, category) => ({ user_id: userId, spent_on, amount_paise: rupees * 100, category });
  const spends = [
    s('2026-02-10', 100, 'groceries'), // before the window: June counts as fully recorded
    s('2026-06-02', 12_000, 'rent'), s('2026-06-10', 6_000, 'groceries'), s('2026-06-20', 2_000, 'eating_out'), s('2026-06-25', 5_000, 'savings'),
    s('2026-07-02', 12_000, 'rent'), s('2026-07-10', 6_500, 'groceries'), s('2026-07-20', 1_800, 'eating_out'), s('2026-07-25', 5_000, 'savings'),
    s('2026-08-02', 12_000, 'rent'), s('2026-08-10', 6_200, 'groceries'), s('2026-08-20', 3_900, 'eating_out'), s('2026-08-25', 8_000, 'savings'),
    s('2026-09-02', 12_000, 'rent'), s('2026-09-08', 1_500, 'groceries'),
  ];
  const incomes = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((received_on) => ({
    user_id: userId, received_on, amount_paise: 5_000_000,
  }));
  const c = (label, rupees, category, cadence = 'monthly') => ({
    user_id: userId, label, amount_paise: rupees * 100, category, cadence, due_day: 2, started_on: '2026-01-01',
  });
  const seeds = await Promise.all([
    user.from('spends').insert(spends),
    user.from('incomes').insert(incomes),
    user.from('commitments').insert([
      c('Rent', 12_000, 'rent'), c('Netflix', 649, 'entertainment'), c('Spotify', 119, 'other'),
      c('Insurance', 12_000, 'medical', 'yearly'), c('SIP', 5_000, 'savings'),
    ]),
  ]);
  for (const r of seeds) if (r.error) throw r.error;

  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/today/, { timeout: 60_000 });

  await page.goto(`${BASE}/money`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('link', { name: 'Trends over time' }).click();
  await page.waitForURL(/\/money\/trends/, { timeout: 60_000 });
  await page.getByRole('heading', { name: 'Trends' }).waitFor();
  const text = await page.locator('body').innerText();

  check('link from the money screen', page.url().endsWith('/money/trends'));
  // The seeded months are fixed (June–September 2026), so the exact figures in
  // this sentence depend on the day it runs; its shape does not.
  check('headline compares the same point of last month',
    /spent in the first \d+ days? — .* than by the same point last month|about the same as by this point last month/.test(text));
  check('usual month from full months', /A usual month\s*₹20,800/.test(text));
  check('savings rate', /Set aside\s*12%/.test(text));
  check('fixed costs share', /Fixed costs\s*28%/.test(text));
  check('what changed', text.includes('August: ₹22,100 spent, ₹1,800 more than July.'));
  check('mover named with from and to', /Eating out\s*↑ ₹2,100\s*₹1,800 → ₹3,900/.test(text));
  check('subscriptions with a yearly total', text.includes('₹768 a month on 2 subscriptions — ₹9,216 a year.'));
  check('SIP not counted as a fixed cost', !/SIP/.test(text));
  check('current month labelled so far', /Sept?\s*so far/.test(text));

  // Hover a month: the readout names it with its figures.
  await page.getByRole('button', { name: /^August: ₹22,100 spent/ }).hover();
  await page.getByText(/August: ₹22,100 spent, ₹8,000 set aside, of ₹50,000 that came in\./).waitFor({ timeout: 10_000 });
  check('hover readout for a month', true);

  await page.getByText('Show as a table').click();
  const table = await page.locator('table').innerText();
  check('table view carries every month', /June\s*₹20,000\s*₹5,000\s*₹50,000\s*₹25,000/.test(table), 'June row');

  await page.screenshot({ path: `${OUT}/trends-desktop.png`, fullPage: true });

  const dark = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: 'dark', storageState: await context.storageState() });
  const phone = await dark.newPage();
  await phone.goto(`${BASE}/money/trends`, { waitUntil: 'networkidle', timeout: 90_000 });
  await phone.screenshot({ path: `${OUT}/trends-phone-dark.png`, fullPage: true });
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('phone: no sideways scroll', overflow <= 0, `${overflow}px`);
} finally {
  await browser?.close();
  await admin.auth.admin.deleteUser(userId);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
