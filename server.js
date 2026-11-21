require('dotenv').config();
const path = require('path');
const express = require('express');
const { buildView } = require('./src/view');
const { renderAll, esc } = require('./src/markup');
const { createStore } = require('./src/store');
const weather = require('./src/weather');
const { DEFAULT_LOCATION, validateLocation, locationOf } = require('./src/location');

const PORT = Number(process.env.PORT) || 3014;
const CLIENT_ID = process.env.TRMNL_CLIENT_ID;
const CLIENT_SECRET = process.env.TRMNL_CLIENT_SECRET;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const TRMNL_OAUTH_URL = 'https://usetrmnl.com/oauth/token';
const MARKUP_BUDGET_MS = 7000; // TRMNL gives /markup 10 s

const store = createStore();
const app = express();
app.disable('x-powered-by');
// TRMNL posts the markup request form-encoded with nested keys (trmnl[user][...]); JSON is for local testing.
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

const UUID_RE = /^[A-Za-z0-9-]{1,64}$/;

app.get('/icon.svg', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'icon.svg'));
});

// /icon.png: white symbol on a black tile, readable in light and dark UIs (/icon.svg is the same).
// /icon-light.svg|png (black) and /icon-dark.svg|png (white) are transparent single-colour variants.
app.get(/^\/icon(-light|-dark)?\.(svg|png)$/, (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(__dirname, 'icons', `icon${req.params[0] || ''}.${req.params[1]}`));
});

// ---------------------------------------------------------------------------
// Installation (OAuth)
// ---------------------------------------------------------------------------

app.get('/install', async (req, res) => {
  const { code, installation_callback_url: callback } = req.query;
  if (!code || !callback) return res.status(400).json({ error: 'Missing code or installation_callback_url' });
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).json({ error: 'Plugin credentials not configured' });

  try {
    const r = await fetch(TRMNL_OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.access_token) throw new Error(`token exchange failed (HTTP ${r.status})`);
    console.log('Install: token exchange ok');
    res.redirect(302, callback);
  } catch (err) {
    console.error('Install failed:', err.message);
    res.status(500).json({ error: 'Installation failed' });
  }
});

app.post('/webhooks/install-success', (req, res) => {
  const user = req.body?.user;
  if (!user?.uuid || !UUID_RE.test(user.uuid)) return res.status(400).json({ error: 'No user data' });
  store.update(user.uuid, { plugin_setting_id: user.plugin_setting_id ?? null });
  console.log('Install success');
  res.json({ success: true });
});

// TRMNL has sent { user: { uuid } }, { user_uuid } and { uuid }. Anything that is not a well-formed uuid is ignored.
function uninstallUuid(body) {
  for (const raw of [body?.user?.uuid, body?.user_uuid, body?.uuid]) {
    if (typeof raw === 'string' && UUID_RE.test(raw)) return raw;
  }
  return null;
}

