import {
  MEAL_TYPES, getDay, putDay, getDaysInRange, getAllDays, putPhoto, getPhoto, deletePhoto,
  getAllPhotos, clearAll, dayTotal, mealTotal, hasContent,
} from './db.js';
import { FOOD_PRESETS } from './foods.js';

const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $settingsBtn = document.getElementById('settings-btn');
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ---------- helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => toKey(new Date());
const addDays = (key, n) => { const d = fromKey(key); d.setDate(d.getDate() + n); return toKey(d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmt = (n) => Number(n).toLocaleString('ja-JP');

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function getGoal() {
  try { return Number(localStorage.getItem('goalKcal')) || 2000; } catch { return 2000; }
}
function setGoal(v) {
  try { localStorage.setItem('goalKcal', String(v)); } catch { /* storage unavailable */ }
}

// Object URLs created for the current view; revoked on every navigation.
let objectUrls = [];
function blobUrl(blob) { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; }
function revokeUrls() { objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls = []; }

function toast(msg) {
  const el = h('div', { class: 'toast' }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

// Resize/compress a photo to keep IndexedDB small.
async function compressImage(file, maxSize = 1280, quality = 0.8) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const hgt = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hgt;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, hgt);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
}

// ---------- router ----------
function parseRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg] = hash.split('/');
  if (name === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(arg || '')) return { name: 'day', date: arg };
  if (name === 'settings') return { name: 'settings' };
  if (name === 'month' && /^\d{4}-\d{2}$/.test(arg || '')) return { name: 'month', month: arg };
  return { name: 'month', month: todayKey().slice(0, 7) };
}

async function render() {
  revokeUrls();
  const route = parseRoute();
  $back.hidden = route.name === 'month';
  $settingsBtn.hidden = route.name === 'settings';
  let view;
  if (route.name === 'day') view = await renderDay(route.date);
  else if (route.name === 'settings') view = renderSettings();
  else view = await renderMonth(route.month);
  $app.replaceChildren(view);
  view.onMount?.();
}

$back.addEventListener('click', () => {
  const route = parseRoute();
  if (route.name === 'day') location.hash = `#/month/${route.date.slice(0, 7)}`;
  else location.hash = '#/';
});
$settingsBtn.addEventListener('click', () => { location.hash = '#/settings'; });
window.addEventListener('hashchange', render);

// ---------- month (calendar) view ----------
async function renderMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const days = await getDaysInRange(toKey(first), toKey(last));
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const goal = getGoal();
  const today = todayKey();
  $title.textContent = `${y}年${m}月`;

  const prevMonth = toKey(new Date(y, m - 2, 1)).slice(0, 7);
  const nextMonth = toKey(new Date(y, m, 1)).slice(0, 7);

  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  const grid = h('div', { class: 'cal-grid', style: `grid-template-rows: auto repeat(${weeks}, 1fr)` },
    WEEKDAYS.map((w, i) => h('div', { class: `cal-wd wd-${i}` }, w)));
  for (let i = 0; i < first.getDay(); i++) grid.append(h('div', { class: 'cal-cell empty' }));

  let monthTotal = 0; let recordedDays = 0;
  for (let d = 1; d <= last.getDate(); d++) {
    const key = `${month}-${pad(d)}`;
    const rec = byDate[key];
    const total = rec ? dayTotal(rec) : 0;
    if (total > 0) { monthTotal += total; recordedDays++; }
    const dots = rec ? MEAL_TYPES.filter((t) => hasContent(rec.meals[t.id])) : [];
    const over = total > goal;
    const wd = new Date(y, m - 1, d).getDay();
    grid.append(h('button', {
      class: `cal-cell${key === today ? ' today' : ''}${key > today ? ' future' : ''}`,
      onclick: () => { location.hash = `#/day/${key}`; },
      'aria-label': `${m}月${d}日 ${total ? `${total}kcal` : '記録なし'}`,
    },
    h('span', { class: `cal-num wd-${wd}` }, d),
    h('span', { class: 'cal-dots' }, dots.map((t) => h('i', { class: `dot dot-${t.id}` }))),
    total ? h('span', { class: `cal-kcal${over ? ' over' : ''}` }, fmt(total)) : null));
  }

  const avg = recordedDays ? Math.round(monthTotal / recordedDays) : 0;
  return h('div', { class: 'view month-view' },
    h('div', { class: 'month-nav' },
      h('button', { class: 'icon-btn', 'aria-label': '前の月', onclick: () => { location.hash = `#/month/${prevMonth}`; } }, '‹'),
      h('button', { class: 'today-btn', onclick: () => { location.hash = `#/day/${today}`; } }, '今日を記録'),
      h('button', { class: 'icon-btn', 'aria-label': '次の月', onclick: () => { location.hash = `#/month/${nextMonth}`; } }, '›')),
    grid,
    h('div', { class: 'legend' },
      MEAL_TYPES.map((t) => h('span', {}, h('i', { class: `dot dot-${t.id}` }), t.label)),
      h('span', {}, h('b', { class: 'over-sample' }, '赤字'), `= 目標${fmt(goal)}kcal超`)),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('small', {}, '記録日数'), h('strong', {}, `${recordedDays}日`)),
      h('div', { class: 'stat' }, h('small', {}, '1日平均'), h('strong', {}, `${fmt(avg)}kcal`)),
      h('div', { class: 'stat' }, h('small', {}, '月合計'), h('strong', {}, `${fmt(monthTotal)}kcal`))));
}

