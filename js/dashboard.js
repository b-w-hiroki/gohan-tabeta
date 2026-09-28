// Dashboard: calorie trends for a week, a month, or the last N days.
import { MEAL_TYPES, getDaysInRange, dayTotal, mealTotal, exerciseTotal, dayItems } from './db.js';
import {
  WEEKDAYS, toKey, fromKey, todayKey, addDays, daysBetween, fmt, shortDate, h, getGoal,
  getProfile, isProfileComplete, calcTdee, KCAL_PER_KG, icon, sumPfc, fmtLiters, round1,
} from './util.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_DAILY_BARS = 62; // Longer ranges are shown as weekly averages.

// Period selection survives navigation within the session.
const RANGE_PRESETS = [7, 30, 90, 365];
const state = { mode: 'week', anchor: todayKey(), days: 30, chart: 'kcal' };

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
    if (Math.abs(y(v) - y(goal)) < 12) continue; // the goal label takes priority
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

// Weight chart: measured weights (solid) and the estimate from the energy balance (dashed),
// starting at the first measured weight in the period.
function drawWeightChart(box, from, to, byDate, tdee) {
  box.replaceChildren();
  const W = box.clientWidth; const H = box.clientHeight;
  if (W < 60 || H < 50) return;
  const last = to < todayKey() ? to : todayKey();
  const n = daysBetween(from, to) + 1;
  const measured = [];
  for (let i = 0; i < n; i++) {
    const key = addDays(from, i);
    if (byDate[key]?.weight) measured.push({ i, key, v: byDate[key].weight });
  }
  if (!measured.length) {
    box.append(h('p', { class: 'chart-empty' }, '日ごとの画面で「体重」を記録すると、ここにグラフが表示されます'));
    return;
  }
  const estimate = [];
  if (tdee) {
    let bal = 0;
    for (let i = measured[0].i; i < n; i++) {
      const key = addDays(from, i);
      if (key > last) break;
      const d = byDate[key];
      if (d && dayTotal(d) > 0) bal += tdee + exerciseTotal(d) - dayTotal(d);
      estimate.push({ i, v: measured[0].v - bal / KCAL_PER_KG });
    }
  }
  const all = [...measured, ...estimate].map((p) => p.v);
  let lo = Math.min(...all); let hi = Math.max(...all);
  if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 0.5; hi = mid + 0.5; }
  lo -= 0.3; hi += 0.3;
  const pad = { l: 40, r: 8, t: 10, b: 20 };
  const inset = 10; // keeps the first and last dots clear of the axis labels
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const x = (i) => pad.l + inset + (n === 1 ? (iw - 2 * inset) / 2 : (i / (n - 1)) * (iw - 2 * inset));
  const y = (v) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '体重の推移' });
  for (const v of [lo + 0.3, hi - 0.3]) {
    root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
    const t = svg('text', { x: pad.l - 4, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' });
    t.textContent = round1(v).toFixed(1);
    root.append(t);
  }
  if (estimate.length > 1) {
    root.append(svg('polyline', { points: estimate.map((p) => `${x(p.i)},${y(p.v)}`).join(' '), class: 'w-est' }));
  }
  if (measured.length > 1) {
    root.append(svg('polyline', { points: measured.map((p) => `${x(p.i)},${y(p.v)}`).join(' '), class: 'w-line' }));
  }
  for (const p of measured) root.append(svg('circle', { cx: x(p.i), cy: y(p.v), r: 4, class: 'w-dot' }));
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(iw / 44))));
  for (let i = 0; i < n; i += every) {
    const t = svg('text', { x: x(i), y: H - 4, 'text-anchor': 'middle', class: 'tick' });
    t.textContent = shortDate(addDays(from, i));
    root.append(t);
  }
  box.append(root);
}

