#!/usr/bin/env node
// Renders every layout on every screen class with TRMNL's real framework CSS and screenshots it with headless Chrome.
//   node scripts/preview.js [outDir] [--scenario=tonight|crescent|overcast|nodata|south|arctic] [--live]
// Sample clouds by default; --live fetches Open-Meteo for Vienna (or SKY_LAT/SKY_LON from .env) right now.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const weather = require('../src/weather');
const { buildView } = require('../src/view');
const { renderAll } = require('../src/markup');
const { sampleForecast, PATTERNS } = require('../test/fixtures/sample');

const args = process.argv.slice(2);
const live = args.includes('--live');
const scenario = (args.find((a) => a.startsWith('--scenario=')) || '--scenario=tonight').split('=')[1];
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'preview'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FRAMEWORK = 'https://trmnl.com';

const SCREENS = [
  { name: 'og-1bit', cls: 'screen--og screen--md screen--1bit', w: 800, h: 480 },
  { name: 'og-2bit', cls: 'screen--ogv2 screen--md screen--2bit', w: 800, h: 480 },
  { name: 'trmnl-x-lg', cls: 'screen--v2 screen--lg screen--4bit', w: 1872, h: 1404 },
];

const VIENNA = { lat: 48.2082, lon: 16.3738, place: 'Vienna' };
const SCENARIOS = {
  tonight: { now: Date.UTC(2026, 10, 19, 15, 0), cfg: VIENNA, tz: 'Europe/Vienna', clouds: PATTERNS.clearsLate },
  crescent: { now: Date.UTC(2026, 11, 13, 15, 0), cfg: VIENNA, tz: 'Europe/Vienna', clouds: PATTERNS.clear },
  overcast: { now: Date.UTC(2026, 10, 25, 20, 0), cfg: VIENNA, tz: 'Europe/Vienna', clouds: PATTERNS.overcast },
  patchy: { now: Date.UTC(2026, 11, 2, 1, 0), cfg: { lat: 52.52, lon: 13.405, place: 'Berlin' }, tz: 'Europe/Berlin', clouds: PATTERNS.patchy },
  nodata: { now: Date.UTC(2026, 10, 19, 15, 0), cfg: VIENNA, tz: 'Europe/Vienna', clouds: null },
  south: { now: Date.UTC(2026, 10, 19, 6, 0), cfg: { lat: -33.8688, lon: 151.2093, place: 'Sydney' }, tz: 'Australia/Sydney', clouds: PATTERNS.clear },
  arctic: { now: Date.UTC(2027, 5, 21, 12, 0), cfg: { lat: 69.6496, lon: 18.956, place: 'Tromsø' }, tz: 'Europe/Oslo', clouds: PATTERNS.clear },
};

function page(screen, portrait, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${FRAMEWORK}/css/latest/plugins.css">
<script src="${FRAMEWORK}/js/latest/plugins.js"></script>
<style>html,body{margin:0;padding:0;background:#fff}</style></head>
<body class="trmnl"><div class="screen ${screen.cls}${portrait ? ' screen--portrait' : ''}">${body}</div></body></html>`;
}

async function main() {
  let v;
  if (live) {
    const cfg = process.env.SKY_LAT ? { lat: Number(process.env.SKY_LAT), lon: Number(process.env.SKY_LON), place: process.env.SKY_PLACE || '' } : VIENNA;
    v = await buildView(cfg, { timeZone: process.env.SKY_TZ || 'Europe/Vienna', getClouds: (la, lo) => weather.getClouds(la, lo, { waitMs: 8000 }) });
  } else {
    const s = SCENARIOS[scenario];
    if (!s) throw new Error(`unknown scenario ${scenario}`);
    const getClouds = async () =>
      s.clouds
        ? { data: weather.parseForecast(sampleForecast(s.now - 30 * 3600e3, s.clouds)), fetchedAt: s.now, error: null }
        : { data: null, fetchedAt: 0, error: 'network' };
    v = await buildView(s.cfg, { now: s.now, timeZone: s.tz, getClouds });
  }
  const m = renderAll(v, { baseUrl: 'http://localhost:3014' });
  const icon = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, '..', 'icon.svg')).toString('base64');
  const fix = (s) => s.replaceAll('http://localhost:3014/icon.svg', icon);
  const LAYOUTS = {
    full: fix(m.markup),
    half_horizontal: `<div class="mashup mashup--1Tx1B">${fix(m.markup_half_horizontal)}${fix(m.markup_half_horizontal)}</div>`,
    half_vertical: `<div class="mashup mashup--1Lx1R">${fix(m.markup_half_vertical)}${fix(m.markup_half_vertical)}</div>`,
    quadrant: `<div class="mashup mashup--2x2">${fix(m.markup_quadrant).repeat(4)}</div>`,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
  let n = 0;
  for (const s of SCREENS) {
    for (const portrait of [false, true]) {
      for (const [layout, body] of Object.entries(LAYOUTS)) {
        const name = `${live ? 'live' : scenario}-${s.name}${portrait ? '-portrait' : ''}-${layout}`;
        if (only && !name.includes(only)) continue;
        const html = path.join(outDir, `${name}.html`);
        fs.writeFileSync(html, page(s, portrait, body));
        const [w, h] = portrait ? [s.h, s.w] : [s.w, s.h];
        execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
          `--window-size=${w},${h}`, '--virtual-time-budget=6000', `--screenshot=${path.join(outDir, `${name}.png`)}`, `file://${html}`],
        { stdio: 'ignore' });
        n++;
      }
    }
  }
  console.log(`${n} screenshots in ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
