import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, fmtCountdown, countdownClass, skeletonBlock, emptyState, errorState,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip, countdownChip } from '../components/status-chip.js';

let appEl = null;
let tripId = null; // null => prepare/list screen

/* ---- prepare screen state ---- */
let readiness = null;
let trucks = null;
let drivers = null;
let existingTrips = null;
let prepareError = '';
let lastPickList = null;
let preparing = false;

/* ---- detail screen state ---- */
let trip = null;
let tripError = '';
let tab = 'loading'; // loading | seal
let scanInstance = null;
let sealScanInstance = null;

/** @param {{tripId?:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  tripId = params.tripId || null;
  if (tripId) {
    trip = null; tripError = ''; tab = 'loading';
    loadTrip();
  } else {
    readiness = null; trucks = null; drivers = null; existingTrips = null; prepareError = ''; lastPickList = null; preparing = false;
    loadPrepare();
  }
  return { destroy, refresh: tripId ? loadTrip : loadPrepare, activeTripId: () => tripId };
}

export function destroy() {
  scanInstance?.destroy(); scanInstance = null;
  sealScanInstance?.destroy(); sealScanInstance = null;
  appEl = null;
}

/* ===================== PREPARE SCREEN ===================== */

async function loadPrepare() {
  if (!appEl) return;
  renderPrepareSkeleton();
  try {
    const [r, t, d, trips] = await Promise.all([
      api.getFlightsReadiness(), api.getOutboundTrucks(), api.getDrivers(), api.getOutboundTrips(),
    ]);
    if (!appEl) return;
    readiness = r; trucks = t; drivers = d; existingTrips = trips;
    prepareError = '';
    renderPrepare();
  } catch (err) {
    if (!appEl) return;
    prepareError = err.message;
    renderPrepare();
  }
}

function renderPrepareSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Outbound</h1></div>${skeletonBlock(6)}`;
}

function renderPrepare() {
  if (!appEl) return;
  if (prepareError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Outbound</h1></div>${errorState({ message: prepareError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadPrepare);
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Outbound</h1>
        <p class="page-subtitle">Prepare a load, scan it onto a truck, then seal and dispatch.</p>
      </div>
    </div>
    <div class="section-title">Flight readiness</div>
    <div id="readiness-table" style="margin-block-end:var(--s6)"></div>
    <div id="picklist-root"></div>
    <div class="section-title">Prepare outbound load</div>
    <div class="card" style="margin-block-end:var(--s6);max-width:620px" id="prepare-form-root"></div>
    <div class="section-title">Trips</div>
    <div id="trips-root"></div>`;
  renderReadinessTable();
  renderPrepareForm();
  renderTripsList();
  if (lastPickList) renderPickListPanel();
}