export async function renderDashboard(setHeader) {
  setHeader({ title: 'ダッシュボード' });
  const goal = getGoal();
  const { from, to, label } = currentRange();
  const days = await getDaysInRange(from, to);
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const totals = days.map(dayTotal).filter((v) => v > 0);
  const recorded = totals.length;
  const sum = totals.reduce((a, b) => a + b, 0);
  const avg = recorded ? Math.round(sum / recorded) : 0;
  const within = totals.filter((v) => v <= goal).length;

  // Energy balance on days with food records: (TDEE + exercise) - intake.
  const profile = getProfile();
  const tdee = isProfileComplete(profile) ? calcTdee(profile) : 0;
  const balance = days.filter((d) => dayTotal(d) > 0)
    .reduce((a, d) => a + tdee + exerciseTotal(d) - dayTotal(d), 0);
  const kg = balance / KCAL_PER_KG;
  const kgText = `${kg > 0 ? '-' : kg < 0 ? '+' : '±'}${Math.abs(kg).toFixed(Math.abs(kg) >= 1 ? 1 : 2)}kg`;

  // Average kcal per meal over recorded days.
  const mealAvg = MEAL_TYPES.map((t) => {
    const s = days.filter((d) => dayTotal(d) > 0).reduce((a, d) => a + mealTotal(d.meals[t.id]), 0);
    return { ...t, value: recorded ? Math.round(s / recorded) : 0 };
  });
  const mealSum = mealAvg.reduce((a, m) => a + m.value, 0);

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
        }, `${n}日`))),
      h('small', { class: 'period-sub' }, `${label}（今日まで）`));
  } else {
    periodRow = h('div', { class: 'period' },
      h('button', { class: 'icon-btn', 'aria-label': '前へ', onclick: () => { shift(-1); rerender(); } }, icon('chevron-left')),
      h('strong', { class: 'period-label' }, label),
      h('button', { class: 'icon-btn', 'aria-label': '次へ', onclick: () => { shift(1); rerender(); } }, icon('chevron-right')));
  }

  const kpi = (title, value, sub) => h('div', { class: 'stat' }, h('small', {}, title), h('strong', {}, value), sub ? h('small', {}, sub) : null);
  const kpis = h('div', { class: 'stats' },
    kpi('1日平均', `${fmt(avg)}`, 'kcal'),
    kpi('目標内の日', `${within}/${recorded}`, recorded ? `${Math.round((within / recorded) * 100)}%` : '日'),
    tdee && recorded
      ? h('a', { class: `stat stat-link${kg > 0 ? ' loss' : ''}`, href: '#/stats', onclick: (e) => { e.preventDefault(); toggleBalance(); } },
        h('small', {}, '推定減量'), h('strong', {}, kgText), h('small', {}, `${balance > 0 ? '-' : '+'}${fmt(Math.abs(Math.round(balance)))}kcal`))
      : tdee
        ? h('div', { class: 'stat' }, h('small', {}, '推定減量'), h('strong', {}, '—'), h('small', {}, '記録なし'))
        : h('a', { class: 'stat stat-link', href: '#/settings' },
          h('small', {}, '推定減量'), h('strong', {}, '—'), h('small', {}, '基本情報を入力')));

  // Tapping the estimate shows how it was calculated.
  const exSum = days.filter((d) => dayTotal(d) > 0).reduce((a, d) => a + exerciseTotal(d), 0);
  const balanceNote = h('p', { class: 'balance-note', hidden: true },
    `記録${recorded}日: 消費 ${fmt(tdee * recorded)} + 運動 ${fmt(exSum)} − 摂取 ${fmt(sum)} = ${fmt(Math.round(balance))}kcal ÷ ${fmt(KCAL_PER_KG)}kcal/kg（食事未記録の日は除外）`);
  function toggleBalance() { balanceNote.hidden = !balanceNote.hidden; }

  const { bars, unit } = buildBars(from, to, byDate);
  const chartBox = h('div', { class: 'chart-box' });
  const readout = h('div', { class: 'readout' });
  let selectedKey = null;

  const showReadout = (b) => {
    selectedKey = b ? b.key : null;
    if (!b) {
      readout.replaceChildren(h('span', { class: 'muted' },
        `目標 ${fmt(goal)}kcal・${unit === 'week' ? '記録日の週平均・' : ''}棒をタップで詳細`));
      return;
    }
    const when = b.from === b.to ? `${shortDate(b.from)}(${WEEKDAYS[fromKey(b.from).getDay()]})` : `${shortDate(b.from)}〜${shortDate(b.to)} 平均`;
    readout.replaceChildren(
      h('strong', { class: b.value > goal ? 'over-text' : '' }, b.recorded ? `${fmt(b.value)} kcal` : '記録なし'),
      h('span', { class: 'muted' }, ` ${when}`),
      b.from === b.to ? h('a', { class: 'readout-link', href: `#/day/${b.from}` }, 'この日を開く ›') : null);
  };
  const isWeight = state.chart === 'weight';
  const draw = () => (isWeight
    ? drawWeightChart(chartBox, from, to, byDate, tdee)
    : drawChart(chartBox, bars, unit, goal, (b) => { showReadout(b); draw(); }, selectedKey));
  if (isWeight) {
    const ws = days.filter((d) => d.weight).sort((a, b) => (a.date < b.date ? -1 : 1));
    const change = ws.length > 1 ? round1(ws[ws.length - 1].weight - ws[0].weight) : null;
    readout.replaceChildren(ws.length
      ? h('span', {}, h('strong', {}, `${ws[ws.length - 1].weight}kg`),
        h('span', { class: 'muted' }, ` 最新${change != null ? `・期間 ${change > 0 ? '+' : ''}${change}kg` : ''}`))
      : h('span', { class: 'muted' }, '体重の記録がありません'));
  } else {
    showReadout(null);
  }

  // PFC and water averages over days that have them.
  const pfcDays = days.map((d) => sumPfc(dayItems(d))).filter((t) => t.has);
  const avgOf = (arr, k) => Math.round(arr.reduce((a, t) => a + t[k], 0) / arr.length);
  const waterDays = days.filter((d) => d.water);
  const extra = (label, value) => h('span', { class: 'extra' }, h('small', {}, label), h('b', {}, value));
  const extras = [
    pfcDays.length ? extra('PFC', `${avgOf(pfcDays, 'p')}/${avgOf(pfcDays, 'f')}/${avgOf(pfcDays, 'c')}g`) : null,
    waterDays.length ? extra('水分', fmtLiters(waterDays.reduce((a, d) => a + d.water, 0) / waterDays.length)) : null,
  ].filter(Boolean);
  const chartTabs = h('div', { class: 'segment segment-mini chart-tabs', role: 'tablist' },
    [['kcal', 'カロリー'], ['weight', '体重']].map(([k, l]) => h('button', {
      role: 'tab', 'aria-selected': String(state.chart === k), onclick: () => { state.chart = k; rerender(); },
    }, l)));

  // Share of each meal as one stacked bar, with the values underneath.
  const meals = h('div', { class: 'meal-split' },
    h('div', { class: 'meal-stack', role: 'img', 'aria-label': mealAvg.map((m) => `${m.label}${fmt(m.value)}kcal`).join('、') },
      mealSum ? mealAvg.filter((m) => m.value > 0).map((m) => h('span', { class: `dot-${m.id}`, style: `flex:${m.value}` })) : null),
    h('div', { class: 'meal-values' },
      mealAvg.map((m) => h('span', { class: 'meal-value' },
        h('small', {}, h('i', { class: `dot dot-${m.id}` }), m.label), h('b', {}, fmt(m.value))))));

  const view = h('div', { class: 'view dash-view' },
    seg, periodRow, kpis, balanceNote,
    h('section', { class: 'card chart-card' },
      h('div', { class: 'chart-head' },
        chartTabs,
        isWeight
          ? h('span', { class: 'chart-legend' },
            h('i', { class: 'key key-wline' }), '実測', tdee ? [h('i', { class: 'key key-west' }), '推定'] : null)
          : h('span', { class: 'chart-legend' },
            h('i', { class: 'key key-over' }), '超過',
            h('i', { class: 'key key-goal' }), '目標')),
      readout, chartBox),
    h('section', { class: 'card meal-card' },
      h('h2', {}, '食事別の平均', h('small', { class: 'unit' }, 'kcal/日')),
      meals,
      extras.length ? h('div', { class: 'meal-extras' }, h('small', {}, '平均'), extras) : null));

  // Redraw whenever the chart area changes size (rotation, the balance note opening, etc.).
  view.onMount = () => {
    draw();
    if (typeof ResizeObserver === 'undefined') return;
    let last = '';
    const ro = new ResizeObserver(() => {
      if (!chartBox.isConnected) { ro.disconnect(); return; }
      const size = `${chartBox.clientWidth}x${chartBox.clientHeight}`;
      if (size !== last) { last = size; draw(); }
    });
    ro.observe(chartBox);
  };
  return view;
}
