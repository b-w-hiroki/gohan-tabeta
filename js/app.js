import {
  MEAL_TYPES, getDay, putDay, getDaysInRange, getAllDays, putPhoto, getPhoto, deletePhoto,
  getAllPhotos, clearAll, dayTotal, mealTotal, hasContent, exerciseTotal,
} from './db.js';
import { FOOD_PRESETS, EXERCISE_PRESETS } from './foods.js';
import {
  WEEKDAYS, pad, toKey, fromKey, todayKey, addDays, uid, fmt, h, getGoal, setGoal,
  getProfile, setProfile, isProfileComplete, calcBmr, calcTdee, exerciseKcal, ACTIVITY_LEVELS,
  icon, iconSvg, parseKcal,
} from './util.js';
import { renderDashboard } from './dashboard.js';

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
      h('span', {}, h('b', { class: 'over-sample' }, '赤字'), `=目標${fmt(goal)}超`)),
    h('div', { class: 'month-summary' },
      h('span', {}, '記録 ', h('strong', {}, recordedDays), '日'),
      h('span', {}, '平均 ', h('strong', {}, fmt(avg)), 'kcal'),
      h('span', {}, '合計 ', h('strong', {}, fmt(monthTotal)), 'kcal')));
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
  for (const type of MEAL_TYPES) panels.append(await renderMealCard(day, type, save));
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
      burned ? h('div', { class: 'day-burn' }, `運動 -${fmt(burned)} kcal`) : null),
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

async function renderMealCard(day, type, save) {
  const meal = day.meals[type.id];
  const subtotal = mealTotal(meal);

  const items = h('ul', { class: 'items' },
    meal.items.map((it, idx) => h('li', {},
      h('button', { class: 'item-main', 'aria-label': `${it.name} ${it.kcal}kcal を編集`, onclick: () => openItemSheet(type, it, async (next) => {
        if (next) meal.items[idx] = next; else meal.items.splice(idx, 1);
        await save();
      }) },
      h('span', { class: 'item-name' }, it.name || '(無題)'),
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
      empty ? h('p', { class: 'empty' }, `${type.label}はまだ記録がありません`) : null),
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

  return h('section', { class: 'card meal meal-exercise', role: 'tabpanel', 'aria-label': '運動' },
    h('header', { class: 'meal-head' },
      h('h2', {}, '運動'),
      h('span', { class: 'meal-kcal' }, total ? `-${fmt(total)} kcal` : '')),
    h('div', { class: 'items-wrap' }, items,
      day.exercises.length ? null : h('p', { class: 'empty' }, '運動はまだ記録がありません')),
    h('div', { class: 'actions' },
      actionButton('plus', '運動を追加', { class: 'action-btn primary-soft', onclick: () => openExerciseSheet(null, async (next) => {
        if (next) { day.exercises.push(next); await save(); }
      }) }),
      actionButton('watch', 'Watch', { 'aria-label': 'Apple Watchの値を貼り付け', onclick: async () => {
        if (await pasteWatchKcal(day.date)) render();
      } })),
    h('p', { class: 'hint' }, 'Watch：ショートカットでコピーした値を貼り付け'));
}

// ---------- Apple Watch (via iOS Shortcuts) ----------
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
  if (!confirm(`アクティブカロリー ${fmt(kcal)}kcal を記録しますか？\n（この日のApple Watch記録は置き換えます）`)) return false;
  await saveWatchKcal(date, kcal);
  toast('Apple Watchの値を記録しました');
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
    h('h3', {}, `${type.label}を${item ? '編集' : '追加'}`),
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
    app: 'gohan-tabeta', version: 1, exportedAt: new Date().toISOString(), goalKcal: getGoal(), profile: getProfile(), days,
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
  return true;
}

let settingsTab = 'profile';

function renderSettings() {
  setHeader({ title: '設定' });
  const tabs = [['profile', '基本情報'], ['goal', '目標'], ['link', '連携'], ['data', 'データ']];
  const seg = h('div', { class: 'segment', role: 'tablist' },
    tabs.map(([id, label]) => h('button', {
      role: 'tab', 'aria-selected': String(settingsTab === id),
      onclick: () => { settingsTab = id; render(); },
    }, label)));
  const body = settingsTab === 'profile' ? renderProfileForm()
    : settingsTab === 'goal' ? renderGoalForm()
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

let linkMode = 'paste';

function renderLinkPanel() {
  const importUrl = `${location.origin}${location.pathname}#/import?kcal=`;
  const step = (n, ...body) => h('li', {}, h('span', { class: 'step-no' }, n), h('span', {}, ...body));
  const b = (t) => h('b', {}, t);
  const common = [
    step(1, 'ショートカットAppで新規作成し ', b('ヘルスケアサンプルを検索'), '（アクティブエネルギー・今日）'),
    step(2, b('統計を計算'), '（合計）→ ', b('数値を丸める')),
  ];
  const body = linkMode === 'paste'
    ? [h('ol', { class: 'steps' }, ...common,
      step(3, b('クリップボードにコピー'), 'を追加して実行'),
      step(4, 'アプリの ', b('運動 → Watch'), ' で貼り付け')),
    h('p', { class: 'hint note' }, 'ホーム画面のアプリはこちらを使用。同じ日の再取り込みは上書き。活動量は「座り仕事が中心」推奨')]
    : [h('ol', { class: 'steps' }, ...common,
      step(3, b('URLを開く'), 'に下のURL＋丸めた数値を指定')),
    h('button', { class: 'url-copy', onclick: async () => {
      try { await navigator.clipboard.writeText(importUrl); toast('URLをコピーしました'); } catch { prompt('URLをコピーしてください', importUrl); }
    } }, h('code', {}, importUrl), h('small', {}, 'タップでコピー')),
    h('p', { class: 'hint note' }, 'Safariで使う場合のみ（ホーム画面のアプリとはデータが別）。再取り込みは上書き')];

  return h('section', { class: 'card link-panel' },
    h('h2', {}, 'Apple Watchの消費カロリー取り込み'),
    h('div', { class: 'segment segment-sm', role: 'tablist' },
      [['paste', '貼り付け（推奨）'], ['url', 'URL']].map(([id, label]) => h('button', {
        role: 'tab', 'aria-selected': String(linkMode === id), onclick: () => { linkMode = id; render(); },
      }, label))),
    ...body);
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
  return h('div', {},
    h('section', { class: 'card' },
      h('h2', {}, 'バックアップ'),
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
