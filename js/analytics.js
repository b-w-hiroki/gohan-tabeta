/*
 * アクセス解析（Google アナリティクス 4）
 *
 * GA4 の管理画面で「ウェブ」のデータストリームを作り、発行された測定ID（G-XXXXXXXXXX）を
 * 下の GA_ID に入れると計測が始まる。未設定の間は何も読み込まない・通信しない。
 *
 * - page_view に display_mode（ホーム画面から起動 = standalone / ブラウザ = browser）を付けて、
 *   PWA として使われている割合を見られるようにする
 */
(function () {
  // テストでは window.BIRDMAN_GA_TEST_ID で差し替える
  var GA_ID = window.BIRDMAN_GA_TEST_ID !== undefined ? window.BIRDMAN_GA_TEST_ID : null; // 例: 'G-XXXXXXXXXX'
  if (!GA_ID) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  gtag('js', new Date());
  gtag('config', GA_ID, { display_mode: standalone ? 'standalone' : 'browser' });

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
})();
