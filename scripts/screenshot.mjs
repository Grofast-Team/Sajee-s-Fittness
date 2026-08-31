#!/usr/bin/env node
/**
 * Screenshot a page using the Chrome already installed on this machine.
 *
 * Design work needs looking at, not inferring from markup. Playwright's own
 * browser download is a large fetch that is unreliable on a slow connection, so
 * this drives the system Chrome via `channel: 'chrome'` instead.
 *
 * Usage:
 *   node scripts/screenshot.mjs <out.png> <url> [cookieJar] [light|dark] [width]
 */

import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [out, url, cookieJar, scheme = 'dark', width = '390'] = process.argv.slice(2);

if (!out || !url) {
  console.error('Usage: node scripts/screenshot.mjs <out.png> <url> [cookieJar] [scheme] [width]');
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: Number(width), height: 1200 },
  deviceScaleFactor: 2,
  colorScheme: scheme === 'light' ? 'light' : 'dark',
});

// Netscape cookie jar, as written by the verification scripts.
if (cookieJar && fs.existsSync(cookieJar)) {
  const cookies = fs
    .readFileSync(cookieJar, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [domain, , path, , , name, value] = line.split('\t');
      return { name, value, domain, path, httpOnly: false, secure: false };
    });
  await context.addCookies(cookies);
}

const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
// Let webfonts land and the rail animation settle before capturing.
await page.waitForTimeout(1400);
await page.screenshot({ path: out, fullPage: true });

console.log(`saved ${out}`);
await browser.close();
