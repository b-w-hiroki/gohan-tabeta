// Local-only Chromium smoke check used to capture the backup restore flow.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'test-results');
await mkdir(output, { recursive: true });
const server = await startServer(root);
const headed = process.argv.includes('--headed');
const browser = await chromium.launch({
  headless: !headed,
  ...(headed ? { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', slowMo: 120 } : {}),
});
const context = await browser.newContext({ viewport: { width: 1200, height: 820 } });
await context.addInitScript(() => localStorage.setItem('authMode', 'local'));
const page = await context.newPage();
await page.route((url) => url.hostname !== '127.0.0.1', (route) => route.abort());
await page.route('**/js/firebase-config.js', (route) => route.fulfill({
  contentType: 'text/javascript', body: 'export const FIREBASE_CONFIG = null;',
}));
page.on('dialog', (dialog) => dialog.accept());

try {
  await page.goto(`${server.url}/app.html#/settings`);
  await page.waitForSelector('.view');
  await page.click('[role=tab] >> nth=4');
  await page.screenshot({ path: resolve(output, 'gohan-restore-before.png'), fullPage: true });

  const date = await page.evaluate(async () => (await import('./js/util.js')).todayKey());
  const meals = Object.fromEntries(['breakfast', 'lunch', 'dinner', 'snack'].map((name) => [name, {
    items: name === 'breakfast' ? [{ name: '復元確認ごはん', kcal: 420 }] : [], photos: [], memo: '',
  }]));
  const data = {
    app: 'gohan-tabeta', version: 1,
    settings: { goalKcal: 1900, myFoods: [{ name: '復元確認メニュー', kcal: 420 }] },
    days: [{ date, meals, exercises: [] }], photos: [],
  };
  await page.setInputFiles('input[type=file][accept*="json"]', {
    name: 'local-restore-check.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.waitForSelector('.toast');
  await page.screenshot({ path: resolve(output, 'gohan-restore-success.png'), fullPage: true });

  await page.goto(`${server.url}/app.html#/today`);
  await page.waitForSelector('.meal-breakfast');
  await page.click('.tab-breakfast');
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(output, 'gohan-restored-day.png'), fullPage: true });

  // Make the second IndexedDB write fail. The first restored record must stay readable.
  await page.goto(`${server.url}/app.html#/settings`);
  await page.waitForSelector('.view');
  await page.click('[role=tab] >> nth=4');
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    let calls = 0;
    IDBObjectStore.prototype.put = function patchedPut(...args) {
      calls += 1;
      if (calls === 2) {
        IDBObjectStore.prototype.put = originalPut;
        throw new DOMException('simulated capacity exhaustion', 'QuotaExceededError');
      }
      return originalPut.apply(this, args);
    };
  });
  const replacementMeals = structuredClone(meals);
  replacementMeals.breakfast.items = [{ name: '失敗時に残ってはいけない食事', kcal: 999 }];
  const failingData = {
    ...data,
    days: [
      { date, meals: replacementMeals, exercises: [] },
      { date: '2026-09-30', meals: replacementMeals, exercises: [] },
    ],
  };
  await page.setInputFiles('input[type=file][accept*="json"]', {
    name: 'local-restore-failure.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(failingData)),
  });
  await page.waitForSelector('.toast');
  await page.screenshot({ path: resolve(output, 'gohan-restore-failure.png'), fullPage: true });

  await page.goto(`${server.url}/app.html#/today`);
  await page.waitForSelector('.meal-breakfast');
  await page.click('.tab-breakfast');
  await page.waitForSelector('.item-name:has-text("復元確認ごはん")');
  await page.screenshot({ path: resolve(output, 'gohan-restore-failure-preserved.png'), fullPage: true });
  console.log(`local ${headed ? 'headed Edge' : 'Chromium'} restore check passed at ${server.url}`);
} finally {
  await context.close();
  await browser.close();
  server.close();
}
