// Recording meals: presets, PFC, my menu, history, copying the previous meal, tabs and swipe.
import { openPage, seed, assertEq, assertNoErrors } from './helpers.mjs';

const itemsOf = (page, meal, date) => page.evaluate(async ({ meal, date }) => {
  const db = await import('./js/db.js'); const u = await import('./js/util.js');
  return (await db.getDay(date || u.todayKey())).meals[meal].items;
}, { meal, date });

async function openAdd(page, meal) {
  await page.go('#/today', '.tabs');
  await page.click(`.tab-${meal}`); await page.waitForTimeout(350);
  await page.click(`.meal-${meal} .primary-soft`);
  await page.waitForSelector('.sheet');
}

export default {
  async 'adds a food with PFC and saves it to my menu'({ browser, base }) {
    const page = await openPage(browser, base);
    await openAdd(page, 'breakfast');
    await page.fill('.sheet input[type=text]', 'オートミール');
    await page.fill('.sheet input[type=number] >> nth=0', '150');
    await page.click('.pfc-details summary');
    await page.fill('input[aria-label="たんぱく質(g)"]', '5.1');
    await page.fill('input[aria-label="脂質(g)"]', '2.4');
    await page.fill('input[aria-label="炭水化物(g)"]', '27');
    await page.check('.check-row input');
    await page.click('.sheet button.primary');
    await page.waitForTimeout(400);
    const items = await itemsOf(page, 'breakfast');
    assertEq(JSON.stringify(items), JSON.stringify([{ name: 'オートミール', kcal: 150, p: 5.1, f: 2.4, c: 27 }]), 'saved item');
    assertEq(await page.textContent('.day-chip.pfc b'), '5/2/27g', 'PFC chip totals');
    // It is offered again from "my menu".
    await page.click('.meal-breakfast .primary-soft'); await page.waitForSelector('.chip-mine');
    await page.click('.chip-mine');
    assertEq(await page.inputValue('.sheet input[type=number] >> nth=0'), '150', 'my menu fills kcal');
    assertNoErrors(page, 'my menu');
    await page.context().close();
  },

  async 'standard presets add up kcal and PFC; history lists past foods'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    await seed(page, async (db, u) => {
      const d = db.emptyDay(u.addDays(u.todayKey(), -3));
      d.meals.dinner.items.push({ name: '自家製カレー', kcal: 700 });
      await db.putDay(d);
    });
    await openAdd(page, 'lunch');
    await page.waitForSelector('.presets .chip:has-text("自家製カレー")');
    await page.click('.segment-mini button:has-text("定番")');
    await page.click('.chip:has-text("ごはん(茶碗1杯)")');
    await page.click('.chip:has-text("みそ汁")');
    assertEq(await page.inputValue('.sheet input[type=number] >> nth=0'), '274', 'kcal sum');
    assertEq(await page.inputValue('input[aria-label="たんぱく質(g)"]'), '6.8', 'protein sum');
    assertEq(await page.inputValue('.sheet input[type=text]'), 'ごはん(茶碗1杯)・みそ汁', 'name joined');
    assertNoErrors(page, 'presets');
    await page.context().close();
  },

  async 'copies the previous meal into an empty one'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    await seed(page, async (db, u) => {
      const d = db.emptyDay(u.addDays(u.todayKey(), -1));
      d.meals.breakfast.items.push({ name: 'トースト', kcal: 160 }, { name: 'コーヒー', kcal: 5 });
      await db.putDay(d);
    });
    await page.go('#/today', '.tabs');
    await page.click('.tab-breakfast'); await page.waitForTimeout(300);
    await page.click('.meal-breakfast .copy-btn');
    await page.waitForTimeout(400);
    assertEq((await itemsOf(page, 'breakfast')).map((i) => i.name).join(','), 'トースト,コーヒー', 'copied items');
    assertNoErrors(page, 'copy');
    await page.context().close();
  },

  async 'tabs and swipe switch meals; edit and delete an item'({ browser, base }) {
    const page = await openPage(browser, base, { device: 'iPhone SE' });
    await page.go('#/today', '.tabs');
    await page.click('.tab-dinner'); await page.waitForTimeout(500);
    assertEq(await page.getAttribute('.tab-dinner', 'aria-selected'), 'true', 'tab click');
    await page.evaluate(() => { const p = document.querySelector('.panels'); p.scrollLeft = p.clientWidth; });
    await page.waitForTimeout(400);
    assertEq(await page.getAttribute('.tab-lunch', 'aria-selected'), 'true', 'swipe');
    await page.click('.meal-lunch .primary-soft');
    await page.fill('.sheet input[type=text]', 'ラーメン');
    await page.fill('.sheet input[type=number] >> nth=0', '500');
    await page.click('.sheet button.primary'); await page.waitForTimeout(400);
    assertEq(await page.getAttribute('.tab-lunch', 'aria-selected'), 'true', 'stays on tab after save');
    await page.click('.meal-lunch .item-main');
    await page.fill('.sheet input[type=number] >> nth=0', '520');
    await page.click('.sheet button.primary'); await page.waitForTimeout(400);
    assertEq((await itemsOf(page, 'lunch'))[0].kcal, 520, 'edited kcal');
    await page.click('.meal-lunch .item-main');
    await page.click('.sheet button.danger'); await page.waitForTimeout(400);
    assertEq((await itemsOf(page, 'lunch')).length, 0, 'deleted');
    assertNoErrors(page, 'tabs');
    await page.context().close();
  },
};