function renderReadinessTable() {
  const root = appEl.querySelector('#readiness-table');
  if (!root) return;
  if (!readiness.length) { root.innerHTML = emptyState({ message: 'No flights to prepare.' }); return; }
  root.innerHTML = `<div class="stack gap-2">${readiness.map((f) => `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3);padding:var(--s3) 0;border-bottom:1px solid var(--border)">
      <div>
        <strong class="mono">${esc(f.code)}</strong>
        <span class="fs-sm muted"> · ${esc(f.destination)}</span>
        <div class="fs-xs muted">${f.stored} / ${f.total} stored</div>
      </div>
      <div class="row gap-2 wrap">
        ${countdownChip(fmtCountdown(f.dispatchDeadline), countdownClass(f.dispatchDeadline))}
        ${statusChip(f.status)}
        ${f.status !== 'Ready' ? `<button type="button" class="btn btn-ghost" data-action="raise-cutoff" data-code="${esc(f.code)}" style="height:32px;padding-inline:var(--s3);font-size:12px">Raise missed cut-off</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
  root.querySelectorAll('[data-action="raise-cutoff"]').forEach((btn) => btn.addEventListener('click', () => onRaiseCutoff(btn)));
}

async function onRaiseCutoff(btn) {
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.raiseMissedCutoff(btn.dataset.code);
    toast('Missed cut-off exception raised.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

function renderPrepareForm() {
  const root = appEl.querySelector('#prepare-form-root');
  if (!root) return;
  const availableTrucks = trucks.filter((t) => t.status !== 'Out of Service');
  root.innerHTML = `
    <form id="prepare-form" novalidate>
      <div class="field">
        <label>Flights <span class="req">*</span></label>
        ${readiness.map((f) => `<label class="checkbox-row"><input type="checkbox" name="flight" value="${esc(f.code)}" /> ${esc(f.code)} — ${esc(f.destination)} (${f.stored} stored)</label>`).join('')}
      </div>
      <div class="field">
        <label for="prepare-truck">Truck <span class="req">*</span></label>
        <select id="prepare-truck" required>
          <option value="">Select…</option>
          ${availableTrucks.map((t) => `<option value="${esc(t.id)}">${esc(t.code)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="prepare-driver">Driver <span class="req">*</span></label>
        <select id="prepare-driver" required>
          <option value="">Select…</option>
          ${drivers.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${d.status === 'Busy' ? ' (busy)' : ''}</option>`).join('')}
        </select>
      </div>
      <button type="submit" class="btn btn-primary" id="prepare-submit" ${preparing ? 'disabled aria-busy="true"' : ''}>
        ${preparing ? '<span class="spinner"></span> Creating…' : `${icon('clipboard-list', 16)} Create pick list`}
      </button>
    </form>`;
  root.querySelector('#prepare-form').addEventListener('submit', onPrepareSubmit);
}

async function onPrepareSubmit(e) {
  e.preventDefault();
  if (preparing) return;
  const form = e.currentTarget;
  const flightCodes = Array.from(form.querySelectorAll('input[name="flight"]:checked')).map((i) => i.value);
  const truckId = form.querySelector('#prepare-truck').value;
  const driverId = form.querySelector('#prepare-driver').value;
  if (!flightCodes.length) { toast('Select at least one flight.', 'error'); return; }
  if (!truckId || !driverId) { toast('Truck and driver are both required.', 'error'); return; }
  preparing = true;
  const btn = form.querySelector('#prepare-submit');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Creating…';
  try {
    const newTrip = await api.prepareLoad({ flightCodes, truckId, driverId });
    const pickList = await api.getPickList(newTrip.id);
    lastPickList = pickList;
    toast(`Pick list created for ${newTrip.id}.`, 'success');
    preparing = false;
    await loadPrepare();
  } catch (err) {
    preparing = false;
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = `${icon('clipboard-list', 16)} Create pick list`;
    toast(err.message, 'error');
  }
}

function renderPickListPanel() {
  const root = appEl.querySelector('#picklist-root');
  if (!root || !lastPickList) return;
  const { trip: t, bags } = lastPickList;
  root.innerHTML = `
    <div class="card no-print-margin" style="margin-block-end:var(--s6)">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3)">
        <div class="section-title" style="margin-block-end:0">Pick list — ${esc(t.id)}</div>
        <div class="row gap-2 no-print">
          <button type="button" class="btn btn-secondary" data-action="print-picklist">${icon('printer', 16)} Print</button>
          <a class="btn btn-primary" href="#/outbound/${esc(t.id)}">Open ${icon('arrow-right', 14)}</a>
        </div>
      </div>
      <p class="fs-sm muted">${esc(t.truckCode)} · ${esc(t.driverName)} · ${bags.length} bags</p>
      <div class="stack gap-1" style="margin-block-start:var(--s3)">
        ${bags.map((b) => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span class="fs-sm mono">${esc(b.tagNumber)}</span><span class="fs-xs muted">${esc(b.pilgrimName)} · ${esc(b.flightCode)}</span></div>`).join('')}
      </div>
    </div>`;
  root.querySelector('[data-action="print-picklist"]').addEventListener('click', () => window.print());
}

function renderTripsList() {
  const root = appEl.querySelector('#trips-root');
  if (!root) return;
  if (!existingTrips.length) { root.innerHTML = emptyState({ message: 'No outbound trips planned yet.' }); return; }
  root.innerHTML = `<div class="grid grid-auto">${existingTrips.map((t) => `
    <a class="card card-tap" href="#/outbound/${esc(t.id)}">
      <div class="row" style="justify-content:space-between">
        <strong class="mono">${esc(t.id)}</strong>
        ${statusChip(t.status)}
      </div>
      <div class="fs-sm muted" style="margin-block:var(--s2)">${esc(t.truckCode)} · ${esc(t.driverName)}</div>
      <div class="fs-xs muted">${t.bagIds.length} bags · ${esc(t.flightCodes.join(', '))}</div>
    </a>`).join('')}</div>`;
}

/* ===================== DETAIL: LOADING / SEAL & DISPATCH ===================== */

async function loadTrip() {
  if (!appEl) return;
  if (!trip) renderTripSkeleton();
  try {
    trip = await api.getOutboundTrip(tripId);
    if (!appEl) return;
    tripError = '';
    renderTrip();
  } catch (err) {
    if (!appEl) return;
    tripError = err.message;
    renderTrip();
  }
}

function renderTripSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Outbound trip</h1></div>${skeletonBlock(8)}`;
}

function renderTrip() {
  if (!appEl) return;
  if (tripError) {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/outbound">${icon('arrow-left', 16)} Back</a></div>${errorState({ message: tripError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadTrip);
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/outbound">${icon('arrow-left', 14)} All trips</a>
        <h1 class="page-title">${esc(trip.id)} <span class="muted fs-sm">· ${esc(trip.truckCode)}</span></h1>
        <p class="page-subtitle">${esc(trip.driverName)} · ${esc(trip.flightCodes.join(', '))}</p>
      </div>
      ${statusChip(trip.status)}
    </div>
    ${trip.status !== 'Departed' ? `
      <div class="tabs" role="tablist">
        <button type="button" class="tab" role="tab" aria-selected="${tab === 'loading'}" data-tab="loading">Loading</button>
        <button type="button" class="tab" role="tab" aria-selected="${tab === 'seal'}" data-tab="seal">Seal &amp; dispatch</button>
      </div>` : ''}
    <div id="trip-tab-root"></div>`;

  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.tab === tab) return;
    tab = btn.dataset.tab;
    appEl.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    renderTripTab();
  }));

  if (trip.status === 'Departed') { renderDepartedStep(); return; }
  renderTripTab();
}

