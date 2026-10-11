// Login screen and "use without login" mode (Firebase itself is not reachable in tests).
import { openPage, assertEq, assertNoErrors, PHONES } from './helpers.mjs';

export default {
  async 'without cloud config the first launch explains the app, then guest mode opens directly'({ browser, base }) {
    for (const device of PHONES) {
      const page = await openPage(browser, base, { device, local: false });
      await page.go('', '.launch-welcome');
      assertEq(await page.textContent('#launch-title'), 'ごはん食べた', 'app name');
      assertEq(await page.isVisible('text=朝・昼・晩の食事や写真'), true, 'purpose explained');
      assertEq(await page.isEnabled('.launch-actions .secondary'), false, 'login disabled without config');
      await page.click('.launch-actions .primary');
      await page.waitForSelector('.cal-grid');
      assertEq(await page.isVisible('.bottom-nav'), true, 'nav shown');
      await page.reload(); await page.waitForSelector('.cal-grid');
      await page.go('#/settings', '.segment');
      await page.click('.settings-view > .segment button:has-text("データ")');
      const settingsButtons = await page.$$eval('.settings-view button', (buttons) => buttons.map((button) => button.textContent.trim()));
      assertEq(settingsButtons.includes('ログインしてクラウドに保存'), false, `no login button (${settingsButtons.join(' / ')})`);
      assertEq(await page.isVisible('text=準備中'), true, 'explains that login is not ready');
      await page.click('.settings-about-corner');
      assertEq(await page.isVisible('.app-about'), true, 'about opens from settings');
      await page.goBack();
      assertEq(await page.isVisible('.app-about'), false, 'browser back closes about');
      assertNoErrors(page, device);
      await page.context().close();
    }
  },

  async 'with cloud config the first visit offers start and login; both lead to the existing flows'({ browser, base }) {
    for (const device of PHONES) {
      const page = await openPage(browser, base, { device, local: false, cloud: true });
      await page.go('', '.launch-welcome');
      assertEq(await page.isVisible('.bottom-nav'), false, 'nav hidden on welcome');
      const widths = await page.$$eval('.launch-actions button', (buttons) => buttons.map((b) => b.getBoundingClientRect().height));
      if (widths.some((height) => height < 44)) throw new Error(`${device}: launch action below 44px ${widths}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 1) throw new Error(`${device}: launch screen overflows by ${overflow}px`);
      await page.click('.launch-actions .secondary');
      await page.waitForSelector('.auth-card');
      assertEq(await page.isEnabled('.google-btn'), true, 'Google login enabled');
      assertEq(await page.isVisible('.auth-notice'), false, 'no "not ready" notice');
      await page.click('.auth-guest .secondary');
      await page.waitForSelector('.cal-grid');
      await page.reload(); await page.waitForSelector('.cal-grid');
      await page.go('#/settings', '.segment');
      await page.click('.settings-view > .segment button:has-text("データ")');
      assertEq(await page.isVisible('text=ログインしてクラウドに保存'), true, 'offers login from settings');
      await page.context().close();
    }
  },
  async 'restored cloud session keeps login hidden and opens the app'({ browser, base }) {
    const page = await openPage(browser, base, { local: false, cloud: true });
    await page.context().addInitScript(() => {
      localStorage.setItem('authMode', 'cloud');
      localStorage.setItem('launchGuideSeen', '1');
    });
    const modules = {
      'firebase-app.js': `export const initializeApp = (config) => ({ config });`,
      'firebase-auth.js': `
        const user = { uid: 'restored-user', email: 'restored@example.com' };
        export const browserLocalPersistence = {};
        export const getAuth = () => ({ currentUser: user, authStateReady: () => new Promise((resolve) => setTimeout(resolve, 800)) });
        export const setPersistence = async () => {};
      `,
      'firebase-firestore.js': `
        export const persistentMultipleTabManager = () => ({});
        export const persistentLocalCache = () => ({});
        export const initializeFirestore = () => ({});
        export const getFirestore = () => ({});
        export const doc = (...path) => ({ path });
        export const collection = (...path) => ({ path });
        export const query = (ref) => ref;
        export const where = (...args) => ({ args });
        export const limit = (...args) => ({ args });
        export const getDoc = async () => ({ exists: () => false, data: () => null });
        export const getDocs = async () => ({ docs: [], empty: true });
        export const setDoc = async () => {};
        export const deleteDoc = async () => {};
        export const writeBatch = () => ({ delete: () => {}, commit: async () => {} });
      `,
    };
    await page.route('https://www.gstatic.com/firebasejs/10.12.2/**', (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      return route.fulfill({ contentType: 'text/javascript', body: modules[name] || '' });
    });
    await page.go('', '.boot-loading');
    assertEq(await page.isVisible('.auth-card'), false, 'login hidden during restoration');
    assertEq(await page.isVisible('.launch-welcome'), false, 'welcome hidden during restoration');
    await page.waitForTimeout(250);
    assertEq(await page.isVisible('.boot-loading'), true, 'loading remains until auth is ready');
    await page.waitForSelector('.cal-grid');
    assertEq(await page.isVisible('.auth'), false, 'signed-in user opens the app');
    assertNoErrors(page, 'restored signed-in session');
    await page.context().close();
  },
};
