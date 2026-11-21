// Hourly cloud cover from Open-Meteo (free, no API key).
//
// Stale-while-revalidate per rounded location (0.01° ≈ 1 km): a screen request answers from cache at once and starts
// a refresh when the entry is older than 30 minutes. It only waits for the network when nothing usable is cached (no
// data, or data older than MAX_STALE_MS), and then never longer than WAIT_MS, so a slow upstream can not break the
// 10 s TRMNL gives /markup.
//
// Upstream budget. Open-Meteo's free API allows fewer than 10,000 calls per day, 5,000 per hour and 600 per minute
// (open-meteo.com/en/terms; one request here is 1 variable over 4 days = 1.0 call). Every request this module makes
// is counted against DAILY_CALLS / HOURLY_CALLS, by default half of those limits. When the budget is used up, no
// request is made: screens keep the forecast they have, or show "Cloud forecast unavailable". Background warming
// stops earlier (WARM_SHARE of the budget), so screen requests always keep some headroom.

const API = 'https://api.open-meteo.com/v1/forecast';
const CACHE_MS = 30 * 60 * 1000;
const MAX_STALE_MS = 3 * 60 * 60 * 1000; // older than this, a screen waits (briefly) for fresh data
const RETRY_MS = 5 * 60 * 1000; // after a failed attempt while older data is still shown
const RETRY_EMPTY_MS = 60 * 1000; // after a failed attempt with nothing to show
const TIMEOUT_MS = 6000;
const WAIT_MS = 4000;
const MAX_ENTRIES = 1000;
const USER_AGENT = 'trmnl-skytonight/1.0 (TRMNL e-ink plugin)';

const posInt = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
const DAILY_CALLS = posInt(process.env.OPEN_METEO_DAILY_CALLS, 5000);
const HOURLY_CALLS = posInt(process.env.OPEN_METEO_HOURLY_CALLS, 1000);
const WARM_SHARE = 0.8; // warming may use this share of each budget; the rest is kept for screen requests
const ACTIVE_MS = 2 * 60 * 60 * 1000; // a location is kept warm while a screen asked for it this recently
const WARM_CONCURRENCY = 2;
const WARM_GAP_MS = 1000; // between warm requests: at most ~120 per minute, far below the 600/min limit

// Upstream calls per UTC day and per UTC hour, enforced before every request.
function createBudget({ daily = DAILY_CALLS, hourly = HOURLY_CALLS } = {}) {
  let day = null;
  let hour = null;
  let usedDay = 0;
  let usedHour = 0;
  const roll = (now) => {
    const d = Math.floor(now / 86400e3);
    const h = Math.floor(now / 3600e3);
    if (d !== day) [day, usedDay] = [d, 0];
    if (h !== hour) [hour, usedHour] = [h, 0];
  };
  return {
    daily,
    hourly,
    // share < 1 reserves the rest for callers with a full share.
    take(now, share = 1) {
      roll(now);
      if (usedDay + 1 > Math.floor(daily * share) || usedHour + 1 > Math.floor(hourly * share)) return false;
      usedDay++;
      usedHour++;
      return true;
    },
    used(now) {
      roll(now);
      return { day: usedDay, hour: usedHour };
    },
  };
}

let budget = createBudget();

class WeatherError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // 'network' | 'http' | 'parse'
  }
}

