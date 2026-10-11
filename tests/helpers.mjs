// Shared test helpers: browser contexts with blocked external requests, error capture and layout checks.
import { chromium, devices } from 'playwright';

export const PHONES = ['iPhone SE', 'iPhone 13'];

export async function launch() {
  return chromium.launch();
}

// A page on the app. local=true starts in "use without login" mode.
// cloud=false serves a null Firebase config so tests never depend on the real project.
export async function openPage(browser, base, { device = 'iPhone 13', local = true, scheme = 'light', permissions, cloud = false } = {}) {
  // App-shell/offline behavior is covered separately. Blocking service workers here keeps
  // the Firebase config route deterministic across reloads and avoids the installed worker
  // replacing the test's null config with the production file.
  const ctx = await browser.newContext({ ...devices[device], colorScheme: scheme, serviceWorkers: 'block' });
  if (permissions) await ctx.grantPermissions(permissions, { origin: base });
  if (local) {
    await ctx.addInitScript(() => {
      try { if (!localStorage.getItem('authMode')) localStorage.setItem('authMode', 'local'); } catch { /* about:blank */ }
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  await page.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort());
  if (!cloud) {
    await page.route('**/js/firebase-config.js', (r) => r.fulfill({
      contentType: 'text/javascript', body: 'export const FIREBASE_CONFIG = null;',
    }));
  }
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  page.errors = errors;
  page.base = base;
  page.go = async (hash, wait = '.view') => {
    await page.goto(`${base}/app.html${hash}`);
    if (wait) await page.waitForSelector(wait);
    await page.waitForTimeout(250);
  };
  return page;
}

// Seed records directly through the app's data layer.
export async function seed(page, fn, arg) {
  await page.evaluate(async ({ src, arg }) => {
    const db = await import('./js/db.js');
    const u = await import('./js/util.js');
    // eslint-disable-next-line no-new-func
    await new Function('db', 'u', 'arg', `return (${src})(db, u, arg)`)(db, u, arg);
  }, { src: fn.toString(), arg });
}

// The page and the current view must fit the screen without scrolling.
export async function assertFits(page, label) {
  const o = await page.evaluate(() => {
    const v = document.querySelector('.view');
    return {
      page: document.documentElement.scrollHeight - innerHeight,
      wide: document.documentElement.scrollWidth - innerWidth,
      view: v ? v.scrollHeight - v.clientHeight : 0,
    };
  });
  if (o.page > 1 || o.wide > 1 || o.view > 1) throw new Error(`${label}: overflows ${JSON.stringify(o)}`);
}

export function assertEq(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

export function assertNoErrors(page, label) {
  if (page.errors.length) throw new Error(`${label}: page errors ${JSON.stringify(page.errors)}`);
}
