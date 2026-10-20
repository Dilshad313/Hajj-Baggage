import * as api from '../api.js';
import {
  skeletonBlock, errorState, emptyState, toast, openDrawer,
  fmtDateTime, fmtRelative, fmtCountdown, esc, icon,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';
import { REROUTE_DESTINATIONS } from '../api.js';

let appEl = null;
let map = null;
let markers = {};
let table = null;
let lastUpdated = null;

const CONTACT_LABELS = {
  call: 'Called driver',
  message: 'Message sent',
  'eta-update': 'ETA updated',
  reroute: 'Rerouted',
};

/**
 * Renders the Trucks view: a live map and list of active trips, with a
 * detail drawer for contacting the driver, updating the ETA and rerouting.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:Function, poll:Function, refresh:Function}}
 */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: pollTick, refresh: load };
}

/** Tears down the Leaflet map instance and clears view state. */
export function destroy() {
  teardownMap();
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
    const trips = await api.getTrucks();
    lastUpdated = new Date().toISOString();
    renderData(trips);
  } catch (err) {
    teardownMap();
    table = null;
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl) return;
  try {
    const trips = await api.getTrucks();
    lastUpdated = new Date().toISOString();
    updateLastUpdatedText();
    if (!map || !table) { renderData(trips); return; }
    updateMapInPlace(trips);
    table.setRows(trips);
  } catch (e) { /* silent background refresh */ }
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Trucks</h1><p class="page-subtitle">Live positions, delays and delivery ETAs for active trips.</p></div>
      <div class="last-updated"><span id="last-updated-text">${lastUpdated ? `Updated ${fmtRelative(lastUpdated)}` : ''}</span></div>
    </div>`;
}

function updateLastUpdatedText() {
  const el = appEl?.querySelector('#last-updated-text');
  if (el) el.textContent = lastUpdated ? `Updated ${fmtRelative(lastUpdated)}` : '';
}

function renderData(trips) {
  if (!trips.length) {
    teardownMap();
    table = null;
    appEl.innerHTML = pageShell() + emptyState({ message: 'No active trips right now.' });
    return;
  }
  appEl.innerHTML = `
    ${pageShell()}
    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Live map</h2>
      <div class="map-wrap"><div id="truck-map"></div></div>
    </div>
    <div class="card">
      <h2 class="section-title">Active trips</h2>
      <div id="trucks-table-root"></div>
    </div>`;
  initMap(trips);
  initTable(trips);
}

/* ===================== Map ===================== */

function buildIcon(delayed) {
  return window.L.divIcon({
    className: `truck-marker ${delayed ? 'delayed' : 'ontime'}`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function popupHtml(trip) {
  return `
    <div class="fs-sm" style="margin-block-end:var(--s2)">
      <strong>${esc(trip.driver)}</strong> — <span class="mono">${esc(trip.id)}</span><br>
      ${esc(trip.fromName)} &rarr; ${esc(trip.toName)}<br>
      ${trip.bags} bags &middot; ETA ${esc(fmtCountdown(trip.etaAt))}<br>
      ${statusChip(trip.delayed ? 'Delayed' : 'On time')}
    </div>
    <button type="button" class="btn btn-secondary" data-action="open-trip" data-id="${esc(trip.id)}">View details</button>`;
}

function addMarker(trip) {
  const marker = window.L.marker(trip.position, { icon: buildIcon(trip.delayed) }).addTo(map);
  marker.bindPopup(popupHtml(trip));
  markers[trip.id] = marker;
}

function bindPopupButton(popup) {
  const btn = popup.getElement()?.querySelector('[data-action="open-trip"]');
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => openDetailDrawer(btn.dataset.id));
  }
}

function onPopupOpen(e) {
  bindPopupButton(e.popup);
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
      existing.setIcon(buildIcon(t.delayed));
      existing.setPopupContent(popupHtml(t));
      // setPopupContent() doesn't re-fire 'popupopen' on an already-open popup,
      // so the freshly-inserted button needs its listener bound directly here too.
      const popup = existing.getPopup();
      if (popup) bindPopupButton(popup);
    } else {
      addMarker(t);
    }
  });
  Object.keys(markers).forEach((id) => {
    if (!seen.has(id)) { map.removeLayer(markers[id]); delete markers[id]; }
  });
}

/* ===================== Table ===================== */

function etaCell(trip) {
  const overdue = new Date(trip.etaAt).getTime() < Date.now();
  return `<span class="${overdue ? 'sla-red' : ''}" title="${esc(fmtDateTime(trip.etaAt))}">${esc(fmtCountdown(trip.etaAt))}</span>`;
}

function initTable(trips) {
  const root = appEl.querySelector('#trucks-table-root');
  table = createDataTable(root, {
    rows: trips,
    searchKeys: ['id', 'driver', 'fromName', 'toName'],
    getRowId: (t) => t.id,
    csvFilename: 'trucks',
    emptyMessage: 'No active trips match this search.',
    onRowClick: (row) => openDetailDrawer(row.id),
    columns: [
      { key: 'id', label: 'Trip', sortable: true, render: (t) => `<span class="mono">${esc(t.id)}</span>` },
      { key: 'driver', label: 'Driver', sortable: true },
      { key: 'route', label: 'From → To', render: (t) => `${esc(t.fromName)} &rarr; ${esc(t.toName)}`, csvValue: (t) => `${t.fromName} -> ${t.toName}` },
      { key: 'bags', label: 'Bags', sortable: true },
      { key: 'etaAt', label: 'ETA', sortable: true, render: etaCell, csvValue: (t) => t.etaAt },
      { key: 'delayed', label: 'Status', sortable: true, render: (t) => statusChip(t.delayed ? 'Delayed' : 'On time'), csvValue: (t) => (t.delayed ? 'Delayed' : 'On time') },
    ],
  });
}

/* ===================== Detail drawer ===================== */

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function openDetailDrawer(id) {
  let trip;
  try {
    trip = await api.getTruck(id);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const drawer = openDrawer({
    title: `${trip.id} — ${trip.driver}`,
    bodyHtml: `<div id="truck-detail-body"></div>`,
    large: true,
  });

  function renderBody() {
    const body = drawer.el.querySelector('#truck-detail-body');
    body.innerHTML = `
      <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
        ${statusChip(trip.delayed ? 'Delayed' : 'On time')}
      </div>
      <div class="grid grid-cols-2 fs-sm" style="margin-block-end:var(--s4)">
        <div><span class="muted">Route</span><br><strong>${esc(trip.fromName)} &rarr; ${esc(trip.toName)}</strong></div>
        <div><span class="muted">Bags</span><br><strong>${trip.bags}</strong></div>
        <div><span class="muted">ETA</span><br><strong title="${esc(fmtDateTime(trip.etaAt))}">${esc(fmtCountdown(trip.etaAt))}</strong></div>
        <div><span class="muted">Driver</span><br><strong>${esc(trip.driver)}</strong></div>
      </div>
      ${trip.delayed && trip.delayReason ? `<p class="fs-sm sla-red" style="margin-block-end:var(--s4)">${icon('alert-triangle', 14)} ${esc(trip.delayReason)}</p>` : ''}

      <div class="card" style="margin-block-end:var(--s4)">
        <h2 class="section-title">Contact driver</h2>
        <button type="button" class="btn btn-secondary" data-act="call-driver">${icon('phone', 16)} Call driver</button>
        <div class="field" style="margin-block-start:var(--s3)">
          <label for="t-message">Message</label>
          <textarea id="t-message" placeholder="Message to driver" minlength="1" maxlength="500"></textarea>
          <div class="error" id="err-t-message" hidden></div>
        </div>
        <button type="button" class="btn btn-primary" data-act="send-message">${icon('send', 16)} Send message</button>
      </div>

      <div class="card" style="margin-block-end:var(--s4)">
        <h2 class="section-title">Update ETA</h2>
        <div class="row gap-2 wrap" style="align-items:flex-end">
          <div class="field" style="margin:0;min-width:200px">
            <label for="t-eta">New ETA <span class="req">*</span></label>
            <input id="t-eta" type="datetime-local" value="${toLocalInputValue(new Date(Date.now() + 30 * 60000))}" />
          </div>
          <div class="field" style="margin:0;min-width:200px;flex:1">
            <label for="t-eta-reason">Reason <span class="req">*</span></label>
            <input id="t-eta-reason" placeholder="Reason for ETA change" />
          </div>
          <button type="button" class="btn btn-primary" data-act="update-eta">Update ETA</button>
        </div>
        <div class="error" id="err-t-eta" hidden style="margin-block-start:var(--s2)"></div>
      </div>

      <div class="card" style="margin-block-end:var(--s4)">
        <h2 class="section-title">Reroute</h2>
        <div class="row gap-2 wrap" style="align-items:flex-end">
          <div class="field" style="margin:0;min-width:200px">
            <label for="t-dest">Destination</label>
            <select id="t-dest">${REROUTE_DESTINATIONS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}</select>
          </div>
          <div class="field" style="margin:0;min-width:200px;flex:1">
            <label for="t-reroute-reason">Reason <span class="req">*</span></label>
            <input id="t-reroute-reason" placeholder="Reason for reroute" />
          </div>
          <button type="button" class="btn btn-secondary" data-act="reroute">${icon('route', 16)} Reroute</button>
        </div>
        <div class="error" id="err-t-reroute" hidden style="margin-block-start:var(--s2)"></div>
      </div>

      <div class="card">
        <h2 class="section-title">Contact log</h2>
        <div class="stack gap-3">
          ${trip.contactLog.length ? trip.contactLog.map((c) => `
            <div style="border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
              <div class="fs-sm">${esc(CONTACT_LABELS[c.type] || c.type)}${c.message ? `: ${esc(c.message)}` : ''}</div>
              <div class="fs-xs muted" title="${esc(fmtDateTime(c.time))}">${fmtRelative(c.time)}</div>
            </div>`).join('') : `<p class="muted fs-sm">No contact yet.</p>`}
        </div>
      </div>`;
    wireActions();
  }

  function setErr(fieldId, msg) {
    const el = drawer.el.querySelector(`#err-${fieldId}`);
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; } else el.hidden = true;
  }

  async function refetchAndRender() {
    trip = await api.getTruck(trip.id);
    renderBody();
  }

  function wireActions() {
    drawer.el.querySelector('[data-act="call-driver"]')?.addEventListener('click', async () => {
      try {
        await api.contactDriver(trip.id, { type: 'call' });
        toast('Driver called.', 'success');
        await refetchAndRender();
        refreshQuiet();
      } catch (err) { toast(err.message, 'error'); }
    });

    drawer.el.querySelector('[data-act="send-message"]')?.addEventListener('click', async () => {
      const message = drawer.el.querySelector('#t-message').value.trim();
      if (!message) { setErr('t-message', 'Message is required.'); return; }
      setErr('t-message', '');
      try {
        await api.contactDriver(trip.id, { type: 'message', message });
        toast('Message sent to driver.', 'success');
        await refetchAndRender();
        refreshQuiet();
      } catch (err) { toast(err.message, 'error'); }
    });

    drawer.el.querySelector('[data-act="update-eta"]')?.addEventListener('click', async () => {
      const etaRaw = drawer.el.querySelector('#t-eta').value;
      const reason = drawer.el.querySelector('#t-eta-reason').value.trim();
      if (!etaRaw) { setErr('t-eta', 'New ETA is required.'); return; }
      const etaAt = new Date(etaRaw).toISOString();
      if (new Date(etaAt).getTime() <= Date.now()) { setErr('t-eta', 'New ETA must be in the future.'); return; }
      if (!reason) { setErr('t-eta', 'Reason is required.'); return; }
      setErr('t-eta', '');
      try {
        await api.updateEta(trip.id, { etaAt, reason });
        toast('ETA updated.', 'success');
        await refetchAndRender();
        refreshQuiet();
      } catch (err) { toast(err.message, 'error'); }
    });

    drawer.el.querySelector('[data-act="reroute"]')?.addEventListener('click', async () => {
      const destination = drawer.el.querySelector('#t-dest').value;
      const reason = drawer.el.querySelector('#t-reroute-reason').value.trim();
      if (!reason) { setErr('t-reroute', 'Reason is required.'); return; }
      setErr('t-reroute', '');
      try {
        await api.reroute(trip.id, { destination, reason });
        toast(`Rerouted to ${destination}.`, 'success');
        await refetchAndRender();
        refreshQuiet();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  renderBody();
}