// ---------- day view ----------
// Selected meal tab, kept across re-renders of the same day.
let dayTab = { date: null, index: 0 };

function defaultMealIndex(date) {
  if (date !== todayKey()) return 0;
  const hr = new Date().getHours();
  if (hr < 10) return 0;
  if (hr < 15) return 1;
  if (hr < 21) return 2;
  return 3;
}

async function renderDay(date) {
  const day = await getDay(date);
  const d = fromKey(date);
  $title.textContent = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
  const goal = getGoal();
  const total = dayTotal(day);
  const pct = Math.min(100, Math.round((total / goal) * 100));
  const remain = goal - total;
  if (dayTab.date !== date) dayTab = { date, index: defaultMealIndex(date) };

  const save = async () => { await putDay(day); await render(); };

  const tabs = MEAL_TYPES.map((t, i) => {
    const sub = mealTotal(day.meals[t.id]);
    return h('button', {
      class: `tab tab-${t.id}`, role: 'tab',
      onclick: () => selectTab(i, true),
    },
    h('span', { class: 'tab-label' }, t.icon, ' ', t.label),
    h('span', { class: 'tab-kcal' }, sub ? fmt(sub) : hasContent(day.meals[t.id]) ? '✓' : '—'));
  });

  const panels = h('div', { class: 'panels' });
  for (const type of MEAL_TYPES) panels.append(await renderMealCard(day, type, save));

  function selectTab(i, scroll) {
    dayTab.index = i;
    tabs.forEach((t, j) => t.setAttribute('aria-selected', String(i === j)));
    if (scroll) panels.scrollTo({ left: i * panels.clientWidth, behavior: 'smooth' });
  }
  // Swiping the panels updates the active tab.
  let scrollTimer;
  panels.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const i = Math.round(panels.scrollLeft / panels.clientWidth);
      if (i !== dayTab.index) selectTab(i, false);
    }, 60);
  });

  const view = h('div', { class: 'view day-view' },
    h('div', { class: 'day-nav' },
      h('button', { class: 'icon-btn', 'aria-label': '前の日', onclick: () => { location.hash = `#/day/${addDays(date, -1)}`; } }, '‹'),
      h('div', { class: 'day-summary' },
        h('div', { class: 'day-total' }, h('strong', {}, fmt(total)), ` / ${fmt(goal)} kcal`,
          h('small', { class: remain < 0 ? 'over-text' : '' },
            remain < 0 ? `${fmt(-remain)} オーバー` : `あと ${fmt(remain)}`),
          date !== todayKey()
            ? h('button', { class: 'today-chip', onclick: () => { location.hash = `#/day/${todayKey()}`; } }, '今日へ')
            : null),
        h('div', { class: 'bar' }, h('div', { class: `bar-fill${remain < 0 ? ' over' : ''}`, style: `width:${pct}%` }))),
      h('button', { class: 'icon-btn', 'aria-label': '次の日', onclick: () => { location.hash = `#/day/${addDays(date, 1)}`; } }, '›')),
    h('div', { class: 'tabs', role: 'tablist' }, tabs),
    panels);

  view.onMount = () => {
    selectTab(dayTab.index, false);
    panels.scrollLeft = dayTab.index * panels.clientWidth;
  };
  return view;
}

