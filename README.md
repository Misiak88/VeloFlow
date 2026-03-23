# VeloFlow

Two animated visualizations of bike-sharing trips built with Mapbox GL JS.

- **Single Bike** (`index.html`) — follow one bike through its rentals across a day, trip by trip

  <video src="assets/demo-single-bike.webm" autoplay loop muted playsinline width="100%"></video>

- **City Overview** (`city.html`) — all rentals of a day animated simultaneously on a city map

  <video src="assets/demo-city-overview.webm" autoplay loop muted playsinline width="100%"></video>


Both views auto-center on your data and use real trip speed derived from `end_time - start_time`.

---

## How it works

### Single Bike

Reads `data/singlebike-trip.csv` directly in the browser. For each trip it calls the Mapbox Directions API live to get the cycling route, then animates the bike along it.

```
singlebike-trip.csv  →  index.html  (routes fetched live from Mapbox)
```

### City Overview

Routes are pre-fetched once and stored locally. The browser loads `city-routes.json` and animates all trips simultaneously — no API calls during playback.

```
your_data.csv
  → [validate-csv.js]   → your_data_clean.csv
  → [prefetch-routes.js] → city-routes.json
  → city.html
```

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [Mapbox](https://account.mapbox.com/) account (free tier is sufficient)

---

## Setup

### 1. Get a Mapbox token

Sign up at [mapbox.com](https://account.mapbox.com/) and copy your **public token** (starts with `pk.`).

### 2. Create config.js

```bash
cp config.example.js config.js
```

Paste your token in `config.js`:

```js
const MAPBOX_TOKEN = 'pk.your_token_here';
```

> `config.js` is in `.gitignore` and will never be committed.

### 3. CSV format

Both views use the same input format:

```csv
"bike_name","start_time","end_time","start_lat","start_lng","end_lat","end_lng"
"K224856",1748210700,1748211780,50.9427,6.9584,50.9509,6.9186
```

| Column | Type | Description |
|---|---|---|
| `bike_name` | string | Bike identifier |
| `start_time` | Unix timestamp (s) | Rental start |
| `end_time` | Unix timestamp (s) | Rental end |
| `start_lat` / `start_lng` | float | Start coordinates |
| `end_lat` / `end_lng` | float | End coordinates |

Sample files:
- [`data/sample.csv`](data/sample.csv) — 15 rows including intentional errors (for testing validate-csv.js)
- [`data/singlebike-trip.csv`](data/singlebike-trip.csv) — 45 trips for single bike view

---

## Single Bike setup

Place your filtered CSV (one bike, sorted by `start_time`) at `data/singlebike-trip.csv` and open `index.html`. No scripts needed.

---

## City Overview setup

### Step 1 — Clean the data

```bash
# with the sample file:
node scripts/validate-csv.js data/sample.csv

# with your own data:
node scripts/validate-csv.js data/your_data.csv
```

Removes rows with:
- missing or empty `end_time`
- coordinates of `0, 0` or `NaN`
- identical start and end coordinates

Output: `data/your_data_clean.csv`

```
Total:  15
OK:     10
Errors: 5
  Row 12: bike 10011 — missing end_time
  Row 13: bike 10012 — start(0, 0)
  ...
Cleaned file: data/your_data_clean.csv (10 trips)
```

### Step 2 — Fetch routes

```bash
node scripts/prefetch-routes.js data/your_data_clean.csv
```

- Calls Mapbox Directions API (cycling profile) for each trip
- Falls back to a straight line on API error
- Saves results to `data/city-routes.json` (includes `start_time`, `end_time`, `distance`, `coordinates`)
- Saves progress every 10 routes — safe to interrupt and resume
- Rate limit: 250 requests/minute (~1.5 hours for 23,000 trips)

**Resume after interruption:**
```bash
node scripts/prefetch-routes.js data/your_data_clean.csv
# already-fetched routes are skipped automatically
```

> Do not reorder or remove rows from the CSV between runs. To start over: `rm data/city-routes.json`

### Step 3 — Run a local server

```bash
python3 -m http.server 8000
```

### Step 4 — Open in browser

```
http://localhost:8000/            # Single Bike
http://localhost:8000/city.html   # City Overview
```

---

## Updating an existing city-routes.json

If you have a `city-routes.json` generated before `end_time` was added to the format, run:

```bash
node scripts/enrich-routes.js data/your_data_clean.csv
```

This reads `end_time` from the CSV and adds it to each entry in `city-routes.json` — no API calls needed.

---

## Docker

```bash
docker build -t bike-vis .
docker run -d -p 7890:80 -e MAPBOX_TOKEN=pk.your_token_here bike-vis
```

Open `http://localhost:7890/`.

> `city-routes.json` must exist in `data/` before building the image (pre-fetch first).

---

## Project structure

```
bike-vis/
│
├── assets/
│   └── cycling-icon.png        # Bike marker icon (provide your own)
│
├── css/
│   ├── city.css                # City Overview styles
│   └── style.css               # Single Bike styles
│
├── data/
│   ├── sample.csv              # 15-row sample with error examples
│   ├── singlebike-trip.csv     # Sample for Single Bike view (45 trips)
│
├── i18n/
│   ├── en.json                 # English strings (default)
│   └── de.json                 # German strings
│
├── js/
│   ├── app.js                  # Single Bike logic
│   └── city.js                 # City Overview logic
│
├── scripts/
│   ├── validate-csv.js         # Step 1: clean raw CSV
│   ├── prefetch-routes.js      # Step 2: fetch routes from Mapbox → city-routes.json
│   └── enrich-routes.js        # Add end_time to existing city-routes.json
│
├── city.html                   # City Overview view
├── config.example.js           # Token template
├── config.js                   # Mapbox token (gitignored)
├── docker-entrypoint.sh        # Injects token at container start
├── Dockerfile
├── index.html                  # Single Bike view
└── package.json                # ES module declaration
```

---

## Data formats

### Input CSV

```csv
"bike_name","start_time","end_time","start_lat","start_lng","end_lat","end_lng"
"K224856",1748210700,1748211780,50.9427,6.9584,50.9509,6.9186
```

### city-routes.json

Generated by `prefetch-routes.js`. Each entry is one trip:

```json
{
  "start_time": 1748210700,
  "end_time":   1748211780,
  "distance":   3623.7,
  "coordinates": [[6.9584, 50.9427], [6.9521, 50.9468], ...]
}
```

`distance` is the real cycling route length in meters (from Mapbox Directions API), not the straight-line distance between start and end.

---

## Internationalisation (i18n)

All user-visible strings for both views are stored in `i18n/`:

```
i18n/
├── en.json   # English (default)
└── de.json   # German
```

Translation files use a two-level namespace — `nav`, `index`, `city` — matching the view they belong to:

```json
{
  "nav":   { "single_bike": "Single Bike", ... },
  "index": { "heading": "Single Bike", "status_ready": "Ready", ... },
  "city":  { "heading": "All Rentals", ... }
}
```

Every translatable element in `index.html` and `city.html` is annotated with:

- `data-i18n="namespace.key"` — for text content
- `data-i18n-title="namespace.key"` — for `title` attributes (button tooltips)

To add a new language, copy `i18n/en.json` to `i18n/<code>.json` (e.g. `fr.json`) and translate the values. Keys must stay unchanged.

### Switching language

Pass `?lang=<code>` in the URL — the choice is saved in `localStorage` and persists across page loads:

```
http://localhost:8000/?lang=de        # German
http://localhost:8000/?lang=en        # English (default)
```

To reset to the default, clear `localStorage` in the browser (`vf_lang` key) or open the page with `?lang=en`.

---

## Tech stack

- [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) v3
- [Mapbox Directions API](https://docs.mapbox.com/api/navigation/directions/) — cycling profile
- Vanilla HTML / CSS / JavaScript (no build step)
- Node.js (ES modules) — data preparation scripts only

---

## License

[MIT](LICENSE)
