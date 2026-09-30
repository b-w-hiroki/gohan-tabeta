// Shared helpers used by every view.
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayKey = () => toKey(new Date());
export const addDays = (key, n) => { const d = fromKey(key); d.setDate(d.getDate() + n); return toKey(d); };
export const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const fmt = (n) => Number(n).toLocaleString('ja-JP');
export const shortDate = (k) => { const d = fromKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };

export function h(tag, attrs = {}, ...children) {
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

export function getGoal() {
  try { return Number(localStorage.getItem('goalKcal')) || 2000; } catch { return 2000; }
}
export function setGoal(v) {
  try { localStorage.setItem('goalKcal', String(v)); } catch { /* storage unavailable */ }
  settingsHook?.({ goalKcal: Number(v) });
}

// Settings are cached in localStorage for synchronous reads; when logged in the hook mirrors them to the cloud.
let settingsHook = null;
export function setSettingsHook(fn) { settingsHook = fn; }
export function applySettings(s) {
  if (!s) return;
  try {
    if (s.goalKcal) localStorage.setItem('goalKcal', String(s.goalKcal));
    if (s.profile) localStorage.setItem('profile', JSON.stringify(s.profile));
    if (s.shortcutName) localStorage.setItem('shortcutName', s.shortcutName);
    if (Array.isArray(s.myFoods)) localStorage.setItem('myFoods', JSON.stringify(s.myFoods));
  } catch { /* storage unavailable */ }
}
export function currentSettings() {
  const out = { goalKcal: getGoal() };
  const p = getProfile();
  if (p) out.profile = p;
  try { const n = localStorage.getItem('shortcutName'); if (n) out.shortcutName = n; } catch { /* ignore */ }
  const foods = getMyFoods();
  if (foods.length) out.myFoods = foods;
  return out;
}

// "My menu": the user's own saved foods, synced like other settings.
export function getMyFoods() {
  try { return JSON.parse(localStorage.getItem('myFoods')) || []; } catch { return []; }
}
export function setMyFoods(list) {
  try { localStorage.setItem('myFoods', JSON.stringify(list)); } catch { /* storage unavailable */ }
  settingsHook?.({ myFoods: list });
}

// ---------- nutrition helpers ----------
export const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
export function sumPfc(items) {
  const t = { p: 0, f: 0, c: 0, has: false };
  for (const it of items) {
    for (const k of ['p', 'f', 'c']) {
      if (it[k] != null && it[k] !== '') { t[k] += Number(it[k]) || 0; t.has = true; }
    }
  }
  t.p = round1(t.p); t.f = round1(t.f); t.c = round1(t.c);
  return t;
}
export const fmtLiters = (ml) => `${round1((Number(ml) || 0) / 1000)}L`;

// ---------- profile & energy estimates ----------
export const KCAL_PER_KG = 7200; // Commonly used approximation for 1kg of body fat.

// Exercise is recorded separately, so these levels describe daily life without workouts.
export const ACTIVITY_LEVELS = [
  { value: 1.2, label: '座り仕事が中心' },
  { value: 1.375, label: '立ち仕事・よく歩く' },
  { value: 1.55, label: '体を動かす仕事' },
];

export function getProfile() {
  try { return JSON.parse(localStorage.getItem('profile')) || null; } catch { return null; }
}
export function setProfile(p) {
  try { localStorage.setItem('profile', JSON.stringify(p)); } catch { /* storage unavailable */ }
  settingsHook?.({ profile: p });
}

export function isProfileComplete(p) {
  return !!p && p.age > 0 && p.height > 0 && p.weight > 0 && (p.sex === 'male' || p.sex === 'female');
}

// Basal metabolic rate (Mifflin-St Jeor).
export function calcBmr(p) {
  if (!isProfileComplete(p)) return 0;
  const base = 10 * p.weight + 6.25 * p.height - 5 * p.age;
  return Math.round(p.sex === 'male' ? base + 5 : base - 161);
}

// Daily energy expenditure excluding recorded exercise.
export function calcTdee(p) {
  return Math.round(calcBmr(p) * (Number(p?.activity) || 1.2));
}

// Net extra kcal of an exercise (METs minus the resting 1 MET already counted in TDEE).
export function exerciseKcal(mets, minutes, weight) {
  if (!mets || !minutes || !weight) return 0;
  return Math.max(0, Math.round((mets - 1) * weight * (minutes / 60) * 1.05));
}

// ---------- icons (static, trusted SVG markup) ----------
const ICONS = {
  'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
  'chevron-right': '<path d="M9 18l6-6-6-6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  camera: '<path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l.7-3.5h4.6L15 6M9 18l.7 3.5h4.6L15 18M12 9.5V12l1.5 1.5"/>',
};

export function iconSvg(name, size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export function icon(name, size) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = iconSvg(name, size);
  return span;
}

// Pull a calorie number out of pasted text such as "347", "347.6 kcal" or "1,234 kcal".
export function parseKcal(text) {
  const m = String(text ?? '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!m) return 0;
  const v = Math.round(Number(m[0]));
  return v > 0 && v < 10000 ? v : 0;
}

// Name of the iOS Shortcut that copies today's Apple Watch active energy.
export const DEFAULT_SHORTCUT = 'Watch取り込み';
export function getShortcutName() {
  try { return localStorage.getItem('shortcutName') || DEFAULT_SHORTCUT; } catch { return DEFAULT_SHORTCUT; }
}
export function setShortcutName(v) {
  try { localStorage.setItem('shortcutName', v); } catch { /* storage unavailable */ }
  settingsHook?.({ shortcutName: v });
}