async function renderMealCard(day, type, save) {
  const meal = day.meals[type.id];
  const subtotal = mealTotal(meal);

  const items = h('ul', { class: 'items' },
    meal.items.map((it, idx) => h('li', {},
      h('button', { class: 'item-main', onclick: () => openItemSheet(type, it, async (next) => {
        if (next) meal.items[idx] = next; else meal.items.splice(idx, 1);
        await save();
      }) },
      h('span', { class: 'item-name' }, it.name || '(無題)'),
      h('span', { class: 'item-kcal' }, `${fmt(it.kcal)} kcal`)))));

  const photos = h('div', { class: 'photos' });
  for (const id of meal.photos) {
    const p = await getPhoto(id);
    if (!p) continue;
    photos.append(h('button', { class: 'thumb', 'aria-label': '写真を表示', onclick: () => openPhotoViewer(p, async () => {
      meal.photos = meal.photos.filter((x) => x !== id);
      await deletePhoto(id);
      await save();
    }) }, h('img', { src: blobUrl(p.blob), alt: `${type.label}の写真`, loading: 'lazy' })));
  }
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', multiple: true, hidden: true,
    onchange: async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      toast('写真を保存中…');
      for (const f of files) {
        try {
          const blob = await compressImage(f);
          const id = uid();
          await putPhoto({ id, blob, date: day.date });
          meal.photos.push(id);
        } catch {
          toast('写真を読み込めませんでした');
        }
      }
      await save();
    },
  });
  photos.append(h('label', { class: 'thumb add-photo', 'aria-label': '写真を追加' }, fileInput, h('span', {}, '📷'), h('small', {}, '写真')));

  let memoTimer;
  const memo = h('textarea', {
    class: 'memo', rows: 1, placeholder: 'メモ',
    oninput: (e) => {
      meal.memo = e.target.value;
      clearTimeout(memoTimer);
      memoTimer = setTimeout(() => putDay(day), 400);
    },
    onblur: () => { clearTimeout(memoTimer); putDay(day); },
  });
  memo.value = meal.memo;

  return h('section', { class: `card meal meal-${type.id}`, role: 'tabpanel' },
    h('header', { class: 'meal-head' },
      h('h2', {}, h('span', { class: 'meal-icon' }, type.icon), type.label),
      h('span', { class: 'meal-kcal' }, subtotal ? `${fmt(subtotal)} kcal` : '')),
    h('div', { class: 'items-wrap' }, items, meal.items.length ? null : h('p', { class: 'empty' }, 'まだ記録がありません')),
    h('button', { class: 'add-btn', onclick: () => openItemSheet(type, null, async (next) => {
      if (next) { meal.items.push(next); await save(); }
    }) }, '＋ 食べたものを追加'),
    photos,
    memo);
}

// ---------- bottom sheet: add / edit item ----------
function openSheet(content) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-grip' }), content);
  const close = () => { backdrop.remove(); sheet.remove(); document.body.classList.remove('no-scroll'); };
  backdrop.addEventListener('click', close);
  document.body.classList.add('no-scroll');
  document.body.append(backdrop, sheet);
  return close;
}

function openItemSheet(type, item, onDone) {
  const name = h('input', { type: 'text', placeholder: '例: 焼き魚定食', enterkeyhint: 'next', autocomplete: 'off' });
  const kcal = h('input', { type: 'number', inputmode: 'numeric', placeholder: '0', min: 0, max: 9999, enterkeyhint: 'done' });
  if (item) { name.value = item.name; kcal.value = item.kcal; }

  let close;
  const submit = async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    const k = Math.max(0, Math.round(Number(kcal.value) || 0));
    if (!n && !k) { name.focus(); return; }
    close();
    await onDone({ name: n || '食事', kcal: k });
  };

  const presets = h('div', { class: 'presets' },
    FOOD_PRESETS.map((p) => h('button', {
      type: 'button', class: 'chip',
      onclick: () => {
        // Tapping a preset adds its calories to what's already entered, so sets can be built up.
        name.value = name.value.trim() ? `${name.value.trim()}・${p.name}` : p.name;
        kcal.value = (Number(kcal.value) || 0) + p.kcal;
      },
    }, p.name, h('small', {}, p.kcal))));

  const form = h('form', { class: 'item-form', onsubmit: submit },
    h('h3', {}, `${type.icon} ${type.label}：${item ? '編集' : '追加'}`),
    h('label', {}, '料理名', name),
    h('label', {}, 'カロリー (kcal)', kcal),
    h('p', { class: 'hint' }, 'よく食べるもの（タップで加算）'),
    presets,
    h('div', { class: 'sheet-actions' },
      item ? h('button', { type: 'button', class: 'danger', onclick: async () => {
        if (!confirm('この項目を削除しますか？')) return;
        close(); await onDone(null);
      } }, '削除') : null,
      h('button', { type: 'button', class: 'secondary', onclick: () => close() }, 'キャンセル'),
      h('button', { type: 'submit', class: 'primary' }, '保存')));

  close = openSheet(form);
  if (!item) setTimeout(() => name.focus(), 50);
}

