// Dashboard: calorie trends for a week, a month, or the last N days.
import { MEAL_TYPES, getDaysInRange, dayTotal, mealTotal } from './db.js';
import {
  WEEKDAYS, toKey, fromKey, todayKey, addDays, daysBetween, fmt, shortDate, h, getGoal,
} from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DAILY_BARS = 62; // Longer ranges are shown as weekly averages.

// Period selection survives navigation within the session.
const RANGE_PRESETS = [7, 30, 90, 365];
const state = { mode: 'week', anchor: todayKey(), days: 30 };

function weekStart(key) {
  const d = fromKey(key);
  const offset = (d.getDay() + 6) % 7; // Monday-start weeks
  return addDays(key, -offset);
}

function currentRange() {
  if (state.mode === 'week') {
    const from = weekStart(state.anchor);
    return { from, to: addDays(from, 6), label: `${shortDate(from)}〜${shortDate(addDays(from, 6))}` };
  }
  if (state.mode === 'month') {
    const d = fromKey(state.anchor);
    const from = toKey(new Date(d.getFullYear(), d.getMonth(), 1));
    const to = toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { from, to, label: `${d.getFullYear()}年${d.getMonth() + 1}月` };
  }
  const to = todayKey();
  const from = addDays(to, -(state.days - 1));
  const start = from.slice(0, 4) === to.slice(0, 4) ? shortDate(from) : `${from.slice(0, 4)}/${shortDate(from)}`;
  return { from, to, label: `${start}〜${shortDate(to)}` };
}

function shift(dir) {
  if (state.mode === 'week') state.anchor = addDays(state.anchor, 7 * dir);
  else {
    const d = fromKey(state.anchor);
    state.anchor = toKey(new Date(d.getFullYear(), d.getMonth() + dir, 1));
  }
}

// One bar per day, or per week for long ranges. value = average kcal over recorded days.
function buildBars(from, to, byDate) {
  const n = daysBetween(from, to) + 1;
  const bars = [];
  if (n <= MAX_DAILY_BARS) {
    for (let i = 0; i < n; i++) {
      const key = addDays(from, i);
      const rec = byDate[key];
      const v = rec ? dayTotal(rec) : 0;
      bars.push({ key, from: key, to: key, value: v, recorded: v > 0 });
    }
    return { bars, unit: 'day' };
  }
  for (let start = weekStart(from); start <= to; start = addDays(start, 7)) {
    let sum = 0; let cnt = 0;
    for (let i = 0; i < 7; i++) {
      const key = addDays(start, i);
      if (key < from || key > to) continue;
      const v = byDate[key] ? dayTotal(byDate[key]) : 0;
      if (v > 0) { sum += v; cnt++; }
    }
    bars.push({ key: start, from: start < from ? from : start, to: addDays(start, 6) > to ? to : addDays(start, 6),
      value: cnt ? Math.round(sum / cnt) : 0, recorded: cnt > 0 });
  }
  return { bars, unit: 'week' };
}

function svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Bar with 4px rounded top, square at the baseline.
function barPath(x, y, w, hgt) {
  const r = Math.min(4, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

function drawChart(box, bars, unit, goal, onSelect, selectedKey) {
  box.replaceChildren();
  const W = box.clientWidth; const H = box.clientHeight;
  if (W < 60 || H < 50) return;
  const pad = { l: 36, r: 6, t: 10, b: 20 };
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const maxV = Math.max(goal * 1.15, ...bars.map((b) => b.value));
  const niceMax = Math.ceil(maxV / 500) * 500;
  const y = (v) => pad.t + ih - (v / niceMax) * ih;
  const slot = iw / bars.length;
  const gap = Math.max(2, Math.min(slot * 0.3, 10));
  const bw = Math.max(1, slot - gap);

  const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `カロリー推移。目標${goal}kcal` });

  // Recessive grid: 0 and max. The goal gets its own labelled tick instead of a mid line.
  for (const v of [0, niceMax]) {
    root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
    const t = svg('text', { x: pad.l - 4, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' });
    t.textContent = v >= 1000 ? `${v / 1000}k` : String(v);
    root.append(t);
  }

  bars.forEach((b, i) => {
    const x = pad.l + i * slot + gap / 2;
    const g = svg('g', { class: `bar${b.value > goal ? ' over' : ''}${b.key === selectedKey ? ' selected' : ''}`, tabindex: 0,
      role: 'button', 'aria-label': `${shortDate(b.from)} ${fmt(b.value)}kcal` });
    // Hit target: full column height, wider than the painted mark.
    g.append(svg('rect', { x: pad.l + i * slot, y: pad.t, width: slot, height: ih, class: 'hit' }));
    if (b.value > 0) {
      const top = y(b.value);
      g.append(svg('path', { d: barPath(x, top, bw, pad.t + ih - top), class: 'mark' }));
    }
    const pick = () => onSelect(b);
    g.addEventListener('click', pick);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    root.append(g);
  });

  // Goal reference line, labelled.
  root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal), class: 'goal' }));
  const gl = svg('text', { x: pad.l - 4, y: y(goal) + 4, 'text-anchor': 'end', class: 'goal-label' });
  gl.textContent = goal >= 1000 ? `${Math.round(goal / 100) / 10}k` : String(goal);
  root.append(gl);

  // X labels: thinned so they never collide.
  const every = Math.ceil(bars.length / Math.max(1, Math.floor(iw / 34)));
  bars.forEach((b, i) => {
    if (i % every !== 0 && bars.length > 7) return;
    const t = svg('text', { x: pad.l + i * slot + slot / 2, y: H - 4, 'text-anchor': 'middle', class: 'tick' });
    const d = fromKey(b.from);
    t.textContent = bars.length <= 7 && unit === 'day' ? WEEKDAYS[d.getDay()] : shortDate(b.from);
    root.append(t);
  });
  box.append(root);
}

