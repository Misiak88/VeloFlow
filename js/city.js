const SPEED_STEPS = [1, 1.5, 2, 3, 5, 8, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 300, 400, 500];
const FALLBACK_SPEED_MPS = 4.5; // used when end_time is missing in city-routes.json
const FADE_DURATION = 3.0;
const FADE_BUCKETS = 3;
const SIMPLIFY_TOLERANCE = 0.0003;

let allRoutes = [];
let map = null;
let mapReady = false;
let isPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let speedMultiplier = SPEED_STEPS[6]; // default: 10x (sim-seconds per real-second)

let isFinalFadeIn = false;
let finalFadeStartTime = 0;
const FINAL_FADE_DURATION = 2.5;

let simTime = 0;
let simStart = 0;
let simEnd = 0;

let nextTripIdx = 0;
let activeTrips = [];
let fadingTrips = [];
let completedCount = 0;
let totalDistanceKm = 0;

let lastSidebarUpdate = 0;
const SIDEBAR_UPDATE_MS = 150;

// Reusable GeoJSON objects to reduce GC pressure
const emptyFC = { type: 'FeatureCollection', features: [] };
const activeFC = { type: 'FeatureCollection', features: [] };
const headsFC = { type: 'FeatureCollection', features: [] };
const fadeBucketFCs = [];
const fadeBucketPrevEmpty = [];
for (let i = 0; i < FADE_BUCKETS; i++) {
  fadeBucketFCs.push({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [] } }] });
  fadeBucketPrevEmpty.push(true);
}

let domTimeSlider;
let isSeekingTimeline = false;
let domSimTime, domActiveCount, domCompletedCount, domTotalDist;

async function init() {
  const resp = await fetch('data/city-routes.json');
  let rawRoutes = await resp.json();

  rawRoutes = rawRoutes.filter(r =>
    r.coordinates && r.coordinates.length >= 2 && r.distance > 0
  );

  rawRoutes.sort((a, b) => a.start_time - b.start_time);

  const firstDay = new Date(rawRoutes[0].start_time * 1000).toDateString();
  rawRoutes = rawRoutes.filter(r => {
    const endTime = r.end_time ?? (r.start_time + r.distance / FALLBACK_SPEED_MPS);
    return new Date(endTime * 1000).toDateString() === firstDay;
  });

  allRoutes = rawRoutes;

  for (let i = 0; i < allRoutes.length; i++) {
    const r = allRoutes[i];
    r.coordinates = simplifyRoute(r.coordinates, SIMPLIFY_TOLERANCE);
    r.fadingCoords = r.coordinates;
    r.duration = r.end_time
      ? r.end_time - r.start_time
      : r.distance / FALLBACK_SPEED_MPS;
    r.cumDist = buildCumulativeDistances(r.coordinates);
    r.totalDist = r.cumDist[r.cumDist.length - 1];
  }

  simStart = allRoutes[0].start_time;
  simEnd = Math.max(...allRoutes.map(r => r.start_time + r.duration));
  simTime = simStart;

  domSimTime = document.getElementById('sim-time');
  domActiveCount = document.getElementById('active-count');
  domCompletedCount = document.getElementById('completed-count');
  domTotalDist = document.getElementById('total-distance');
  domTimeSlider = document.getElementById('time-slider');

  document.getElementById('total-trips').textContent = allRoutes.length;
  const fmt = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('time-range').textContent =
    `${fmt(new Date(simStart * 1000))} – ${fmt(new Date(simEnd * 1000))}`;

  initMap();
}

function buildCumulativeDistances(coords) {
  const cumDist = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) {
    cumDist[i] = cumDist[i - 1] + haversine(
      coords[i - 1][1], coords[i - 1][0],
      coords[i][1], coords[i][0]
    );
  }
  return cumDist;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * 0.017453292519943295;
  const dLon = (lon2 - lon1) * 0.017453292519943295;
  const a = Math.sin(dLat * 0.5) ** 2 +
    Math.cos(lat1 * 0.017453292519943295) *
    Math.cos(lat2 * 0.017453292519943295) *
    Math.sin(dLon * 0.5) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Douglas-Peucker simplification
