const SPEED_STEPS = [1, 1.5, 2, 3, 5, 8, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 300, 400, 500];

let trips = [];
let routes = [];
let completedFeatures = [];
let totalDistanceCovered = 0;
let currentTrip = 0;
let currentPoint = 0;
let isPlaying = false;
let animFrameId = null;
let lastFrameTime = 0;
let speedMultiplier = SPEED_STEPS[6]; // default: 10x (sim-seconds per real-second)
let bikeMarker = null;
let startMarker = null;
let endMarker = null;
let map = null;

function parseCSV(text) {
  const strip = s => s.replace(/^"|"$/g, '').trim();
  const lines = text.trim().split('\n').slice(1).filter(l => l.trim());
  return lines.map(line => {
    const v = line.split(',').map(strip);
    return {
      bike_name:  v[0],
      start_time: parseInt(v[1]),
      end_time:   parseInt(v[2]),
      start_lat:  parseFloat(v[3]),
      start_lng:  parseFloat(v[4]),
      end_lat:    parseFloat(v[5]),
      end_lng:    parseFloat(v[6]),
    };
  });
}

async function init() {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/dark-v11',
    center: [0, 0],
    zoom: 2
  });

  map.addControl(new mapboxgl.NavigationControl(), 'top-left');

  try {
    const text = await fetch('data/singlebike-trip.csv').then(r => r.text());
    trips = parseCSV(text);
    routes = new Array(trips.length).fill(null);
  } catch (err) {
    console.error('Failed to load trips.csv:', err);
    return;
  }

  map.on('load', () => {
    setupMapLayers();
    addStartMarkers();
    createBikeMarker();
    createEndpointMarkers();
    buildTripList();
    updateLegend();
    showCurrentTripEndpoints();

    const bounds = new mapboxgl.LngLatBounds();
    trips.forEach(t => {
      bounds.extend([t.start_lng, t.start_lat]);
      bounds.extend([t.end_lng, t.end_lat]);
    });
    map.fitBounds(bounds, { padding: 60, duration: 800 });
  });

  document.getElementById('btn-play').addEventListener('click', togglePlay);
  document.getElementById('btn-skip').addEventListener('click', skipTrip);
  document.getElementById('btn-reset').addEventListener('click', resetAll);

  const slider = document.getElementById('speed-slider');
  const updateSpeed = () => {
    const mult = SPEED_STEPS[parseInt(slider.value)];
    speedMultiplier = mult; // sim-seconds per real-second
    document.getElementById('speed-label').textContent = mult + 'x';
  };
  slider.addEventListener('input', updateSpeed);
  updateSpeed();
}

