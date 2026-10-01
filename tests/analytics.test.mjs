// アクセス解析（GA4）: 測定ID未設定なら読み込まない。設定すると gtag を読み込み page_view を送る。
import { openPage, assertNoErrors } from './helpers.mjs';

export default {
  async 'analytics makes no requests until a measurement ID is set'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.context().addInitScript(() => { window.BIRDMAN_GA_TEST_ID = null; });
    const hits = [];
    page.on('request', (r) => { if (/googletagmanager|google-analytics/.test(r.url())) hits.push(r.url()); });
    await page.goto(`${base}/`); await page.waitForSelector('.hero');
    await page.go('#/', '.view');
    if (hits.length) throw new Error(`GA requested without ID: ${hits}`);
    if (await page.evaluate(() => typeof window.gtag !== 'undefined')) throw new Error('gtag defined without ID');
    assertNoErrors(page, 'no id');
    await page.context().close();
  },

  async 'analytics loads gtag with the measurement ID once set'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.context().addInitScript(() => { window.BIRDMAN_GA_TEST_ID = 'G-TEST123'; });
    const hits = [];
    page.on('request', (r) => { if (/googletagmanager\.com\/gtag\/js/.test(r.url())) hits.push(r.url()); });
    await page.go('#/', '.view');
    const cfg = await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).find((a) => a[0] === 'config'));
    if (!cfg || cfg[1] !== 'G-TEST123' || cfg[2].display_mode !== 'browser') throw new Error(`bad config ${JSON.stringify(cfg)}`);
    if (!hits.some((u) => u.includes('id=G-TEST123'))) throw new Error('gtag.js not requested');
    await page.context().close();
  },
  async 'production build uses the issued measurement ID'({ browser, base }) {
    const page = await openPage(browser, base);
    const hits = [];
    page.on('request', (r) => { if (/googletagmanager\.com\/gtag\/js/.test(r.url())) hits.push(r.url()); });
    await page.goto(`${base}/`); await page.waitForSelector('.hero');
    await page.waitForTimeout(300);
    const cfg = await page.evaluate(() => (window.dataLayer || []).map((a) => Array.from(a)).find((a) => a[0] === 'config'));
    if (!cfg || cfg[1] !== 'G-1SHZQRFM6P') throw new Error(`bad config ${JSON.stringify(cfg)}`);
    if (!hits.some((u) => u.includes('id=G-1SHZQRFM6P'))) throw new Error('gtag.js not requested');
    await page.context().close();
  },
};
