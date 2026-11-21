// Builds the screen's view model: tonight's sky for the user's location, cloud cover per hour and the verdict.
// No I/O beyond getClouds.

const { computeNight } = require('./sky');
const weather = require('./weather');
const { locationOf } = require('./location');
const { HOUR, clock, validZone } = require('./time');

const CLEAR = 30; // % cloud cover that still counts as clear
const CLOUDY = 70;
const BRIGHT_MOON = 0.5; // illuminated fraction that washes out faint objects

// Hours that count for stargazing: astronomical darkness, or the darkest twilight there is.
function darkHours(hours) {
  for (const limit of [-18, -12, -6]) {
    const h = hours.filter((x) => x.sunAlt < limit);
    if (h.length) return { hours: h, limit };
  }
  return { hours: [], limit: null };
}

// Longest run of consecutive hours matching pred. -> [startIndex, endIndex] or null
function longestRun(list, pred) {
  let best = null;
  let start = -1;
  list.forEach((x, i) => {
    if (pred(x)) {
      if (start < 0) start = i;
      if (!best || i - start > best[1] - best[0]) best = [start, i];
    } else start = -1;
  });
  return best;
}

// When the moon crosses the horizon between dark hours a and b: the computed rise/set time when it falls in that
// stretch, else interpolated from the sampled altitudes.
function crossing(a, b, exact) {
  if (exact && exact >= a.t - HOUR && exact <= b.t + HOUR) return exact;
  return a.t + ((b.t - a.t) * a.moonAlt) / (a.moonAlt - b.moonAlt);
}

// The moon's part in the verdict: is it up during the dark hours, and how bright. The dark hours need not be one
// stretch of moonlight: far north the moon can set after dusk and rise again before dawn.
function moonNote(dark, moon, tz) {
  const up = dark.filter((h) => h.moonAlt > 0);
  const pct = Math.round(moon.fraction * 100);
  if (moon.fraction < 0.08 || up.length === 0) return { text: moon.fraction < 0.08 ? 'No moon' : 'Moon down after dark', bright: false };
  const bright = moon.fraction >= BRIGHT_MOON;
  const label = bright ? 'Bright moon' : `Moon ${pct}%`;
  if (up.length === dark.length) return { text: `${label} all night`, bright };
  const name = bright ? 'Bright moon' : 'Moon';

  // Horizon crossings between consecutive dark hours.
  const sets = [];
  const rises = [];
  for (let i = 1; i < dark.length; i++) {
    const [a, b] = [dark[i - 1], dark[i]];
    if (a.moonAlt > 0 && b.moonAlt <= 0) sets.push(crossing(a, b, moon.set));
    if (a.moonAlt <= 0 && b.moonAlt > 0) rises.push(crossing(a, b, moon.rise));
  }
  const upFirst = dark[0].moonAlt > 0;
  const upLast = dark[dark.length - 1].moonAlt > 0;
  if (upFirst && !upLast && sets.length === 1) return { text: `${name} sets ${clock(sets[0], tz)}`, bright, moonlessFrom: sets[0] };
  if (!upFirst && upLast && rises.length === 1) return { text: `${name} rises ${clock(rises[0], tz)}`, bright, moonlessUntil: rises[0] };
  // Up, down, up again: the moonless gap is what matters.
  if (upFirst && upLast && sets.length === 1 && rises.length === 1) {
    return { text: `${name} down ${clock(sets[0], tz)}–${clock(rises[0], tz)}`, bright, moonlessFrom: sets[0], moonlessUntil: rises[0] };
  }
  // Rises and sets inside the dark hours, or anything stranger: when it is up, first to last.
  const from = upFirst ? dark[0].t : rises[0];
  const to = upLast ? dark[dark.length - 1].t + HOUR : sets[sets.length - 1];
  return { text: `${name} up ${clock(from, tz)}–${clock(to, tz)}`, bright };
}

