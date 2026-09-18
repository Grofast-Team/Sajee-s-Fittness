// End-to-end check of /kitchen with a throwaway @example.test user.
// Runs the full flow when the kitchen tables exist; otherwise checks the page
// says so plainly.
// Usage (from the project root): node --env-file=.env.local scripts/e2e/kitchen.mjs [baseUrl]
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

const email = `rls-e2e-kitchen-${Date.now()}@example.test`;
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

  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/today/, { timeout: 60_000 });

  await page.goto(`${BASE}/food`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('link', { name: 'Kitchen stock' }).click();
  await page.waitForURL(/\/kitchen/, { timeout: 60_000 });
  await page.getByRole('heading', { name: 'Kitchen', exact: true }).waitFor({ timeout: 60_000 }).catch(async (e) => {
    await page.screenshot({ path: `${OUT}/kitchen-failure.png`, fullPage: true });
    throw e;
  });
  check('link from the food screen', page.url().endsWith('/kitchen'));

  const body = () => page.locator('body').innerText();
  let text = await body();

  if (text.includes('Kitchen stock is not set up yet')) {
    check('says plainly that the tables are missing, rather than showing anything', true);
    await page.screenshot({ path: `${OUT}/kitchen-unavailable.png`, fullPage: true });
  } else {
    // --- add an item linked to a food ------------------------------------
    await page.fill('#kitchen-food', 'egg');
    await page.getByRole('button', { name: 'Egg, boiled' }).click();
    await page.fill('#kitchen-onhand', '6');
    await page.getByRole('button', { name: 'Start tracking' }).click();
    await page.getByText('Egg, boiled added.').waitFor({ timeout: 30_000 });
    text = await body();
    check('add: item appears with what is there', /Egg, boiled\s*6/.test(text));

    // --- buy, with a cost -------------------------------------------------
    await page.getByRole('button', { name: 'Bought: Egg, boiled' }).click();
    await page.fill('input[id^="bought-"]', '12');
    await page.fill('input[id$="-cost"]', '84');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('12 Egg, boiled added, and ₹84 recorded under groceries.').waitFor({ timeout: 30_000 });
    text = await body();
    check('bought: stock and message together', /Egg, boiled\s*18/.test(text));

    // --- a food log, confirmed from home ----------------------------------
    const { data: egg } = await user.from('foods').select('id').eq('slug', 'egg-whole-boiled').single();
    const { error: logError } = await user.from('food_logs').insert({
      user_id: userId, food_id: egg.id, description: '2 piece Egg, boiled', quantity: 2, unit_label: 'piece', grams: 100, kcal: 155,
    });
    if (logError) throw logError;
    await page.reload({ waitUntil: 'networkidle' });
    text = await body();
    check('food log offered', /From your food log/.test(text) && /would take 2/.test(text));
    await page.getByRole('button', { name: 'From home', exact: true }).click();
    await page.getByText('2 Egg, boiled taken from stock.').waitFor({ timeout: 30_000 }).catch(async (e) => {
      await page.screenshot({ path: `${OUT}/kitchen-failure.png`, fullPage: true });
      console.log(await body());
      throw e;
    });
    text = await body();
    check('from home: taken from stock, offer gone', /Egg, boiled\s*16/.test(text) && !/From your food log/.test(text));

    // --- count ------------------------------------------------------------
    await page.getByRole('button', { name: 'Count: Egg, boiled' }).click();
    await page.fill('input[id^="counted-"]', '10');
    await page.getByRole('button', { name: 'Set', exact: true }).click();
    await page.getByText('Egg, boiled: 10 there now.').waitFor({ timeout: 30_000 });
    text = await body();
    check('count: corrects what is there', /Egg, boiled\s*10/.test(text));
    check('no estimate from a single day of use', /Not enough use recorded yet/.test(text));

    await page.screenshot({ path: `${OUT}/kitchen-desktop.png`, fullPage: true });

    // --- the purchase reached the money screen -----------------------------
    await page.goto(`${BASE}/money`, { waitUntil: 'networkidle', timeout: 90_000 });
    text = await body();
    check('purchase cost appears as a groceries spend', /Groceries\s*Egg, boiled\s*₹84/.test(text));
  }

  const phone = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: 'dark', storageState: await context.storageState() });
  const p2 = await phone.newPage();
  await p2.goto(`${BASE}/kitchen`, { waitUntil: 'networkidle', timeout: 90_000 });
  await p2.screenshot({ path: `${OUT}/kitchen-phone-dark.png`, fullPage: true });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('phone: no sideways scroll', overflow <= 0, `${overflow}px`);
} finally {
  await browser?.close();
  await admin.auth.admin.deleteUser(userId);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
