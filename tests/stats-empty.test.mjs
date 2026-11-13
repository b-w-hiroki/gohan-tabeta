import { openPage, seed, assertEq, assertFits, assertNoErrors } from './helpers.mjs';

export default {
  async 'empty stats distinguish missing intake and provide a keyboard usable CTA'({ browser, base }) {
    for (const device of ['iPhone SE', 'iPhone 13']) for (const scheme of ['light', 'dark']) {
      const page = await openPage(browser, base, { device, scheme });
      await page.go('#/stats');
      assertEq(await page.locator('.stats .stat strong').first().textContent(), '—', 'no average');
      assertEq((await page.locator('.meal-value b').allTextContents()).join(','), '—,—,—,—', 'no meal averages');
      await assertFits(page, `${device} ${scheme} empty`);
      const cta = page.getByRole('link', { name: '今日の食事を記録' });
      await cta.focus(); await page.keyboard.press('Enter');
      await page.waitForSelector('.tabs');
      await page.go('#/stats');
      await seed(page, async (db, u) => {
        const d = db.emptyDay(u.todayKey()); d.weight = 60; d.water = 500;
        d.meals.breakfast.memo = 'メモのみ'; await db.putDay(d);
        const old = db.emptyDay(u.addDays(u.todayKey(), -100));
        old.meals.lunch.items.push({ name: '以前の食事', kcal: 500 }); await db.putDay(old);
      });
      await page.reload(); await page.waitForSelector('.dash-view');
      await page.go('#/stats');
      assertEq(await page.locator('.food-empty').count(), 1, 'body data and outside range are not calorie records');
      assertNoErrors(page, 'empty stats');
      await page.context().close();
    }
  },
  async 'recorded zero remains a real record in daily and weekly averages'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/stats');
    await seed(page, async (db, u) => {
      const d = db.emptyDay(u.todayKey());
      d.meals.breakfast.items.push({ name: 'ゼロカロリー', kcal: 0 }); await db.putDay(d);
    });
    await page.reload(); await page.waitForSelector('.dash-view');
    await page.go('#/stats');
    assertEq(await page.locator('.food-empty').count(), 0, 'zero has chart');
    assertEq(await page.locator('.stats .stat strong').first().textContent(), '0', 'real zero average');
    assertEq(await page.locator('.stats .stat strong').nth(1).textContent(), '1/1', 'zero counted');
    await page.getByRole('button', { name: / 0kcal$/ }).click();
    assertEq(await page.locator('.readout strong').textContent(), '0 kcal', 'zero readout');
    assertEq(await page.getByRole('button', { name: /記録なし$/ }).count(), 6, 'unrecorded labels');
    await seed(page, async (db, u) => {
      const d = db.emptyDay(u.addDays(u.todayKey(), -1));
      d.meals.lunch.items.push({ name: '食事', kcal: 600 }); await db.putDay(d);
    });
    await page.getByRole('tab', { name: '期間', exact: true }).click();
    await page.getByRole('button', { name: '90日', exact: true }).click();
    assertEq(await page.locator('.stats .stat strong').first().textContent(), '300', 'average includes zero');
    assertEq(await page.locator('.food-empty').count(), 0, 'weekly chart shown');
    assertNoErrors(page, 'recorded stats');
    await page.context().close();
  },
};