function locationKey(lat, lon) {
  return `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
}

function forecastUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: Number(lat).toFixed(2),
    longitude: Number(lon).toFixed(2),
    hourly: 'cloud_cover',
    timeformat: 'unixtime',
    timezone: 'GMT',
    past_days: '1',
    forecast_days: '3',
  });
  return `${API}?${q}`;
}

// -> { times: [ms], cover: [0..100 | null] }, sorted. Throws on anything else.
function parseForecast(payload) {
  const h = payload && payload.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.cloud_cover) || h.time.length !== h.cloud_cover.length) {
    throw new WeatherError('parse', 'no hourly cloud_cover in response');
  }
  const rows = h.time
    .map((t, i) => {
      const c = h.cloud_cover[i];
      return { t: Number(t) * 1000, c: c === null || c === undefined || !Number.isFinite(Number(c)) ? null : Math.max(0, Math.min(100, Number(c))) };
    })
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  if (rows.filter((r) => r.c !== null).length === 0) throw new WeatherError('parse', 'cloud_cover is empty');
  return { times: rows.map((r) => r.t), cover: rows.map((r) => r.c) };
}

// Cloud cover at an instant: the nearest hourly value, or null when the forecast has nothing within 90 minutes.
function coverAt(forecast, t) {
  if (!forecast) return null;
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < forecast.times.length; i++) {
    const d = Math.abs(forecast.times[i] - t);
    if (d < bestD) {
      bestD = d;
      best = forecast.cover[i];
    }
  }
  return bestD <= 90 * 60e3 ? best : null;
}

async function fetchForecast(lat, lon) {
  let res;
  try {
    res = await fetch(forecastUrl(lat, lon), {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new WeatherError('network', err.message);
  }
  if (!res.ok) throw new WeatherError('http', `HTTP ${res.status}`);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new WeatherError('parse', 'response is not JSON');
  }
  return parseForecast(json);
}

const cache = new Map(); // key -> { data, fetchedAt, attemptedAt, requestedAt, lat, lon, error, inflight }
let budgetLogged = 0; // last time "budget used up" was logged, so a busy day logs it once an hour at most

function refresh(e, lat, lon, now, fetcher, share = 1) {
  if (e.inflight) return e.inflight;
  if (!budget.take(now, share)) {
    if (share === 1) {
      e.attemptedAt = now; // counts as a failed attempt: retried after RETRY_MS / RETRY_EMPTY_MS
      e.error = 'budget';
      if (now - budgetLogged >= 3600e3) {
        budgetLogged = now;
        console.error('Open-Meteo call budget used up: serving cached forecasts only');
      }
    }
    return Promise.resolve();
  }
  e.attemptedAt = now;
  e.inflight = fetcher(lat, lon)
    .then((data) => {
      e.data = data;
      e.fetchedAt = now; // when the request started: the data is at least that fresh
      e.error = null;
    })
    .catch((err) => {
      e.error = err.code || 'network';
      console.error(`Open-Meteo request failed: ${err.message}`);
    })
    .finally(() => {
      e.inflight = null;
    });
  return e.inflight;
}

function entry(lat, lon) {
  const key = locationKey(lat, lon);
  let e = cache.get(key);
  if (!e) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value); // oldest first
    e = { data: null, fetchedAt: 0, attemptedAt: 0, requestedAt: 0, lat: Number(lat), lon: Number(lon), error: null, inflight: null };
    cache.set(key, e);
  }
  return e;
}

function isDue(e, now) {
  return e.data ? now - e.fetchedAt >= CACHE_MS && now - e.attemptedAt >= RETRY_MS : now - e.attemptedAt >= RETRY_EMPTY_MS;
}

// A screen asks for a location. Returns { data, fetchedAt, error }.
async function getClouds(lat, lon, { now = Date.now(), fetcher = fetchForecast, waitMs = WAIT_MS } = {}) {
  const e = entry(lat, lon);
  e.requestedAt = Math.max(e.requestedAt, now);
  if (isDue(e, now)) refresh(e, Number(lat), Number(lon), now, fetcher);
  if (e.inflight && (!e.data || now - e.fetchedAt >= MAX_STALE_MS)) {
    let timer;
    await Promise.race([e.inflight, new Promise((r) => (timer = setTimeout(r, waitMs)))]);
    clearTimeout(timer);
  }
  return { data: e.data, fetchedAt: e.fetchedAt, error: e.data ? e.error : e.error || (e.inflight ? 'slow' : 'network') };
}

// Locations a screen asked for within ACTIVE_MS: the only ones worth refreshing in the background.
function activeLocations(now = Date.now()) {
  return [...cache.values()].filter((e) => e.requestedAt && now - e.requestedAt < ACTIVE_MS).map((e) => ({ lat: e.lat, lon: e.lon }));
}

// Refresh the given locations that are due, WARM_CONCURRENCY at a time with WARM_GAP_MS between starts, within
// WARM_SHARE of the budget. Does not count as a screen request, so it never keeps a location active by itself.
// Resolves to the number of upstream requests made.
async function warm(locations, { fetcher = fetchForecast, now = () => Date.now(), gapMs = WARM_GAP_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const seen = new Set();
  const queue = locations.filter((l) => {
    if (!l || !Number.isFinite(l.lat) || !Number.isFinite(l.lon)) return false;
    const k = locationKey(l.lat, l.lon);
    return !seen.has(k) && seen.add(k);
  });
  let made = 0;
  let stop = false;
  const worker = async () => {
    while (queue.length && !stop) {
      const l = queue.shift();
      const e = entry(l.lat, l.lon);
      const t = now();
      if (!isDue(e, t) || e.inflight) continue;
      const p = refresh(e, e.lat, e.lon, t, fetcher, WARM_SHARE);
      if (!e.inflight) {
        stop = true; // warming has used its share: leave the rest to screen requests
        break;
      }
      made++;
      await p;
      if (queue.length && gapMs > 0) await sleep(gapMs);
    }
  };
  await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
  return made;
}

function clearCache() {
  cache.clear();
  budget = createBudget();
  budgetLogged = 0;
}

// Tests: replace the budget ({ daily, hourly }).
function setBudget(limits) {
  budget = createBudget(limits);
}

module.exports = {
  WeatherError,
  parseForecast,
  coverAt,
  forecastUrl,
  locationKey,
  fetchForecast,
  getClouds,
  warm,
  activeLocations,
  clearCache,
  setBudget,
  usage: (now = Date.now()) => budget.used(now),
  CACHE_MS,
  ACTIVE_MS,
  DAILY_CALLS,
  HOURLY_CALLS,
};
