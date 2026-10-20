import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, esc, icon, toast, fmtDistance, fmtCountdown, fmtRelative } from '../ui.js';
import { openDelaySheet } from '../components/delay-sheet.js';
import { navigate } from '../router.js';

let appEl = null;
let trip = null;
let map = null;
let truckMarker = null;
let routeLine = null;
let trailLine = null;
let tickTimer = null;
let geoWatchId = null;
let useDeviceGps = false;

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: refreshQuiet, refresh: load };
}

export function destroy() {
  teardownMap();
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  stopDeviceGps();
  appEl = null;
  trip = null;
}

function teardownMap() {
  if (map) { map.remove(); map = null; }
  truckMarker = null; routeLine = null; trailLine = null;
}

function stopDeviceGps() {
  if (geoWatchId != null) { navigator.geolocation?.clearWatch(geoWatchId); geoWatchId = null; }
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    trip = await api.getActiveTrip();
    if (!appEl) return;
    if (!trip || trip.stage !== 'transit') {
      teardownMap();
      appEl.innerHTML = emptyState({ message: trip ? 'This trip is not in transit yet.' : 'No trip is currently in transit.' });
      return;
    }
    renderShell();
    initMap();
    startTicking();
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || !trip) return;
  try { await tick(); } catch (e) { /* silent */ }
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Live map</h1><p class="page-subtitle">${esc(trip.id)} — ${esc(trip.fromName)} &rarr; ${esc(trip.toName)}</p></div></div>
    <div id="near-banner"></div>
    <div class="map-wrap map-wrap-lg"><div id="trip-map" style="height:100%"></div></div>
    <div class="gps-sheet">
      <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
        <span class="gps-pulse ${trip.transit.gpsActive ? 'active' : 'paused'}" id="gps-pulse"><span class="dot"></span>${trip.transit.gpsActive ? 'GPS active' : 'GPS paused'}</span>
        <button type="button" class="btn btn-ghost btn-icon" id="gps-toggle-btn" aria-label="Toggle GPS">${icon(trip.transit.gpsActive ? 'pause' : 'play', 18)}</button>
      </div>
      <div class="stat-grid" style="margin-block-end:var(--s4)">
        <div class="kpi-tile"><div class="kpi-label">Distance left</div><div class="kpi-value fs-lg" id="stat-distance">${fmtDistance(trip.transit.distanceRemainingKm)}</div></div>
        <div class="kpi-tile"><div class="kpi-label">ETA</div><div class="kpi-value fs-lg" id="stat-eta">${fmtCountdown(trip.transit.etaAt)}</div></div>
        <div class="kpi-tile"><div class="kpi-label">Speed</div><div class="kpi-value fs-lg" id="stat-speed">${trip.transit.speedKmh} km/h</div></div>
        <div class="kpi-tile"><div class="kpi-label">Last update</div><div class="kpi-value fs-lg" id="stat-updated">${fmtRelative(trip.transit.lastPingAt)}</div></div>
      </div>
      <div class="row gap-2 wrap" style="margin-block-end:var(--s3)">
        <a class="btn btn-secondary" id="open-google-maps" target="_blank" rel="noopener" href="#">${icon('map', 16)} Open in Google Maps</a>
        <button type="button" class="btn btn-secondary" data-action="report-delay">${icon('clock-alert', 16)} Report delay</button>
        <label class="checkbox-row" style="margin:0;min-height:auto">
          <input type="checkbox" id="device-gps-toggle" />
          Use device GPS
        </label>
      </div>
      <button type="button" class="btn btn-primary btn-lg btn-block" id="arrived-btn" disabled>${icon('map-pin', 20)} I have arrived</button>
    </div>`;

  appEl.querySelector('#gps-toggle-btn').addEventListener('click', async () => {
    try {
      const res = await api.setGpsPaused(trip.id, trip.transit.gpsActive);
      trip.transit.gpsActive = res.gpsActive;
      updatePulse();
    } catch (e) { toast(e.message, 'error'); }
  });
  appEl.querySelector('[data-action="report-delay"]').addEventListener('click', () => openDelaySheet(trip.id, { onDone: () => tick() }));
  appEl.querySelector('#device-gps-toggle').addEventListener('change', (e) => {
    useDeviceGps = e.target.checked;
    if (useDeviceGps) startDeviceGps(); else stopDeviceGps();
  });
  appEl.querySelector('#arrived-btn').addEventListener('click', () => navigate(`#/trip/${trip.id}/arrive`));
  updateGoogleMapsLink();
}

