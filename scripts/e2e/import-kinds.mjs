// End-to-end check that imported lines are filed as the right kind of money:
// spending, saving to a goal, income from a source, transfers kept out, refunds
// not recorded — and that a transfer's other leg is found in a second bank's
// statement.
// Usage (from the project root): node --env-file=.env.local scripts/e2e/import-kinds.mjs [baseUrl]
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

const email = `rls-e2e-kinds-${Date.now()}@example.test`;
const password = `Test-${Math.random().toString(36).slice(2, 12)}!9`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const header = 'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance';
const bankA = [
  'BANK A,,,,,,',
  header,
  '01/09/26,NEFT CR-ACME PAYROLL-SALARY SEP,N1,01/09/26,,"50,000.00","60,000.00"',
  '02/09/26,UPI-SWIGGY-SWIGGY8@YBL-1-PAYMENT,R2,02/09/26,250.00,,"59,750.00"',
  '03/09/26,ACH D- ZERODHA BROKING-SIP,R3,03/09/26,"5,000.00",,"54,750.00"',
  '04/09/26,BIL/ONL/000123/CRED CLUB/CC PAYMENT,R4,04/09/26,"18,000.00",,"36,750.00"',
  '05/09/26,IMPS-P2A-TRANSFER TO SELF-BANK B,R5,05/09/26,"7,000.00",,"29,750.00"',
  '06/09/26,UPI REFUND AMAZON,R6,06/09/26,,499.00,"30,249.00"',
  '07/09/26,UPI/412345/RAVI KUMAR/okaxis,R7,07/09/26,,800.00,"31,049.00"',
].join('\r\n');
const bankB = [
  'BANK B,,,,,,',
  header,
  '06/09/26,NEFT CR-HDFC0000001-SAJEE,N9,06/09/26,,"7,000.00","7,000.00"',
].join('\r\n');

const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (createError) throw createError;
const userId = created.user.id;
const fileA = path.join(os.tmpdir(), `bank-a-${Date.now()}.csv`);
const fileB = path.join(os.tmpdir(), `bank-b-${Date.now()}.csv`);
fs.writeFileSync(fileA, bankA);
fs.writeFileSync(fileB, bankB);

let browser;
try {
  const { error: planError } = await admin.from('plans').insert({
    user_id: userId, bmr_kcal: 1500, tdee_kcal: 2000, activity: 'light', energy_target_kcal: 1700,
    energy_floor_kcal: 1400, protein_g: 100, fat_g: 55, carb_g: 200, fibre_g: 25, step_target: 7000,
  });
  if (planError) throw planError;

  const user = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await user.auth.signInWithPassword({ email, password });
  const [{ data: goal }, { data: source }] = await Promise.all([
    user.from('savings_goals').insert({ user_id: userId, label: 'Emergency fund', target_paise: 10_000_000 }).select('id').single(),
    user.from('income_sources').insert({ user_id: userId, label: 'Acme salary', kind: 'salary' }).select('id').single(),
  ]);

  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' });
  const page = await context.newPage();
  const body = () => page.locator('body').innerText();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/today/, { timeout: 60_000 });

  // --- Bank A -----------------------------------------------------------------
  await page.goto(`${BASE}/money/import`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.setInputFiles('#statement-file', fileA);
  await page.getByRole('button', { name: /Check these 7 lines/ }).click();
  await page.waitForURL(/\/money\/import\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  await page.getByRole('heading', { name: 'Review the import' }).waitFor({ timeout: 90_000 });

  let text = await body();
  check('one line of spending', /Spending\s*1/.test(text));
  check('the SIP read as saving', /Saving\s*1/.test(text));
  check('salary, refund and the friend’s payment as money in', /Money in\s*3/.test(text));
  check('card bill and transfer to self kept apart as transfers', /Transfers\s*2/.test(text));

  await page.getByRole('tab', { name: /Transfers/ }).click();
  text = await body();
  check('the card bill says why it is not spending', /The spending is on the card statement/.test(text));

  await page.getByRole('tab', { name: /^Saving/ }).click();
  await page.locator('select[id^="goal-"]').first().selectOption(goal.id);

  await page.getByRole('tab', { name: /Money in/ }).click();
  text = await body();
  check('a refund is not called income', /Looks like a refund\. A refund is not income\./.test(text));
  await page.locator('select[id^="src-"]').first().selectOption(source.id); // the salary line
  await page.screenshot({ path: `${OUT}/kinds-review.png`, fullPage: true });

  await page.getByRole('button', { name: 'Record ticked lines' }).click();
  const outcome = page.getByText(/^Recorded /);
  await outcome.waitFor({ timeout: 90_000 });
  text = await body();
  check(
    'confirm message counts each kind',
    /Recorded 1 spend \(₹250\), ₹5,000 saved, ₹50,000 income\. 2 transfers kept out of spending and income\. 1 refund not recorded/.test(text),
  );

  const [spendsRes, incomesRes, rulesRes] = await Promise.all([
    user.from('spends').select('amount_paise, category, savings_goal_id').eq('user_id', userId),
    user.from('incomes').select('amount_paise, source_id').eq('user_id', userId),
    user.from('merchant_rules').select('merchant_key, direction, kind, savings_goal_id, income_source_id').eq('user_id', userId),
  ]);
  const spends = spendsRes.data ?? [];
  check('only spending and saving reached the ledger', spends.length === 2, JSON.stringify(spends));
  check('the SIP is a savings spend on the goal', spends.some((s) => Number(s.amount_paise) === 500_000 && s.category === 'savings' && s.savings_goal_id === goal.id));
  check('no card bill or transfer recorded as spending', !spends.some((s) => [1_800_000, 700_000].includes(Number(s.amount_paise))));
  check('salary recorded from its source; refund and friend not recorded', (incomesRes.data ?? []).length === 1 && incomesRes.data[0].source_id === source.id);
  const rules = rulesRes.data ?? [];
  check('learned the SIP goal and the salary source', rules.some((r) => r.kind === 'saving' && r.savings_goal_id === goal.id) && rules.some((r) => r.kind === 'income' && r.income_source_id === source.id), JSON.stringify(rules));

  await page.goto(`${BASE}/money`, { waitUntil: 'networkidle', timeout: 90_000 });
  text = await body();
  check('the goal shows the SIP', /Emergency fund\s*₹5,000\s*of ₹1,00,000/.test(text));

  // --- Bank B: the other leg of the transfer ----------------------------------
  await page.goto(`${BASE}/money/import`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.setInputFiles('#statement-file', fileB);
  await page.getByRole('button', { name: /Check this 1 line/ }).click();
  await page.waitForURL(/\/money\/import\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  await page.getByRole('heading', { name: 'Review the import' }).waitFor({ timeout: 90_000 });
  text = await body();
  check('the arriving ₹7,000 is matched to the transfer from bank A', /Transfers\s*1/.test(text));
  await page.getByRole('tab', { name: /Transfers/ }).click();
  text = await body();
  check('and says where the other side is', /Matches ₹7,000 going out on 05\/09 in another statement you imported/.test(text));
  await page.screenshot({ path: `${OUT}/kinds-transfer.png`, fullPage: true });

  const phone = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: 'dark', storageState: await context.storageState() });
  const p2 = await phone.newPage();
  await p2.goto(page.url(), { waitUntil: 'networkidle', timeout: 90_000 });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('phone: no sideways scroll on review', overflow <= 0, `${overflow}px`);
} finally {
  await browser?.close();
  await admin.auth.admin.deleteUser(userId);
  fs.rmSync(fileA, { force: true });
  fs.rmSync(fileB, { force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
