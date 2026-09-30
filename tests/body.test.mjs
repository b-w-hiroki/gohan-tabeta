// Profile, exercise, weight, water and the dashboard estimates.
import { openPage, seed, assertEq, assertNoErrors } from './helpers.mjs';

const dayOf = (page) => page.evaluate(async () => {
  const db = await import('./js/db.js'); const u = await import('./js/util.js');
  return db.getDay(u.todayKey());
});

export default {
  async 'profile computes BMR and daily expenditure'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/settings', '.profile-form');
    await page.selectOption('select[aria-label=性別]', 'female');
    const inputs = page.locator('.profile-form input');
    await inputs.nth(0).fill('30'); await inputs.nth(1).fill('160'); await inputs.nth(2).fill('55');
    const text = (await page.textContent('.energy')).replace(/\s+/g, '');
    assertEq(text.includes('1,239') && text.includes('1,487'), true, `energy ${text}`);
    await page.click('.profile-form button[type=submit]');
    assertNoErrors(page, 'profile');
    await page.context().close();
  },

  async 'exercise preset uses METs, weight and water are recorded'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    await seed(page, async (db, u) => u.setProfile({ sex: 'female', age: 30, height: 160, weight: 55, activity: 1.2 }));
    await page.go('#/today', '.tabs');
    await page.click('.tab-exercise'); await page.waitForTimeout(400);
    await page.click('.meal-exercise .primary-soft');
    await page.click('.sheet .chip:has-text("ジョギング")');
    assertEq(await page.inputValue('.sheet input[type=number] >> nth=1'), '173', '30min jogging kcal');
    await page.click('.sheet button.primary'); await page.waitForTimeout(400);

    await page.click('.day-chip:has-text("体重")');
    await page.fill('.sheet input[type=number]', '54.6');
    await page.click('.sheet button.primary'); await page.waitForTimeout(400);
    await page.click('.day-chip:has-text("水分")');
    await page.click('.water-btns .chip:has-text("350")');
    await page.click('.water-btns .chip:has-text("150")');
    await page.click('.sheet button.primary'); await page.waitForTimeout(400);

    const day = await dayOf(page);
    assertEq(day.weight, 54.6, 'weight saved');
    assertEq(day.water, 500, 'water saved');
    assertEq(day.exercises[0].kcal, 173, 'exercise saved');
    const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('profile')));
    assertEq(prof.weight, 54.6, "today's weight updates the profile");
    assertNoErrors(page, 'body');
    await page.context().close();
  },

  async 'one-tap workout and gym checks toggle and show on the calendar'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/today', '.tabs');
    await page.click('.tab-exercise'); await page.waitForTimeout(400);
    await page.click('.check-workout'); await page.waitForTimeout(300);
    await page.click('.check-gym'); await page.waitForTimeout(300);
    let day = await dayOf(page);
    assertEq(day.workout && day.gym, true, 'both checked');
    assertEq(await page.getAttribute('.check-gym', 'aria-pressed'), 'true', 'gym pressed');
    assertEq((await page.textContent('.tab-exercise .tab-kcal')).trim(), '✓', 'tab shows check');
    await page.click('.check-workout'); await page.waitForTimeout(300);
    day = await dayOf(page);
    assertEq(day.workout, undefined, 'workout cleared');
    assertEq(day.gym, true, 'gym kept');
    await page.go('#/', '.cal-grid');
    assertEq(await page.locator('.cal-cell.today .dot-exercise').count(), 1, 'exercise dot');
    assertEq(await page.locator('.cal-cell.today .dot-gym').count(), 1, 'gym dot');
    assertEq((await page.textContent('.month-summary')).replace(/\s+/g, '').includes('運動1日'), true, 'month count');
    assertNoErrors(page, 'checks');
    await page.context().close();
  },

  async 'dashboard shows the weight-loss estimate and the weight chart'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    await seed(page, async (db, u) => {
      u.setProfile({ sex: 'female', age: 30, height: 160, weight: 55, activity: 1.2 });
      for (let i = 0; i < 5; i++) {
        const d = db.emptyDay(u.addDays(u.todayKey(), -i));
        d.meals.lunch.items.push({ name: '定食', kcal: 1200 });
        d.weight = 55 - i * -0.1;
        await db.putDay(d);
      }
    });
    await page.go('#/stats', '.chart-box');
    await page.click('.dash-view > .segment button:has-text("期間")');
    await page.click('.presets-row .chip:has-text("7日")'); await page.waitForTimeout(300);
    await page.click('.stat-link');
    const note = await page.textContent('.balance-note');
    // 5 days × (1,487 − 1,200) = 1,435 kcal
    assertEq(note.includes('= 1,435kcal'), true, `balance note: ${note}`);
    await page.click('.chart-tabs button:has-text("体重")'); await page.waitForTimeout(400);
    assertEq(await page.locator('.chart-box .w-dot').count(), 5, 'weight dots');
    assertEq(await page.locator('.chart-box .w-est').count(), 1, 'estimate line');
    assertNoErrors(page, 'dashboard');
    await page.context().close();
  },
};
