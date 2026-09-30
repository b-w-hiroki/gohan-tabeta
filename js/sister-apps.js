/*
 * birdman studio の姉妹アプリ導線（ヘッダーの切り替えメニュー＋フッターのアイコン）
 *
 * ★ アプリを追加・変更するときは、下の APPS に1行足すだけ。
 *   このファイルは 4 リポジトリ（otsukai / osanpo-bingo / gohan-tabeta / osaifu）で同じ内容。
 *   変更したら全リポジトリにコピーし、各リポジトリの Service Worker のキャッシュ番号を上げる。
 *
 * - 表示中のアプリ自身は、ホスト名で判定して一覧から自動で外す
 * - 並び順は APPS の順番どおり
 * - 件数が増えたら、メニューは縦スクロール、フッターは横スクロールになる
 * - HTML 側には次の2つの枠だけを置く（見た目の CSS は各 LP の <head> にある）
 *     <div class="bs-sw">…ボタン…<div class="bs-sw-pop" hidden><p>…</p><div data-bs-list></div></div></div>
 *     <div class="bs-foot"><p>…</p><ul data-bs-foot></ul></div>
 */
(function () {
  var APPS = [
    // [キー（utm_source に使う）, 正式名, フッター用の短い名前, ひとこと説明, URL, アイコン]
    ['otsukai', 'おうちのおつかい', 'おつかい', '買い物リストを家族で共有', 'https://otsukai.birdman-studio.com/', 'https://otsukai.birdman-studio.com/icon-192.png'],
    ['osanpo-bingo', 'おさんぽビンゴバトル', 'おさんぽビンゴ', '散歩で見つけてビンゴ', 'https://osanpobingo-battle.com/', 'https://osanpobingo-battle.com/icon-192.png'],
    ['gohan-tabeta', 'ごはん食べた', 'ごはん食べた', '食事とカロリーを記録', 'https://gohan-tabeta.birdman-studio.com/', 'https://gohan-tabeta.birdman-studio.com/icons/icon-192.png'],
    ['osaifu', 'おさいふ', 'おさいふ', '支払い日を忘れない家計簿', 'https://osaifu.birdman-studio.com/', 'https://osaifu.birdman-studio.com/icons/icon-192.png'],
  ];

  // テストでは window.BIRDMAN_SISTER_TEST で一覧と「自分」を差し替える
  var T = window.BIRDMAN_SISTER_TEST || {};
  var list = T.apps || APPS;
  var host = location.hostname;
  var self = T.self || (list.filter(function (a) { return new URL(a[4]).hostname === host; })[0] || [])[0] || document.documentElement.getAttribute('data-app') || '';

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function href(a, where) {
    var u = new URL(a[4]);
    u.searchParams.set('utm_source', self || host);
    u.searchParams.set('utm_medium', 'referral');
    u.searchParams.set('utm_campaign', 'sister_apps');
    u.searchParams.set('utm_content', where);
    return u.toString();
  }
  var others = list.filter(function (a) { return a[0] !== self; });

  function render() {
    document.querySelectorAll('.bs-sw [data-bs-list]').forEach(function (box) {
      box.innerHTML = others.map(function (a) {
        return '<a href="' + esc(href(a, 'header')) + '" target="_blank" rel="noopener"><img src="' + esc(a[5]) + '" alt="" width="36" height="36" loading="lazy"><span><b>' + esc(a[1]) + '</b><small>' + esc(a[3]) + '</small></span></a>';
      }).join('');
    });
    document.querySelectorAll('[data-bs-foot]').forEach(function (ul) {
      ul.innerHTML = others.map(function (a) {
        return '<li><a href="' + esc(href(a, 'footer')) + '" target="_blank" rel="noopener"><img src="' + esc(a[5]) + '" alt="" width="40" height="40" loading="lazy">' + esc(a[2]) + '</a></li>';
      }).join('');
    });
    // 横に続きがあるときだけ右端を薄くして「スクロールできる」ことを伝える（末尾まで来たら消す）
    document.querySelectorAll('[data-bs-foot]').forEach(function (ul) {
      function mark() { ul.classList.toggle('bs-more', ul.scrollLeft + ul.clientWidth < ul.scrollWidth - 2); }
      ul.addEventListener('scroll', mark, { passive: true });
      window.addEventListener('resize', mark);
      mark();
    });
    // ほかのアプリが無い場合は、導線ごと隠す
    if (!others.length) document.querySelectorAll('.bs-sw, .bs-foot').forEach(function (el) { el.hidden = true; });
  }

  function wire() {
    document.querySelectorAll('.bs-sw').forEach(function (sw) {
      var btn = sw.querySelector('.bs-sw-btn'), pop = sw.querySelector('.bs-sw-pop');
      if (!btn || !pop) return;
      // 画面の右端に揃えて、ボタンのすぐ下に出す（ボタンの位置に関係なく画面からはみ出さない）
      function set(open) {
        if (open) pop.style.top = Math.round(btn.getBoundingClientRect().bottom + 8) + 'px';
        pop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      }
      btn.addEventListener('click', function (e) { e.stopPropagation(); set(pop.hidden); });
      document.addEventListener('click', function (e) { if (!sw.contains(e.target)) set(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') set(false); });
      // ページのスクロールでは閉じる（メニューの中のスクロールでは閉じない）
      window.addEventListener('scroll', function () { if (!pop.hidden) set(false); }, { passive: true });
    });
  }

  function init() { render(); wire(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
