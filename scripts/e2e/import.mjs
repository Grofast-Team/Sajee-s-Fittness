// End-to-end check of /money/import with a throwaway @example.test user.
// Runs the full flow when the import tables exist; otherwise checks the page
// says so plainly.
// Usage (from the project root): node --env-file=.env.local scripts/e2e/import.mjs [baseUrl]
// Creates and deletes an @example.test user on the linked Supabase project.
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket;

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = process.env.SHOTS ?? '.';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = `rls-e2e-import-${Date.now()}@example.test`;
const password = `Test-${Math.random().toString(36).slice(2, 12)}!9`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// An HDFC-style export: preamble, split columns, a repeated line from an
// overlapping export, a spend already typed by hand (Swiggy ₹250 on the 2nd),
// a salary credit, and a closing-balance line that is not a transaction.
const statement = [
  'HDFC BANK Ltd.,,,,,,',
  'Statement of account,,,,,,',
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '01/09/26,NEFT CR-HDFC0000001-ACME PAYROLL-SALARY SEP,N244123456,01/09/26,,"50,000.00","95,750.00"',
  '02/09/26,UPI-SWIGGY-SWIGGY8@YBL-YESB0YBLUPI-424512345678-PAYMENT,0000424512345678,02/09/26,250.00,,"95,500.00"',
  '03/09/26,POS 512345XXXXXX1234 DMART AVENUE SUP,0000000000000001,03/09/26,"1,840.50",,"93,659.50"',
  '04/09/26,UPI/412345678901/Payment from Ph/sharma.kirana@okaxis/ICICI Bank,412345678901,04/09/26,320.00,,"93,339.50"',
  '05/09/26,ATW-512345XXXXXX1234-S1ANMU12-MUMBAI,0000000000000002,05/09/26,"2,000.00",,"91,339.50"',
  '05/09/26,ATW-512345XXXXXX1234-S1ANMU12-MUMBAI,0000000000000002,05/09/26,"2,000.00",,"91,339.50"',
  ',,Closing balance,,,,"91,339.50"',
].join('\r\n');

const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createError) throw createError;
const userId = created.user.id;
const csvPath = path.join(os.tmpdir(), `statement-${Date.now()}.csv`);
fs.writeFileSync(csvPath, statement);

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
  // Typed in by hand on the day, before the statement arrived.
  const { error: typedError } = await user
    .from('spends')
    .insert({ user_id: userId, amount_paise: 25_000, category: 'eating_out', note: 'lunch', spent_on: '2026-09-02' });
  if (typedError) throw typedError;

  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/today/, { timeout: 60_000 });

  await page.goto(`${BASE}/money`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('link', { name: 'Import a statement' }).click();
  await page.waitForURL(/\/money\/import$/, { timeout: 60_000 });
  await page.getByRole('heading', { name: 'Import a statement', exact: true }).waitFor({ timeout: 60_000 });
  check('link from the money screen', page.url().endsWith('/money/import'));

  const body = () => page.locator('body').innerText();
  let text = await body();

  if (text.includes('Statement import is not set up yet')) {
    check('says plainly that the tables are missing, rather than offering an import that cannot save', true);
    await page.screenshot({ path: `${OUT}/import-unavailable.png`, fullPage: true });
  } else {
    await page.setInputFiles('#statement-file', csvPath);
    await page.getByText(/Check these 7 lines/).waitFor({ timeout: 30_000 });
    text = await body();
    check('mapping guessed from the header', (await page.locator('#map-date').inputValue()) === '0' && (await page.locator('#map-money-out-withdrawals-').inputValue()) === '4');
    check('preview counts', /5\s*out \(₹6,410\.50\),\s*1\s*in \(₹50,000\), 1 we cannot read/.test(text));
    await page.screenshot({ path: `${OUT}/import-mapping.png`, fullPage: true });

    await page.getByRole('button', { name: /Check these 7 lines/ }).click();
    await page.waitForURL(/\/money\/import\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await page.getByRole('heading', { name: 'Review the import' }).waitFor({ timeout: 90_000 }).catch(async (e) => {
      await page.screenshot({ path: `${OUT}/import-failure.png`, fullPage: true });
      console.log(page.url(), '\n', await body());
      throw e;
    });
    text = await body();
    check('out tab: known merchants suggested', /DMART[\s\S]*Known merchant/.test(text));
    check('no guess for a person or a shop it does not know', /sharma kirana[\s\S]*No suggestion/.test(text));
    check('duplicates found: typed spend and repeated line', /Possible duplicates\s*2/.test(text));

    await page.getByRole('tab', { name: /Possible duplicates/ }).click();
    text = await body();
    check('duplicate of a typed spend is explained', /Looks like ₹250 on 02\/09\/26 already recorded as eating out \(lunch\)/.test(text));
    check('repeated line is explained', /The same as line 8 of this file/.test(text));

    await page.getByRole('tab', { name: /Money out/ }).click();
    await page.locator('select[id^="cat-"]').nth(1).selectOption('groceries'); // sharma kirana
    await page.screenshot({ path: `${OUT}/import-review.png`, fullPage: true });

    await page.getByRole('button', { name: 'Record ticked lines' }).click();
    await page.getByText(/Recorded 3 spends \(₹4,160\.50\)\. 3 left out\./).waitFor({ timeout: 60_000 });
    check('confirm: three spends recorded, the rest left out', true);

    const { data: spends } = await user.from('spends').select('amount_paise, category, spent_on').eq('user_id', userId).order('spent_on');
    check('spends written through the ordinary path', spends.length === 4 && spends.some((s) => Number(s.amount_paise) === 184_050 && s.category === 'groceries'));
    const { data: rules } = await user.from('merchant_rules').select('merchant_key, category').eq('user_id', userId);
    check('learned the corrected merchant only', rules.length === 1 && rules[0].merchant_key === 'sharma kirana' && rules[0].category === 'groceries');

    // Import the same statement again: everything recorded is now a duplicate.
    await page.goto(`${BASE}/money/import`, { waitUntil: 'networkidle' });
    await page.setInputFiles('#statement-file', csvPath);
    await page.getByRole('button', { name: /Check these 7 lines/ }).click();
    await page.waitForURL(/\/money\/import\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    text = await body();
    check('a second import of the same file finds it all already recorded', /Money out\s*0/.test(text) && /Possible duplicates\s*5/.test(text));
    const batchId = page.url().split('/').pop();
    const { data: taught } = await user.from('import_rows').select('category, category_source').eq('batch_id', batchId).eq('merchant_key', 'sharma kirana').single();
    check('what it was taught is applied next time', taught.category === 'groceries' && taught.category_source === 'rule');
  }

  const phone = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: 'dark', storageState: await context.storageState() });
  const p2 = await phone.newPage();
  await p2.goto(`${BASE}/money/import`, { waitUntil: 'networkidle', timeout: 90_000 });
  await p2.screenshot({ path: `${OUT}/import-phone-dark.png`, fullPage: true });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('phone: no sideways scroll', overflow <= 0, `${overflow}px`);
} finally {
  await browser?.close();
  await admin.auth.admin.deleteUser(userId);
  fs.rmSync(csvPath, { force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
