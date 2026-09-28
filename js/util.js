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
