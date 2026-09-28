import {
  MEAL_TYPES, getDay, putDay, getDaysInRange, getAllDays, putPhoto, getPhoto, deletePhoto,
  getAllPhotos, clearAll, dayTotal, mealTotal, hasContent, exerciseTotal, useStore, localStore, dayItems,
} from './db.js';
import { FOOD_PRESETS, EXERCISE_PRESETS } from './foods.js';
import {
  WEEKDAYS, pad, toKey, fromKey, todayKey, addDays, uid, fmt, h, getGoal, setGoal, shortDate,
  getProfile, setProfile, isProfileComplete, calcBmr, calcTdee, exerciseKcal, ACTIVITY_LEVELS,
  icon, iconSvg, parseKcal, getShortcutName, setShortcutName, DEFAULT_SHORTCUT,
  setSettingsHook, applySettings, currentSettings, getMyFoods, setMyFoods, round1, sumPfc, fmtLiters,
} from './util.js';
import { renderDashboard } from './dashboard.js';
import {
  isConfigured, currentUser, cloudStore, signInGoogle, signInEmail, signUpEmail, resetPassword,
  signOutCloud, authErrorMessage, deleteAccount,
} from './cloud.js';

const $app = document.getElementById('app');
const $title = document.getElementById('title');
const $subtitle = document.getElementById('subtitle');
const $left = document.getElementById('hd-left');
const $right = document.getElementById('hd-right');
const $nav = document.getElementById('bottom-nav');

// Object URLs created for the current view; revoked on every navigation.
let objectUrls = [];
function blobUrl(blob) { const u = URL.createObjectURL(blob); objectUrls.push(u); return u; }
function revokeUrls() { objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls = []; }

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
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

// ---------- header ----------
// Each view configures the top bar: a title, optional subtitle and optional prev/next arrows.
function setHeader({ title, subtitle = '', prev = null, next = null, onTitle = null }) {
  $title.textContent = title;
  $subtitle.textContent = subtitle;
  $subtitle.hidden = !subtitle;
  const wrap = $title.parentElement;
  wrap.onclick = onTitle;
  wrap.classList.toggle('tappable', !!onTitle);
  for (const [btn, cfg, name] of [[$left, prev, 'chevron-left'], [$right, next, 'chevron-right']]) {
    btn.hidden = !cfg;
    if (!cfg) { btn.onclick = null; continue; }
    btn.innerHTML = iconSvg(name);
    btn.setAttribute('aria-label', cfg.label);
    btn.onclick = cfg.go;
  }
}
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = iconSvg(el.dataset.icon);

// ---------- router ----------
function parseRoute() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, arg] = path.split('/');
  if (name === 'import') {
    const q = new URLSearchParams(query);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : todayKey();
    return { name: 'import', date, kcal: parseKcal(q.get('kcal')) };
  }
  if (name === 'today') return { name: 'day', date: todayKey() };
  if (name === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(arg || '')) return { name: 'day', date: arg };
  if (name === 'settings') return { name: 'settings' };
  if (name === 'stats') return { name: 'stats' };
  if (name === 'month' && /^\d{4}-\d{2}$/.test(arg || '')) return { name: 'month', month: arg };
  return { name: 'month', month: todayKey().slice(0, 7) };
}

async function render() {
  if (document.body.classList.contains('auth-screen')) return; // login screen owns the page
  revokeUrls();
  const route = parseRoute();
  if (route.name === 'import') {
    // Opened from an iOS Shortcut: save, then show that day's exercise tab.
    if (route.kcal && confirm(`アクティブカロリー ${fmt(route.kcal)}kcal を${route.date === todayKey() ? '今日' : route.date}の運動に記録しますか？`)) {
      await saveWatchKcal(route.date, route.kcal);
      toast('Apple Watchの値を記録しました');
    } else if (!route.kcal) {
      toast('取り込む値が見つかりませんでした');
    }
    dayTab = { date: route.date, index: MEAL_TYPES.length };
    location.replace(route.date === todayKey() ? '#/today' : `#/day/${route.date}`);
    return;
  }
  const active = route.name === 'day' ? (route.date === todayKey() ? 'today' : 'calendar')
    : route.name === 'month' ? 'calendar' : route.name;
  for (const a of $nav.querySelectorAll('a')) {
    a.setAttribute('aria-current', a.dataset.nav === active ? 'page' : 'false');
  }
  let view;
  if (route.name === 'day') view = await renderDay(route.date);
  else if (route.name === 'settings') view = renderSettings();
  else if (route.name === 'stats') view = await renderDashboard(setHeader);
  else view = await renderMonth(route.month);
  $app.replaceChildren(view);
  view.onMount?.();
}
window.addEventListener('hashchange', render);
// Coming back from the Shortcuts app: redraw so the paste prompt appears.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && getWatchPending()) render();
});

