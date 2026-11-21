const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-data-'));
process.env.DATA_FILE = path.join(DATA_DIR, 'connections.json');

const { zonedTime, clock, duration, localParts, validZone } = require('../src/time');
const { parseLat, parseLon, parsePair, validateLocation, locationOf, cleanPlace } = require('../src/location');
const { computeNight, phaseName, compass } = require('../src/sky');
const weather = require('../src/weather');
const { buildView, verdict, longestRun } = require('../src/view');
const { renderAll, esc, litPath } = require('../src/markup');
const { createStore } = require('../src/store');
const { sampleForecast, PATTERNS } = require('./fixtures/sample');

const H = 3600e3;
const VIE = 'Europe/Vienna';
const VIENNA = { lat: 48.2082, lon: 16.3738, place: 'Vienna' };
const NOV19 = Date.UTC(2026, 10, 19, 15, 0); // 16:00 in Vienna
const cloudsFrom = (pattern, from = NOV19) => async () => ({
  data: weather.parseForecast(sampleForecast(from - 30 * H, pattern)),
  fetchedAt: from,
  error: null,
});
const noClouds = async () => ({ data: null, fetchedAt: 0, error: 'network' });

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

test('zonedTime finds the instant of a local wall-clock time, across DST', () => {
  assert.equal(new Date(zonedTime(2026, 11, 19, 18, 0, VIE)).toISOString(), '2026-11-19T17:00:00.000Z');
  assert.equal(new Date(zonedTime(2026, 7, 1, 18, 0, VIE)).toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(new Date(zonedTime(2026, 11, 19, 30, 0, VIE)).toISOString(), '2026-11-20T05:00:00.000Z'); // hour overflow
  assert.equal(new Date(zonedTime(2026, 11, 19, 18, 0, 'Asia/Kolkata')).toISOString(), '2026-11-19T12:30:00.000Z');
});

test('clock, duration and time zone validation', () => {
  assert.equal(clock(Date.UTC(2026, 10, 19, 15, 12), VIE), '16:12');
  assert.equal(clock(null, VIE), '–');
  assert.equal(duration(11 * H + 17 * 60e3), '11h 17m');
  assert.equal(duration(42 * 60e3), '42m');
  assert.equal(validZone('Europe/Vienna'), true);
  assert.equal(validZone('Mars/Olympus'), false);
  assert.equal(validZone(undefined), false);
  assert.deepEqual(localParts(Date.UTC(2026, 10, 19, 23, 30), VIE), { y: 2026, m: 11, d: 20, h: 0, min: 30 });
});

// ---------------------------------------------------------------------------
// Location input
// ---------------------------------------------------------------------------

test('coordinates parse from decimals, commas and hemisphere letters', () => {
  assert.equal(parseLat('48.2082'), 48.2082);
  assert.equal(parseLat(' 48,2082 '), 48.2082);
  assert.equal(parseLat('33.87 S'), -33.87);
  assert.equal(parseLat('33.87°S'), -33.87);
  assert.equal(parseLat('N 48.2'), 48.2);
  assert.equal(parseLon('70.6W'), -70.6);
  assert.equal(parseLon('-180'), -180);
  assert.equal(parseLat('90.0001'), null);
  assert.equal(parseLat('91'), null);
  assert.equal(parseLon('181'), null);
  assert.equal(parseLat('48.2 E'), null); // wrong axis
  assert.equal(parseLat('-33 S'), null); // ambiguous
  assert.equal(parseLat(''), null);
  assert.equal(parseLat('abc'), null);
  assert.equal(parseLat('1e2'), null);
  assert.equal(parseLat('Infinity'), null);
  assert.deepEqual(parsePair('48.2082, 16.3738'), { lat: 48.2082, lon: 16.3738 });
  assert.deepEqual(parsePair('-33.87 151.21'), { lat: -33.87, lon: 151.21 });
});

test('validateLocation accepts good input, explains bad input, and cleans the place name', () => {
  assert.deepEqual(validateLocation({ lat: '48.2082', lon: '16.3738', place: '  Vienna \n Center ' }), {
    ok: true,
    location: { lat: 48.2082, lon: 16.3738, place: 'Vienna Center' },
  });
  // A pair pasted into the latitude field.
  assert.equal(validateLocation({ lat: '48.2, 16.4', lon: '' }).location.lon, 16.4);
  // A missing place name falls back to the coordinates.
  assert.equal(validateLocation({ lat: '-33.87', lon: '151.21' }).location.place, '33.87°S 151.21°E');
  assert.match(validateLocation({ lat: '100', lon: '16' }).error, /Latitude/);
  assert.match(validateLocation({ lat: '48', lon: 'east' }).error, /Longitude/);
  assert.match(validateLocation({}).error, /Latitude/);
  assert.equal(cleanPlace('x'.repeat(80)).length, 40);
});

test('without saved settings the location is Vienna', () => {
  assert.deepEqual(locationOf(null), VIENNA);
  assert.deepEqual(locationOf({ plugin_setting_id: 5 }), VIENNA);
  assert.deepEqual(locationOf({ lat: 1, lon: 2, place: 'X' }), { lat: 1, lon: 2, place: 'X' });
});

// ---------------------------------------------------------------------------
// Astronomy
// ---------------------------------------------------------------------------

test('Vienna on 19 Nov 2026: sunset, darkness, sunrise and the moon', () => {
  const n = computeNight({ ...VIENNA, now: NOV19, timeZone: VIE });
  assert.equal(clock(n.sunset, VIE), '16:12');
  assert.equal(clock(n.dusk, VIE), '18:01');
  assert.equal(clock(n.dawn, VIE), '05:18');
  assert.equal(clock(n.sunrise, VIE), '07:08');
  assert.ok(Math.abs(n.darkMs - (11 * H + 17 * 60e3)) < 2 * 60e3);
  assert.equal(n.moon.name, 'Waxing Gibbous');
  assert.ok(n.moon.fraction > 0.65 && n.moon.fraction < 0.78);
  assert.ok(n.moon.nextFull > NOV19 && n.moon.nextFull - NOV19 < 7 * 24 * H);
  assert.equal(clock(n.moon.set, VIE), '01:49');
  assert.equal(n.hours.length, 13);
  assert.deepEqual([n.hours[0].hour, n.hours[12].hour], [18, 6]);
});

test('after midnight "tonight" is still the running night', () => {
  const evening = computeNight({ ...VIENNA, now: Date.UTC(2026, 10, 18, 15), timeZone: VIE });
  const late = computeNight({ ...VIENNA, now: Date.UTC(2026, 10, 19, 1), timeZone: VIE }); // 02:00
  assert.equal(late.sunset, evening.sunset);
  assert.equal(late.anchor.d, 18);
  const morning = computeNight({ ...VIENNA, now: Date.UTC(2026, 10, 19, 8), timeZone: VIE }); // 09:00: next night
  assert.equal(morning.anchor.d, 19);
});

test('planets are listed with direction and a time window inside the dark hours', () => {
  const n = computeNight({ ...VIENNA, now: NOV19, timeZone: VIE });
  assert.ok(n.planets.length >= 2);
  for (const p of n.planets) {
    assert.ok(['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'].includes(p.name));
    assert.match(p.dir, /^(N|NE|E|SE|S|SW|W|NW)$/);
    assert.ok(p.from < p.to && p.from >= n.sunset && p.to <= n.sunrise);
    assert.ok(p.best >= p.from && p.best <= p.to);
  }
  for (let i = 1; i < n.planets.length; i++) assert.ok(n.planets[i - 1].from <= n.planets[i].from);
});

test('polar day, polar night and the southern hemisphere', () => {
  const summer = computeNight({ lat: 69.65, lon: 18.96, now: Date.UTC(2026, 5, 21, 12), timeZone: 'Europe/Oslo' });
  assert.equal(summer.polar, 'day');
  assert.equal(summer.sunset, null);
  assert.equal(summer.planets.length, 0);
  const winter = computeNight({ lat: 69.65, lon: 18.96, now: Date.UTC(2026, 11, 21, 12), timeZone: 'Europe/Oslo' });
  assert.equal(winter.polar, 'night');
  const sydney = computeNight({ lat: -33.87, lon: 151.21, now: NOV19, timeZone: 'Australia/Sydney' });
  assert.ok(sydney.sunset && sydney.dusk && sydney.dawn && sydney.sunrise);
  assert.throws(() => computeNight({ lat: 91, lon: 0 }));
  assert.throws(() => computeNight({ lat: NaN, lon: 0 }));
});

test('phase names and compass points', () => {
  assert.equal(phaseName(0), 'New Moon');
  assert.equal(phaseName(45), 'Waxing Crescent');
  assert.equal(phaseName(90), 'First Quarter');
  assert.equal(phaseName(180), 'Full Moon');
  assert.equal(phaseName(270), 'Last Quarter');
  assert.equal(phaseName(300), 'Waning Crescent');
  assert.equal(phaseName(359), 'New Moon');
  assert.deepEqual([0, 44, 90, 200, 300, 350].map(compass), ['N', 'NE', 'E', 'S', 'NW', 'N']);
});

test('the lit part of the moon: none, crescent, gibbous, full, on either side', () => {
  assert.equal(litPath(0), '');
  assert.match(litPath(1), /A46 46 0 1 1/);
  // Waxing crescent: limb through the right (sweep 1), terminator back through the right (sweep 0).
  assert.match(litPath(0.2, true), /^M50 4A46 46 0 0 1 50 96A27\.60 46 0 0 0 50 4Z$/);
  assert.match(litPath(0.8, true), /A27\.60 46 0 0 1 50 4Z$/);
  // Waning: mirrored.
  assert.match(litPath(0.2, false), /^M50 4A46 46 0 0 0 50 96A27\.60 46 0 0 1 50 4Z$/);
  assert.match(litPath(0.5, true), /A0\.00 46/);
});

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

test('parseForecast reads Open-Meteo hourly cloud cover and rejects anything else', () => {
  const f = weather.parseForecast({ hourly: { time: [7200, 3600], cloud_cover: [50, null] } });
  assert.deepEqual(f, { times: [3600e3, 7200e3], cover: [null, 50] });
  assert.deepEqual(weather.parseForecast({ hourly: { time: [0], cloud_cover: [130] } }).cover, [100]);
  assert.throws(() => weather.parseForecast(null));
  assert.throws(() => weather.parseForecast({ hourly: { time: [1, 2], cloud_cover: [1] } }));
  assert.throws(() => weather.parseForecast({ hourly: { time: [1], cloud_cover: [null] } }));
  assert.throws(() => weather.parseForecast({ error: true, reason: 'bad' }));
});

test('coverAt picks the nearest hour and gives up beyond 90 minutes', () => {
  const f = { times: [0, H, 2 * H], cover: [10, 20, 30] };
  assert.equal(weather.coverAt(f, 0.4 * H), 10);
  assert.equal(weather.coverAt(f, 1.6 * H), 30);
  assert.equal(weather.coverAt(f, 3.5 * H), 30);
  assert.equal(weather.coverAt(f, 4 * H), null);
  assert.equal(weather.coverAt(null, 0), null);
});

test('forecast requests use rounded coordinates and no personal data', () => {
  assert.equal(weather.locationKey(48.20821, 16.37379), '48.21,16.37');
  const url = weather.forecastUrl(48.20821, 16.37379);
  assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.match(url, /latitude=48\.21&longitude=16\.37/);
  assert.match(url, /hourly=cloud_cover/);
});

test('getClouds caches per location for 30 minutes and serves stale data while refreshing', async () => {
  weather.clearCache();
  const now = NOV19;
  let calls = 0;
  const ok = async () => {
    calls++;
    return { times: [now], cover: [calls] };
  };
  const a = await weather.getClouds(48.2, 16.4, { now, fetcher: ok });
  assert.deepEqual(a.data.cover, [1]);
  await weather.getClouds(48.2001, 16.4001, { now: now + 29 * 60e3, fetcher: ok }); // same rounded location
  assert.equal(calls, 1);
  const stale = await weather.getClouds(48.2, 16.4, { now: now + 31 * 60e3, fetcher: ok });
  assert.deepEqual(stale.data.cover, [1]); // answered from cache at once
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  assert.deepEqual((await weather.getClouds(48.2, 16.4, { now: now + 32 * 60e3, fetcher: ok })).data.cover, [2]);
});

test('getClouds keeps the last forecast when a refresh fails, and does not hammer a failing API', async () => {
  weather.clearCache();
  const now = NOV19;
  await weather.getClouds(1, 2, { now, fetcher: async () => ({ times: [now], cover: [5] }) });
  let failing = 0;
  const bad = async () => {
    failing++;
    throw new weather.WeatherError('http', 'HTTP 500');
  };
  await weather.getClouds(1, 2, { now: now + 31 * 60e3, fetcher: bad });
  await new Promise((r) => setImmediate(r));
  const r = await weather.getClouds(1, 2, { now: now + 32 * 60e3, fetcher: bad });
  assert.deepEqual(r.data.cover, [5]);
  assert.equal(r.error, 'http');
  assert.equal(failing, 1); // retries only after RETRY_MS
});

test('with nothing cached, a failed fetch is retried after a minute, not five', async () => {
  weather.clearCache();
  const now = NOV19;
  let calls = 0;
  const bad = async () => {
    calls++;
    throw new weather.WeatherError('network', 'timeout');
  };
  await weather.getClouds(5, 6, { now, fetcher: bad });
  await weather.getClouds(5, 6, { now: now + 30e3, fetcher: bad });
  assert.equal(calls, 1);
  const r = await weather.getClouds(5, 6, { now: now + 61e3, fetcher: async () => ({ times: [now], cover: [7] }) });
  assert.deepEqual(r.data.cover, [7]);
});

test('a slow upstream with an empty cache is cut off after waitMs', async () => {
  weather.clearCache();
  const t0 = Date.now();
  const slow = () => new Promise((r) => setTimeout(() => r({ times: [0], cover: [1] }), 400));
  const r = await weather.getClouds(3, 4, { fetcher: slow, waitMs: 50 });
  assert.ok(Date.now() - t0 < 300);
  assert.equal(r.data, null);
  assert.equal(r.error, 'slow');
  await new Promise((res) => setTimeout(res, 450));
  assert.deepEqual((await weather.getClouds(3, 4, { fetcher: slow })).data.cover, [1]);
});

// ---------------------------------------------------------------------------
// Verdict and view
// ---------------------------------------------------------------------------

function nightWith(clouds, { moonUp = () => false, fraction = 0.1, sunAlt = () => -30 } = {}) {
  const base = Date.UTC(2026, 10, 19, 17);
  const hours = clouds.map((c, i) => ({ t: base + i * H, hour: (18 + i) % 24, cloud: c, sunAlt: sunAlt(i), moonAlt: moonUp(i) ? 20 : -20 }));
  return { hours, moon: { fraction, rise: null, set: null } };
}

test('verdict: clear after, clear until, all night, overcast, no forecast, twilight', () => {
  const z = 'UTC';
  assert.equal(verdict(nightWith([90, 90, 80, 60, 10, 0, 0, 0, 5, 0, 0, 10, 0]), null, z).clouds, 'Clear after 21:00');
  assert.equal(verdict(nightWith([0, 0, 0, 10, 20, 80, 90, 100, 100, 100, 100, 100, 100]), null, z).clouds, 'Clear until 22:00');
  assert.equal(verdict(nightWith([90, 90, 0, 0, 0, 90, 90, 90, 90, 90, 90, 90, 90]), null, z).clouds, 'Clear 19:00–22:00');
  assert.equal(verdict(nightWith(Array(13).fill(0)), null, z).clouds, 'Clear all night');
  assert.equal(verdict(nightWith(Array(13).fill(0)), null, z).rating, 'great');
  const over = verdict(nightWith(Array(13).fill(100)), null, z);
  assert.deepEqual([over.clouds, over.rating, over.text], ['Overcast all night', 'poor', 'Overcast all night']);
  assert.equal(verdict(nightWith(Array(13).fill(75)), null, z).clouds, 'Cloudy all night');
  const none = verdict(nightWith(Array(13).fill(null)), null, z);
  assert.equal(none.rating, null);
  assert.equal(none.clouds, 'No cloud forecast');
  assert.equal(verdict(nightWith(Array(13).fill(0), { sunAlt: () => 2 }), null, z).text, 'Twilight all night');
});

test('verdict: a bright moon all night turns a clear night into a fair one', () => {
  const v = verdict(nightWith(Array(13).fill(0), { moonUp: () => true, fraction: 0.95 }), null, 'UTC');
  assert.equal(v.rating, 'fair');
  assert.equal(v.moon, 'Bright moon all night');
  assert.equal(v.text, 'Clear all night · Bright moon all night');
  const setting = verdict(nightWith(Array(13).fill(0), { moonUp: (i) => i < 4, fraction: 0.7 }), null, 'UTC');
  assert.match(setting.moon, /^Bright moon sets \d\d:\d\d$/);
  assert.equal(verdict(nightWith(Array(13).fill(0), { fraction: 0.02 }), null, 'UTC').moon, 'No moon');
});

test('longestRun finds the longest stretch', () => {
  assert.deepEqual(longestRun([1, 0, 1, 1, 1, 0, 1], Boolean), [2, 4]);
  assert.equal(longestRun([0, 0], Boolean), null);
});

test('buildView combines astronomy and clouds; bad time zones fall back to UTC', async () => {
  const v = await buildView(VIENNA, { now: NOV19, timeZone: VIE, getClouds: cloudsFrom(PATTERNS.clearsLate) });
  assert.equal(v.state, 'ok');
  assert.equal(v.clouds.available, true);
  assert.equal(v.verdict.clouds, 'Clear after 22:00');
  assert.ok(v.night.hours.every((h) => h.cloud !== null));
  const utc = await buildView(null, { now: NOV19, timeZone: 'Not/AZone', getClouds: noClouds });
  assert.equal(utc.timeZone, 'UTC');
  assert.equal(utc.location.place, 'Vienna');
  assert.equal(utc.clouds.available, false);
  const throwing = await buildView(VIENNA, { now: NOV19, timeZone: VIE, getClouds: async () => { throw new Error('boom'); } });
  assert.equal(throwing.state, 'ok');
  assert.equal(throwing.clouds.available, false);
});

test('an unusable stored location gives an error view', async () => {
  const v = await buildView({ lat: 95, lon: 0 }, { now: NOV19, getClouds: noClouds });
  assert.deepEqual([v.state, v.error], ['error', 'astro']);
});

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

const LAYOUT_KEYS = ['markup', 'markup_half_horizontal', 'markup_half_vertical', 'markup_quadrant'];
const VIEW_CLASS = { markup: 'view--full', markup_half_horizontal: 'view--half_horizontal', markup_half_vertical: 'view--half_vertical', markup_quadrant: 'view--quadrant' };

async function views() {
  const run = (cfg, now, tz, getClouds) => buildView(cfg, { now, timeZone: tz, getClouds });
  return [
    ['tonight', await run(VIENNA, NOV19, VIE, cloudsFrom(PATTERNS.clearsLate))],
    ['overcast', await run(VIENNA, Date.UTC(2026, 10, 25, 20), VIE, cloudsFrom(PATTERNS.overcast, Date.UTC(2026, 10, 25, 20)))],
    ['no clouds', await run(VIENNA, NOV19, VIE, noClouds)],
    ['south', await run({ lat: -33.87, lon: 151.21, place: 'Sydney' }, NOV19, 'Australia/Sydney', cloudsFrom(PATTERNS.clear))],
    ['polar day', await run({ lat: 69.65, lon: 18.96, place: 'Tromsø' }, Date.UTC(2026, 5, 21, 12), 'Europe/Oslo', noClouds)],
    ['polar night', await run({ lat: 78.22, lon: 15.65, place: 'Svalbard' }, Date.UTC(2026, 11, 21, 12), 'Arctic/Longyearbyen', cloudsFrom(PATTERNS.patchy, Date.UTC(2026, 11, 21, 12)))],
    ['new moon', await run(VIENNA, Date.UTC(2026, 11, 9, 15), VIE, cloudsFrom(PATTERNS.clear, Date.UTC(2026, 11, 9, 15)))],
    ['error', { state: 'error', error: 'astro', location: VIENNA }],
    ['null', null],
  ];
}

test('renderAll returns every layout, Liquid-safe and without hex colors', async () => {
  for (const [name, v] of await views()) {
    const out = renderAll(v, { baseUrl: 'https://x.example' });
    assert.deepEqual(Object.keys(out).sort(), [...LAYOUT_KEYS].sort(), name);
    for (const k of LAYOUT_KEYS) {
      assert.match(out[k], new RegExp(VIEW_CLASS[k]), `${name} ${k}`);
      assert.match(out[k], /class="title_bar"/, `${name} ${k}`);
      assert.match(out[k], /src="https:\/\/x\.example\/icon\.svg"/, `${name} ${k}`);
      assert.doesNotMatch(out[k], /\{\{|\{%/, `${name} ${k} contains Liquid delimiters`);
      assert.doesNotMatch(out[k], /#[0-9a-f]{3,6}\b(?![^<]*>)|(?:color|fill|stroke|background)\s*[:=]\s*"?\s*#/i, `${name} ${k} contains a hex color`);
      assert.doesNotMatch(out[k], /NaN|undefined|Invalid Date/, `${name} ${k}`);
      if (v && v.state === 'ok') assert.match(out[k], /<svg viewBox="0 0 100 100"/, `${name} ${k} has the moon`);
    }
  }
});

test('the full layout shows the moon, verdict, chart, sun and planets', async () => {
  const v = await buildView(VIENNA, { now: NOV19, timeZone: VIE, getClouds: cloudsFrom(PATTERNS.clearsLate) });
  const out = renderAll(v, { baseUrl: 'https://x.example' }).markup;
  for (const s of ['Waxing Gibbous', 'Clear after 22:00', 'Bright moon sets 01:49', 'Sunset', '16:12', '18:01–05:18', '07:08', 'Saturn', 'Clouds']) {
    assert.ok(out.includes(s), `missing ${s}`);
  }
  assert.ok(renderAll(v, { baseUrl: 'https://x.example' }).markup_quadrant.includes('Clear after 22:00'));
});

test('place and instance names are escaped, including Liquid braces', async () => {
  const v = await buildView({ ...VIENNA, place: '<script>{{ x }}</script>' }, { now: NOV19, timeZone: VIE, getClouds: noClouds });
  const out = renderAll(v, { baseUrl: 'https://x.example' });
  for (const k of LAYOUT_KEYS) {
    assert.doesNotMatch(out[k], /<script>/);
    assert.match(out[k], /&lt;script&gt;&#123;&#123; x &#125;&#125;/);
  }
  const named = renderAll(v, { baseUrl: 'https://x.example', instance: '{% raw %}' });
  assert.match(named.markup, /&#123;% raw %&#125;/);
  assert.equal(esc('{%'), '&#123;%');
  assert.equal(esc(`a&"'b`), 'a&amp;&quot;&#39;b');
});

test('error and missing data show a clear message', async () => {
  const err = renderAll({ state: 'error', error: 'astro', location: VIENNA }, { baseUrl: 'https://x.example' });
  assert.match(err.markup, /Location not usable/);
  const none = renderAll(null, { baseUrl: 'https://x.example' });
  assert.match(none.markup_quadrant, /Sky data unavailable/);
  const v = await buildView(VIENNA, { now: NOV19, timeZone: VIE, getClouds: noClouds });
  assert.match(renderAll(v, { baseUrl: 'https://x.example' }).markup, /Cloud forecast unavailable/);
});

test('SVG ids are unique across layouts rendered on the same page', async () => {
  const v = await buildView(VIENNA, { now: NOV19, timeZone: VIE, getClouds: cloudsFrom(PATTERNS.clear) });
  const a = renderAll(v, { baseUrl: 'https://x.example' });
  const b = renderAll(v, { baseUrl: 'https://x.example' });
  const ids = [...Object.values(a), ...Object.values(b)].join('').match(/ id="[^"]+"/g);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

test('store persists settings with owner-only permissions and forgets them on delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-store-'));
  const file = path.join(dir, 'connections.json');
  const a = createStore(file);
  a.update('u1', { lat: 1, lon: 2, place: 'X' });
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.equal(createStore(file).get('u1').place, 'X');
  assert.equal(a.all().length, 1);
  a.delete('u1');
  assert.equal(createStore(file).get('u1'), null);
  fs.rmSync(dir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

test('server: health, settings page, validation, saving and markup', async (t) => {
  // No network in tests: answer every forecast from a fixture.
  const realGetClouds = weather.getClouds;
  weather.getClouds = async () => ({ data: weather.parseForecast(sampleForecast(Date.now() - 30 * H, PATTERNS.clear)), fetchedAt: Date.now(), error: null });
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    server.close();
    weather.getClouds = realGetClouds;
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });

  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok', users: 0 });
  assert.equal((await fetch(`${base}/manage`)).status, 400);
  assert.equal((await fetch(`${base}/manage?uuid=${encodeURIComponent('../x')}`)).status, 400);
  const page = await (await fetch(`${base}/manage?uuid=abc-123`)).text();
  assert.match(page, /value="48.2082"/);

  const bad = await fetch(`${base}/manage/save`, form({ uuid: 'abc-123', lat: '123', lon: '16', place: '"><b>' }));
  assert.equal(bad.status, 400);
  const badHtml = await bad.text();
  assert.match(badHtml, /Latitude must be/);
  assert.match(badHtml, /value="123"/); // keeps what was typed
  assert.doesNotMatch(badHtml, /"><b>/);

  const ok = await fetch(`${base}/manage/save`, form({ uuid: 'abc-123', lat: '-33.87', lon: '151.21', place: 'Sydney' }));
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Saved: Sydney/);

  const mk = await fetch(`${base}/markup`, form({ 'trmnl[user][uuid]': 'abc-123', 'trmnl[user][time_zone_iana]': 'Australia/Sydney' }));
  const json = await mk.json();
  assert.deepEqual(Object.keys(json).sort(), [...LAYOUT_KEYS].sort());
  assert.match(json.markup, /Sydney/);

  const anon = await (await fetch(`${base}/markup`, form({}))).json();
  assert.match(anon.markup, /Vienna/);

  await fetch(`${base}/webhooks/uninstall`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: { uuid: 'abc-123' } }) });
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok', users: 0 });
});
