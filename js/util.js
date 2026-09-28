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
}

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
