#!/usr/bin/env node
// Removes rows with invalid coordinates and writes a clean CSV.
// Usage: node scripts/validate-csv.js data/your_file.csv

import fs from 'fs';
import path from 'path';

const INPUT_CSV = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('data/trips.csv');
const OUTPUT_CSV = INPUT_CSV.replace(/\.csv$/i, '_clean.csv');

const strip = (s) => s.replace(/^"|"$/g, '').trim();

const lines = fs.readFileSync(INPUT_CSV, 'utf-8').trim().split('\n');
const header = lines[0];

let total = 0;
let bad = 0;
const goodLines = [header];
const badLines = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  total++;

  // columns: bike_name, start_time, end_time, start_lat, start_lng, end_lat, end_lng
  const vals = line.split(',').map(strip);
  const endTime  = vals[2];
  const startLat = parseFloat(vals[3]);
  const startLng = parseFloat(vals[4]);
  const endLat   = parseFloat(vals[5]);
  const endLng   = parseFloat(vals[6]);

  const isValid = (lat, lng) => !isNaN(lat) && !isNaN(lng) && Math.abs(lat) > 1 && Math.abs(lng) > 1;
  const isSameCoords = startLat === endLat && startLng === endLng;

  const reason = [];
  if (!endTime)                        reason.push('missing end_time');
  if (!isValid(startLat, startLng))    reason.push(`start(${startLat}, ${startLng})`);
  if (!isValid(endLat, endLng))        reason.push(`end(${endLat}, ${endLng})`);
  if (isSameCoords)                    reason.push('start == end');

  if (reason.length === 0) {
    goodLines.push(line);
  } else {
    bad++;
    badLines.push({ row: i + 1, bike: vals[0], reason: reason.join(', ') });
  }
}

console.log(`Total:  ${total}`);
console.log(`OK:     ${total - bad}`);
console.log(`Errors: ${bad}`);

if (bad > 0) {
  badLines.forEach(b => console.log(`  Row ${b.row}: bike ${b.bike} — ${b.reason}`));
}

fs.writeFileSync(OUTPUT_CSV, goodLines.join('\n') + '\n');
console.log(`\nCleaned file: ${OUTPUT_CSV} (${total - bad} trips)`);
