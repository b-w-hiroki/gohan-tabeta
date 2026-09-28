// Login screen and "use without login" mode (Firebase itself is not reachable in tests).
import { openPage, assertEq, assertNoErrors, PHONES } from './helpers.mjs';

export default {
  async 'without cloud config the app opens directly and says login is not ready'({ browser, base }) {
    for (const device of PHONES) {
      const page = await openPage(browser, base, { device, local: false });
      await page.go('', '.cal-grid');
      assertEq(await page.isVisible('.auth'), false, 'no login screen');
      assertEq(await page.isVisible('.bottom-nav'), true, 'nav shown');
      await page.go('#/settings', '.segment');
      await page.click('.settings-view > .segment button:has-text("データ")');
      assertEq(await page.isVisible('text=ログインしてクラウドに保存'), false, 'no login button');
      assertEq(await page.isVisible('text=準備中'), true, 'explains that login is not ready');
      assertNoErrors(page, device);
      await page.context().close();
    }
  },
};