// One-line verdict from the hourly cloud cover in the dark hours plus the moon. rating: great | good | fair | poor | null
function verdict(night, clouds, tz) {
  const { hours: dark, limit } = darkHours(night.hours);
  if (!dark.length) return { rating: 'poor', text: 'Twilight all night', clouds: null, moon: null };
  const moon = moonNote(dark, night.moon, tz);
  const known = dark.filter((h) => h.cloud !== null);
  if (known.length < Math.ceil(dark.length / 2)) {
    return { rating: null, text: `No cloud forecast · ${moon.text}`, clouds: 'No cloud forecast', moon: moon.text };
  }

  const clear = (h) => h.cloud !== null && h.cloud <= CLEAR;
  const clearN = dark.filter(clear).length;
  const avg = known.reduce((a, h) => a + h.cloud, 0) / known.length;
  let cloudText;
  if (clearN === 0) cloudText = avg >= 90 ? 'Overcast all night' : avg >= CLOUDY ? 'Cloudy all night' : 'Partly cloudy all night';
  else if (clearN === dark.length) cloudText = 'Clear all night';
  else {
    const [a, b] = longestRun(dark, clear);
    const endsClear = b === dark.length - 1;
    const startsClear = a === 0;
    if (endsClear && !startsClear) cloudText = `Clear after ${clock(dark[a].t, tz)}`;
    else if (startsClear && !endsClear) cloudText = `Clear until ${clock(dark[b].t + HOUR, tz)}`;
    else if (b - a + 1 >= 2) cloudText = `Clear ${clock(dark[a].t, tz)}–${clock(dark[b].t + HOUR, tz)}`;
    else cloudText = clearN >= dark.length / 2 ? 'Mostly clear' : 'Mostly cloudy, short gaps';
  }

  // Clear hours without a bright moon in the sky are what make a good night.
  const clearDark = dark.filter((h) => clear(h) && (h.moonAlt <= 0 || night.moon.fraction < 0.3)).length;
  const share = clearN / dark.length;
  let rating;
  if (clearN === 0) rating = 'poor';
  else if (clearDark >= 3 && share >= 0.6 && limit === -18) rating = 'great';
  else if (clearDark >= 2 || (share >= 0.6 && !moon.bright)) rating = 'good';
  else if (clearN >= 2) rating = 'fair';
  else rating = 'poor';

  const text = clearN === 0 ? cloudText : `${cloudText} · ${moon.text}`;
  return { rating, text, clouds: cloudText, moon: moon.text };
}

const RATING = { great: 'Great night', good: 'Good night', fair: 'Fair', poor: 'Poor' };

// cfg: stored settings ({ lat, lon, place }) or null for the default location
async function buildView(cfg, { now = Date.now(), timeZone, getClouds = weather.getClouds } = {}) {
  const tz = validZone(timeZone) ? timeZone : 'UTC';
  const loc = locationOf(cfg);
  let night;
  try {
    night = computeNight({ lat: loc.lat, lon: loc.lon, now, timeZone: tz });
  } catch (err) {
    console.error('Astronomy failed:', err.message);
    return { state: 'error', error: 'astro', location: loc, timeZone: tz };
  }

  let wx = { data: null, fetchedAt: 0, error: 'network' };
  try {
    wx = await getClouds(loc.lat, loc.lon, { now });
  } catch (err) {
    console.error('Cloud lookup failed:', err.message);
  }
  for (const h of night.hours) h.cloud = weather.coverAt(wx.data, h.t);
  const hasClouds = night.hours.some((h) => h.cloud !== null);

  const v = verdict(night, wx.data, tz);
  return {
    state: 'ok',
    now,
    timeZone: tz,
    location: loc,
    night,
    verdict: { ...v, label: v.rating ? RATING[v.rating] : 'Tonight' },
    clouds: { available: hasClouds, error: hasClouds ? null : wx.error || 'network', fetchedAt: wx.fetchedAt },
  };
}

module.exports = { buildView, verdict, darkHours, longestRun, moonNote, CLEAR };