function simplifyRoute(coords, tolerance) {
  if (coords.length <= 2) return coords;

  let maxDist = 0;
  let maxIdx = 0;
  const start = coords[0];
  const end = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i++) {
    const d = pointToLineDist(coords[i], start, end);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > tolerance) {
    const left = simplifyRoute(coords.slice(0, maxIdx + 1), tolerance);
    const right = simplifyRoute(coords.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [start, end];
}

function pointToLineDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.sqrt((p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2);
}

function initMap() {
  // Compute center from data
  const lngs = allRoutes.map(r => r.coordinates[0][0]);
  const lats = allRoutes.map(r => r.coordinates[0][1]);
  const center = [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2
  ];

  mapboxgl.accessToken = MAPBOX_TOKEN;
  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center,
    zoom: 12,
    interactive: false,
  });

  map.on('load', () => {
    const fadeOpacities = [0.5, 0.25, 0.07];
    for (let i = 0; i < FADE_BUCKETS; i++) {
      map.addSource(`fading-${i}`, { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: `fading-layer-${i}`,
        type: 'line',
        source: `fading-${i}`,
        paint: { 'line-color': '#d4365c', 'line-width': 2, 'line-opacity': fadeOpacities[i] }
      });
    }

    map.addSource('active-routes', { type: 'geojson', data: emptyFC });
    map.addLayer({
      id: 'active-routes-layer',
      type: 'line',
      source: 'active-routes',
      paint: { 'line-color': '#e94560', 'line-width': 3, 'line-opacity': 0.9 }
    });

    map.addSource('bike-heads', { type: 'geojson', data: emptyFC });
    map.addLayer({
      id: 'bike-heads-layer',
      type: 'circle',
      source: 'bike-heads',
      paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-opacity': 0.9 }
    });

    map.addSource('final-routes', { type: 'geojson', data: emptyFC });
    map.addLayer({
      id: 'final-routes-layer',
      type: 'line',
      source: 'final-routes',
      paint: { 'line-color': '#e94560', 'line-width': 1.5, 'line-opacity': 0 }
    });

    mapReady = true;
    updateSidebar();
  });

  setupControls();
}

function setupControls() {
  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-reset').addEventListener('click', resetAll);

  const slider = document.getElementById('speed-slider');
  const speedLabel = document.getElementById('speed-label');
  const updateSpeed = () => {
    const mult = SPEED_STEPS[parseInt(slider.value)];
    speedMultiplier = mult; // sim-seconds per real-second
    speedLabel.textContent = mult + 'x';
  };
  slider.addEventListener('input', updateSpeed);
  updateSpeed();

  domTimeSlider.addEventListener('input', () => {
    isSeekingTimeline = true;
    seekTo(simStart + (parseInt(domTimeSlider.value) / 1000) * (simEnd - simStart));
  });
  domTimeSlider.addEventListener('change', () => { isSeekingTimeline = false; });

  const collapseBtn = document.getElementById('sidebar-collapse');
  const sidebar = document.getElementById('sidebar');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      collapseBtn.textContent = sidebar.classList.contains('collapsed') ? '▲' : '▼';
    });
  }
}

function seekTo(targetTime) {
  if (!mapReady) return;

  simTime = Math.max(simStart, Math.min(targetTime, simEnd));

  if (isFinalFadeIn) {
    isFinalFadeIn = false;
    map.setPaintProperty('final-routes-layer', 'line-opacity', 0);
    map.getSource('final-routes').setData(emptyFC);
  }

  activeTrips = [];
  fadingTrips = [];
  completedCount = 0;
  totalDistanceKm = 0;
  nextTripIdx = 0;

  for (let i = 0; i < allRoutes.length; i++) {
    const r = allRoutes[i];
    const tripEnd = r.start_time + r.duration;

    if (r.start_time > simTime) {
      nextTripIdx = i;
      break;
    }

    if (tripEnd <= simTime) {
      completedCount++;
      totalDistanceKm += r.distance / 1000;
    } else {
      activeTrips.push({ route: r, startedAt: r.start_time, duration: r.duration });
    }

    if (i === allRoutes.length - 1) nextTripIdx = allRoutes.length;
  }

  for (let b = 0; b < FADE_BUCKETS; b++) {
    map.getSource(`fading-${b}`).setData(emptyFC);
  }

  lastFrameTime = performance.now();
  renderFrame(performance.now());
  updateSidebar();
}

function togglePlay() {
  if (!mapReady) return;
  if (isPlaying) pause(); else play();
}

function play() {
  if (!mapReady) return;
  isPlaying = true;
  document.getElementById('btn-play').innerHTML = '&#9646;&#9646;';
  lastFrameTime = performance.now();
  animFrameId = requestAnimationFrame(animationLoop);
}

