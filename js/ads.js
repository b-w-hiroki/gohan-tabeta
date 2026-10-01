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
    pid: 84969,
    spots: {
      // 形式: { sp: { mid, asid, elementid }, pc: { mid, asid, elementid } }（タグ取得で表示される値）
      // トップページ（LP）フッター直前
      lp: { sp: { mid: 596787, asid: 1946462, elementid: 'im-7c35cee49c1147d19eeb12bb807a3a19' },
        pc: { mid: 596788, asid: 1946465, elementid: 'im-4e7e06e2f1bf46d8aa0e1a9fda417867' } },
      // ログイン画面
      login: { sp: { mid: 596787, asid: 1946463, elementid: 'im-76d441861d4a4722ba175e7f5e5a0e69' },
        pc: { mid: 596788, asid: 1946466, elementid: 'im-6c2256f769564e68aad0f8c4dd3ddf29' } },
      // ダッシュボード（統計）タブの末尾
      stats: { sp: { mid: 596787, asid: 1946464, elementid: 'im-b5fd3587580949f49df6b24d57b97cca' },
        pc: { mid: 596788, asid: 1946467, elementid: 'im-186ad9996c944fe08ecb98fb28a83e5b' } },
    },
  };

  var LOADER = 'https://imp-adedge.i-mobile.co.jp/script/v1/spot.js?20220104';
  var seq = 0;
  var sdkLoading = false;
  var enqueueSeq = 0;
  var dynamicSlots = {};

  // The production SDK drains the array that exists when spot.js executes, but
  // does not replace push() with a live handler. Load it again for spots added
  // later by client-side navigation (login -> dashboard, etc.).
  function flushSdkQueue() {
    if (sdkLoading || !Array.isArray(window.adsbyimobile) || !window.adsbyimobile.length) return;
    sdkLoading = true;
    var startedAt = enqueueSeq;
    var s = document.createElement('script');
    s.async = true;
    s.src = LOADER;
    s.setAttribute('data-imobile-loader', '1');
    s.onload = function () {
      sdkLoading = false;
      // A spot may have been queued after this script started executing.
      if (Array.isArray(window.adsbyimobile) && window.adsbyimobile.length && enqueueSeq > startedAt) flushSdkQueue();
    };
    s.onerror = function () { sdkLoading = false; };
    document.head.appendChild(s);
  }

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
    // タグ取得で発行された elementid を使う（未指定なら生成）。同じ id が既にあれば重複を避けて生成する
    el.id = v.elementid && !document.getElementById(v.elementid) ? v.elementid : 'im-' + slot.dataset.adSpot + '-' + (++seq);
    content.appendChild(el);
    new MutationObserver(function (_, obs) {
      if (el.children.length) { slot.classList.add('has-ad'); obs.disconnect(); }
    }).observe(el, { childList: true, subtree: true });
    var queue = (window.adsbyimobile = window.adsbyimobile || []);
    enqueueSeq++;
    queue.push({
      pid: IMOBILE.pid, mid: v.mid, asid: v.asid, type: 'banner', display: 'inline', elementid: el.id,
    });
    // Test doubles and some SDK versions install a live push handler. Only the
    // plain array form needs another execution of spot.js.
    if (Array.isArray(queue)) flushSdkQueue();
  }

  function watch(slot) {
    if (!spotConfig(slot.dataset.adSpot)) return; // 未設定なら監視もしない
    // 1画面に収める画面では、画面の高さが足りない端末では出さない（中身を潰さないため）
    var minH = Number(slot.dataset.adMinHeight || 0);
    if (minH && window.innerHeight < minH) { delete slot.dataset.adWatch; return; }
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
    if (dynamicSlots[name]) return dynamicSlots[name];
    var d = document.createElement('div');
    d.className = 'ad-slot';
    d.dataset.adSpot = name;
    if (opts && opts.minHeight) d.dataset.adMinHeight = String(opts.minHeight);
    d.innerHTML = '<div class="ad-label">広告</div><div class="ad-content"></div>';
    dynamicSlots[name] = d;
    return dynamicSlots[name];
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
