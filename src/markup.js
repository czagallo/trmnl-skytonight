// Pure markup builders for every TRMNL layout.
//
// Same rules as the other plugins in this repo:
// - The platform picks the screen and adds screen--sm/md/lg, screen--portrait and bit-depth classes; we never branch
//   on device in JS. Text uses framework classes with lg:/portrait: prefixes, graphics are SVG with a viewBox.
// - Black and white only (currentColor / white in SVG), no hex colors: they dither badly on 1-bit panels.
// - TRMNL parses every markup string as Liquid, so nothing may contain "{{" or "{%". esc() also escapes braces,
//   because the place name comes from the user.

const { HOUR, clock, duration } = require('./time');

const DAY = 24 * HOUR;

function esc(s) {
  return String(s).replace(
    /[&<>"'{}]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;', '}': '&#125;' })[c],
  );
}

// SVG ids must be unique per page: TRMNL shows several layouts (mashups) side by side.
let uidCounter = 0;
const uid = () => `st${(++uidCounter).toString(36)}`;

// ---------------------------------------------------------------------------
// Moon
// ---------------------------------------------------------------------------

// The lit part of a disc of radius r at (cx, cy): lit on the right when waxing (as seen from the northern
// hemisphere), on the left when waning. The terminator is a half ellipse with horizontal radius r·|1−2k|; it bulges
// toward the lit limb for a crescent.
function litPath(k, right = true, cx = 50, cy = 50, r = 46) {
  if (k <= 0.005) return '';
  if (k >= 0.995) return `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx} ${cy + r}A${r} ${r} 0 1 1 ${cx} ${cy - r}Z`;
  const rx = (r * Math.abs(1 - 2 * k)).toFixed(2);
  const crescent = k < 0.5;
  // Limb: top to bottom through the lit side. Terminator: bottom back to top, through the lit side for a crescent.
  const limbSweep = right ? 1 : 0;
  const termSweep = right === crescent ? 0 : 1;
  return `M${cx} ${cy - r}A${r} ${r} 0 0 ${limbSweep} ${cx} ${cy + r}A${rx} ${r} 0 0 ${termSweep} ${cx} ${cy - r}Z`;
}

// Rough near-side maria (lit-right frame) as overlapping ellipses [cx, cy, rx, ry, rotation], stippled so they read
// as grey on a 1-bit panel. Same pattern everywhere, so overlaps merge into one organic shape.
const MARIA = [
  [36, 31, 13, 10, -12], // Imbrium
  [47, 17, 15, 3.2, 4], // Frigoris
  [21, 52, 9, 18, 8], // Procellarum
  [28, 40, 8, 8, 0],
  [57, 31, 7.5, 7, 0], // Serenitatis
  [64, 46, 9, 6.5, 22], // Tranquillitatis
  [57, 51, 5, 4, 0],
  [81, 36, 5, 4, -10], // Crisium
  [76, 57, 4.5, 7, -15], // Fecunditatis
  [67, 63, 4, 4, 0], // Nectaris
  [42, 67, 8, 5.5, 10], // Nubium
  [28, 68, 4.5, 4, 0], // Humorum
];

// Ellipses as plain polygons: a transform would also rotate the stipple pattern and break the merge.
function ellipsePath([cx, cy, rx, ry, deg]) {
  const a = (deg * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * 2 * Math.PI;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    pts.push(`${(cx + x * Math.cos(a) - y * Math.sin(a)).toFixed(1)} ${(cy + x * Math.sin(a) + y * Math.cos(a)).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}
const MARIA_PATH = MARIA.map(ellipsePath).join('');

function moonSvg(moon, { south = false } = {}) {
  const id = uid();
  const k = moon.fraction;
  // Southern hemisphere: everything appears rotated by 180°.
  const rot = south ? ' transform="rotate(180 50 50)"' : '';
  const lit = litPath(k, moon.waxing);
  // Thin crescents only show clipped slivers of maria, which read as noise: leave them out.
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:100%" xmlns="http://www.w3.org/2000/svg">
<defs>
<pattern id="${id}d" width="2.6" height="2.6" patternUnits="userSpaceOnUse"><rect width="2.6" height="2.6" fill="currentColor"/><circle cx="1.3" cy="1.3" r="0.55" fill="white"/></pattern>
<pattern id="${id}m" width="2.2" height="2.2" patternUnits="userSpaceOnUse"><rect width="2.2" height="2.2" fill="white"/><rect width="1.1" height="1.1" fill="currentColor"/></pattern>
${lit ? `<clipPath id="${id}c"><path d="${lit}"/></clipPath>` : ''}
</defs>
<g${rot}>
<circle cx="50" cy="50" r="46" fill="url(#${id}d)"/>
${lit ? `<path d="${lit}" fill="white"/>
${k < 0.25 ? '' : `<path clip-path="url(#${id}c)" fill="url(#${id}m)" d="${MARIA_PATH}"/>`}
<path d="${lit}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>` : ''}
</g>
<circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2"/>
</svg>`;
}

function daysUntil(t, now) {
  const d = Math.round((t - now) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
}

// "Full moon in 5 days", "New moon in 19 days" — the nearer one first.
function nextPhases(moon, now) {
  const list = [
    ['Full', moon.nextFull],
    ['New', moon.nextNew],
  ]
    .filter(([, t]) => t)
    .sort((a, b) => a[1] - b[1]);
  return list.map(([n, t]) => `${n} ${daysUntil(t, now)}`);
}

function moonRiseSet(v, ctx) {
  const m = v.night.moon;
  const items = [];
  if (m.rise) items.push(['Rise', m.rise]);
  if (m.set) items.push(['Set', m.set]);
  items.sort((a, b) => a[1] - b[1]);
  if (!items.length) return [['Moon', v.night.hours[0].moonAlt > 0 ? 'up all day' : 'down all day']];
  return items.map(([n, t]) => [n, clock(t, ctx.tz)]);
}

// ---------------------------------------------------------------------------
// Cloud chart with darkness and moon bands
// ---------------------------------------------------------------------------

// x position of an instant on the chart (slot i is centred at 10·i + 5; 13 slots → 130 units).
function xAt(hours, t) {
  const x = 5 + (10 * (t - hours[0].t)) / HOUR;
  return Math.max(0, Math.min(130, x));
}

function cloudBars(v) {
  const { hours } = v.night;
  const bars = hours
    .map((h, i) => {
      const x = i * 10 + 1.5;
      if (h.cloud === null) {
        return `<rect x="${x}" y="1" width="7" height="98" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>`;
      }
      const hgt = Math.max(h.cloud, 0);
      return `<rect x="${x}" y="1" width="7" height="98" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${
        hgt > 0 ? `<rect x="${x}" y="${(99 - hgt * 0.98).toFixed(1)}" width="7" height="${(hgt * 0.98).toFixed(1)}" fill="currentColor"/>` : ''
      }`;
    })
    .join('');
  return `<svg viewBox="0 0 130 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

function band(rects, id) {
  return `<svg viewBox="0 0 130 10" preserveAspectRatio="none" style="display:block;width:100%;height:100%" xmlns="http://www.w3.org/2000/svg">
<defs><pattern id="${id}" width="3" height="10" patternUnits="userSpaceOnUse" patternTransform="skewX(-30)"><rect width="1.2" height="10" fill="currentColor"/></pattern></defs>
<line x1="0" y1="5" x2="130" y2="5" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke"/>
${rects.map(([a, b, kind]) => (b - a > 0.2 ? `<rect x="${a.toFixed(2)}" y="1" width="${(b - a).toFixed(2)}" height="8" fill="${kind === 'solid' ? 'currentColor' : `url(#${id})`}"/>` : '')).join('')}
</svg>`;
}

// Twilight hatched, astronomical darkness solid.
function darkBand(v) {
  const n = v.night;
  const hrs = n.hours;
  const end = hrs[hrs.length - 1].t + HOUR / 2;
  const start = hrs[0].t - HOUR / 2;
  const clip = (t, fallback) => (t == null ? fallback : Math.max(start, Math.min(end, t)));
  const rects = [];
  const set = clip(n.sunset, start);
  const rise = clip(n.sunrise, end);
  if (n.polar === 'day') return band([], uid());
  if (n.dusk && n.dawn) {
    rects.push([xAt(hrs, set), xAt(hrs, clip(n.dusk)), 'hatch']);
    rects.push([xAt(hrs, clip(n.dusk)), xAt(hrs, clip(n.dawn)), 'solid']);
    rects.push([xAt(hrs, clip(n.dawn)), xAt(hrs, rise), 'hatch']);
  } else if (n.polar === 'night') {
    // Use the sampled sun altitude: solid where truly dark.
    hrs.forEach((h, i) => rects.push([Math.max(0, i * 10), Math.min(130, i * 10 + 10), h.sunAlt < -18 ? 'solid' : 'hatch']));
  } else {
    rects.push([xAt(hrs, set), xAt(hrs, rise), 'hatch']);
  }
  return band(rects, uid());
}

// Moon above the horizon: solid when bright (≥ 50 % lit), hatched when faint. Edges interpolated between slots.
function moonBand(v) {
  const hrs = v.night.hours;
  const kind = v.night.moon.fraction >= 0.5 ? 'solid' : 'hatch';
  const rects = [];
  let from = hrs[0].moonAlt > 0 ? 0 : null;
  for (let i = 1; i < hrs.length; i++) {
    const a = hrs[i - 1].moonAlt;
    const b = hrs[i].moonAlt;
    if ((a > 0) !== (b > 0)) {
      const x = (i - 1) * 10 + 5 + (10 * a) / (a - b);
      if (b > 0) from = x;
      else if (from !== null) {
        rects.push([from, x, kind]);
        from = null;
      }
    }
  }
  if (from !== null) rects.push([from, 130, kind]);
  return band(rects, uid());
}

function hourLabels(v, small) {
  const cls = small ? 'label label--small lg:label--base' : 'label label--small lg:label--large';
  return `<div style="display:grid;grid-template-columns:repeat(13,1fr)">${v.night.hours
    .map((h, i) => `<span class="${cls} value--tnums" style="text-align:center;white-space:nowrap">${i % 2 === 0 ? String(h.hour).padStart(2, '0') : ''}</span>`)
    .join('')}</div>`;
}

// size: 'large' (full) | 'small' (halves). bands: show the Dark/Moon strips.
function cloudChart(v, { small = false, bands = true } = {}) {
  const lbl = small ? 'label label--small lg:label--base' : 'label label--small lg:label--large';
  const bandH = small ? '0.55em' : '0.7em';
  const unavailable = !v.clouds.available
    ? `<div class="st-center" style="position:absolute;inset:0"><span class="label lg:label--large" style="background:white;padding:2px 6px">Cloud forecast unavailable</span></div>`
    : '';
  return `<div class="st-chart">
<span class="${lbl}">Clouds</span>
<div style="position:relative;min-height:0">${cloudBars(v)}${unavailable}</div>
${bands ? `<span class="${lbl}">Dark</span><div style="height:${bandH};align-self:center">${darkBand(v)}</div>
<span class="${lbl}">Moon</span><div style="height:${bandH};align-self:center">${moonBand(v)}</div>` : ''}
<span></span>${hourLabels(v, small)}
</div>`;
}

// ---------------------------------------------------------------------------
// Text pieces
// ---------------------------------------------------------------------------

function verdictBlock(v, { size = 'large' } = {}) {
  const pill = size === 'large' ? 'label lg:label--large' : 'label label--small lg:label--base';
  const head = size === 'large' ? 'title lg:title--large' : 'title title--small lg:title--base';
  const sub = size === 'large' ? 'label lg:label--large' : 'label label--small lg:label--base';
  const vd = v.verdict;
  const main = vd.clouds || vd.text;
  const second = vd.clouds ? vd.moon : null;
  return `<div class="st-verdict">
<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-start;column-gap:8px;row-gap:2px;min-width:0">
<span class="${pill}" style="flex:none;background:black;color:white;padding:1px 8px;border-radius:4px;font-weight:700;white-space:nowrap">${esc(vd.label)}</span>
<span class="${head}" style="min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(main)}</span>
</div>
${second ? `<span class="${sub}" style="display:block;margin-top:2px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(second)}</span>` : ''}
</div>`;
}

function moonFacts(v, ctx, { size = 'large' } = {}) {
  const m = v.night.moon;
  const name = size === 'large' ? 'title lg:title--large' : 'title title--small lg:title--base';
  const big = size === 'large' ? 'value value--small lg:value--large' : 'value value--xsmall lg:value--small';
  const lbl = size === 'large' ? 'label lg:label--large' : 'label label--small lg:label--base';
  const rs = moonRiseSet(v, ctx)
    .map(([n, t]) => `<span style="white-space:nowrap">${esc(n)} <b>${esc(t)}</b></span>`)
    .join(' ');
  return `<div class="st-facts">
<span class="${name}" style="white-space:nowrap">${esc(m.name)}</span>
<span class="${big} value--tnums" style="display:block;white-space:nowrap">${Math.round(m.fraction * 100)}%<span class="${lbl}" style="display:inline">&nbsp;lit</span></span>
<span class="${lbl}" style="display:flex;flex-wrap:wrap;column-gap:10px">${rs}</span>
<span class="${lbl}" style="display:flex;flex-wrap:wrap;column-gap:10px">${nextPhases(m, ctx.now)
    .map((t) => `<span style="white-space:nowrap">${esc(t)}</span>`)
    .join('')}</span>
</div>`;
}

function sunRows(v, ctx) {
  const n = v.night;
  if (n.polar === 'day') return [['Sunset', 'none'], ['Midnight sun', 'all night']];
  if (n.polar === 'night') return [['Sunrise', 'none'], ['Polar night', 'all day']];
  const rows = [['Sunset', clock(n.sunset, ctx.tz)]];
  if (n.dusk && n.dawn) {
    rows.push(['Dark', `${clock(n.dusk, ctx.tz)}–${clock(n.dawn, ctx.tz)}`]);
    rows.push(['Dark for', duration(n.darkMs)]);
  } else rows.push(['Dark', 'no full darkness']);
  rows.push(['Sunrise', clock(n.sunrise, ctx.tz)]);
  return rows;
}

function sunStats(v, ctx, { small = false } = {}) {
  const lbl = small ? 'label label--small lg:label--base' : 'label lg:label--large';
  const val = small ? 'label label--small lg:label--base value--tnums' : 'label lg:label--large value--tnums';
  return `<div class="st-sun">${sunRows(v, ctx)
    .map(([k, t]) => `<span class="${lbl}">${esc(k)}</span><span class="${val}" style="font-weight:700;white-space:nowrap;text-align:right">${esc(t)}</span>`)
    .join('')}</div>`;
}

function planetList(v, ctx, { max = 5, small = false, best = true } = {}) {
  const lbl = small ? 'label label--small lg:label--base' : 'label lg:label--large';
  const list = v.night.planets.slice(0, max);
  if (!list.length) return `<span class="${lbl}">No bright planets after dark</span>`;
  const cell = (s, extra = '') => `<span class="${lbl} value--tnums" style="white-space:nowrap;${extra}">${s}</span>`;
  return `<div class="st-planets${best ? '' : ' st-planets--nobest'}">${list
    .map(
      (p) =>
        cell(`<b>${esc(p.name)}</b>`) +
        cell(esc(p.dir)) +
        cell(`${esc(clock(p.from, ctx.tz))}–${esc(clock(p.to, ctx.tz))}`) +
        (best ? cell(`best ${esc(clock(p.best, ctx.tz))}`, 'text-align:right') : ''),
    )
    .join('')}</div>`;
}

function heading(text, small) {
  return `<span class="${small ? 'label label--small lg:label--base' : 'label lg:label--large'}" style="display:block;border-bottom:2px solid currentColor;font-weight:700;margin-bottom:2px">${esc(text)}</span>`;
}

function titleBar(v, ctx) {
  const place = v && v.location ? v.location.place : '';
  const instance = ctx.instance || place || 'Tonight';
  return `<div class="title_bar">
<img class="image" src="${esc(ctx.baseUrl)}/icon.svg" alt="">
<span class="title">Sky Tonight</span>
<span class="instance">${esc(instance)}</span>
</div>`;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

const BASE_CSS = `.st-grid{display:grid;width:100%;height:100%;min-width:0;min-height:0}
.st-grid>*{min-width:0;min-height:0}
.st-moon{position:relative}
.st-moon>svg{position:absolute;inset:0}
.st-facts{display:flex;flex-direction:column;gap:2px;justify-content:center;min-width:0}
.st-chart{display:grid;grid-template-columns:auto 1fr;grid-template-rows:minmax(0,1fr) auto auto auto;column-gap:6px;row-gap:3px;height:100%;min-height:0}
.st-chart>span{align-self:center}
.st-chart>span:first-child{align-self:start}
.st-sun{display:grid;grid-template-columns:1fr auto;column-gap:10px;row-gap:1px;align-content:start}
.st-planets{display:grid;grid-template-columns:repeat(4,auto);justify-content:space-between;column-gap:10px;row-gap:1px;align-content:start}
.st-planets--nobest{grid-template-columns:repeat(3,auto);justify-content:start;column-gap:1em}
.st-center{display:flex;align-items:center;justify-content:center}`;

function style(css) {
  return `<style>${BASE_CSS}\n${css}</style>`;
}

function wrap(view, css, body, v, ctx) {
  return `<div class="view view--${view}">${style(css)}
<div class="layout" style="align-items:stretch;justify-content:stretch">
${body}
</div>
${titleBar(v, ctx)}
</div>`;
}

const FULL_CSS = `.st-full{grid-template-columns:30% 0.75fr 1.35fr;grid-template-rows:auto minmax(0,1fr) auto;column-gap:22px;row-gap:12px;
grid-template-areas:"moon verdict verdict" "moon chart chart" "facts sun planets"}
.screen--lg .st-full{column-gap:40px;row-gap:24px}
.screen--portrait .st-full{grid-template-columns:44% 1fr;grid-template-rows:27% auto minmax(0,1fr) auto auto;
grid-template-areas:"moon facts" "verdict verdict" "chart chart" "sun sun" "planets planets";row-gap:14px}
.screen--portrait .st-full .st-sun{grid-template-columns:auto 1fr auto 1fr;column-gap:12px}
.st-full .st-moon{margin:0 6px}
.st-full .st-facts-cell{align-self:start}
.screen--portrait .st-full .st-facts-cell{align-self:center}`;

function full(v, ctx) {
  const south = v.location.lat < 0;
  const body = `<div class="st-grid st-full">
<div class="st-moon" style="grid-area:moon">${moonSvg(v.night.moon, { south })}</div>
<div class="st-facts-cell" style="grid-area:facts">${moonFacts(v, ctx)}</div>
<div style="grid-area:verdict">${verdictBlock(v)}</div>
<div style="grid-area:chart">${cloudChart(v)}</div>
<div style="grid-area:sun">${heading('Sun')}${sunStats(v, ctx)}</div>
<div style="grid-area:planets">${heading('Planets after dark')}${planetList(v, ctx, { max: 5 })}</div>
</div>`;
  return wrap('full', FULL_CSS, body, v, ctx);
}

const HH_CSS = `.st-hh{grid-template-columns:22% 1fr 30%;grid-template-rows:auto minmax(0,1fr);column-gap:18px;row-gap:6px;
grid-template-areas:"moon verdict side" "moon chart side"}
.screen--lg .st-hh{column-gap:32px;row-gap:12px}
.st-hh .st-facts-slot{display:none}
.st-hh .st-side{display:flex;flex-direction:column;gap:6px;overflow:hidden}
.screen--portrait .st-hh{grid-template-columns:34% 1fr;grid-template-rows:42% auto minmax(0,1fr);
grid-template-areas:"moon facts" "verdict verdict" "chart chart"}
.screen--portrait .st-hh .st-facts-slot{display:flex}
.screen--portrait .st-hh .st-side{display:none}`;

function halfHorizontal(v, ctx) {
  const m = v.night.moon;
  const lbl = 'label label--small lg:label--base';
  const body = `<div class="st-grid st-hh">
<div class="st-moon" style="grid-area:moon">${moonSvg(m, { south: v.location.lat < 0 })}</div>
<div class="st-facts-slot" style="grid-area:facts;align-items:center">${moonFacts(v, ctx, { size: 'small' })}</div>
<div style="grid-area:verdict">${verdictBlock(v, { size: 'small' })}</div>
<div style="grid-area:chart">${cloudChart(v, { small: true })}</div>
<div class="st-side" style="grid-area:side">
<div>
<span class="title title--small lg:title--base" style="display:block;white-space:nowrap">${esc(m.name)} · ${Math.round(m.fraction * 100)}%</span>
<span class="${lbl}" style="display:block">${moonRiseSet(v, ctx).map(([n, t]) => `${esc(n)} <b>${esc(t)}</b>`).join(' · ')}</span>
</div>
<div>${heading('Planets', true)}${planetList(v, ctx, { max: 5, small: true, best: false })}</div>
</div>
</div>`;
  return wrap('half_horizontal', HH_CSS, body, v, ctx);
}

const HV_CSS = `.st-hv{grid-template-columns:40% 1fr;grid-template-rows:27% auto minmax(0,1fr) auto;column-gap:14px;row-gap:8px;
grid-template-areas:"moon facts" "verdict verdict" "chart chart" "planets planets"}
.screen--lg .st-hv{row-gap:16px;column-gap:24px}
.screen--portrait .st-hv{grid-template-columns:1fr;grid-template-rows:22% auto auto minmax(0,1fr) auto auto;
grid-template-areas:"moon" "facts" "verdict" "chart" "sun" "planets";row-gap:10px}
.st-hv .st-sun-slot{display:none}
.screen--portrait .st-hv .st-sun-slot{display:block}
.screen--portrait .st-hv .st-facts{width:100%;align-items:center;text-align:center}
.screen--portrait .st-hv .st-facts>span{justify-content:center}`;

function halfVertical(v, ctx) {
  const body = `<div class="st-grid st-hv">
<div class="st-moon" style="grid-area:moon">${moonSvg(v.night.moon, { south: v.location.lat < 0 })}</div>
<div style="grid-area:facts;display:flex">${moonFacts(v, ctx, { size: 'small' })}</div>
<div style="grid-area:verdict">${verdictBlock(v, { size: 'small' })}</div>
<div style="grid-area:chart">${cloudChart(v, { small: true })}</div>
<div class="st-sun-slot" style="grid-area:sun">${sunStats(v, ctx, { small: true })}</div>
<div style="grid-area:planets">${heading('Planets', true)}${planetList(v, ctx, { max: 4, small: true, best: false })}</div>
</div>`;
  return wrap('half_vertical', HV_CSS, body, v, ctx);
}

const Q_CSS = `.st-q{grid-template-columns:38% 1fr;grid-template-rows:minmax(0,1fr) auto;column-gap:14px;row-gap:6px;
grid-template-areas:"moon facts" "verdict verdict"}
.screen--lg .st-q{column-gap:24px;row-gap:12px}
.screen--portrait .st-q{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto auto;grid-template-areas:"moon" "facts" "verdict";row-gap:8px}
.screen--portrait .st-q .st-facts{align-items:center;text-align:center}`;

function quadrant(v, ctx) {
  const m = v.night.moon;
  const lbl = 'label label--small lg:label--base';
  const body = `<div class="st-grid st-q">
<div class="st-moon" style="grid-area:moon">${moonSvg(m, { south: v.location.lat < 0 })}</div>
<div class="st-facts" style="grid-area:facts">
<span class="title title--small lg:title--base">${esc(m.name)}</span>
<span class="value value--xsmall lg:value--small value--tnums" style="display:block">${Math.round(m.fraction * 100)}%<span class="${lbl}" style="display:inline">&nbsp;lit</span></span>
<span class="${lbl}" style="display:block">${moonRiseSet(v, ctx).map(([n, t]) => `${esc(n)} <b>${esc(t)}</b>`).join(' · ')}</span>
</div>
<div style="grid-area:verdict">${verdictBlock(v, { size: 'small' })}</div>
</div>`;
  return wrap('quadrant', Q_CSS, body, v, ctx);
}

const MESSAGES = {
  astro: ['Location not usable', 'Check latitude and longitude in the plugin settings.'],
  error: ['Sky data unavailable', 'It will retry on the next refresh.'],
};

function message(view, v, ctx) {
  const [title, text] = MESSAGES[v && v.error] || MESSAGES.error;
  return `<div class="view view--${view}">
<div class="layout layout--col layout--center" style="gap:6px">
  <span class="title text--center">${esc(title)}</span>
  <span class="description text--center">${esc(text)}</span>
</div>
${titleBar(v, ctx)}
</div>`;
}

// ctx: { baseUrl, instance, now }
function renderAll(v, ctx) {
  const c = { now: (v && v.now) || Date.now(), tz: (v && v.timeZone) || 'UTC', ...ctx };
  if (!v || v.state !== 'ok') {
    const vv = v || { state: 'error', error: 'error' };
    return {
      markup: message('full', vv, c),
      markup_half_horizontal: message('half_horizontal', vv, c),
      markup_half_vertical: message('half_vertical', vv, c),
      markup_quadrant: message('quadrant', vv, c),
    };
  }
  return {
    markup: full(v, c),
    markup_half_horizontal: halfHorizontal(v, c),
    markup_half_vertical: halfVertical(v, c),
    markup_quadrant: quadrant(v, c),
  };
}

module.exports = { renderAll, esc, litPath, moonSvg, nextPhases };
