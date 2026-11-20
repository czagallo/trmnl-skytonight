// Hourly cloud cover from Open-Meteo (free, no API key).
//
// Stale-while-revalidate per rounded location (0.01° ≈ 1 km): a screen request answers from cache at once and starts
// a refresh when the entry is older than 30 minutes. It only waits for the network when nothing is cached yet, and
// then never longer than WAIT_MS, so a slow upstream can not break the 10 s TRMNL gives /markup.

const API = 'https://api.open-meteo.com/v1/forecast';
const CACHE_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000; // after a failed attempt
const TIMEOUT_MS = 6000;
const WAIT_MS = 4000;
const MAX_ENTRIES = 1000;
const USER_AGENT = 'trmnl-skytonight/1.0 (TRMNL e-ink plugin)';

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

const cache = new Map(); // key -> { data, fetchedAt, attemptedAt, error, inflight }

function refresh(e, lat, lon, now, fetcher) {
  if (e.inflight) return e.inflight;
  e.attemptedAt = now;
  e.inflight = fetcher(lat, lon)
    .then((data) => {
      e.data = data;
      e.fetchedAt = now; // when the request started: the data is at least that fresh
      e.error = null;
    })
    .catch((err) => {
      e.error = err.code || 'network';
      console.error(`Open-Meteo ${locationKey(lat, lon)} failed: ${err.message}`);
    })
    .finally(() => {
      e.inflight = null;
    });
  return e.inflight;
}

// Returns { data, fetchedAt, error }.
async function getClouds(lat, lon, { now = Date.now(), fetcher = fetchForecast, waitMs = WAIT_MS } = {}) {
  const key = locationKey(lat, lon);
  let e = cache.get(key);
  if (!e) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value); // oldest first
    cache.set(key, (e = { data: null, fetchedAt: 0, attemptedAt: 0, error: null, inflight: null }));
  }
  const due = e.data ? now - e.fetchedAt >= CACHE_MS && now - e.attemptedAt >= RETRY_MS : now - e.attemptedAt >= RETRY_MS;
  if (due) refresh(e, Number(lat), Number(lon), now, fetcher);
  if (!e.data && e.inflight) {
    let timer;
    await Promise.race([e.inflight, new Promise((r) => (timer = setTimeout(r, waitMs)))]);
    clearTimeout(timer);
  }
  return { data: e.data, fetchedAt: e.fetchedAt, error: e.data ? e.error : e.error || (e.inflight ? 'slow' : 'network') };
}

// Keep a list of locations warm (startup, deploys, every 30 minutes) so screens rarely wait.
function warm(locations, { fetcher = fetchForecast } = {}) {
  const seen = new Set();
  return Promise.all(
    locations
      .filter((l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lon))
      .filter((l) => !seen.has(locationKey(l.lat, l.lon)) && seen.add(locationKey(l.lat, l.lon)))
      .map((l) => getClouds(l.lat, l.lon, { fetcher, waitMs: TIMEOUT_MS + 1000 })),
  );
}

function clearCache() {
  cache.clear();
}

module.exports = { WeatherError, parseForecast, coverAt, forecastUrl, locationKey, fetchForecast, getClouds, warm, clearCache, CACHE_MS };