function updateGoogleMapsLink() {
  const a = appEl?.querySelector('#open-google-maps');
  if (!a || !trip.transit.position) return;
  const [lat, lng] = trip.transit.position;
  a.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function updatePulse() {
  const pulse = appEl?.querySelector('#gps-pulse');
  const btn = appEl?.querySelector('#gps-toggle-btn');
  if (pulse) { pulse.className = `gps-pulse ${trip.transit.gpsActive ? 'active' : 'paused'}`; pulse.innerHTML = `<span class="dot"></span>${trip.transit.gpsActive ? 'GPS active' : 'GPS paused'}`; }
  if (btn) btn.innerHTML = icon(trip.transit.gpsActive ? 'pause' : 'play', 18);
}

function buildTruckIcon() {
  return window.L.divIcon({ className: `truck-marker ${trip.transit.speedKmh === 0 && trip.transit.distanceRemainingKm > 0.5 ? 'delayed' : ''}`, iconSize: [18, 18], iconAnchor: [9, 9] });
}

function initMap() {
  teardownMap();
  const el = appEl.querySelector('#trip-map');
  if (!el || !window.L) return;
  map = window.L.map(el, { scrollWheelZoom: true });
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
  window.L.marker(trip.fromPosition, { icon: window.L.divIcon({ className: 'place-marker', iconSize: [12, 12] }) }).addTo(map).bindTooltip(trip.fromName);
  window.L.marker(trip.toPosition, { icon: window.L.divIcon({ className: 'place-marker', iconSize: [12, 12] }) }).addTo(map).bindTooltip(trip.toName);
  routeLine = window.L.polyline([trip.fromPosition, trip.toPosition], { color: '#94A3B8', weight: 2, dashArray: '6 6' }).addTo(map);
  trailLine = window.L.polyline(trip.transit.trail, { color: '#7C3AED', weight: 3 }).addTo(map);
  truckMarker = window.L.marker(trip.transit.position, { icon: buildTruckIcon() }).addTo(map);
  map.fitBounds(window.L.latLngBounds([trip.fromPosition, trip.toPosition]), { padding: [40, 40] });
}

function updateNearBanner() {
  const root = appEl?.querySelector('#near-banner');
  if (!root) return;
  const near = trip.transit.distanceRemainingKm <= 3;
  root.innerHTML = near ? `<div class="stage-banner accent">${icon('map-pin', 20)} Approaching destination — ${fmtDistance(trip.transit.distanceRemainingKm)} left.</div>` : '';
  const arrivedBtn = appEl?.querySelector('#arrived-btn');
  if (arrivedBtn) arrivedBtn.disabled = false; // driver may confirm arrival whenever physically there
}

async function tick() {
  if (!trip) return;
  const res = await api.gpsTick(trip.id);
  trip.transit = { ...trip.transit, ...res };
  if (truckMarker) { truckMarker.setLatLng(res.position); truckMarker.setIcon(buildTruckIcon()); }
  if (trailLine) trailLine.setLatLngs(res.trail);
  const distEl = appEl?.querySelector('#stat-distance');
  const etaEl = appEl?.querySelector('#stat-eta');
  const speedEl = appEl?.querySelector('#stat-speed');
  const updatedEl = appEl?.querySelector('#stat-updated');
  if (distEl) distEl.textContent = fmtDistance(res.distanceRemainingKm);
  if (etaEl) etaEl.textContent = fmtCountdown(res.etaAt);
  if (speedEl) speedEl.textContent = `${res.speedKmh} km/h`;
  if (updatedEl) updatedEl.textContent = fmtRelative(res.lastPingAt);
  updateGoogleMapsLink();
  updateNearBanner();
  updatePulse();
}

function startTicking() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, 10000);
  tick();
  updateNearBanner();
}

function startDeviceGps() {
  if (!navigator.geolocation) { toast('Device GPS is not available in this browser.', 'error'); return; }
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!truckMarker) return;
      const ll = [pos.coords.latitude, pos.coords.longitude];
      truckMarker.setLatLng(ll);
    },
    () => { toast('Could not access device GPS — check permissions.', 'error'); useDeviceGps = false; const cb = appEl?.querySelector('#device-gps-toggle'); if (cb) cb.checked = false; },
    { enableHighAccuracy: true },
  );
}