// ---------- month (calendar) view ----------
async function renderMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const days = await getDaysInRange(toKey(first), toKey(last));
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const goal = getGoal();
  const today = todayKey();
  const thisMonth = today.slice(0, 7);
  const prevMonth = toKey(new Date(y, m - 2, 1)).slice(0, 7);
  const nextMonth = toKey(new Date(y, m, 1)).slice(0, 7);
  setHeader({
    title: `${y}年${m}月`,
    subtitle: month === thisMonth ? '' : 'タップで今月へ',
    prev: { label: '前の月', go: () => { location.hash = `#/month/${prevMonth}`; } },
    next: { label: '次の月', go: () => { location.hash = `#/month/${nextMonth}`; } },
    onTitle: month === thisMonth ? null : () => { location.hash = `#/month/${thisMonth}`; },
  });

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
    const exercised = rec && exerciseTotal(rec) > 0;
    const over = total > goal;
    const wd = new Date(y, m - 1, d).getDay();
    grid.append(h('button', {
      class: `cal-cell${key === today ? ' today' : ''}${key > today ? ' future' : ''}`,
      onclick: () => { location.hash = key === today ? '#/today' : `#/day/${key}`; },
      'aria-label': `${m}月${d}日 ${total ? `${total}kcal` : '記録なし'}${exercised ? ' 運動あり' : ''}`,
    },
    h('span', { class: `cal-num wd-${wd}` }, d),
    h('span', { class: 'cal-dots' },
      dots.map((t) => h('i', { class: `dot dot-${t.id}` })),
      exercised ? h('i', { class: 'dot dot-exercise' }) : null),
    total ? h('span', { class: `cal-kcal${over ? ' over' : ''}` }, fmt(total)) : null));
  }

  const avg = recordedDays ? Math.round(monthTotal / recordedDays) : 0;
  return h('div', { class: 'view month-view' },
    grid,
    h('div', { class: 'legend' },
      MEAL_TYPES.map((t) => h('span', {}, h('i', { class: `dot dot-${t.id}` }), t.label)),
      h('span', {}, h('i', { class: 'dot dot-exercise' }), '運動'),
      h('span', { title: `目標${fmt(goal)}kcal` }, h('b', { class: 'over-sample' }, '赤字'), '=目標超')),
    recordedDays ? h('div', { class: 'month-summary' },
      h('span', {}, '記録 ', h('strong', {}, recordedDays), '日'),
      h('span', {}, '平均 ', h('strong', {}, fmt(avg)), 'kcal'),
      h('span', {}, '合計 ', h('strong', {}, fmt(monthTotal)), 'kcal'))
      : h('div', { class: 'month-summary empty-hint' }, '日付をタップして食事を記録'));
}

// ---------- day view ----------
// Selected tab, kept across re-renders of the same day.
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
  const isToday = date === todayKey();
  const go = (key) => { location.hash = key === todayKey() ? '#/today' : `#/day/${key}`; };
  setHeader({
    title: `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`,
    subtitle: isToday ? '今日' : 'タップで今日へ',
    prev: { label: '前の日', go: () => go(addDays(date, -1)) },
    next: { label: '次の日', go: () => go(addDays(date, 1)) },
    onTitle: isToday ? null : () => go(todayKey()),
  });
  const goal = getGoal();
  const total = dayTotal(day);
  const burned = exerciseTotal(day);
  const pct = Math.min(100, Math.round((total / goal) * 100));
  const remain = goal - total;
  if (dayTab.date !== date) dayTab = { date, index: defaultMealIndex(date) };
  if (getWatchPending() === date) dayTab.index = MEAL_TYPES.length;

  const save = async () => { await putDay(day); await render(); };

  const tabDefs = [
    ...MEAL_TYPES.map((t) => {
      const sub = mealTotal(day.meals[t.id]);
      return { id: t.id, label: t.label, value: sub ? fmt(sub) : hasContent(day.meals[t.id]) ? '✓' : '—' };
    }),
    { id: 'exercise', label: '運動', value: burned ? `-${fmt(burned)}` : day.exercises.length ? '✓' : '—' },
  ];
  const tabs = tabDefs.map((t, i) => h('button', {
    class: `tab tab-${t.id}`, role: 'tab', onclick: () => selectTab(i, true),
  }, h('span', { class: 'tab-label' }, t.label), h('span', { class: 'tab-kcal' }, t.value)));

  const panels = h('div', { class: 'panels' });
  // Most recent earlier record of each meal (last 30 days), offered as "copy previous" on empty meals.
  const past = (await getDaysInRange(addDays(date, -30), addDays(date, -1)).catch(() => []))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const lastMeal = (id) => past.find((d) => d.meals?.[id]?.items?.length);
  for (const type of MEAL_TYPES) panels.append(await renderMealCard(day, type, save, lastMeal(type.id)));
  panels.append(renderExerciseCard(day, save));

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
    h('div', { class: 'day-summary' },
      h('div', { class: 'day-total' },
        h('span', {}, h('small', {}, '摂取 '), h('strong', {}, fmt(total)), h('small', {}, ` / ${fmt(goal)} kcal`)),
        h('span', { class: `remain${remain < 0 ? ' over-text' : ''}` },
          remain < 0 ? `${fmt(-remain)} オーバー` : `あと ${fmt(remain)}`)),
      h('div', { class: 'bar' }, h('div', { class: `bar-fill${remain < 0 ? ' over' : ''}`, style: `width:${pct}%` })),
      renderDayChips(day, save)),
    h('div', { class: 'tabs', role: 'tablist' }, tabs),
    panels);

  view.onMount = () => {
    selectTab(dayTab.index, false);
    panels.scrollLeft = dayTab.index * panels.clientWidth;
  };
  return view;
}

function actionButton(iconName, label, attrs = {}) {
  return h('button', { class: 'action-btn', ...attrs }, icon(iconName, 18), label);
}

// Exercise / weight / water / PFC at a glance; weight and water are tappable.
function renderDayChips(day, save) {
  const pfc = sumPfc(dayItems(day));
  const chip = (label, value, onclick, cls = '') => h(onclick ? 'button' : 'span', { class: `day-chip ${cls}`, onclick, type: onclick ? 'button' : null },
    h('small', {}, label), h('b', {}, value));
  return h('div', { class: 'day-chips' },
    chip('体重', day.weight ? `${day.weight}kg` : '記録', () => openWeightSheet(day, save), day.weight ? '' : 'empty'),
    chip('水分', day.water ? fmtLiters(day.water) : '記録', () => openWaterSheet(day, save), day.water ? '' : 'empty'),
    // Exercise already shows on its own tab, so the third slot is the PFC total.
    chip('PFC', pfc.has ? `${Math.round(pfc.p)}/${Math.round(pfc.f)}/${Math.round(pfc.c)}g` : '—', null, pfc.has ? 'pfc' : 'pfc none'));
}

