// User location settings: parsing and validation.

const DEFAULT_LOCATION = { lat: 48.2082, lon: 16.3738, place: 'Vienna' };

// Accepts "48.2082", "48,2082", "-33.87", "48.2082° N" / "16.37 E" / "33.87S". Returns a number or null.
function parseCoord(input, max, [pos, neg]) {
  let s = String(input ?? '').trim().toUpperCase().replace(/°/g, '').replace(/\s+/g, '');
  if (!s) return null;
  let sign = 1;
  const hemi = s.match(/^([NSEW])?(.*?)([NSEW])?$/);
  const letter = hemi[1] || hemi[3];
  if (hemi[1] && hemi[3]) return null;
  s = hemi[2];
  if (letter) {
    if (letter !== pos && letter !== neg) return null;
    if (letter === neg) sign = -1;
  }
  s = s.replace(',', '.');
  if (!/^[+-]?(\d{1,3})(\.\d{1,8})?$/.test(s)) return null;
  const n = sign * Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  if (letter && n * sign < 0) return null; // "-48 S" is ambiguous
  return Math.round(n * 1e5) / 1e5;
}

const parseLat = (s) => parseCoord(s, 90, ['N', 'S']);
const parseLon = (s) => parseCoord(s, 180, ['E', 'W']);

// "48.2082, 16.3738" pasted into one field (e.g. copied from a map).
function parsePair(input) {
  const m = String(input ?? '').trim().match(/^([^,;\s]+(?:\s*[NS])?)\s*[,;\s]\s*([^,;\s]+(?:\s*[EW])?)$/i);
  if (!m) return null;
  const lat = parseLat(m[1]);
  const lon = parseLon(m[2]);
  return lat === null || lon === null ? null : { lat, lon };
}

function cleanPlace(input) {
  return String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

// Validates a settings form. -> { ok: true, location } or { ok: false, error }
function validateLocation(body) {
  let lat = parseLat(body.lat);
  let lon = parseLon(body.lon);
  if (lat === null && lon === null) {
    const pair = parsePair(body.lat);
    if (pair) ({ lat, lon } = pair);
  }
  if (lat === null) return { ok: false, error: 'Latitude must be a number between -90 and 90 (north is positive), e.g. 48.2082.' };
  if (lon === null) return { ok: false, error: 'Longitude must be a number between -180 and 180 (east is positive), e.g. 16.3738.' };
  const place = cleanPlace(body.place) || `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return { ok: true, location: { lat, lon, place } };
}

// A user's saved location, or the default.
function locationOf(cfg) {
  if (cfg && Number.isFinite(cfg.lat) && Number.isFinite(cfg.lon)) return { lat: cfg.lat, lon: cfg.lon, place: cfg.place || '' };
  return { ...DEFAULT_LOCATION };
}

module.exports = { DEFAULT_LOCATION, parseLat, parseLon, parsePair, cleanPlace, validateLocation, locationOf };
