#!/usr/bin/env node
// Fetches cycling routes from Mapbox Directions API for each trip in the CSV
// and saves the results to data/city-routes.json.
//
// Usage: node scripts/prefetch-routes.js data/your_file_clean.csv
// Requires: Mapbox token in config.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT_DIR = path.join(__dirname, '..');
const INPUT_CSV  = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT_DIR, 'data', 'trips_clean.csv');
const OUTPUT_JSON = path.join(ROOT_DIR, 'data', 'city-routes.json');
const CONFIG_FILE = path.join(ROOT_DIR, 'config.js');

const REQUESTS_PER_MINUTE = 250;
const DELAY_MS = Math.ceil(60000 / REQUESTS_PER_MINUTE);

function readToken() {
  const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
  const match = content.match(/MAPBOX_TOKEN\s*=\s*['"]([^'"]+)['"]/);
  if (!match) { console.error('MAPBOX_TOKEN not found in config.js'); process.exit(1); }
  return match[1];
}

function parseCSV(filePath) {
  const strip = (s) => s.replace(/^"|"$/g, '').trim();
  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');

  // columns: bike_name, start_time, end_time, start_lat, start_lng, end_lat, end_lng
  return lines.slice(1).filter(l => l.trim()).map((line, i) => {
    const vals = line.split(',').map(strip);
    return {
      index:      i,
      bike_name:  vals[0],
      start_time: parseInt(vals[1]),
      end_time:   parseInt(vals[2]),
      start_lat:  parseFloat(vals[3]),
      start_lng:  parseFloat(vals[4]),
      end_lat:    parseFloat(vals[5]),
      end_lng:    parseFloat(vals[6]),
    };
  });
}

async function fetchRoute(token, trip) {
  const url = `https://api.mapbox.com/directions/v5/mapbox/cycling/${trip.start_lng},${trip.start_lat};${trip.end_lng},${trip.end_lat}?geometries=geojson&overview=full&access_token=${token}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();

  if (!data.routes || data.routes.length === 0) {
    return {
      coordinates: [[trip.start_lng, trip.start_lat], [trip.end_lng, trip.end_lat]],
      distance: haversine(trip.start_lat, trip.start_lng, trip.end_lat, trip.end_lng),
    };
  }

  return {
    coordinates: data.routes[0].geometry.coordinates,
    distance: data.routes[0].distance,
  };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function printProgress(current, total, errors) {
  const pct = ((current / total) * 100).toFixed(1);
  const filled = Math.floor((current / total) * 30);
  const bar = '█'.repeat(filled) + '░'.repeat(30 - filled);
  process.stdout.write(`\r[${bar}] ${pct}% (${current}/${total}) errors: ${errors}`);
}

async function main() {
  const token = readToken();
  const trips = parseCSV(INPUT_CSV);
  console.log(`Loaded ${trips.length} trips from ${INPUT_CSV}`);

  let existing = [];
  if (fs.existsSync(OUTPUT_JSON)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf-8'));
      console.log(`Resuming — skipping ${existing.length} already fetched routes`);
    } catch (_) { existing = []; }
  }

  const results = [...existing];
  const startFrom = existing.length;
  let errors = 0;

  if (startFrom >= trips.length) {
    console.log('All routes already fetched.');
    return;
  }

  console.log(`Starting from trip ${startFrom + 1} — rate limit: ${REQUESTS_PER_MINUTE} req/min\n`);

  for (let i = startFrom; i < trips.length; i++) {
    const trip = trips[i];
    printProgress(i - startFrom, trips.length - startFrom, errors);

    try {
      const route = await fetchRoute(token, trip);
      results.push({ start_time: trip.start_time, end_time: trip.end_time, distance: route.distance, coordinates: route.coordinates });
    } catch (err) {
      errors++;
      const dist = haversine(trip.start_lat, trip.start_lng, trip.end_lat, trip.end_lng);
      results.push({
        start_time: trip.start_time,
        end_time:   trip.end_time,
        distance:   dist,
        coordinates: [[trip.start_lng, trip.start_lat], [trip.end_lng, trip.end_lat]],
      });
      console.log(`\n  Trip ${i + 1} failed: ${err.message} (straight line fallback)`);
    }

    // Save every 10 routes to support resume
    if ((i + 1) % 10 === 0 || i === trips.length - 1) {
      fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 0));
    }

    if (i < trips.length - 1) await sleep(DELAY_MS);
  }

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, results.length < 500 ? 2 : 0));
  printProgress(trips.length - startFrom, trips.length - startFrom, errors);
  console.log(`\n\nDone! ${results.length} routes saved to ${OUTPUT_JSON}`);
  if (errors > 0) console.log(`${errors} errors (straight line fallback used)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