export async function renderDashboard($title) {
  $title.textContent = 'ダッシュボード';
  const goal = getGoal();
  const { from, to, label } = currentRange();
  const days = await getDaysInRange(from, to);
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const totals = days.map(dayTotal).filter((v) => v > 0);
  const recorded = totals.length;
  const sum = totals.reduce((a, b) => a + b, 0);
  const avg = recorded ? Math.round(sum / recorded) : 0;
  const within = totals.filter((v) => v <= goal).length;

  // Average kcal per meal over recorded days.
  const mealAvg = MEAL_TYPES.map((t) => {
    const s = days.filter((d) => dayTotal(d) > 0).reduce((a, d) => a + mealTotal(d.meals[t.id]), 0);
    return { ...t, value: recorded ? Math.round(s / recorded) : 0 };
  });
  const mealMax = Math.max(1, ...mealAvg.map((m) => m.value));

  // State lives here, not in the URL, so ask the router to redraw the current route.
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  const seg = h('div', { class: 'segment', role: 'tablist' },
    [['week', '週'], ['month', '月'], ['range', '期間']].map(([m, l]) => h('button', {
      role: 'tab', 'aria-selected': String(state.mode === m),
      onclick: () => { state.mode = m; state.anchor = todayKey(); rerender(); },
    }, l)));

  let periodRow;
  if (state.mode === 'range') {
    periodRow = h('div', { class: 'period range' },
      h('div', { class: 'presets-row', role: 'group', 'aria-label': '集計期間' },
        RANGE_PRESETS.map((n) => h('button', {
          class: 'chip', 'aria-pressed': String(state.days === n),
          onclick: () => { state.days = n; rerender(); },
        }, `直近${n}日`))),
      h('small', { class: 'period-sub' }, `${label}（今日まで）`));
  } else {
    periodRow = h('div', { class: 'period' },
      h('button', { class: 'icon-btn', 'aria-label': '前へ', onclick: () => { shift(-1); rerender(); } }, '‹'),
      h('strong', { class: 'period-label' }, label),
      h('button', { class: 'icon-btn', 'aria-label': '次へ', onclick: () => { shift(1); rerender(); } }, '›'));
  }

  const kpi = (title, value, sub) => h('div', { class: 'stat' }, h('small', {}, title), h('strong', {}, value), sub ? h('small', {}, sub) : null);
  const kpis = h('div', { class: 'stats' },
    kpi('1日平均', `${fmt(avg)}`, 'kcal'),
    kpi('目標内の日', `${within}/${recorded}`, recorded ? `${Math.round((within / recorded) * 100)}%` : '日'),
    kpi('合計', `${fmt(sum)}`, 'kcal'));

  const { bars, unit } = buildBars(from, to, byDate);
  const chartBox = h('div', { class: 'chart-box' });
  const readout = h('div', { class: 'readout' });
  let selectedKey = null;

  const showReadout = (b) => {
    selectedKey = b ? b.key : null;
    if (!b) {
      readout.replaceChildren(h('span', { class: 'muted' },
        unit === 'week' ? '記録日の週平均・タップで詳細' : '棒をタップで詳細'));
      return;
    }
    const when = b.from === b.to ? `${shortDate(b.from)}(${WEEKDAYS[fromKey(b.from).getDay()]})` : `${shortDate(b.from)}〜${shortDate(b.to)} 平均`;
    readout.replaceChildren(
      h('strong', { class: b.value > goal ? 'over-text' : '' }, b.recorded ? `${fmt(b.value)} kcal` : '記録なし'),
      h('span', { class: 'muted' }, ` ${when}`),
      b.from === b.to ? h('a', { class: 'readout-link', href: `#/day/${b.from}` }, 'この日を開く ›') : null);
  };
  const draw = () => drawChart(chartBox, bars, unit, goal, (b) => { showReadout(b); draw(); }, selectedKey);
  showReadout(null);

  const meals = h('div', { class: 'meal-bars' },
    mealAvg.map((m) => h('div', { class: 'meal-bar-row' },
      h('span', { class: 'meal-bar-label' }, m.label),
      h('span', { class: 'meal-bar-track' },
        h('span', { class: `meal-bar-fill dot-${m.id}`, style: `width:${(m.value / mealMax) * 100}%` })),
      h('span', { class: 'meal-bar-value' }, fmt(m.value)))));

  const view = h('div', { class: 'view dash-view' },
    seg, periodRow, kpis,
    h('section', { class: 'card chart-card' },
      h('div', { class: 'chart-head' },
        h('h2', {}, unit === 'week' ? '週平均カロリー' : '日別カロリー'),
        h('span', { class: 'chart-legend' },
          h('i', { class: 'key key-bar' }), '目標内', h('i', { class: 'key key-over' }), '超過',
          h('i', { class: 'key key-goal' }), `目標${fmt(goal)}`)),
      readout, chartBox),
    h('section', { class: 'card meal-card' },
      h('h2', {}, '食事別の平均 (kcal/日)'), meals));

  const onResize = () => { if (chartBox.isConnected) draw(); else window.removeEventListener('resize', onResize); };
  view.onMount = () => { draw(); window.addEventListener('resize', onResize); };
  return view;
}