function openWeightSheet(day, save) {
  const input = h('input', { type: 'number', inputmode: 'decimal', step: 0.1, min: 20, max: 300, placeholder: '例: 55.2', 'aria-label': '体重(kg)' });
  input.value = day.weight || getProfile()?.weight || '';
  let close;
  const form = h('form', { class: 'item-form', onsubmit: async (e) => {
    e.preventDefault();
    const v = round1(input.value);
    if (!v || v < 20 || v > 300) { toast('体重を正しく入力してください'); return; }
    day.weight = v;
    // Today's weight also updates the profile so BMR and exercise estimates stay current.
    const prof = getProfile();
    if (day.date === todayKey() && prof) setProfile({ ...prof, weight: v });
    close(); await save();
  } },
  h('h3', {}, '体重を記録'),
  h('label', {}, '体重 (kg)', input),
  h('p', { class: 'hint' }, '朝起きてトイレの後など、同じ条件で測ると変化がわかりやすくなります。今日の体重は基本情報にも反映されます。'),
  h('div', { class: 'sheet-actions' },
    day.weight ? h('button', { type: 'button', class: 'danger', onclick: async () => { delete day.weight; close(); await save(); } }, '削除') : null,
    h('button', { type: 'button', class: 'secondary', onclick: () => close() }, 'キャンセル'),
    h('button', { type: 'submit', class: 'primary' }, '保存')));
  close = openSheet(form);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function openWaterSheet(day, save) {
  let ml = Number(day.water) || 0;
  const value = h('strong', { class: 'water-value' });
  const draw = () => { value.textContent = `${fmt(ml)} ml`; };
  draw();
  const add = (n) => () => { ml = Math.max(0, ml + n); draw(); };
  let close;
  const form = h('form', { class: 'item-form', onsubmit: async (e) => {
    e.preventDefault();
    if (ml) day.water = ml; else delete day.water;
    close(); await save();
  } },
  h('h3', {}, '水分を記録'),
  h('div', { class: 'water-now' }, value, h('small', {}, '目安 1日 1.5〜2L（食事以外）')),
  h('div', { class: 'water-btns' },
    ...[[150, 'コップ'], [350, '缶'], [500, 'ペット']].map(([n, l]) => h('button', { type: 'button', class: 'chip', onclick: add(n) }, `＋${n}ml`, h('small', {}, l))),
    h('button', { type: 'button', class: 'chip', onclick: add(-150) }, '−150ml')),
  h('div', { class: 'sheet-actions' },
    h('button', { type: 'button', class: 'secondary', onclick: () => close() }, 'キャンセル'),
    h('button', { type: 'submit', class: 'primary' }, '保存')));
  close = openSheet(form);
}

async function renderMealCard(day, type, save, previous) {
  const meal = day.meals[type.id];
  const subtotal = mealTotal(meal);

  const items = h('ul', { class: 'items' },
    meal.items.map((it, idx) => h('li', {},
      h('button', { class: 'item-main', 'aria-label': `${it.name} ${it.kcal}kcal を編集`, onclick: () => openItemSheet(type, it, async (next) => {
        if (next) meal.items[idx] = next; else meal.items.splice(idx, 1);
        await save();
      }) },
      h('span', { class: 'item-name' }, it.name || '(無題)', pfcText(it) ? h('small', { class: 'item-pfc' }, pfcText(it)) : null),
      h('span', { class: 'item-kcal' }, `${fmt(it.kcal)} kcal`),
      icon('chevron-right', 16)))));

  const thumbs = [];
  for (const id of meal.photos) {
    const p = await getPhoto(id);
    if (!p) continue;
    thumbs.push(h('button', { class: 'thumb', 'aria-label': '写真を表示', onclick: () => openPhotoViewer(p, async () => {
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

  let memoTimer;
  const memo = h('textarea', {
    class: 'memo', rows: 1, placeholder: 'メモを追加',
    oninput: (e) => {
      meal.memo = e.target.value;
      clearTimeout(memoTimer);
      memoTimer = setTimeout(() => putDay(day), 400);
    },
    onblur: () => { clearTimeout(memoTimer); putDay(day); },
  });
  memo.value = meal.memo;

  const empty = !meal.items.length;
  return h('section', { class: `card meal meal-${type.id}`, role: 'tabpanel', 'aria-label': type.label },
    h('header', { class: 'meal-head' },
      h('h2', {}, type.label),
      h('span', { class: 'meal-kcal' }, subtotal ? `${fmt(subtotal)} kcal` : '')),
    h('div', { class: 'items-wrap' }, items,
      empty ? h('div', { class: 'empty' },
        h('p', {}, `${type.label}はまだ記録がありません`),
        previous ? h('button', { class: 'copy-btn', onclick: async () => {
          const src = previous.meals[type.id].items;
          meal.items.push(...src.map((it) => ({ ...it })));
          toast(`${shortDate(previous.date)}の${type.label}をコピーしました`);
          await save();
        } }, `${shortDate(previous.date)}の${type.label}をコピー`,
        h('small', {}, `${previous.meals[type.id].items.length}品・${fmt(mealTotal(previous.meals[type.id]))}kcal`)) : null) : null),
    thumbs.length ? h('div', { class: 'photos' }, thumbs) : null,
    h('div', { class: 'actions' },
      actionButton('plus', '食事を追加', { class: 'action-btn primary-soft', onclick: () => openItemSheet(type, null, async (next) => {
        if (next) { meal.items.push(next); await save(); }
      }) }),
      h('label', { class: 'action-btn', 'aria-label': '写真を追加' }, fileInput, icon('camera', 18), '写真')),
    memo);
}

function renderExerciseCard(day, save) {
  const total = exerciseTotal(day);
  const items = h('ul', { class: 'items' },
    day.exercises.map((ex, idx) => h('li', {},
      h('button', { class: 'item-main', 'aria-label': `${ex.name} を編集`, onclick: () => openExerciseSheet(ex, async (next) => {
        if (next) day.exercises[idx] = next; else day.exercises.splice(idx, 1);
        await save();
      }) },
      h('span', { class: 'item-name' }, ex.name || '運動', ex.minutes ? h('small', { class: 'item-sub' }, ` ${ex.minutes}分`) : null),
      h('span', { class: 'item-kcal' }, `-${fmt(ex.kcal)} kcal`),
      icon('chevron-right', 16)))));

  const pending = getWatchPending() === day.date;
  const paste = async () => { if (await pasteWatchKcal(day.date)) render(); };

  return h('section', { class: 'card meal meal-exercise', role: 'tabpanel', 'aria-label': '運動' },
    h('header', { class: 'meal-head' },
      h('h2', {}, '運動'),
      h('span', { class: 'meal-kcal' }, total ? `-${fmt(total)} kcal` : '')),
    h('div', { class: 'items-wrap' }, items,
      day.exercises.length ? null : h('p', { class: 'empty' }, '運動はまだ記録がありません')),
    pending
      ? h('div', { class: 'watch-banner', role: 'status' },
        h('p', {}, icon('watch', 18), 'ショートカットでコピーした値を記録します'),
        h('div', { class: 'actions' },
          h('button', { class: 'primary watch-paste', onclick: paste }, '貼り付けて記録'),
          h('button', { class: 'action-btn', onclick: () => { clearWatchPending(); render(); } }, 'やめる')),
        h('small', {}, '「ペースト」と表示されたらタップ'))
      : h('div', { class: 'actions' },
        actionButton('plus', '運動を追加', { class: 'action-btn primary-soft', onclick: () => openExerciseSheet(null, async (next) => {
          if (next) { day.exercises.push(next); await save(); }
        }) }),
        actionButton('watch', 'Watch', { 'aria-label': 'ショートカットでApple Watchの値を取り込む', onclick: () => runWatchShortcut(day.date) })),
    pending ? null : h('p', { class: 'hint watch-hint' }, 'Watchの消費カロリーをコピー済みなら',
      h('button', { class: 'text-btn', onclick: paste }, '貼り付けて記録')));
}

// ---------- Apple Watch (via iOS Shortcuts) ----------
// The app launches the Shortcut, the Shortcut copies the value, and on return the app offers a paste button.
const PENDING_KEY = 'watchPending';
const PENDING_TTL = 15 * 60 * 1000;

function getWatchPending() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY));
    return p && Date.now() - p.at < PENDING_TTL ? p.date : null;
  } catch { return null; }
}
function clearWatchPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
}
function runWatchShortcut(date) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ date, at: Date.now() })); } catch { /* storage unavailable */ }
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(getShortcutName())}`;
  // If the Shortcuts app did not open (e.g. not on iOS), still show the paste prompt.
  setTimeout(() => { if (document.visibilityState === 'visible') render(); }, 1500);
}

// One Watch entry per day: re-importing later in the day replaces it instead of double counting.
async function saveWatchKcal(date, kcal) {
  const day = await getDay(date);
  day.exercises = day.exercises.filter((ex) => ex.source !== 'watch');
  day.exercises.push({ name: 'Apple Watch', minutes: 0, kcal, source: 'watch' });
  await putDay(day);
}

async function pasteWatchKcal(date) {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch { /* clipboard blocked: fall back to manual paste */ }
  let kcal = parseKcal(text);
  if (!kcal) {
    const typed = prompt('アクティブカロリーを貼り付けてください（例: 347）', text || '');
    if (typed == null) return false;
    kcal = parseKcal(typed);
  }
  if (!kcal) { toast('数値が見つかりませんでした'); return false; }
  await saveWatchKcal(date, kcal);
  clearWatchPending();
  toast(`Apple Watch ${fmt(kcal)}kcal を記録しました`);
  return true;
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

// Frequently eaten foods from the last 60 days (most frequent first), for quick re-entry.
async function recentFoods() {
  const days = await getDaysInRange(addDays(todayKey(), -60), todayKey()).catch(() => []);
  const byName = new Map();
  for (const d of days.sort((x, y) => (x.date < y.date ? -1 : 1))) {
    for (const it of dayItems(d)) {
      if (!it.name) continue;
      const prev = byName.get(it.name);
      byName.set(it.name, { ...it, count: (prev?.count || 0) + 1 });
    }
  }
  return [...byName.values()].sort((x, y) => y.count - x.count).slice(0, 16);
}

const pfcOf = (it) => ({ p: it.p, f: it.f, c: it.c });
const pfcText = (it) => (it.p != null || it.f != null || it.c != null
  ? `P${round1(it.p)} F${round1(it.f)} C${round1(it.c)}` : '');

function openItemSheet(type, item, onDone) {
  const name = h('input', { type: 'text', placeholder: '例: 焼き魚定食', enterkeyhint: 'next', autocomplete: 'off' });
  const kcal = h('input', { type: 'number', inputmode: 'numeric', placeholder: '0', min: 0, max: 9999, enterkeyhint: 'done' });
  const pfcInput = (label) => h('input', { type: 'number', inputmode: 'decimal', step: 0.1, min: 0, max: 999, placeholder: '-', 'aria-label': label });
  const p = pfcInput('たんぱく質(g)'); const f = pfcInput('脂質(g)'); const c = pfcInput('炭水化物(g)');
  const saveMine = h('input', { type: 'checkbox' });
  if (item) {
    name.value = item.name; kcal.value = item.kcal;
    if (item.p != null) p.value = item.p;
    if (item.f != null) f.value = item.f;
    if (item.c != null) c.value = item.c;
  }
  const pfcDetails = h('details', { class: 'pfc-details', open: item && (item.p != null || item.f != null || item.c != null) },
    h('summary', {}, 'PFC（たんぱく質・脂質・炭水化物）も入力'),
    h('div', { class: 'pfc-row' },
      h('label', {}, 'P たんぱく質(g)', p), h('label', {}, 'F 脂質(g)', f), h('label', {}, 'C 炭水化物(g)', c)));

  let close;
  const submit = async (e) => {
    e.preventDefault();
    const n = name.value.trim();
    const k = Math.max(0, Math.round(Number(kcal.value) || 0));
    if (!n && !k) { name.focus(); return; }
    const next = { name: n || '食事', kcal: k };
    for (const [key, el] of [['p', p], ['f', f], ['c', c]]) {
      if (el.value !== '') next[key] = round1(el.value);
    }
    if (saveMine.checked) {
      const mine = getMyFoods().filter((m) => m.name !== next.name);
      setMyFoods([next, ...mine].slice(0, 50));
      toast('マイメニューに保存しました');
    }
    close();
    await onDone(next);
  };

  // Tapping a food adds it to what's already entered, so a set meal can be built up.
  const addFood = (fd) => {
    name.value = name.value.trim() ? `${name.value.trim()}・${fd.name}` : fd.name;
    kcal.value = (Number(kcal.value) || 0) + (Number(fd.kcal) || 0);
    for (const [key, el] of [['p', p], ['f', f], ['c', c]]) {
      if (fd[key] != null) el.value = round1((Number(el.value) || 0) + Number(fd[key]));
    }
  };
  const chip = (fd, extra) => h('button', { type: 'button', class: `chip${extra ? ` ${extra}` : ''}`, onclick: () => addFood(fd) },
    fd.name, h('small', {}, fd.kcal));

  const list = h('div', { class: 'presets' });
  let tab = 'mine';
  const tabs = h('div', { class: 'segment segment-mini', role: 'tablist' });
  const drawTabs = () => {
    tabs.replaceChildren(...[['mine', 'マイメニュー・履歴'], ['std', '定番']].map(([id, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; drawTabs(); drawList(); },
    }, label)));
  };
  const drawList = async () => {
    if (tab === 'std') { list.replaceChildren(...FOOD_PRESETS.map((fd) => chip(fd))); return; }
    const mine = getMyFoods();
    list.replaceChildren(...mine.map((fd) => chip(fd, 'chip-mine')));
    const recent = (await recentFoods()).filter((r) => !mine.some((m) => m.name === r.name));
    if (tab !== 'mine') return;
    list.append(...recent.map((fd) => chip(fd)));
    if (!list.children.length) {
      list.append(h('p', { class: 'hint' }, 'まだありません。下の「マイメニューに保存」にチェックして保存すると、ここに並びます。'));
    }
  };
  drawTabs(); drawList();

  const form = h('form', { class: 'item-form', onsubmit: submit },
    h('h3', {}, `${type.label}を${item ? '編集' : '追加'}`),
    h('label', {}, '料理名', name),
    h('label', {}, 'カロリー (kcal)', kcal),
    pfcDetails,
    tabs,
    list,
    h('label', { class: 'check-row' }, saveMine, 'この内容をマイメニューに保存'),
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

function openExerciseSheet(ex, onDone) {
  const profile = getProfile();
  const weight = Number(profile?.weight) || 0;
  let mets = ex?.mets || 0;
  const name = h('input', { type: 'text', placeholder: '例: ジョギング', autocomplete: 'off' });
  const minutes = h('input', { type: 'number', inputmode: 'numeric', placeholder: '30', min: 0, max: 1440 });
  const kcal = h('input', { type: 'number', inputmode: 'numeric', placeholder: '0', min: 0, max: 9999 });
  if (ex) { name.value = ex.name; minutes.value = ex.minutes || ''; kcal.value = ex.kcal; }

  const recalc = () => {
    const k = exerciseKcal(mets, Number(minutes.value), weight);
    if (k) kcal.value = k;
  };
  minutes.addEventListener('input', recalc);
  // Typing kcal by hand (e.g. from Apple Watch) stops auto-calculation.
  kcal.addEventListener('input', () => { mets = 0; });

  let close;
  const submit = async (e) => {
    e.preventDefault();
    const k = Math.max(0, Math.round(Number(kcal.value) || 0));
    const m = Math.max(0, Math.round(Number(minutes.value) || 0));
    if (!name.value.trim() && !k) { name.focus(); return; }
    close();
    await onDone({ name: name.value.trim() || '運動', minutes: m, kcal: k, mets: mets || undefined });
  };

  const presets = h('div', { class: 'presets' },
    EXERCISE_PRESETS.map((p) => h('button', {
      type: 'button', class: 'chip',
      onclick: () => {
        name.value = p.name; mets = p.mets;
        if (!minutes.value) minutes.value = 30;
        recalc();
      },
    }, p.name)));

  const form = h('form', { class: 'item-form', onsubmit: submit },
    h('h3', {}, `運動を${ex ? '編集' : '追加'}`),
    h('label', {}, '種目', name),
    h('div', { class: 'row2' },
      h('label', {}, '時間 (分)', minutes),
      h('label', {}, '消費 (kcal)', kcal)),
    h('p', { class: 'hint' }, weight
      ? '種目を選ぶと時間と体重から消費kcalを自動計算します'
      : '設定で体重を入力すると消費kcalを自動計算できます'),
    presets,
    h('div', { class: 'sheet-actions' },
      ex ? h('button', { type: 'button', class: 'danger', onclick: async () => {
        if (!confirm('この運動を削除しますか？')) return;
        close(); await onDone(null);
      } }, '削除') : null,
      h('button', { type: 'button', class: 'secondary', onclick: () => close() }, 'キャンセル'),
      h('button', { type: 'submit', class: 'primary' }, '保存')));

  close = openSheet(form);
  if (!ex) setTimeout(() => name.focus(), 50);
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
    app: 'gohan-tabeta', version: 1, exportedAt: new Date().toISOString(), goalKcal: getGoal(), profile: getProfile(),
    settings: currentSettings(), days,
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
  if (data.profile) setProfile(data.profile);
  if (data.settings?.myFoods) setMyFoods(data.settings.myFoods);
  return true;
}

let settingsTab = 'profile';

function renderSettings() {
  setHeader({ title: '設定' });
  const tabs = [['profile', '基本情報'], ['goal', '目標'], ['menu', 'メニュー'], ['link', '連携'], ['data', 'データ']];
  const seg = h('div', { class: 'segment', role: 'tablist' },
    tabs.map(([id, label]) => h('button', {
      role: 'tab', 'aria-selected': String(settingsTab === id),
      onclick: () => { settingsTab = id; render(); },
    }, label)));
  const body = settingsTab === 'profile' ? renderProfileForm()
    : settingsTab === 'goal' ? renderGoalForm()
      : settingsTab === 'menu' ? renderMenuPanel()
        : settingsTab === 'link' ? renderLinkPanel() : renderDataPanel();
  return h('div', { class: 'view settings-view' }, seg, body);
}

function renderProfileForm() {
  const p = getProfile() || { sex: '', age: '', height: '', weight: '', activity: 1.2 };
  const sex = h('select', { 'aria-label': '性別' },
    h('option', { value: '' }, '選択'), h('option', { value: 'female' }, '女性'), h('option', { value: 'male' }, '男性'));
  sex.value = p.sex || '';
  const num = (value, attrs) => h('input', { type: 'number', inputmode: 'decimal', value: value || '', ...attrs });
  const age = num(p.age, { min: 10, max: 100 });
  const height = num(p.height, { min: 100, max: 250, step: 0.1 });
  const weight = num(p.weight, { min: 20, max: 300, step: 0.1 });
  const activity = h('select', { 'aria-label': '活動レベル' },
    ACTIVITY_LEVELS.map((a) => h('option', { value: a.value }, a.label)));
  activity.value = String(p.activity || 1.2);

  const result = h('div', { class: 'energy' });
  const readForm = () => ({
    sex: sex.value, age: Number(age.value), height: Number(height.value),
    weight: Number(weight.value), activity: Number(activity.value),
  });
  const update = () => {
    const f = readForm();
    if (!isProfileComplete(f)) { result.replaceChildren(h('p', { class: 'hint' }, 'すべて入力すると基礎代謝と消費カロリーを計算します')); return; }
    result.replaceChildren(
      h('div', { class: 'energy-item' }, h('small', {}, '基礎代謝(推定)'), h('strong', {}, fmt(calcBmr(f))), h('small', {}, 'kcal/日')),
      h('div', { class: 'energy-item' }, h('small', {}, '1日の消費(運動除く)'), h('strong', {}, fmt(calcTdee(f))), h('small', {}, 'kcal/日')));
  };
  for (const el of [sex, age, height, weight, activity]) el.addEventListener('input', update);
  update();

  return h('form', { class: 'card profile-form', onsubmit: (e) => {
    e.preventDefault();
    const f = readForm();
    if (!isProfileComplete(f)) { toast('すべての項目を入力してください'); return; }
    setProfile(f); toast('保存しました');
  } },
  h('div', { class: 'grid2' },
    h('label', { class: 'field' }, '性別', sex),
    h('label', { class: 'field' }, '年齢', age),
    h('label', { class: 'field' }, '身長 (cm)', height),
    h('label', { class: 'field' }, '体重 (kg)', weight)),
  h('label', { class: 'field' }, '普段の活動量（運動は別に記録）', activity),
  result,
  h('button', { class: 'primary block', type: 'submit' }, '保存'));
}

function renderGoalForm() {
  const goal = h('input', { type: 'number', inputmode: 'numeric', min: 500, max: 9999, value: getGoal() });
  const p = getProfile();
  const tdee = isProfileComplete(p) ? calcTdee(p) : 0;
  const suggestion = (deficit, label) => {
    const v = Math.max(1200, tdee - deficit);
    return h('button', { type: 'button', class: 'chip', onclick: () => { goal.value = v; } },
      `${label} ${fmt(v)}`);
  };
  return h('section', { class: 'card' },
    h('h2', {}, '1日の目標カロリー（摂取）'),
    h('form', { class: 'row', onsubmit: (e) => {
      e.preventDefault();
      const v = Math.round(Number(goal.value));
      if (v < 500 || v > 9999) { toast('500〜9999で入力してください'); return; }
      setGoal(v); toast('保存しました');
    } }, goal, h('span', {}, 'kcal'), h('button', { class: 'primary', type: 'submit' }, '保存')),
    tdee
      ? [h('p', { class: 'hint' }, `消費 ${fmt(tdee)}kcal/日 からの目安（タップで入力）`),
        h('div', { class: 'presets' },
          suggestion(0, '維持'), suggestion(250, '週-0.25kg'), suggestion(500, '週-0.5kg'), suggestion(750, '週-0.75kg'))]
      : h('p', { class: 'hint' }, '基本情報を入力すると、減量ペース別の目安を表示します'));
}

function renderLinkPanel() {
  const name = h('input', { type: 'text', value: getShortcutName(), 'aria-label': 'ショートカット名', autocomplete: 'off' });
  const step = (n, ...body) => h('li', {}, h('span', { class: 'step-no' }, n), h('span', {}, ...body));
  const b = (t) => h('b', {}, t);
  return h('section', { class: 'card link-panel' },
    h('h2', {}, 'Apple Watchの消費カロリー取り込み'),
    h('p', { class: 'hint' }, 'ショートカットAppで次の手順のショートカットを1回だけ作成します'),
    h('ol', { class: 'steps' },
      step(1, '新規作成し、名前を ', b(`「${getShortcutName()}」`), ' にする'),
      step(2, b('ヘルスケアサンプルを検索'), '（アクティブエネルギー・開始日が今日）'),
      step(3, b('統計を計算'), '（合計）→ ', b('数値を丸める')),
      step(4, b('クリップボードにコピー'), ' を追加して保存')),
    h('form', { class: 'row', onsubmit: (e) => {
      e.preventDefault();
      setShortcutName(name.value.trim() || DEFAULT_SHORTCUT); toast('保存しました'); render();
    } }, name, h('button', { class: 'secondary', type: 'submit' }, '名前を保存')),
    h('p', { class: 'hint note' }, '使い方：運動タブの「Watch」→ 実行後にこのアプリへ戻り「貼り付けて記録」。同じ日は上書き'));
}

function renderMenuPanel() {
  const foods = getMyFoods();
  const list = h('ul', { class: 'items menu-list' },
    foods.map((fd, i) => h('li', {},
      h('div', { class: 'item-main' },
        h('span', { class: 'item-name' }, fd.name, pfcText(fd) ? h('small', { class: 'item-pfc' }, pfcText(fd)) : null),
        h('span', { class: 'item-kcal' }, `${fmt(fd.kcal)} kcal`),
        h('button', { class: 'icon-btn small', 'aria-label': `${fd.name}を削除`, onclick: () => {
          if (!confirm(`「${fd.name}」をマイメニューから削除しますか？`)) return;
          setMyFoods(foods.filter((_, j) => j !== i)); render();
        } }, icon('trash', 18))))));
  return h('section', { class: 'card menu-panel' },
    h('h2', {}, 'マイメニュー'),
    h('p', { class: 'hint' }, '食事の追加画面で「マイメニューに保存」にチェックすると登録されます。最近よく食べたものも自動で候補に出ます。'),
    foods.length ? h('div', { class: 'menu-scroll' }, list) : h('div', { class: 'empty' }, h('p', {}, 'まだ登録がありません')));
}

function renderDataPanel() {
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
  const account = session.user
    ? h('section', { class: 'card' },
      h('h2', {}, 'アカウント'),
      h('p', { class: 'hint' }, `${session.user.email || session.user.displayName || 'ログイン中'} でログイン中。記録はクラウドに保存され、他の端末でも同じ内容が見られます。`),
      h('button', { class: 'secondary', onclick: async () => {
        if (!confirm('ログアウトしますか？（記録はクラウドに残ります）')) return;
        await signOutCloud();
        setAuthMode(null);
        location.reload();
      } }, 'ログアウト'),
      h('button', { class: 'danger', onclick: async () => {
        if (!confirm('アカウントとクラウド上のすべての記録・写真を削除します。元に戻せません。よろしいですか？')) return;
        if (!confirm('本当に削除しますか？')) return;
        try {
          await deleteAccount();
          setAuthMode(null);
          alert('アカウントを削除しました');
          location.reload();
        } catch (err) { toast(authErrorMessage(err)); }
      } }, 'アカウントを削除'))
    : h('section', { class: 'card' },
      h('h2', {}, 'アカウント'),
      h('p', { class: 'hint' }, 'ログインせずに利用中。記録はこの端末だけに保存されています。'),
      isConfigured()
        ? h('button', { class: 'secondary', onclick: () => { setAuthMode(null); location.reload(); } }, 'ログインしてクラウドに保存')
        : h('p', { class: 'auth-notice' }, 'ログイン・クラウド同期は準備中です'));
  return h('div', {},
    account,
    h('section', { class: 'card' },
      h('h2', {}, 'バックアップ'),
      h('p', { class: 'hint' }, session.user
        ? '念のためのバックアップや、別アカウントへの移行に使えます。'
        : '機種変更に備えて定期的にエクスポートしてください。'),
      h('div', { class: 'row' },
        h('button', { class: 'secondary', onclick: exportData }, 'エクスポート'),
        h('label', { class: 'button secondary' }, fileInput, 'インポート'))),
    h('section', { class: 'card' },
      h('h2', {}, 'ホーム画面に追加'),
      h('p', { class: 'hint' }, 'iPhone: 共有 →「ホーム画面に追加」／Android: メニュー →「ホーム画面に追加」')));
}

// ---------- session: local (this device) or cloud (logged in) ----------
const session = { user: null };

function getAuthMode() {
  try { return localStorage.getItem('authMode'); } catch { return null; }
}
function setAuthMode(v) {
  try { if (v) localStorage.setItem('authMode', v); else localStorage.removeItem('authMode'); } catch { /* ignore */ }
}

async function startCloud(user) {
  session.user = user;
  const cloud = cloudStore(user.uid);
  // Settings: the account's saved values win; a brand-new account starts from this device's.
  const saved = await cloud.getSettings().catch(() => null);
  if (saved) applySettings(saved); else await cloud.saveSettings(currentSettings()).catch(() => {});
  setSettingsHook((patch) => cloud.saveSettings(patch).catch(() => toast('設定をクラウドに保存できませんでした')));
  useStore(cloud);
  setAuthMode('cloud');
  await offerMigration(cloud);
}

// First login on a device that already has local records: offer to copy them into the account.
async function offerMigration(cloud) {
  let localDays = [];
  try { localDays = await localStore.getAllDays(); } catch { return; }
  if (!localDays.length) return;
  let migratedKey = `migrated:${session.user.uid}`;
  try { if (localStorage.getItem(migratedKey)) return; } catch { /* ignore */ }
  if (await cloud.hasAnyDay()) return;
  if (!confirm(`この端末に${localDays.length}日分の記録があります。アカウントに保存しますか？`)) {
    try { localStorage.setItem(migratedKey, 'skipped'); } catch { /* ignore */ }
    return;
  }
  toast('記録をアカウントに保存しています…');
  for (const d of localDays) await cloud.putDay(d);
  for (const p of await localStore.getAllPhotos()) await cloud.putPhoto(p);
  try { localStorage.setItem(migratedKey, 'done'); } catch { /* ignore */ }
  toast(`${localDays.length}日分の記録を保存しました`);
}

// ---------- login screen ----------
function renderLogin() {
  document.body.classList.add('auth-screen');
  let mode = 'login';
  const configured = isConfigured();
  const email = h('input', { type: 'email', placeholder: 'メールアドレス', autocomplete: 'email', 'aria-label': 'メールアドレス' });
  const password = h('input', { type: 'password', placeholder: 'パスワード（6文字以上）', autocomplete: 'current-password', 'aria-label': 'パスワード' });
  const error = h('p', { class: 'auth-error', role: 'alert', hidden: true });
  const submit = h('button', { class: 'primary block', type: 'submit' }, 'ログイン');
  const toggle = h('button', { type: 'button', class: 'text-btn' });
  const note = h('p', { class: 'auth-note' });

  const busy = (on) => { for (const b of form.querySelectorAll('button')) b.disabled = on; };
  const fail = (e) => { error.textContent = typeof e === 'string' ? e : authErrorMessage(e); error.hidden = false; busy(false); };
  const done = async (user) => {
    if (!user) return; // redirect flow continues after reload
    document.body.classList.remove('auth-screen');
    await startCloud(user);
    location.hash = '#/today';
    render();
  };
  const setMode = (m) => {
    mode = m;
    submit.textContent = m === 'login' ? 'ログイン' : '新規登録';
    password.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    toggle.textContent = m === 'login' ? 'はじめての方は新規登録' : 'アカウントをお持ちの方はログイン';
    note.textContent = m === 'login' ? '' : '登録すると、利用規約とプライバシーポリシーに同意したものとみなします。';
    error.hidden = true;
  };
  toggle.addEventListener('click', () => setMode(mode === 'login' ? 'signup' : 'login'));

  const form = h('form', { class: 'auth-card', onsubmit: async (e) => {
    e.preventDefault();
    if (!configured) return;
    busy(true); error.hidden = true;
    try {
      await done(mode === 'login' ? await signInEmail(email.value.trim(), password.value)
        : await signUpEmail(email.value.trim(), password.value));
    } catch (err) { fail(err); }
  } },
  h('button', { type: 'button', class: 'google-btn', disabled: !configured, onclick: async () => {
    busy(true); error.hidden = true;
    try { await done(await signInGoogle()); } catch (err) { fail(err); }
  } }, googleMark(), 'Googleでログイン'),
  h('div', { class: 'auth-divider' }, h('span', {}, 'または')),
  email, password, submit, error,
  h('div', { class: 'auth-links' }, toggle,
    h('button', { type: 'button', class: 'text-btn', onclick: async () => {
      if (!email.value.trim()) { fail('パスワード再設定のメールを送るため、メールアドレスを入力してください'); return; }
      try { await resetPassword(email.value.trim()); toast('再設定メールを送りました'); } catch (err) { fail(err); }
    } }, 'パスワードを忘れた')),
  note,
  configured ? null : h('p', { class: 'auth-notice' }, 'クラウド保存は準備中です。今は「ログインせずに使う」で利用できます。'));
  if (!configured) for (const el of [email, password, submit]) el.disabled = true;
  setMode('login');

  $app.replaceChildren(h('div', { class: 'auth' },
    h('div', { class: 'auth-hero' },
      h('img', { src: 'icons/icon.svg', alt: '', class: 'auth-logo', width: 72, height: 72 }),
      h('h1', {}, 'ごはん食べた'),
      h('p', {}, '食べたものを、カレンダーにぽんっと記録。')),
    form,
    h('div', { class: 'auth-guest' },
      h('button', { type: 'button', class: 'secondary block', onclick: () => {
        setAuthMode('local');
        document.body.classList.remove('auth-screen');
        render();
      } }, 'ログインせずに使う'),
      h('small', {}, 'ログインしない場合、記録はこの端末だけに保存されます。ログインすると機種変更や複数の端末でも記録を引き継げます。')),
    h('p', { class: 'auth-footer' },
      h('a', { href: './' }, 'ごはん食べたについて'), ' ・ ', h('a', { href: './terms.html' }, '利用規約'),
      ' ・ ', h('a', { href: './privacy.html' }, 'プライバシーポリシー'))));
}

function googleMark() {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  return span;
}

// ---------- boot ----------
async function boot() {
  let user = null;
  if (isConfigured() && getAuthMode() !== 'local') {
    try { user = await currentUser(); } catch { /* offline or SDK unavailable: fall through */ }
  }
  if (user) {
    try { await startCloud(user); } catch { toast('クラウドに接続できませんでした'); }
    render();
  } else if (getAuthMode() === 'local' || !isConfigured()) {
    // Until cloud sync is configured there is nothing to log in to: open the app directly.
    render();
  } else {
    renderLogin();
  }
}
boot();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.().catch(() => {});
