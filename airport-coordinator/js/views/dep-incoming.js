import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, fmtCountdown, countdownClass,
  skeletonBlock, emptyState, errorState, openModal, openDrawer,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, countdownChip } from '../components/status-chip.js';

// Both seeded airports (JED, MED) happen to name their off-airport bays
// OFF-1..OFF-6 (see seed.js buildAirports()), and there is no dedicated
// "get my airport's bays" API call yet, so the full list is hardcoded here
// rather than adding a new endpoint for a one-screen demo need.
const BAYS = ['OFF-1', 'OFF-2', 'OFF-3', 'OFF-4', 'OFF-5', 'OFF-6'];

let appEl = null;
let map = null;
let markers = {};
let table = null;
let currentTrips = [];

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: pollTick, refresh: load };
}

/** Tears down the Leaflet map instance and clears view state. */
export function destroy() {
  teardownMap();
  table?.destroy();
  table = null;
  appEl = null;
}

function teardownMap() {
  if (map) { map.remove(); map = null; }
  markers = {};
}

function pollTick() {
  refreshQuiet();
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell() + skeletonBlock(6);
  try {
    const trips = await api.getIncoming();
    if (!appEl) return;
    renderData(trips);
  } catch (err) {
    if (!appEl) return;
    teardownMap();
    table?.destroy();
    table = null;
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl) return;
  try {
    const trips = await api.getIncoming();
    if (!appEl) return;
    if (!trips.length || !map || !table) { renderData(trips); return; }
    currentTrips = trips;
    updateMapInPlace(trips);
    table.setRows(trips);
    renderMissedCutoffBanner(trips);
  } catch (e) { /* silent background refresh */ }
}

