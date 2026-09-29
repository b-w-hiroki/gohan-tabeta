// Every screen fits one phone screen (no page scroll), in light and dark, with no page errors.
import { openPage, seed, assertFits, assertNoErrors, PHONES } from './helpers.mjs';

const seedMonth = (db, u) => (async () => {
  u.setProfile({ sex: 'female', age: 30, height: 160, weight: 55, activity: 1.2 });
  for (let i = 0; i < 40; i++) {
    const d = db.emptyDay(u.addDays(u.todayKey(), -i));
    d.meals.breakfast.items.push({ name: 'ごはん', kcal: 234, p: 3.8, f: 0.5, c: 55.7 }, { name: 'みそ汁', kcal: 40 });
    d.meals.lunch.items.push({ name: '定食', kcal: 600 + (i % 5) * 40 });
    d.meals.dinner.items.push({ name: '夕食', kcal: 550 + (i % 7) * 50 });
    if (i % 2) d.exercises.push({ name: 'ウォーキング', minutes: 30, kcal: 90 });
    if (i % 3 === 0) d.weight = 56 - i * 0.03;
    if (i % 2 === 0) d.water = 1200 + i * 10;
    await db.putDay(d);
  }
})();

export default {
  async 'app screens fit on small and large phones'({ browser, base }) {
    for (const device of PHONES) {
      for (const scheme of ['light', 'dark']) {
        const page = await openPage(browser, base, { device, scheme });
        await page.go('#/', '.view');
        await seed(page, seedMonth);
        const label = `${device}/${scheme}`;
        await page.go('#/'); await assertFits(page, `${label} calendar`);
        await page.go('#/today', '.tabs');
        for (const tab of ['breakfast', 'lunch', 'dinner', 'snack', 'exercise']) {
          await page.click(`.tab-${tab}`); await page.waitForTimeout(350);
          await assertFits(page, `${label} day ${tab}`);
        }
        // A day without records: the weight/water chips stay one line high.
        const empty = await page.evaluate(async () => (await import('./js/util.js')).addDays((await import('./js/util.js')).todayKey(), 5));
        await page.go(`#/day/${empty}`, '.day-chips');
        const tall = await page.$$eval('.day-chip', (els) => els.map((e) => e.offsetHeight).filter((hgt) => hgt > 36));
        if (tall.length) throw new Error(`${label} empty-day chips too tall: ${tall}`);
        await page.go('#/stats', '.chart-box');
        for (const mode of ['週', '月', '期間']) {
          await page.click(`.dash-view > .segment button:has-text("${mode}")`); await page.waitForTimeout(300);
          await assertFits(page, `${label} stats ${mode}`);
        }
        await page.click('.chart-tabs button:has-text("体重")'); await page.waitForTimeout(300);
        await assertFits(page, `${label} weight chart`);
        await page.go('#/settings', '.segment');
        for (const tab of ['基本情報', '目標', 'メニュー', '連携', 'データ']) {
          await page.click(`.settings-view > .segment button:has-text("${tab}")`); await page.waitForTimeout(200);
          await assertFits(page, `${label} settings ${tab}`);
        }
        assertNoErrors(page, label);
        await page.context().close();
      }
    }
  },

  async 'landing page has no horizontal scroll and forwards deep links'({ browser, base }) {
    for (const device of PHONES) {
      const page = await openPage(browser, base, { device });
      await page.goto(`${base}/`);
      await page.waitForSelector('.hero');
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (wide > 1) throw new Error(`${device}: landing page scrolls sideways by ${wide}px`);
      await page.goto('about:blank');
      await page.goto(`${base}/#/today`);
      await page.waitForURL(/app\.html#\/today/);
      assertNoErrors(page, device);
      await page.context().close();
    }
  },
};
