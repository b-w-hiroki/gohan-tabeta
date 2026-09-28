// Apple Watch active calories via iOS Shortcuts: URL import and the paste prompt.
import { openPage, assertEq, assertNoErrors } from './helpers.mjs';

const exercises = (page) => page.evaluate(async () => {
  const db = await import('./js/db.js'); const u = await import('./js/util.js');
  return (await db.getDay(u.todayKey())).exercises.map((e) => `${e.name}:${e.kcal}`);
});

export default {
  async 'URL import records once per day and replaces on re-import'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/import?kcal=347.6', null); await page.waitForTimeout(800);
    assertEq((await exercises(page)).join(), 'Apple Watch:348', 'first import');
    await page.go('#/import?kcal=420', null); await page.waitForTimeout(800);
    assertEq((await exercises(page)).join(), 'Apple Watch:420', 're-import replaces');
    assertNoErrors(page, 'url import');
    await page.context().close();
  },

  async 'returning from the Shortcut shows a paste prompt'({ browser, base }) {
    const page = await openPage(browser, base, { permissions: ['clipboard-read', 'clipboard-write'] });
    await page.go('#/today', '.tabs');
    await page.click('.tab-exercise'); await page.waitForTimeout(400);
    await page.click('button[aria-label="ショートカットでApple Watchの値を取り込む"]');
    await page.waitForTimeout(1800);
    await page.go('#/'); await page.go('#/today', '.watch-banner');
    await page.evaluate(() => navigator.clipboard.writeText('1,234 kcal'));
    await page.click('.watch-paste'); await page.waitForTimeout(500);
    assertEq((await exercises(page)).join(), 'Apple Watch:1234', 'pasted value');
    assertEq(await page.isVisible('.watch-banner'), false, 'banner closed');
    assertNoErrors(page, 'paste');
    await page.context().close();
  },
};
