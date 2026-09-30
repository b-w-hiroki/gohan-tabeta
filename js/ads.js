/*
 * i-mobile 広告枠（審査通過後にスポット情報を入れるだけで表示される）
 *
 * 使い方
 *   1. i-mobile の管理画面で各スポットを発行し、下の IMOBILE に pid と
 *      スポットごとの SP / PC 用 { mid, asid } を入れる。
 *   2. HTML に <div class="ad-slot" data-ad-spot="lp">…</div> を置くか、
 *      JS から BirdmanAds.slot('login') で枠を作って画面に入れる。
 *
 * 方針
 *   - pid かスポットが未設定の枠は何もしない（空枠も出さない・通信もしない）
 *   - インラインバナーのみ。オーバーレイ系は使わない
 *   - SP / PC 用タグは端末で出し分け、片方だけを差し込む（併用は規約違反）
 *   - 広告SDKが実際に中身を描いたときだけ .has-ad を付けて枠を表示する
 *   - 枠が画面に近づくまで読み込まない
 */
(function () {
  // テストでは window.BIRDMAN_ADS_TEST_CONFIG で差し替える
  var IMOBILE = window.BIRDMAN_ADS_TEST_CONFIG || {
    pid: null, // 例: 12345
    spots: {
      // 例: lp: { sp: { mid: 111, asid: 222 }, pc: { mid: 333, asid: 444 } },
      lp: null, // トップページ（LP）フッター直前
      login: null, // ログイン画面
      stats: null, // ダッシュボード（統計）タブの末尾
    },
  };

  var LOADER = 'https://imp-adedge.i-mobile.co.jp/script/v1/spot.js?20220104';
  var seq = 0;

  function spotConfig(name) {
    var s = IMOBILE.spots[name];
    if (!IMOBILE.pid || !s) return null;
    var isMobile = /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent) || window.matchMedia('(max-width: 767px)').matches;
    var v = isMobile ? s.sp : s.pc;
    return v && v.mid && v.asid ? v : null;
  }

  function load(slot) {
    if (slot.dataset.adLoaded) return;
    var v = spotConfig(slot.dataset.adSpot);
    if (!v) return;
    slot.dataset.adLoaded = '1';
    var content = slot.querySelector('.ad-content');
    var el = document.createElement('div');
    el.id = 'im-' + slot.dataset.adSpot + '-' + (++seq);
    content.appendChild(el);
    new MutationObserver(function (_, obs) {
      if (el.children.length) { slot.classList.add('has-ad'); obs.disconnect(); }
    }).observe(el, { childList: true, subtree: true });
    if (!document.querySelector('script[data-imobile-loader]')) {
      var s = document.createElement('script');
      s.async = true;
      s.src = LOADER;
      s.setAttribute('data-imobile-loader', '1');
      document.head.appendChild(s);
    }
    (window.adsbyimobile = window.adsbyimobile || []).push({
      pid: IMOBILE.pid, mid: v.mid, asid: v.asid, type: 'banner', display: 'inline', elementid: el.id,
    });
  }

  function watch(slot) {
    if (!spotConfig(slot.dataset.adSpot)) return; // 未設定なら監視もしない
    // 1画面に収める画面では、画面の高さが足りない端末では出さない（中身を潰さないため）
    var minH = Number(slot.dataset.adMinHeight || 0);
    if (minH && window.innerHeight < minH) return;
    if (!('IntersectionObserver' in window)) { load(slot); return; }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) { io.disconnect(); load(slot); }
      }
    }, { rootMargin: '200px 0px' });
    // 非表示の枠は交差判定できないため、枠そのものではなく直前の要素を見る
    io.observe(slot.previousElementSibling || slot.parentElement || slot);
  }

  /** 枠の要素を作る（JS で描く画面用）。opts.minHeight: この高さ未満の画面では出さない。画面に入れたあと mount を呼ぶ */
  function slot(name, opts) {
    var d = document.createElement('div');
    d.className = 'ad-slot';
    d.dataset.adSpot = name;
    if (opts && opts.minHeight) d.dataset.adMinHeight = String(opts.minHeight);
    d.innerHTML = '<div class="ad-label">広告</div><div class="ad-content"></div>';
    return d;
  }

  /** root 以下の未処理の枠を有効にする */
  function mount(root) {
    var list = (root || document).querySelectorAll('.ad-slot[data-ad-spot]:not([data-ad-watch])');
    for (var i = 0; i < list.length; i++) { list[i].setAttribute('data-ad-watch', '1'); watch(list[i]); }
  }

  window.BirdmanAds = { slot: slot, mount: mount, isConfigured: function (name) { return !!spotConfig(name); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { mount(); });
  else mount();
})();