app.post('/webhooks/uninstall', (req, res) => {
  const uuid = uninstallUuid(req.body);
  if (!uuid) return res.status(400).json({ error: 'No user data' });
  store.delete(uuid);
  console.log('Uninstall');
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

function managePage(uuid, conn, notice, form) {
  const loc = locationOf(conn);
  const val = (k) => esc(form ? form[k] ?? '' : k === 'place' ? loc.place : loc[k]);
  const back = conn?.plugin_setting_id
    ? `https://usetrmnl.com/plugin_settings/${encodeURIComponent(conn.plugin_setting_id)}/edit?force_refresh=true`
    : 'https://usetrmnl.com';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sky Tonight</title>
<style>
body{font-family:system-ui,sans-serif;max-width:600px;margin:40px auto;padding:0 16px;line-height:1.5;color:#1a1a1a}
label{display:block;font-weight:600;margin-top:18px}
input{width:100%;box-sizing:border-box;padding:9px;font:inherit;border:1px solid #bbb;border-radius:6px;margin-top:4px}
.row{display:flex;gap:12px}.row>div{flex:1}
small{color:#555;display:block;margin-top:4px}
button,.btn{display:inline-block;margin-top:24px;margin-right:8px;padding:10px 18px;font:inherit;border-radius:6px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;text-decoration:none;cursor:pointer}
.btn{background:#fff;color:#1a1a1a}
.notice{padding:10px 14px;border-radius:6px;margin:16px 0;background:#eef6ee;border:1px solid #9c9}
.notice.err{background:#fbeeee;border-color:#d99}
</style></head>
<body>
<h1>Sky Tonight</h1>
<p>Tonight's moon, darkness, cloud cover and visible planets for your location. Times are shown in your TRMNL time zone.</p>
${notice ? `<div class="notice${notice.ok ? '' : ' err'}">${esc(notice.text)}</div>` : ''}
<form method="POST" action="/manage/save">
<input type="hidden" name="uuid" value="${esc(uuid)}">

<label for="place">Place name</label>
<input id="place" name="place" maxlength="40" value="${val('place')}" placeholder="${esc(DEFAULT_LOCATION.place)}">
<small>Shown in the title bar. Optional.</small>

<div class="row">
<div><label for="lat">Latitude</label>
<input id="lat" name="lat" inputmode="decimal" required value="${val('lat')}" placeholder="48.2082"></div>
<div><label for="lon">Longitude</label>
<input id="lon" name="lon" inputmode="decimal" required value="${val('lon')}" placeholder="16.3738"></div>
</div>
<small>Decimal degrees, north and east positive (or 33.87 S, 70.6 W). You can paste "48.2082, 16.3738" from a map into
Latitude. Right-click a spot in Google Maps or OpenStreetMap to copy its coordinates. Two decimals (about 1 km) are plenty.</small>

<button type="submit">Save</button>
<a class="btn" href="${esc(back)}">Back to TRMNL</a>
</form>
<p><small>Cloud forecast: <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0). Astronomy computed locally.</small></p>
</body></html>`;
}

app.get('/manage', (req, res) => {
  const uuid = String(req.query.uuid || '');
  if (!UUID_RE.test(uuid)) return res.status(400).send('Missing or invalid uuid');
  res.type('html').send(managePage(uuid, store.get(uuid)));
});

app.post('/manage/save', async (req, res) => {
  const uuid = String(req.body.uuid || '');
  if (!UUID_RE.test(uuid)) return res.status(400).send('Missing or invalid uuid');
  const conn = store.get(uuid);
  const r = validateLocation(req.body || {});
  if (!r.ok) {
    const form = { lat: String(req.body.lat ?? ''), lon: String(req.body.lon ?? ''), place: String(req.body.place ?? '') };
    return res.status(400).type('html').send(managePage(uuid, conn, { ok: false, text: r.error }, form));
  }
  const next = store.update(uuid, r.location);
  // Fetch the forecast now, so the first screen already has clouds.
  const wx = await weather.getClouds(r.location.lat, r.location.lon, { waitMs: 5000 }).catch(() => ({ data: null }));
  const text = `Saved: ${r.location.place} (${r.location.lat}, ${r.location.lon}).${wx.data ? '' : ' The cloud forecast is not reachable right now; it will retry on the next refresh.'}`;
  res.type('html').send(managePage(uuid, next, { ok: true, text }));
});

// ---------------------------------------------------------------------------
// Screen generation
// ---------------------------------------------------------------------------

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), ms)))]).finally(() =>
    clearTimeout(timer),
  );
}

// TRMNL metadata arrives either as nested form keys (trmnl[user][...]) or as one JSON string in the "trmnl" field.
function trmnlMeta(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.length < 50000) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* not JSON: ignore */
    }
  }
  return {};
}

app.post('/markup', async (req, res) => {
  const trmnl = trmnlMeta(req.body?.trmnl);
  const uuid = req.body?.user_uuid || trmnl.user?.uuid;
  const cfg = uuid && UUID_RE.test(String(uuid)) ? store.get(String(uuid)) : null; // no settings: default location
  const ctx = { baseUrl: BASE_URL, instance: trmnl.plugin_settings?.instance_name };
  try {
    const v = await withTimeout(buildView(cfg, { timeZone: trmnl.user?.time_zone_iana }), MARKUP_BUDGET_MS);
    res.json(renderAll(v, ctx));
  } catch (err) {
    console.error('Markup failed:', err);
    res.json(renderAll(null, ctx));
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', users: store.size(), openMeteoCalls: weather.usage() });
});

// Warm the caches at startup (the default location first, then every saved one), then every 30 minutes refresh only
// the locations a screen asked for in the last two hours. weather.warm staggers the requests and stops at its share
// of the Open-Meteo call budget, so the upstream load follows the devices that are actually running.
function startBackgroundRefresh() {
  const saved = () => store.all().map(locationOf);
  weather.warm([DEFAULT_LOCATION, ...saved()]).catch(() => {});
  setInterval(() => weather.warm(weather.activeLocations()).catch(() => {}), weather.CACHE_MS).unref();
}

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => console.log(`TRMNL Sky Tonight plugin on http://127.0.0.1:${PORT}`));
  startBackgroundRefresh();
}

module.exports = app;