// ---------- photo viewer ----------
function openPhotoViewer(photo, onDelete) {
  const url = URL.createObjectURL(photo.blob);
  const close = () => { URL.revokeObjectURL(url); overlay.remove(); document.body.classList.remove('no-scroll'); };
  const overlay = h('div', { class: 'viewer', onclick: (e) => { if (e.target === overlay) close(); } },
    h('img', { src: url, alt: '食事の写真' }),
    h('div', { class: 'viewer-actions' },
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('この写真を削除しますか？')) return;
        close(); await onDelete();
      } }, '削除'),
      h('button', { class: 'secondary', onclick: close }, '閉じる')));
  document.body.classList.add('no-scroll');
  document.body.append(overlay);
}

// ---------- settings ----------
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function exportData() {
  const days = await getAllDays();
  const photos = await getAllPhotos();
  const data = {
    app: 'gohan-tabeta', version: 1, exportedAt: new Date().toISOString(), goalKcal: getGoal(), days,
    photos: await Promise.all(photos.map(async (p) => ({ id: p.id, date: p.date, data: await blobToDataUrl(p.blob) }))),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `gohan-tabeta-${todayKey()}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'gohan-tabeta' || !Array.isArray(data.days)) throw new Error('形式が違います');
  if (!confirm('現在のデータを上書きしてインポートしますか？')) return false;
  await clearAll();
  for (const p of data.photos || []) {
    const blob = await (await fetch(p.data)).blob();
    await putPhoto({ id: p.id, date: p.date, blob });
  }
  for (const d of data.days) await putDay(d);
  if (data.goalKcal) setGoal(data.goalKcal);
  return true;
}

function renderSettings() {
  $title.textContent = '設定';
  const goal = h('input', { type: 'number', inputmode: 'numeric', min: 500, max: 9999, value: getGoal() });
  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        if (await importData(f)) toast('インポートしました');
      } catch (err) {
        toast(`インポート失敗: ${err.message}`);
      }
      e.target.value = '';
    },
  });

  return h('div', { class: 'view settings-view' },
    h('section', { class: 'card' },
      h('h2', {}, '1日の目標カロリー'),
      h('form', { class: 'row', onsubmit: (e) => {
        e.preventDefault();
        const v = Math.round(Number(goal.value));
        if (v < 500 || v > 9999) { toast('500〜9999で入力してください'); return; }
        setGoal(v); toast('保存しました');
      } }, goal, h('span', {}, 'kcal'), h('button', { class: 'primary', type: 'submit' }, '保存')),
      h('p', { class: 'hint' }, '目安: 女性 1,400〜2,000 / 男性 2,000〜2,600')),
    h('section', { class: 'card' },
      h('h2', {}, 'データのバックアップ'),
      h('p', { class: 'hint' }, 'データはこの端末内のみに保存。機種変更に備えて定期的にエクスポートしてください。'),
      h('div', { class: 'row' },
        h('button', { class: 'secondary', onclick: exportData }, 'エクスポート'),
        h('label', { class: 'button secondary' }, fileInput, 'インポート'))),
    h('section', { class: 'card' },
      h('h2', {}, 'ホーム画面に追加'),
      h('p', { class: 'hint' }, 'iPhone: 共有 →「ホーム画面に追加」／Android: メニュー →「ホーム画面に追加」')));
}

// ---------- boot ----------
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.().catch(() => {});
