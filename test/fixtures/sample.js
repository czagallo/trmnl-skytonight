// Synthetic Open-Meteo-shaped forecasts for tests and previews.

const HOUR = 3600e3;

// Hourly cloud cover from `from` for `hours` hours; cover(t) -> 0..100 or null.
function sampleForecast(from, cover, hours = 96) {
  const start = Math.floor(from / HOUR) * HOUR;
  const times = [];
  const cloud = [];
  for (let i = 0; i < hours; i++) {
    const t = start + i * HOUR;
    times.push(t / 1000);
    cloud.push(cover(t));
  }
  return { latitude: 48.2, longitude: 16.38, hourly_units: { time: 'unixtime', cloud_cover: '%' }, hourly: { time: times, cloud_cover: cloud } };
}

// Cloud patterns by UTC hour.
const PATTERNS = {
  clearsLate: (t) => {
    const h = new Date(t).getUTCHours();
    return h >= 15 && h < 21 ? [100, 95, 90, 80, 60, 45][h - 15] : h >= 21 || h < 7 ? [5, 0, 0, 10, 0, 0, 15, 20, 10, 5][(h + 3) % 24] ?? 10 : 70;
  },
  clear: () => 3,
  overcast: () => 100,
  patchy: (t) => [20, 60, 90, 40, 15, 75, 100, 35][new Date(t).getUTCHours() % 8],
};

module.exports = { sampleForecast, PATTERNS };
