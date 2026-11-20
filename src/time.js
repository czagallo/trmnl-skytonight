// Time zone helpers built on Intl only. All instants are epoch milliseconds.

const HOUR = 3600e3;
const MIN = 60e3;

function validZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const partsFmt = new Map();
// Local calendar fields of an instant in a time zone.
function localParts(ms, tz) {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    partsFmt.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute) };
}

// The instant at which the wall clock in `tz` shows y-m-d h:min (month 1-12; days may overflow). Two passes settle
// the offset; a time skipped by a DST change lands an hour later, which is fine for a chart axis.
function zonedTime(y, m, d, h, min, tz) {
  const want = Date.UTC(y, m - 1, d, h, min);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = localParts(t, tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
    if (shown === want) break;
    t += want - shown;
  }
  return t;
}

function clock(ms, tz) {
  if (ms == null || !Number.isFinite(ms)) return '–';
  const p = localParts(ms, tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

// "11h 40m"
function duration(ms) {
  const mins = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function weekdayDate(ms, tz) {
  return new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
}

module.exports = { HOUR, MIN, validZone, localParts, zonedTime, clock, duration, weekdayDate };
