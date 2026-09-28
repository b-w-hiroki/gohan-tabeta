// Login screen and "use without login" mode (Firebase itself is not reachable in tests).
import { openPage, assertEq, assertNoErrors, PHONES } from './helpers.mjs';

export default {
  async 'first visit shows the login screen; guest mode persists'({ browser, base }) {
    for (const device of PHONES) {
      const page = await openPage(browser, base, { device, local: false });
      await page.go('', '.auth');
      assertEq(await page.isVisible('.bottom-nav'), false, 'nav hidden on login');
      await page.click('.auth-guest .secondary');
      await page.waitForSelector('.cal-grid');
      await page.reload(); await page.waitForSelector('.cal-grid');
      await page.go('#/settings', '.segment');
      await page.click('.settings-view > .segment button:has-text("データ")');
      assertEq(await page.isVisible('text=ログインしてクラウドに保存'), true, 'offers login from settings');
      assertNoErrors(page, device);
      await page.context().close();
    }
  },
};
