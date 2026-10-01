import { openPage, seed, assertEq, assertNoErrors } from './helpers.mjs';

const blankMeals = () => ({
  breakfast: { items: [], photos: [], memo: '' },
  lunch: { items: [], photos: [], memo: '' },
  dinner: { items: [], photos: [], memo: '' },
  snack: { items: [], photos: [], memo: '' },
});

function backup({ date = '2026-09-30', photo = true } = {}) {
  const meals = blankMeals();
  if (photo) meals.breakfast.photos.push('photo-new');
  return {
    app: 'gohan-tabeta',
    version: 1,
    settings: {
      goalKcal: 1850,
      profile: { sex: 'female', age: 35, height: 160, weight: 55, activity: 1.4 },
      myFoods: [{ name: 'new food', kcal: 123 }],
    },
    days: [{ date, meals, exercises: [] }],
    photos: photo ? [{
      id: 'photo-new', date, data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    }] : [],
  };
}

async function seedOriginal(page) {
  await seed(page, async (db) => {
    const day = db.emptyDay('2026-09-01');
    day.meals.dinner.items.push({ name: 'original', kcal: 500 });
    day.meals.dinner.photos.push('photo-old');
    await db.putDay(day);
    await db.putPhoto({ id: 'photo-old', date: day.date, blob: new Blob(['old'], { type: 'image/jpeg' }) });
  });
}

const snapshot = (page) => page.evaluate(async () => {
  const db = await import('./js/db.js');
  const u = await import('./js/util.js');
  const days = await db.getAllDays();
  const photos = await db.getAllPhotos();
  return {
    days: days.map((day) => ({ date: day.date, item: day.meals.dinner.items[0]?.name || '' })),
    photos: photos.map((photo) => ({ id: photo.id, type: photo.blob.type, size: photo.blob.size })),
    goal: u.getGoal(), profile: u.getProfile(), foods: u.getMyFoods(),
  };
});

async function openImport(page) {
  await page.go('#/settings');
  await page.click('[role=tab] >> nth=4');
  await page.waitForSelector('input[type=file][accept*="json"]', { state: 'attached' });
}

async function upload(page, value, name = 'backup.json') {
  await page.setInputFiles('input[type=file][accept*="json"]', {
    name, mimeType: 'application/json', buffer: Buffer.from(value),
  });
  await page.waitForTimeout(250);
}

export default {
  async 'normal restore replaces all days/photos/settings after full validation'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    await seedOriginal(page);
    await openImport(page);
    await upload(page, JSON.stringify(backup()));

    const state = await snapshot(page);
    assertEq(JSON.stringify(state.days), JSON.stringify([{ date: '2026-09-30', item: '' }]), 'restored days');
    assertEq(state.photos[0].id, 'photo-new', 'restored photo id');
    assertEq(state.photos[0].type, 'image/png', 'restored photo type');
    assertEq(state.photos[0].size > 0, true, 'restored photo bytes');
    assertEq(state.goal, 1850, 'restored goal');
    assertEq(state.profile.sex, 'female', 'restored profile');
    assertEq(state.foods[0].name, 'new food', 'restored foods');
    assertNoErrors(page, 'normal restore');
    await page.context().close();
  },

  async 'malformed JSON, corrupt photo and missing photo leave existing data intact'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    await seedOriginal(page);
    const before = JSON.stringify(await snapshot(page));
    await openImport(page);

    await upload(page, '{not-json');
    assertEq(JSON.stringify(await snapshot(page)), before, 'malformed JSON');

    const corrupt = backup();
    corrupt.photos[0].data = 'data:image/png;base64,bm90LWFuLWltYWdl';
    await upload(page, JSON.stringify(corrupt));
    assertEq(JSON.stringify(await snapshot(page)), before, 'corrupt photo');

    const missing = backup();
    missing.photos = [];
    await upload(page, JSON.stringify(missing));
    assertEq(JSON.stringify(await snapshot(page)), before, 'missing photo');
    assertNoErrors(page, 'rejected backups');
    await page.context().close();
  },

  async 'cancel leaves existing data intact'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    await seedOriginal(page);
    const before = JSON.stringify(await snapshot(page));
    await openImport(page);
    await page.evaluate(() => { window.confirm = () => false; });
    await upload(page, JSON.stringify(backup()));
    assertEq(JSON.stringify(await snapshot(page)), before, 'cancelled import');
    await page.context().close();
  },

  async 'quota-like failure aborts the local transaction and preserves old records'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    await seedOriginal(page);
    const before = JSON.stringify(await snapshot(page));
    await openImport(page);
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
    await upload(page, JSON.stringify(backup()));
    assertEq(JSON.stringify(await snapshot(page)), before, 'failed atomic import');
    assertNoErrors(page, 'quota failure');
    await page.context().close();
  },

  async 'non-atomic store restores its backup after a partial save failure'({ browser, base }) {
    const page = await openPage(browser, base);
    await page.go('#/');
    const result = await page.evaluate(async () => {
      const db = await import('./js/db.js');
      let days = [{ date: 'old-day' }];
      let photos = [{ id: 'old-photo' }];
      let failOnce = true;
      const fake = {
        getAllDays: async () => structuredClone(days),
        getAllPhotos: async () => structuredClone(photos),
        clearAll: async () => { days = []; photos = []; },
        putPhoto: async (photo) => { photos.push(photo); },
        putDay: async (day) => {
          days.push(day);
          if (failOnce) { failOnce = false; throw new Error('simulated write failure'); }
        },
      };
      db.useStore(fake);
      try { await db.replaceAllData([{ date: 'new-day' }], [{ id: 'new-photo' }]); } catch { /* expected */ }
      db.useStore(db.localStore);
      return { days, photos };
    });
    assertEq(JSON.stringify(result), JSON.stringify({ days: [{ date: 'old-day' }], photos: [{ id: 'old-photo' }] }), 'rollback');
    await page.context().close();
  },
};
