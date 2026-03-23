#!/usr/bin/env node
// Adds end_time to an existing city-routes.json from the source CSV.
// No API calls needed — reads both files and merges.
//
// Usage: node scripts/enrich-routes.js data/your_file_clean.csv

import fs from 'fs';
import path from 'path';

const ROOT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const INPUT_CSV   = path.resolve(process.argv[2] || 'data/trips_clean.csv');
const ROUTES_JSON = path.join(ROOT_DIR, 'data', 'city-routes.json');

const strip = s => s.replace(/^"|"$/g, '').trim();

const csvLines = fs.readFileSync(INPUT_CSV, 'utf-8').trim().split('\n').slice(1).filter(l => l.trim());
const trips = csvLines.map(line => {
  const v = line.split(',').map(strip);
  return { start_time: parseInt(v[1]), end_time: parseInt(v[2]) };
});

const routes = JSON.parse(fs.readFileSync(ROUTES_JSON, 'utf-8'));

if (routes.length !== trips.length) {
  console.error(`Mismatch: ${routes.length} routes vs ${trips.length} CSV rows — must be the same file used for prefetch.`);
  process.exit(1);
}

let added = 0;
for (let i = 0; i < routes.length; i++) {
  if (!routes[i].end_time) {
    routes[i].end_time = trips[i].end_time;
    added++;
  }
}

fs.writeFileSync(ROUTES_JSON, JSON.stringify(routes, null, routes.length < 500 ? 2 : 0));
console.log(`Done. Added end_time to ${added} entries in ${ROUTES_JSON}`);