function setupMapLayers() {
  map.addSource('completed-routes', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  map.addLayer({
    id: 'completed-routes-layer',
    type: 'line',
    source: 'completed-routes',
    paint: { 'line-color': '#d4365c', 'line-width': 4, 'line-opacity': 0.7 }
  });

  map.addSource('current-route', {
    type: 'geojson',
    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
  });
  map.addLayer({
    id: 'current-route-layer',
    type: 'line',
    source: 'current-route',
    paint: { 'line-color': '#e94560', 'line-width': 5, 'line-opacity': 0.9 }
  });
}

function addStartMarkers() {
  trips.forEach((trip) => {
    const el = document.createElement('div');
    el.style.cssText = 'width:10px;height:10px;background:#e94560;border-radius:50%;border:2px solid #fff;opacity:0.6;';
    new mapboxgl.Marker({ element: el }).setLngLat([trip.start_lng, trip.start_lat]).addTo(map);
  });
}

function createBikeMarker() {
  const el = document.createElement('div');
  el.className = 'bike-marker';
  el.innerHTML = `<img src="assets/cycling-icon.png" style="
    width: 46px; height: 46px;
    border: 3px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 12px rgba(0,84,166,0.8), 0 0 24px rgba(0,84,166,0.4);
    animation: pulse 1.5s ease-in-out infinite;
    object-fit: cover;
  ">`;
  bikeMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
    .setLngLat([trips[0].start_lng, trips[0].start_lat])
    .addTo(map);
}

function createEndpointMarkers() {
  const startEl = document.createElement('div');
  startEl.innerHTML = `<div style="width:14px;height:14px;background:#00e676;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(0,230,118,0.6);"></div>`;
  startMarker = new mapboxgl.Marker({ element: startEl, anchor: 'center' })
    .setLngLat([trips[0].start_lng, trips[0].start_lat])
    .addTo(map);

  const endEl = document.createElement('div');
  endEl.innerHTML = `<div style="width:14px;height:14px;background:#ff1744;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px rgba(255,23,68,0.6);"></div>`;
  endMarker = new mapboxgl.Marker({ element: endEl, anchor: 'center' })
    .setLngLat([trips[0].end_lng, trips[0].end_lat])
    .addTo(map);
}

function showCurrentTripEndpoints() {
  if (currentTrip >= trips.length) return;
  const t = trips[currentTrip];
  startMarker.setLngLat([t.start_lng, t.start_lat]);
  endMarker.setLngLat([t.end_lng, t.end_lat]);
}

async function fetchRoute(tripIndex) {
  if (routes[tripIndex]) return routes[tripIndex];

  const t = trips[tripIndex];

  if (t.start_lat === t.end_lat && t.start_lng === t.end_lng) {
    const route = { coordinates: [[t.start_lng, t.start_lat]], distance: 0 };
    routes[tripIndex] = route;
    return route;
  }

  const url = `https://api.mapbox.com/directions/v5/mapbox/cycling/${t.start_lng},${t.start_lat};${t.end_lng},${t.end_lat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.routes && data.routes.length > 0) {
      const coords = data.routes[0].geometry.coordinates;
      const route = {
        coordinates: coords,
        distance: data.routes[0].distance,
        cumDist: buildCumulativeDistances(coords)
      };
      routes[tripIndex] = route;
      return route;
    }
  } catch (err) {
    console.error(`Route fetch failed for trip ${tripIndex + 1}:`, err);
  }

  // Fallback: straight line
  const fallbackCoords = [[t.start_lng, t.start_lat], [t.end_lng, t.end_lat]];
  const route = {
    coordinates: fallbackCoords,
    distance: haversine(t.start_lat, t.start_lng, t.end_lat, t.end_lng),
    cumDist: buildCumulativeDistances(fallbackCoords)
  };
  routes[tripIndex] = route;
  return route;
}

function buildCumulativeDistances(coords) {
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist.push(cumDist[i - 1] + haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  return cumDist;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function togglePlay() {
  if (isPlaying) pause(); else play();
}

async function play() {
  isPlaying = true;
  document.getElementById('btn-play').innerHTML = '&#9646;&#9646;';
  document.getElementById('trip-status').textContent = t('index.status_loading');
  await startTripAnimation();
}

function pause() {
  isPlaying = false;
  document.getElementById('btn-play').innerHTML = '&#9654;';
  document.getElementById('trip-status').textContent = t('index.status_paused');
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

async function startTripAnimation() {
  if (currentTrip >= trips.length) {
    pause();
    document.getElementById('trip-status').textContent = t('index.status_all_done');
    return;
  }

  document.getElementById('trip-status').textContent = t('index.status_loading');
  showCurrentTripEndpoints();

  const route = await fetchRoute(currentTrip);
  if (!isPlaying) return;

  currentPoint = 0;
  updateLegend();
  highlightTripInList(currentTrip);

  if (route.coordinates.length > 1) {
    const bounds = new mapboxgl.LngLatBounds();
    route.coordinates.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 100, duration: 800, maxZoom: 15 });
  }

  bikeMarker.setLngLat(route.coordinates[0]);
  document.getElementById('trip-status').textContent = t('index.status_in_progress');

  if (route.coordinates.length <= 1) {
    await new Promise(r => setTimeout(r, 500));
    if (!isPlaying) return;
    await finishCurrentTrip(route);
    return;
  }

  // Pre-fetch next route in background
  if (currentTrip + 1 < trips.length) fetchRoute(currentTrip + 1);

  // Trip duration in seconds (real data)
  const trip = trips[currentTrip];
  const tripDuration = Math.max(trip.end_time - trip.start_time, 1);

  await new Promise(r => setTimeout(r, 800));
  if (!isPlaying) return;

  lastFrameTime = performance.now();
  animateFrame(route, tripDuration);
}

// currentPoint = simulated seconds elapsed in current trip (same approach as city.js)
// tripDuration = real trip duration in seconds (from end_time - start_time)
function animateFrame(route, tripDuration) {
  if (!isPlaying) return;

  const totalDist = route.cumDist[route.cumDist.length - 1];

  animFrameId = requestAnimationFrame((now) => {
    const dt = now - lastFrameTime;
    lastFrameTime = now;
    const cappedDt = Math.min(dt, 100); // cap to avoid jumps when tab is inactive

    // Advance simulation time (identical to city.js)
    currentPoint += (cappedDt / 1000) * speedMultiplier;

    const progress = Math.min(1, currentPoint / tripDuration);
    const distAlongRoute = progress * totalDist;

    if (progress >= 1) {
      map.getSource('current-route').setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: route.coordinates }
      });
      bikeMarker.setLngLat(route.coordinates[route.coordinates.length - 1]);
      document.getElementById('progress-bar').style.width = '100%';
      finishCurrentTrip(route);
      return;
    }

    let idx = 0;
    for (let i = 1; i < route.cumDist.length; i++) {
      if (route.cumDist[i] > distAlongRoute) { idx = i - 1; break; }
    }

    const segLen = route.cumDist[idx + 1] - route.cumDist[idx];
    const frac = segLen > 0 ? (distAlongRoute - route.cumDist[idx]) / segLen : 0;
    const p1 = route.coordinates[idx];
    const p2 = route.coordinates[idx + 1];
    const lng = p1[0] + (p2[0] - p1[0]) * frac;
    const lat = p1[1] + (p2[1] - p1[1]) * frac;

    bikeMarker.setLngLat([lng, lat]);

    const trailCoords = route.coordinates.slice(0, idx + 1);
    trailCoords.push([lng, lat]);
    map.getSource('current-route').setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: trailCoords }
    });

    document.getElementById('progress-bar').style.width = (progress * 100) + '%';
    animateFrame(route, tripDuration);
  });
}

async function finishCurrentTrip(route) {
  if (route.coordinates.length > 1) {
    completedFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.coordinates }
    });
    map.getSource('completed-routes').setData({
      type: 'FeatureCollection', features: completedFeatures
    });
  }

  map.getSource('current-route').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] }
  });

  markTripCompleted(currentTrip);

  if (route.distance) {
    totalDistanceCovered += route.distance;
    document.getElementById('total-distance').textContent =
      (totalDistanceCovered / 1000).toFixed(2) + ' km';
  }

  currentTrip++;
  currentPoint = 0;
  document.getElementById('progress-bar').style.width = '0%';

  if (currentTrip >= trips.length) {
    pause();
    document.getElementById('trip-status').textContent = t('index.status_all_done');
    const allBounds = new mapboxgl.LngLatBounds();
    completedFeatures.forEach(f => f.geometry.coordinates.forEach(c => allBounds.extend(c)));
    map.fitBounds(allBounds, { padding: 60, duration: 2000 });
    return;
  }

  document.getElementById('trip-status').textContent = t('index.status_loading_next');
  await new Promise(r => setTimeout(r, 800));
  if (!isPlaying) return;
  await startTripAnimation();
}

async function skipTrip() {
  if (currentTrip >= trips.length) return;

  const wasPlaying = isPlaying;
  if (isPlaying) pause();

  const route = await fetchRoute(currentTrip);
  if (route.coordinates.length > 1) {
    completedFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.coordinates }
    });
    map.getSource('completed-routes').setData({
      type: 'FeatureCollection', features: completedFeatures
    });
  }

  map.getSource('current-route').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] }
  });

  markTripCompleted(currentTrip);
  if (route.distance) {
    totalDistanceCovered += route.distance;
    document.getElementById('total-distance').textContent =
      (totalDistanceCovered / 1000).toFixed(2) + ' km';
  }

  currentTrip++;
  currentPoint = 0;
  document.getElementById('progress-bar').style.width = '0%';

  if (currentTrip < trips.length) {
    const t = trips[currentTrip];
    bikeMarker.setLngLat([t.start_lng, t.start_lat]);
    showCurrentTripEndpoints();
    updateLegend();
    highlightTripInList(currentTrip);
  }

  if (wasPlaying && currentTrip < trips.length) play();
}

function resetAll() {
  pause();
  currentTrip = 0;
  currentPoint = 0;
  totalDistanceCovered = 0;

  document.getElementById('total-distance').textContent = '0.00 km';
  completedFeatures = [];
  map.getSource('completed-routes').setData({ type: 'FeatureCollection', features: [] });
  map.getSource('current-route').setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] }
  });

  bikeMarker.setLngLat([trips[0].start_lng, trips[0].start_lat]);
  showCurrentTripEndpoints();
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('trip-status').textContent = t('index.status_ready');
  updateLegend();
  resetTripList();

  map.flyTo({ center: [trips[0].start_lng, trips[0].start_lat], zoom: 12.5, duration: 1000 });
}

function updateLegend() {
  if (currentTrip >= trips.length) return;

  const t = trips[currentTrip];
  const route = routes[currentTrip];

  document.getElementById('trip-number').textContent = `${currentTrip + 1} / ${trips.length}`;
  document.getElementById('trip-time').textContent = new Date(t.start_time * 1000).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  document.getElementById('trip-distance').textContent = route
    ? (route.distance / 1000).toFixed(2) + ' km'
    : '-';
}

function buildTripList() {
  const ul = document.getElementById('trip-list-items');
  ul.innerHTML = '';
  trips.forEach((t, i) => {
    const li = document.createElement('li');
    const time = new Date(t.start_time * 1000).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit'
    });
    li.innerHTML = `<span class="trip-idx">#${i + 1}</span><span>${time}</span>`;
    li.dataset.index = i;
    ul.appendChild(li);
  });
  highlightTripInList(0);
}

function highlightTripInList(index) {
  const items = document.querySelectorAll('#trip-list-items li');
  items.forEach(li => li.classList.remove('active'));
  if (items[index]) {
    items[index].classList.add('active');
    items[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function markTripCompleted(index) {
  const items = document.querySelectorAll('#trip-list-items li');
  if (items[index]) {
    items[index].classList.remove('active');
    items[index].classList.add('completed');
  }
}

function resetTripList() {
  document.querySelectorAll('#trip-list-items li').forEach(li => {
    li.classList.remove('active', 'completed');
  });
  highlightTripInList(0);
}

init();