function pageShell() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Incoming trucks</h1>
        <p class="page-subtitle">Departure trucks heading to, or already at, the gate.</p>
      </div>
    </div>`;
}

function renderData(trips) {
  currentTrips = trips;
  if (!trips.length) {
    teardownMap();
    table?.destroy();
    table = null;
    appEl.innerHTML = pageShell() + emptyState({ message: 'No trucks currently en route or at the gate.' });
    return;
  }
  appEl.innerHTML = `
    ${pageShell()}
    <div id="cutoff-banner-root"></div>
    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Live map</h2>
      <div class="map-wrap"><div id="truck-map"></div></div>
    </div>
    <div class="card">
      <h2 class="section-title">Trips</h2>
      <div id="incoming-table-root"></div>
    </div>`;
  renderMissedCutoffBanner(trips);
  initMap(trips);
  initTable(trips);
}

/* ===================== Missed cut-off banner ===================== */

function isNearingCutoff(trip) {
  return trip.status === 'En route' && (new Date(trip.eta).getTime() - Date.now()) < 15 * 60000;
}

function renderMissedCutoffBanner(trips) {
  const root = appEl?.querySelector('#cutoff-banner-root');
  if (!root) return;
  const atRisk = trips.filter(isNearingCutoff);
  if (!atRisk.length) { root.innerHTML = ''; return; }
  root.innerHTML = `<div class="stack gap-2" style="margin-block-end:var(--s5)">${atRisk.map((t) => `
    <div class="row" role="alert" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3);background:var(--danger-soft);color:var(--danger);padding:var(--s4);border-radius:var(--r-lg)">
      <span class="row gap-2 fw-medium">${icon('alert-triangle', 18)} ${esc(t.code)} will miss its cut-off &mdash; ETA ${esc(fmtCountdown(t.eta))} (flight ${esc(t.flightCode)}).</span>
      <button type="button" class="btn btn-danger" data-action="raise-cutoff" data-id="${esc(t.id)}">Raise missed cut-off</button>
    </div>`).join('')}</div>`;
  root.querySelectorAll('[data-action="raise-cutoff"]').forEach((btn) => btn.addEventListener('click', () => onRaiseCutoff(btn)));
}

async function onRaiseCutoff(btn) {
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.raiseMissedCutoff(btn.dataset.id);
    toast('Missed cut-off exception raised.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

/* ===================== Map ===================== */

function isAtRisk(trip) {
  if (trip.status === 'Security Hold') return true;
  return trip.status === 'En route' && new Date(trip.eta).getTime() < Date.now();
}

function buildIcon(atRisk) {
  return window.L.divIcon({
    className: `truck-marker ${atRisk ? 'delayed' : 'ontime'}`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function popupHtml(trip) {
  return `
    <div class="fs-sm" style="margin-block-end:var(--s2)">
      <strong class="mono">${esc(trip.code)}</strong> &middot; ${esc(trip.truckPlate)}<br>
      Flight ${esc(trip.flightCode)}<br>
      ETA ${esc(fmtCountdown(trip.eta))}<br>
      ${statusChip(trip.status)}
    </div>
    <div class="row gap-2 wrap">
      ${!trip.bay ? `<button type="button" class="btn btn-secondary" data-action="pre-assign" data-id="${esc(trip.id)}">Pre-assign bay</button>` : ''}
      <button type="button" class="btn btn-ghost" data-action="view-manifest" data-id="${esc(trip.id)}">View manifest</button>
    </div>`;
}

function addMarker(trip) {
  const marker = window.L.marker(trip.position, { icon: buildIcon(isAtRisk(trip)) }).addTo(map);
  marker.bindPopup(popupHtml(trip));
  markers[trip.id] = marker;
}

function bindPopupButtons(popup) {
  const el = popup?.getElement();
  if (!el) return;
  const preAssignBtn = el.querySelector('[data-action="pre-assign"]');
  if (preAssignBtn && !preAssignBtn.dataset.bound) {
    preAssignBtn.dataset.bound = '1';
    preAssignBtn.addEventListener('click', () => openPreAssignBayModal(preAssignBtn.dataset.id));
  }
  const manifestBtn = el.querySelector('[data-action="view-manifest"]');
  if (manifestBtn && !manifestBtn.dataset.bound) {
    manifestBtn.dataset.bound = '1';
    manifestBtn.addEventListener('click', () => openManifestDrawer(manifestBtn.dataset.id));
  }
}

function onPopupOpen(e) {
  bindPopupButtons(e.popup);
}

function fitToMarkers(trips) {
  if (!map || !trips.length) return;
  const bounds = window.L.latLngBounds(trips.map((t) => t.position));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
}

function initMap(trips) {
  teardownMap();
  const el = appEl.querySelector('#truck-map');
  if (!el || !window.L) return;
  map = window.L.map(el, { scrollWheelZoom: true });
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);
  trips.forEach((t) => addMarker(t));
  fitToMarkers(trips);
  map.on('popupopen', onPopupOpen);
}

function updateMapInPlace(trips) {
  if (!map) return;
  const seen = new Set();
  trips.forEach((t) => {
    seen.add(t.id);
    const existing = markers[t.id];
    if (existing) {
      existing.setLatLng(t.position);
      existing.setIcon(buildIcon(isAtRisk(t)));
      existing.setPopupContent(popupHtml(t));
      // setPopupContent() doesn't re-fire 'popupopen' on an already-open popup,
      // so the freshly-inserted buttons need their listeners bound directly here too.
      const popup = existing.getPopup();
      if (popup) bindPopupButtons(popup);
    } else {
      addMarker(t);
    }
  });
  Object.keys(markers).forEach((id) => {
    if (!seen.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
  });
}

/* ===================== Table ===================== */

function initTable(trips) {
  const root = appEl.querySelector('#incoming-table-root');
  table = createDataTable(root, {
    rows: trips,
    searchKeys: ['code', 'truckPlate', 'flightCode', 'status', 'bay'],
    getRowId: (t) => t.id,
    csvFilename: 'incoming-trucks',
    emptyMessage: 'No matching trips.',
    columns: [
      { key: 'code', label: 'Trip code', sortable: true, render: (t) => `<span class="mono">${esc(t.code)}</span>` },
      { key: 'truckPlate', label: 'Truck plate', sortable: true, render: (t) => esc(t.truckPlate) },
      { key: 'flightCode', label: 'Flight', sortable: true, render: (t) => esc(t.flightCode) },
      {
        key: 'eta', label: 'ETA', sortable: true,
        render: (t) => `<span title="${esc(fmtDateTime(t.eta))}">${countdownChip(fmtCountdown(t.eta), countdownClass(t.eta))}</span>`,
        csvValue: (t) => t.eta,
      },
      { key: 'status', label: 'Status', sortable: true, render: (t) => statusChip(t.status), csvValue: (t) => t.status },
      { key: 'bay', label: 'Bay', sortable: true, render: (t) => esc(t.bay || '—'), csvValue: (t) => t.bay || '' },
      {
        key: 'actions',
        label: 'Actions',
        render: (t) => `
          <div class="row gap-2 wrap">
            ${!t.bay ? `<button type="button" class="btn btn-secondary" data-action="pre-assign" data-id="${esc(t.id)}">Pre-assign bay</button>` : ''}
            <button type="button" class="btn btn-ghost" data-action="view-manifest" data-id="${esc(t.id)}">View manifest</button>
            <button type="button" class="btn btn-ghost" data-action="call-driver" data-id="${esc(t.id)}">${icon('phone', 14)} Call driver</button>
          </div>`,
      },
    ],
  });
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'pre-assign') openPreAssignBayModal(btn.dataset.id);
    else if (btn.dataset.action === 'view-manifest') openManifestDrawer(btn.dataset.id);
    else if (btn.dataset.action === 'call-driver') onCallDriver(btn.dataset.id);
  });
}

function onCallDriver(tripId) {
  const trip = currentTrips.find((t) => t.id === tripId);
  if (!trip) return;
  toast(`Call ${trip.driverName}: ${trip.driverPhone}`, 'info');
}

/* ===================== Pre-assign bay modal ===================== */

function openPreAssignBayModal(tripId) {
  const close = openModal({
    title: 'Pre-assign bay',
    bodyHtml: `<div class="pos-grid" id="pre-assign-bay-grid">
      ${BAYS.map((bay) => `
        <button type="button" class="pos-card" data-bay="${esc(bay)}">
          ${icon('warehouse', 24)}
          <div class="fs-sm fw-medium" style="margin-block-start:var(--s2)">${esc(bay)}</div>
        </button>`).join('')}
    </div>`,
  });
  const grid = document.getElementById('pre-assign-bay-grid');
  grid.querySelectorAll('[data-bay]').forEach((btn) => btn.addEventListener('click', async () => {
    grid.querySelectorAll('[data-bay]').forEach((b) => { b.disabled = true; });
    btn.classList.add('selected');
    try {
      await api.preAssignBay(tripId, btn.dataset.bay);
      toast(`${btn.dataset.bay} pre-assigned.`, 'success');
      close();
      load();
    } catch (err) {
      grid.querySelectorAll('[data-bay]').forEach((b) => { b.disabled = false; });
      btn.classList.remove('selected');
      toast(err.message, 'error');
    }
  }));
}

/* ===================== Manifest drawer ===================== */

function manifestListHtml(bags) {
  return `
    <div class="stack gap-2">
      ${bags.map((b) => `
        <div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
          <span class="fs-sm"><strong class="mono">${esc(b.tagNumber)}</strong> &middot; ${esc(b.pilgrimName)}</span>
          ${statusChip(b.status)}
        </div>`).join('')}
    </div>`;
}

function openManifestDrawer(tripId) {
  const trip = currentTrips.find((t) => t.id === tripId);
  const drawer = openDrawer({
    title: trip ? `${trip.code} — manifest` : 'Manifest',
    bodyHtml: `<div id="manifest-body">${skeletonBlock(4)}</div>`,
  });
  const body = drawer.el.querySelector('#manifest-body');

  async function loadManifest() {
    body.innerHTML = skeletonBlock(4);
    try {
      const bags = await api.getTripManifest(tripId);
      body.innerHTML = bags.length ? manifestListHtml(bags) : emptyState({ message: 'No bags on this trip yet.' });
    } catch (err) {
      body.innerHTML = errorState({ message: err.message });
      body.querySelector('[data-action="retry"]')?.addEventListener('click', loadManifest);
    }
  }

  loadManifest();
}