function renderTripTab() {
  const root = appEl.querySelector('#trip-tab-root');
  if (!root) return;
  if (tab === 'loading') renderLoadingTab(root);
  else renderSealTab(root);
}

function renderLoadingTab(root) {
  scanInstance?.destroy(); scanInstance = null;
  const loadedCount = trip.bags.filter((b) => b.status === 'Loaded to Airport Truck' || b.status === 'In Transit to Airport').length;
  const total = trip.bags.length;
  const capacity = 40;
  const truckFull = loadedCount >= capacity;

  root.innerHTML = `
    ${truckFull ? `<div class="row" role="alert" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3);background:var(--warning-soft);color:var(--warning);padding:var(--s4);border-radius:var(--r-lg);margin-block-end:var(--s5)">
      <span class="row gap-2 fw-medium">${icon('alert-triangle', 18)} Truck full — seal now.</span>
      <button type="button" class="btn btn-primary" data-action="go-seal">${icon('lock', 16)} Seal truck now</button>
    </div>` : ''}
    <div class="grid grid-cols-2">
      <div>${truckFull ? '' : '<div id="load-scan-root"></div>'}</div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
          <div class="section-title" style="margin-block-end:0">Bags</div>
          <strong class="fs-sm">${loadedCount} / ${total} loaded</strong>
        </div>
        <div class="capacity-bar" style="margin-block-end:var(--s4)"><div class="capacity-bar-fill ${loadedCount >= total ? 'full' : ''}" style="width:${total ? Math.round((loadedCount / total) * 100) : 0}%"></div></div>
        <div id="load-bag-list" class="stack gap-2"></div>
      </div>
    </div>`;

  root.querySelector('[data-action="go-seal"]')?.addEventListener('click', () => { tab = 'seal'; appEl.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab))); renderTripTab(); });

  if (!truckFull) {
    scanInstance = createScanInput(root.querySelector('#load-scan-root'), {
      label: 'Scan bag tag to load onto truck',
      placeholder: 'e.g. RBL-A-0031',
      onSubmit: async (code) => {
        const result = await api.loadScan(tripId, code);
        await refreshLoadingData(root);
        return { message: result.message };
      },
    });
  }
  renderLoadBagList(root);
}

