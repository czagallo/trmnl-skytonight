# Sky Tonight for TRMNL

Tonight's sky for your location on your TRMNL: the moon, when it is really dark, whether the clouds will let you see
anything, and which planets are up.

- **Moon:** the current phase drawn as a 1-bit illustration (lit side, terminator, stippled dark side and maria),
  phase name, illumination, moonrise and moonset, days to the next full and new moon
- **Sun:** sunset, astronomical darkness (sun 18° below the horizon) and how long it lasts, sunrise
- **Stargazing verdict:** hourly cloud cover from 18:00 to 06:00 as a bar chart, with strips that show when it is dark
  and when the moon is up, plus a one-line verdict such as *Great night · Clear after 22:00 · Bright moon sets 01:49*
  or *Poor · Overcast all night*
- **Planets:** Mercury to Saturn when they are at least 5° up after dusk, with compass direction, time window and the
  best time (highest in the sky)
- Every layout (full, half horizontal, half vertical, quadrant) on every screen (TRMNL OG 1-/2-bit, TRMNL X,
  portrait), in pure black and white
- Handles the southern hemisphere (the moon is drawn rotated), midnight sun and polar night

All astronomy is computed locally with [astronomy-engine](https://github.com/cosinekitty/astronomy). Cloud cover comes
from [Open-Meteo](https://open-meteo.com) (free, no API key).

## Setup (as a user)

In the plugin's settings page, enter a **latitude** and **longitude** (decimal degrees, or `33.87 S`, or paste
`48.2082, 16.3738` from a map into the latitude field) and optionally a **place name** for the title bar. Without
settings the plugin shows Vienna. Times are shown in the time zone of your TRMNL account.

## How the verdict works

Only the dark hours count (astronomical darkness, or the darkest twilight there is in summer). An hour is *clear* at
≤ 30 % cloud cover. The text describes the longest clear stretch (*Clear after 22:00*, *Clear until 01:00*,
*Clear 23:00–03:00*, *Clear all night*, *Overcast all night*, ...) and what the moon does in the dark hours. The
rating is *Great* with three or more clear, moonless (or thin-moon) dark hours and mostly clear skies, *Good* with
at least two, *Fair* when it is clear but moonlit, *Poor* otherwise.

## Data and caching

Forecasts are cached per location rounded to 0.01° (about 1 km) for 30 minutes, stale-while-revalidate: a screen is
always answered from cache and the refresh happens in the background. Only the very first request for a new location
waits for Open-Meteo, at most 4 seconds; after that the screen shows *Cloud forecast unavailable* and everything else.
The server keeps the forecasts of all saved locations warm. Failed requests are retried after 5 minutes at the
earliest.

The ISS is not shown: it would need orbital elements from another service plus an SGP4 library.

## Development

```bash
npm install
cp .env.example .env
npm run dev                                   # http://127.0.0.1:3014
npm test

npm run preview                               # screenshots of every layout on every screen in ./preview (needs Chrome)
npm run preview -- --scenario=crescent        # also: tonight (default), overcast, patchy, nodata, south, arctic
npm run preview -- --live                     # real clouds right now for Vienna (or SKY_LAT/SKY_LON from .env)

# a markup request without a user uuid shows the default location
curl -X POST http://127.0.0.1:3014/markup --data-urlencode 'trmnl[user][time_zone_iana]=Europe/Vienna'
```

Code: `src/sky.js` (sun, moon, planets), `src/weather.js` (Open-Meteo, cache), `src/view.js` (verdict, what the screen
shows), `src/markup.js` (layouts and the moon drawing), `src/location.js` (settings validation), `src/store.js` (user
settings), `src/time.js` (time zones).

## Deployment

Pushes to `main` are tested and deployed by GitHub Actions (`.github/workflows/deploy.yml`), which runs
`deployment/deploy.sh` on the server. The server connection comes from repository secrets. The service writes user
settings to `data/`, which the deploy script creates.

## License

MIT