function pause() {
  isPlaying = false;
  document.getElementById('btn-play').innerHTML = '&#9654;';
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

function resetAll() {
  pause();
  seekTo(simStart);
  domTimeSlider.value = 0;
}

function renderFrame(now) {
  const activeFeatures = [];
  const headFeatures = [];
  let i = 0;

  while (i < activeTrips.length) {
    const trip = activeTrips[i];
    const progress = (simTime - trip.startedAt) / trip.duration;

    if (progress >= 1.0) {
      fadingTrips.push({ coordinates: trip.route.fadingCoords, finishedAtReal: now });
      completedCount++;
      totalDistanceKm += trip.route.distance / 1000;
      activeTrips[i] = activeTrips[activeTrips.length - 1];
      activeTrips.pop();
      continue;
    }

    const partialCoords = getPartialCoordinates(trip.route, progress * trip.route.totalDist);

    if (partialCoords.length >= 2) {
      activeFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: partialCoords } });
    }
    if (partialCoords.length >= 1) {
      headFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: partialCoords[partialCoords.length - 1] } });
    }

    i++;
  }

  // Distribute fading trips into discrete opacity buckets (MultiLineString per bucket)
  const bucketCoords = Array.from({ length: FADE_BUCKETS }, () => []);
  let fi = 0;
  while (fi < fadingTrips.length) {
    const ft = fadingTrips[fi];
    const age = (now - ft.finishedAtReal) / 1000;
    if (age >= FADE_DURATION) {
      fadingTrips[fi] = fadingTrips[fadingTrips.length - 1];
      fadingTrips.pop();
      continue;
    }
    bucketCoords[Math.min(FADE_BUCKETS - 1, Math.floor((age / FADE_DURATION) * FADE_BUCKETS))].push(ft.coordinates);
    fi++;
  }

  activeFC.features = activeFeatures;
  headsFC.features = headFeatures;
  map.getSource('active-routes').setData(activeFC);
  map.getSource('bike-heads').setData(headsFC);

  for (let b = 0; b < FADE_BUCKETS; b++) {
    const isEmpty = bucketCoords[b].length === 0;
    if (isEmpty && fadeBucketPrevEmpty[b]) continue;
    fadeBucketFCs[b].features[0].geometry.coordinates = bucketCoords[b];
    map.getSource(`fading-${b}`).setData(isEmpty ? emptyFC : fadeBucketFCs[b]);
    fadeBucketPrevEmpty[b] = isEmpty;
  }
}

function animationLoop(now) {
  if (!isPlaying) return;

  const dtReal = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  simTime += dtReal * speedMultiplier;

  if (nextTripIdx >= allRoutes.length && simTime > simEnd) simTime = simEnd;

  while (nextTripIdx < allRoutes.length && allRoutes[nextTripIdx].start_time <= simTime) {
    const route = allRoutes[nextTripIdx++];
    activeTrips.push({ route, startedAt: route.start_time, duration: route.duration });
  }

  renderFrame(now);

  if (!isSeekingTimeline) {
    domTimeSlider.value = Math.floor(Math.min(1000, ((simTime - simStart) / (simEnd - simStart)) * 1000));
  }

  if (now - lastSidebarUpdate > SIDEBAR_UPDATE_MS) {
    updateSidebar();
    lastSidebarUpdate = now;
  }

  if (nextTripIdx >= allRoutes.length && activeTrips.length === 0 && fadingTrips.length === 0) {
    simTime = simEnd;
    updateSidebar();
    pause();
    startFinalFadeIn();
    return;
  }

  animFrameId = requestAnimationFrame(animationLoop);
}

function startFinalFadeIn() {
  if (isFinalFadeIn || !mapReady) return;

  isFinalFadeIn = true;
  finalFadeStartTime = performance.now();

  map.getSource('active-routes').setData(emptyFC);
  map.getSource('bike-heads').setData(emptyFC);
  for (let b = 0; b < FADE_BUCKETS; b++) map.getSource(`fading-${b}`).setData(emptyFC);

  map.getSource('final-routes').setData({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: allRoutes.map(r => r.coordinates) } }]
  });

  map.moveLayer('final-routes-layer');
  map.setPaintProperty('final-routes-layer', 'line-opacity', 0);
  requestAnimationFrame(finalFadeInLoop);
}

function finalFadeInLoop(now) {
  if (!isFinalFadeIn || !mapReady) return;

  const progress = Math.min(1, (now - finalFadeStartTime) / 1000 / FINAL_FADE_DURATION);
  map.setPaintProperty('final-routes-layer', 'line-opacity', progress * 0.6);

  if (progress < 1) requestAnimationFrame(finalFadeInLoop);
}

// Binary search for the segment at targetDist, then interpolate
function getPartialCoordinates(route, targetDist) {
  const { coordinates, cumDist } = route;
  const n = coordinates.length;
  if (n === 0) return [];
  if (targetDist <= 0) return [coordinates[0]];
  if (targetDist >= cumDist[n - 1]) return coordinates;

  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumDist[mid] < targetDist) lo = mid + 1;
    else hi = mid;
  }

  const result = new Array(lo + 1);
  for (let i = 0; i < lo; i++) result[i] = coordinates[i];

  const segLen = cumDist[lo] - cumDist[lo - 1];
  if (segLen > 0) {
    const t = (targetDist - cumDist[lo - 1]) / segLen;
    result[lo] = [
      coordinates[lo - 1][0] + t * (coordinates[lo][0] - coordinates[lo - 1][0]),
      coordinates[lo - 1][1] + t * (coordinates[lo][1] - coordinates[lo - 1][1]),
    ];
  } else {
    result[lo] = coordinates[lo];
  }

  return result;
}

function updateSidebar() {
  domSimTime.textContent = new Date(simTime * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  domActiveCount.textContent = activeTrips.length;
  domCompletedCount.textContent = completedCount;
  domTotalDist.textContent = totalDistanceKm.toFixed(2) + ' km';
}

init();