async function refreshLoadingData(root) {
  try { trip = await api.getOutboundTrip(tripId); } catch (err) { toast(err.message, 'error'); return; }
  if (!appEl) return;
  const loadedCount = trip.bags.filter((b) => b.status === 'Loaded to Airport Truck' || b.status === 'In Transit to Airport').length;
  const header = root.querySelector('.row strong');
  if (header) header.textContent = `${loadedCount} / ${trip.bags.length} loaded`;
  const fill = root.querySelector('.capacity-bar-fill');
  if (fill) { fill.style.width = `${Math.round((loadedCount / trip.bags.length) * 100)}%`; fill.classList.toggle('full', loadedCount >= trip.bags.length); }
  renderLoadBagList(root);
  if (loadedCount >= 40) renderLoadingTab(root);
}

function renderLoadBagList(root) {
  const list = root.querySelector('#load-bag-list');
  if (!list) return;
  list.innerHTML = trip.bags.map((b) => {
    const loaded = b.status === 'Loaded to Airport Truck' || b.status === 'In Transit to Airport';
    return `
    <div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
      <div><span class="fs-sm mono">${esc(b.tagNumber)}</span><div class="fs-xs muted">${esc(b.pilgrimName)} · ${esc(b.flightCode)}</div></div>
      <div class="row gap-2">
        ${loaded ? '<span class="chip chip-green">Loaded</span>' : '<span class="chip chip-grey">Pending</span>'}
        ${loaded && trip.status !== 'Departed' ? `<button type="button" class="btn btn-ghost" data-action="unload" data-id="${esc(b.id)}">Unload</button>` : ''}
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-action="unload"]').forEach((btn) => btn.addEventListener('click', () => onUnloadCorrection(btn.dataset.id, root)));
}

async function onUnloadCorrection(bagId, root) {
  try {
    await api.unloadCorrection(tripId, bagId);
    toast('Bag removed from truck.', 'info');
    await refreshLoadingData(root);
  } catch (err) { toast(err.message, 'error'); }
}

function renderSealTab(root) {
  sealScanInstance?.destroy(); sealScanInstance = null;
  if (!trip.driverVerifiedCount) {
    root.innerHTML = `
      <div class="state-block">
        ${icon('lock', 40)}
        <p>Waiting for driver count verification.</p>
        <p class="fs-xs muted">Use the profile menu's "Mark driver count verified" to unlock sealing.</p>
      </div>`;
    return;
  }
  if (!trip.sealNumber) {
    root.innerHTML = `
      <div class="card" style="max-width:480px">
        <div class="section-title">Seal the truck</div>
        <form id="seal-form" novalidate>
          <div class="field">
            <label for="seal-input">Seal number <span class="req">*</span></label>
            <div class="row gap-2">
              <input id="seal-input" placeholder="SL-XXXXXX" style="flex:1" required />
              <button type="button" class="btn btn-secondary" data-action="generate-seal">Generate</button>
            </div>
            <div class="error" id="err-seal" hidden></div>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="seal-submit">${icon('lock', 16)} Seal truck</button>
        </form>
      </div>`;
    root.querySelector('[data-action="generate-seal"]').addEventListener('click', () => {
      root.querySelector('#seal-input').value = `SL-${randomAlphaNum(6)}`;
    });
    const form = root.querySelector('#seal-form');
    let submitting = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      const value = form.querySelector('#seal-input').value.trim();
      const errBox = form.querySelector('#err-seal');
      submitting = true;
      const btn = form.querySelector('#seal-submit');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Sealing…';
      try {
        await api.seal(tripId, value);
        trip = await api.getOutboundTrip(tripId);
        toast(`${trip.sealNumber} sealed.`, 'success');
        renderSealTab(root);
      } catch (err) {
        submitting = false;
        btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Seal truck';
        errBox.textContent = err.message; errBox.hidden = false;
      }
    });
    return;
  }
  if (!trip.sealConfirmedAt) {
    root.innerHTML = `
      <div class="grid grid-cols-2">
        <div><div id="seal-confirm-scan-root"></div></div>
        <div class="card">
          <div class="section-title">Seal</div>
          <p class="fs-sm mono">${esc(trip.sealNumber)}</p>
          <p class="fs-xs muted">Scan the physical seal to confirm it matches.</p>
        </div>
      </div>`;
    sealScanInstance = createScanInput(root.querySelector('#seal-confirm-scan-root'), {
      label: 'Scan the seal to confirm',
      placeholder: trip.sealNumber,
      onSubmit: async (code) => {
        await api.confirmSealScan(tripId, code);
        trip = await api.getOutboundTrip(tripId);
        renderSealTab(root);
        return { message: 'Seal confirmed.' };
      },
    });
    return;
  }

  root.innerHTML = `
    <div class="card" style="max-width:480px">
      <div class="section-title">Depart</div>
      <div class="stack gap-2 fs-sm" style="margin-block-end:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted">Seal</span><strong class="mono">${esc(trip.sealNumber)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">ETA (airport)</span><strong>${esc(fmtDateTime(new Date(Date.now() + 60 * 60000).toISOString()))}</strong></div>
      </div>
      <form id="depart-form" novalidate>
        <div class="field">
          <label for="departure-time">Departure time</label>
          <input id="departure-time" type="datetime-local" value="${defaultDepartureInputValue()}" required />
          <div class="hint">Must be within 30 minutes of now.</div>
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="depart-submit">${icon('send', 16)} Truck departed</button>
      </form>
    </div>`;
  const form = root.querySelector('#depart-form');
  let departing = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (departing) return;
    const value = form.querySelector('#departure-time').value;
    if (!value) { toast('Departure time is required.', 'error'); return; }
    departing = true;
    const btn = form.querySelector('#depart-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Departing…';
    try {
      await api.depart(tripId, new Date(value).toISOString());
      toast('Truck departed.', 'success');
      await loadTrip();
    } catch (err) {
      departing = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Truck departed';
      toast(err.message, 'error');
    }
  });
}

function randomAlphaNum(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function defaultDepartureInputValue() {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ===================== DEPARTED: handover manifest ===================== */

async function renderDepartedStep() {
  const root = appEl.querySelector('#trip-tab-root');
  root.innerHTML = skeletonBlock(6);
  let manifest;
  try {
    manifest = await api.getOutboundManifest(tripId);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', renderDepartedStep);
    return;
  }
  if (!appEl) return;
  root.innerHTML = `
    <div class="receipt card no-print-margin">
      <div class="state-block" style="padding-block:var(--s4)">
        ${icon('check-circle', 48)}
        <h2 class="fs-lg">Handover manifest</h2>
      </div>
      <div class="stack gap-2" style="margin-block-start:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Trip</span><strong class="mono">${esc(manifest.trip.id)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Truck</span><strong>${esc(manifest.trip.truckCode)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Driver</span><strong>${esc(manifest.trip.driverName)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Seal</span><strong class="mono">${esc(manifest.trip.sealNumber)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Departed</span><strong>${esc(fmtDateTime(manifest.trip.departureTime))}</strong></div>
      </div>
      <div class="section-title" style="margin-block-start:var(--s4)">Bags (${manifest.bags.length})</div>
      <div class="stack gap-1" style="margin-block-end:var(--s6)">
        ${manifest.bags.map((b) => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span class="fs-sm mono">${esc(b.tagNumber)}</span><span class="fs-xs muted">${esc(b.pilgrimName)}</span></div>`).join('')}
      </div>
      <div class="grid grid-cols-2" style="margin-block-start:var(--s8)">
        <div><p class="fs-xs muted" style="border-top:1px solid var(--border);padding-block-start:var(--s2)">Warehouse staff signature</p></div>
        <div><p class="fs-xs muted" style="border-top:1px solid var(--border);padding-block-start:var(--s2)">Driver signature</p></div>
      </div>
    </div>
    <div class="row gap-2 wrap no-print" style="margin-block-start:var(--s5)">
      <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 16)} Print</button>
      <a class="btn btn-primary" href="#/gate">${icon('truck', 16)} More trucks</a>
      <a class="btn btn-secondary" href="#/handover">No more trucks — shift handover</a>
    </div>`;
  root.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
}
