// 広告枠（i-mobile）: 未設定なら何も表示・通信しない。設定済みなら広告が入っても1画面に収まる。
import { devices } from 'playwright';
import { openPage, seed, assertFits, assertNoErrors, PHONES } from './helpers.mjs';

const SPOT = { sp: { mid: 1, asid: 2 }, pc: { mid: 3, asid: 4 } };
const CONFIG = { pid: 99, spots: { lp: SPOT, login: SPOT, stats: SPOT } };
// i-mobile の SDK の代わりに、指定された要素へ 320x50 のバナーを描く
const FAKE_SDK = `(function(){
  function draw(o){ var el=document.getElementById(o.elementid); if(!el) return;
    var b=document.createElement('div'); b.className='fake-banner'; b.style.cssText='width:320px;height:50px;background:#ccc'; el.appendChild(b); }
  var q=window.adsbyimobile||[]; var pending=q.splice(0); for (var i=0;i<pending.length;i++) draw(pending[i]);
})();`;

async function withAds(page) {
  await page.context().addInitScript((c) => { window.BIRDMAN_ADS_TEST_CONFIG = c; }, CONFIG);
  await page.route('**/spot.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }));
}

const seedWeek = (db, u) => (async () => {
  for (let i = 0; i < 10; i++) {
    const d = db.emptyDay(u.addDays(u.todayKey(), -i));
    d.meals.lunch.items.push({ name: '定食', kcal: 650 });
    await db.putDay(d);
  }
})();

export default {
  async 'ad slots stay hidden and make no requests until configured'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.context().addInitScript(() => { window.BIRDMAN_ADS_TEST_CONFIG = { pid: null, spots: {} }; });
    const hits = [];
    page.on('request', (r) => { if (/i-mobile/.test(r.url())) hits.push(r.url()); });
    await page.goto(`${base}/`); await page.waitForSelector('.hero');
    await page.go('#/stats', '.chart-box');
    const shown = await page.$$eval('.ad-slot', (els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
    if (shown) throw new Error(`${shown} ad slot(s) visible without config`);
    if (hits.length) throw new Error(`i-mobile requested without config: ${hits}`);
    assertNoErrors(page, 'unconfigured');
    await page.context().close();
  },

  async 'configured ads render in the slots and screens still fit'({ browser, base }) {
    for (const device of PHONES) {
      const page = await openPage(browser, base, { device });
      await withAds(page);
      await page.goto(`${base}/`); await page.waitForSelector('.hero');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForSelector('.ad-slot[data-ad-spot="lp"].has-ad .fake-banner');
      await page.go('#/', '.view');
      await seed(page, seedWeek);
      // 高さの足りない画面ではダッシュボードの広告を出さない（グラフを潰さない）
      await page.go('#/stats', '.chart-box');
      await page.waitForTimeout(500);
      if (await page.$('.ad-slot[data-ad-spot="stats"].has-ad')) throw new Error(`${device}: stats ad shown on a short screen`);
      if (page.errors.length) throw new Error(page.errors.join());
      // ホーム画面から起動した大きめの端末（高さ 844）では出し、1画面に収まる
      await page.setViewportSize({ width: 390, height: 844 });
      await page.go('#/settings', '.segment');
      await page.go('#/stats', '.chart-box');
      await page.waitForSelector('.ad-slot[data-ad-spot="stats"].has-ad .fake-banner');
      await page.waitForTimeout(300);
      await assertFits(page, `${device} stats with ad`);
      assertNoErrors(page, device);
      await page.context().close();
    }
  },

  async 'production config loads the issued SP spot on phones and the PC spot on desktop'({ browser, base }) {
    const PC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
    for (const [label, opts, want] of [
      ['phone', devices['iPhone 13'], { mid: 596787, asid: 1946462, elementid: 'im-7c35cee49c1147d19eeb12bb807a3a19' }],
      ['pc', { viewport: { width: 1280, height: 800 }, userAgent: PC_UA, isMobile: false, hasTouch: false },
        { mid: 596788, asid: 1946465, elementid: 'im-4e7e06e2f1bf46d8aa0e1a9fda417867' }],
    ]) {
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();
      const pushed = [];
      await page.route((u) => u.hostname !== '127.0.0.1' && !/spot\.js/.test(u.pathname), (r) => r.abort());
      await page.route('**/spot.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }));
      await page.exposeFunction('__record', (o) => pushed.push(o));
      await ctx.addInitScript(() => { window.adsbyimobile = { push: (o) => window.__record(o) }; });
      await page.goto(`${base}/`); await page.waitForSelector('.hero');
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      for (let i = 0; i < 40 && !pushed.length; i++) await page.waitForTimeout(100);
      const got = pushed[0] || {};
      for (const [k, v] of Object.entries({ pid: 84969, ...want })) {
        if (got[k] !== v) throw new Error(`${label}: ${k} expected ${v}, got ${got[k]}`);
      }
      await ctx.close();
    }
  },

  async 'login screen shows its ad below the buttons'({ browser, base }) {
    const page = await openPage(browser, base, { local: false, cloud: true });
    await withAds(page);
    await page.goto(`${base}/app.html`);
    await page.waitForSelector('.auth-card');
    await page.waitForSelector('.ad-slot[data-ad-spot="login"].has-ad .fake-banner');
    const order = await page.evaluate(() => {
      const guest = document.querySelector('.auth-guest'); const ad = document.querySelector('.ad-slot[data-ad-spot="login"]');
      return !!(guest.compareDocumentPosition(ad) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    if (!order) throw new Error('login ad is not below the guest button');
    await page.context().close();
  },

  async 'client-side navigation flushes a spot queued after the SDK already ran'({ browser, base }) {
    const page = await openPage(browser, base, { local: false, cloud: true });
    await withAds(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/app.html`);
    await page.waitForSelector('.ad-slot[data-ad-spot="login"].has-ad .fake-banner');
    await page.click('.auth-guest button');
    await page.evaluate(() => { location.hash = '#/stats'; });
    await page.waitForSelector('.ad-slot[data-ad-spot="stats"].has-ad .fake-banner');
    await page.evaluate(() => { location.hash = '#/settings'; });
    await page.waitForSelector('.segment');
    await page.evaluate(() => { location.hash = '#/stats'; });
    await page.waitForSelector('.ad-slot[data-ad-spot="stats"].has-ad .fake-banner');
    const loaderCount = await page.locator('script[data-imobile-loader]').count();
    if (loaderCount !== 2) throw new Error(`expected two SDK executions, got ${loaderCount}`);
    const bannerCount = await page.locator('.ad-slot[data-ad-spot="stats"] .fake-banner').count();
    if (bannerCount !== 1) throw new Error(`expected one reused stats banner, got ${bannerCount}`);
    await page.context().close();
  },
};
