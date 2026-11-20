// Tonight's sky for one place, computed locally with astronomy-engine: sun and twilight, moon, planets.
// Pure: everything depends only on (lat, lon, now, timeZone).

const A = require('astronomy-engine');
const { HOUR, MIN, localParts, zonedTime } = require('./time');

const PLANETS = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
const PLANET_MIN_ALT = 5; // degrees; lower than this hides behind trees and haze
const STEP = 10 * MIN; // planet sampling step

const ms = (t) => (t ? t.date.getTime() : null);

function riseSet(body, obs, dir, from, days) {
  try {
    return ms(A.SearchRiseSet(body, obs, dir, new Date(from), days));
  } catch {
    return null;
  }
}

function sunCrossing(obs, dir, altitude, from, days) {
  try {
    return ms(A.SearchAltitude(A.Body.Sun, obs, dir, new Date(from), days, altitude));
  } catch {
    return null;
  }
}

function altAz(body, obs, t) {
  const time = A.MakeTime(new Date(t));
  const eq = A.Equator(body, time, obs, true, true);
  const hor = A.Horizon(time, obs, eq.ra, eq.dec, 'normal');
  return { alt: hor.altitude, az: hor.azimuth };
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass(az) {
  return DIRS[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

// Phase names from the moon's ecliptic elongation (0 = new, 180 = full).
function phaseName(angle) {
  const a = ((angle % 360) + 360) % 360;
  if (a < 7 || a >= 353) return 'New Moon';
  if (a < 83) return 'Waxing Crescent';
  if (a < 97) return 'First Quarter';
  if (a < 173) return 'Waxing Gibbous';
  if (a < 187) return 'Full Moon';
  if (a < 263) return 'Waning Gibbous';
  if (a < 277) return 'Last Quarter';
  return 'Waning Crescent';
}

// Which night is "tonight": the night that ends with the next sunrise. In daytime that is the coming night, after
// midnight it is the one still running. Polar day/night fall back to the evening of the local date.
function nightBounds(obs, now, tz) {
  const sunrise = riseSet(A.Body.Sun, obs, +1, now, 2);
  const sunset = sunrise ? riseSet(A.Body.Sun, obs, -1, sunrise, -2) : null;
  let anchor; // local calendar date the night starts on
  if (sunset && sunset < sunrise && sunrise - sunset < 24 * HOUR) {
    anchor = localParts(sunset, tz);
    // A sunset just after midnight (far north in summer) still belongs to the previous evening.
    if (anchor.h < 12) anchor = localParts(sunset - 12 * HOUR, tz);
  } else {
    const p = localParts(now, tz);
    anchor = p.h < 12 ? localParts(now - 24 * HOUR, tz) : p;
  }
  const valid = sunset && sunrise && sunset < sunrise && sunrise - sunset < 24 * HOUR;
  return { sunset: valid ? sunset : null, sunrise: valid ? sunrise : null, anchor };
}

function computeMoon(obs, now, from) {
  const angle = A.MoonPhase(new Date(now));
  const illum = A.Illumination(A.Body.Moon, new Date(now));
  const nextFull = ms(A.SearchMoonPhase(180, new Date(now), 40));
  const nextNew = ms(A.SearchMoonPhase(0, new Date(now), 40));
  return {
    angle,
    fraction: illum.phase_fraction,
    name: phaseName(angle),
    waxing: angle < 180,
    rise: riseSet(A.Body.Moon, obs, +1, from, 1.2),
    set: riseSet(A.Body.Moon, obs, -1, from, 1.2),
    nextFull,
    nextNew,
  };
}

// Where each planet is while the sky is dark enough to see it (sun below -6°).
function computePlanets(obs, start, end, sunAltAt) {
  const out = [];
  if (!start || !end || end <= start) return out;
  for (const name of PLANETS) {
    const body = A.Body[name];
    let first = null;
    let last = null;
    let best = null;
    for (let t = start; t <= end; t += STEP) {
      if (sunAltAt(t) > -6) continue;
      const p = altAz(body, obs, t);
      if (p.alt < PLANET_MIN_ALT) continue;
      if (first === null) first = t;
      last = t;
      if (!best || p.alt > best.alt) best = { t, alt: p.alt, az: p.az };
    }
    if (first === null || last - first < 2 * STEP) continue; // a glimpse of under 20 minutes is not worth listing
    const mag = A.Illumination(body, new Date(best.t)).mag;
    out.push({
      name,
      from: first,
      to: last,
      best: best.t,
      alt: Math.round(best.alt),
      dir: compass(best.az),
      mag: Math.round(mag * 10) / 10,
      // Visible all through the dark window rather than rising or setting inside it.
      allNight: first === start && last + STEP > end,
    });
  }
  return out.sort((a, b) => a.from - b.from || a.mag - b.mag);
}

// Hourly chart slots from 18:00 on the evening of the night to 06:00 the next morning, local time.
function chartSlots(anchor, tz) {
  const slots = [];
  for (let i = 0; i <= 12; i++) slots.push({ t: zonedTime(anchor.y, anchor.m, anchor.d, 18 + i, 0, tz), hour: (18 + i) % 24 });
  return slots;
}

function computeNight({ lat, lon, now = Date.now(), timeZone = 'UTC' }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error('invalid location');
  }
  const obs = new A.Observer(lat, lon, 0);
  const sunAltAt = (t) => altAz(A.Body.Sun, obs, t).alt;

  const { sunset, sunrise, anchor } = nightBounds(obs, now, timeZone);
  const slots = chartSlots(anchor, timeZone);
  const windowStart = sunset ?? slots[0].t;
  const windowEnd = sunrise ?? slots[slots.length - 1].t;

  // Astronomical twilight: dark once the sun is 18° down. Missing in high-latitude summers.
  let dusk = sunset ? sunCrossing(obs, -1, -18, sunset, 0.6) : null;
  let dawn = dusk ? sunCrossing(obs, +1, -18, dusk, 1) : null;
  if (dusk && dawn && (dusk > windowEnd || dawn > windowEnd + HOUR)) dusk = dawn = null;
  const civilDusk = sunset ? sunCrossing(obs, -1, -6, sunset, 0.3) : null;
  const civilDawn = sunrise ? sunCrossing(obs, +1, -6, sunrise - 3 * HOUR, 0.2) : null;

  const moon = computeMoon(obs, now, Math.min(now, windowStart));
  const hours = slots.map((s) => {
    const m = altAz(A.Body.Moon, obs, s.t);
    return { ...s, sunAlt: sunAltAt(s.t), moonAlt: m.alt };
  });

  const planetStart = civilDusk ?? windowStart;
  const planetEnd = civilDawn ?? windowEnd;

  return {
    lat,
    lon,
    anchor,
    sunset,
    sunrise,
    dusk,
    dawn,
    darkMs: dusk && dawn ? dawn - dusk : 0,
    polar: !sunset ? (sunAltAt(now) > 0 ? 'day' : 'night') : null,
    moon,
    hours,
    planets: computePlanets(obs, planetStart, planetEnd, sunAltAt),
  };
}

module.exports = { computeNight, phaseName, compass, PLANETS };
