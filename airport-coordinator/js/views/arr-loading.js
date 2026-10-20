import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, emptyState, errorState,
} from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let tripId = null; // null => plan screen

/* ---- plan screen state ---- */
let readyGroups = null;
let outboundTrucks = null;
let existingTrips = null;
let planError = '';
let lastCreated = null; // trip[] from the most recent planTrips() call
let planning = false;

/* ---- load+dispatch screen state ---- */
let trip = null;
let tripError = '';
let scanInstance = null;
let dispatching = false;

/** @param {{tripId?:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  tripId = params.tripId || null;
  if (tripId) {
    trip = null; tripError = ''; dispatching = false;
    loadTrip();
  } else {
    readyGroups = null; outboundTrucks = null; existingTrips = null; planError = ''; lastCreated = null; planning = false;
    loadPlan();
  }
  return {
    destroy,
    refresh: tripId ? loadTrip : loadPlan,
    poll: tripId ? pollTrip : null,
    activeTripId: () => tripId,
  };
}

export function destroy() {
  scanInstance?.destroy(); scanInstance = null;
  appEl = null;
}

/* ===================== PLAN SCREEN ===================== */

async function loadPlan() {
  if (!appEl) return;
  renderPlanSkeleton();
  try {
    const [groups, trucks, trips] = await Promise.all([
      api.getReadyToLoadGroups(), api.getOutboundTrucks(), api.getArrTrips(),
    ]);
    if (!appEl) return;
    readyGroups = groups; outboundTrucks = trucks; existingTrips = trips;
    planError = '';
    renderPlan();
  } catch (err) {
    if (!appEl) return;
    planError = err.message;
    renderPlan();
  }
}

function renderPlanSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Truck loading</h1></div>${skeletonBlock(6)}`;
}

function renderPlan() {
  if (!appEl) return;
  if (planError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Truck loading</h1></div>${errorState({ message: planError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadPlan);
    return;
  }

  if (!readyGroups.length && !existingTrips.length) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Truck loading</h1></div>${emptyState({ message: 'No bags are ready to load yet.' })}`;
    return;
  }

  const availableTrucks = outboundTrucks.filter((t) => t.status === 'Available');

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Truck loading</h1>
        <p class="page-subtitle">Assign a hotel truck to each ready group, then load and dispatch.</p>
      </div>
    </div>
    <div id="created-root"></div>
    <div class="section-title">Ready to load, by hotel</div>
    <div id="ready-groups-root" style="margin-block-end:var(--s6)"></div>
    <div class="section-title">Trips</div>
    <div id="trips-root"></div>`;

  renderCreated();
  renderReadyGroups(availableTrucks);
  renderTripsList();
}

function renderCreated() {
  const root = appEl.querySelector('#created-root');
  if (!root) return;
  if (!lastCreated || !lastCreated.length) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <div class="card" style="margin-block-end:var(--s5)">
      <div class="section-title">${lastCreated.length} trip${lastCreated.length === 1 ? '' : 's'} created</div>
      <div class="stack gap-2">
        ${lastCreated.map((t) => `
          <a class="row" style="justify-content:space-between" href="#/arr/loading/${esc(encodeURIComponent(t.id))}">
            <span><strong class="mono">${esc(t.id)}</strong> &middot; ${esc(t.hotel)}</span>
            <span class="fs-sm muted">${esc(t.truckCode)} ${icon('arrow-right', 14)}</span>
          </a>`).join('')}
      </div>
    </div>`;
}

function renderReadyGroups(availableTrucks) {
  const root = appEl.querySelector('#ready-groups-root');
  if (!root) return;
  if (!readyGroups.length) {
    root.innerHTML = emptyState({ message: 'No new hotel groups are ready to plan right now.' });
    return;
  }
  root.innerHTML = `
    <div class="grid grid-auto" style="margin-block-end:var(--s4)">
      ${readyGroups.map((g, i) => `
        <div class="card" data-group-row="${i}">
          <strong>${esc(g.hotel)}</strong>
          <div class="fs-sm muted" style="margin-block:var(--s2)">${g.bagCount} bag${g.bagCount === 1 ? '' : 's'} &middot; ${g.pilgrimCount} pilgrim${g.pilgrimCount === 1 ? '' : 's'}</div>
          <div class="field" style="margin-block-end:0">
            <label for="truck-select-${i}">Truck</label>
            <select id="truck-select-${i}" data-truck-select="${i}">
              <option value="">No truck available</option>
              ${availableTrucks.map((t) => `<option value="${esc(t.id)}">${esc(t.code)} &middot; ${esc(t.driverName)} (cap ${t.capacity})</option>`).join('')}
            </select>
          </div>
        </div>`).join('')}
    </div>
    <div class="row" style="justify-content:flex-end">
      <button type="button" class="btn btn-primary" data-action="create-trips">${icon('route', 16)} Create trips</button>
    </div>`;
  root.querySelector('[data-action="create-trips"]').addEventListener('click', onCreateTrips);
}

async function onCreateTrips() {
  if (planning) return;
  const groups = readyGroups.map((g, i) => {
    const sel = appEl.querySelector(`[data-truck-select="${i}"]`);
    return { hotel: g.hotel, truckId: sel?.value || '' };
  }).filter((g) => g.truckId);
  if (!groups.length) { toast('Select a truck for at least one group.', 'error'); return; }
  planning = true;
  const btn = appEl.querySelector('[data-action="create-trips"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Creating…';
  try {
    const created = await api.planTrips(groups);
    lastCreated = created;
    toast(`${created.length} trip${created.length === 1 ? '' : 's'} created.`, 'success');
    planning = false;
    await loadPlan();
  } catch (err) {
    planning = false;
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Create trips';
    toast(err.message, 'error');
  }
}

function renderTripsList() {
  const root = appEl.querySelector('#trips-root');
  if (!root) return;
  if (!existingTrips.length) { root.innerHTML = emptyState({ message: 'No trips planned yet.' }); return; }
  root.innerHTML = `<div class="grid grid-auto">${existingTrips.map((t) => `
    <a class="card card-tap" href="#/arr/loading/${esc(encodeURIComponent(t.id))}">
      <div class="row" style="justify-content:space-between">
        <strong class="mono">${esc(t.id)}</strong>
        ${statusChip(t.status)}
      </div>
      <div class="fs-sm muted" style="margin-block:var(--s2)">${esc(t.hotel)}</div>
      <div class="fs-xs muted">${esc(t.truckCode)} &middot; ${esc(t.driverName)} &middot; ${t.bagIds.length} bag${t.bagIds.length === 1 ? '' : 's'}</div>
    </a>`).join('')}</div>`;
}

/* ===================== LOAD + DISPATCH SCREEN ===================== */

async function loadTrip() {
  if (!appEl) return;
  if (!trip) renderTripSkeleton();
  try {
    const result = await api.getArrTrip(tripId);
    if (!appEl) return;
    trip = result;
    tripError = '';
    renderTrip();
  } catch (err) {
    if (!appEl) return;
    tripError = err.message;
    renderTrip();
  }
}

async function pollTrip() {
  if (!appEl || !tripId) return;
  try {
    const result = await api.getArrTrip(tripId);
    if (!appEl) return;
    trip = result;
    tripError = '';
    renderTrip();
  } catch (err) { /* silent poll failure — keep showing last good state */ }
}

function renderTripSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Load truck</h1></div>${skeletonBlock(8)}`;
}

function renderTrip() {
  if (!appEl) return;
  if (tripError) {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/arr/loading">${icon('arrow-left', 16)} Back</a></div>${errorState({ message: tripError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadTrip);
    return;
  }

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/arr/loading">${icon('arrow-left', 14)} All trips</a>
        <h1 class="page-title">${esc(trip.id)} <span class="muted fs-sm">&middot; ${esc(trip.hotel)}</span></h1>
        <p class="page-subtitle">${esc(trip.truckCode)} &middot; ${esc(trip.driverName)}</p>
      </div>
      ${statusChip(trip.status)}
    </div>
    <div id="trip-step-root"></div>`;

  const root = appEl.querySelector('#trip-step-root');
  if (trip.status === 'Planned') renderLoadStep(root);
  else if (trip.status === 'Loaded') renderDispatchStep(root);
  else renderDispatchedStep(root);
}

function renderLoadStep(root) {
  scanInstance?.destroy(); scanInstance = null;
  const loadedCount = trip.bags.filter((b) => b.status === 'Loaded to Truck').length;
  const total = trip.bags.length;
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div><div id="load-scan-root"></div></div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
          <div class="section-title" style="margin-block-end:0">Bags</div>
          <strong class="fs-sm">${loadedCount} / ${total} loaded</strong>
        </div>
        <div class="capacity-bar" style="margin-block-end:var(--s4)"><div class="capacity-bar-fill ${loadedCount >= total ? 'full' : ''}" style="width:${total ? Math.round((loadedCount / total) * 100) : 0}%"></div></div>
        <div id="load-bag-list" class="stack gap-2"></div>
      </div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-block-start:var(--s5)">
      <button type="button" class="btn btn-primary" data-action="complete">${icon('check', 16)} Scan truck loading complete</button>
    </div>`;

  scanInstance = createScanInput(root.querySelector('#load-scan-root'), {
    label: 'Scan bag tag to load onto truck',
    placeholder: 'e.g. RBL-B-0060',
    onSubmit: async (code) => {
      const result = await api.loadScan(tripId, code);
      await loadTrip();
      return { message: result.message };
    },
  });
  renderLoadBagList(root);
  root.querySelector('[data-action="complete"]').addEventListener('click', onLoadingComplete);
}

function renderLoadBagList(root) {
  const list = root.querySelector('#load-bag-list');
  if (!list) return;
  list.innerHTML = trip.bags.map((b) => `
    <div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
      <div><span class="fs-sm mono">${esc(b.tagNumber)}</span><div class="fs-xs muted">${esc(b.pilgrimName || '—')}</div></div>
      <div class="row gap-2">
        ${b.status === 'Loaded to Truck' ? '<span class="chip chip-green">Loaded</span>' : '<span class="chip chip-grey">Pending</span>'}
        ${b.status === 'Loaded to Truck' ? `<button type="button" class="btn btn-ghost" data-action="remove" data-id="${esc(b.id)}">Remove</button>` : ''}
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-action="remove"]').forEach((btn) => btn.addEventListener('click', () => onRemoveBag(btn.dataset.id)));
}

async function onRemoveBag(bagId) {
  try {
    await api.removeFromTrip(tripId, bagId);
    toast('Bag removed from trip.', 'info');
    await loadTrip();
  } catch (err) { toast(err.message, 'error'); }
}

async function onLoadingComplete() {
  const btn = appEl.querySelector('[data-action="complete"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.loadingComplete(tripId);
    toast('Loading complete.', 'success');
    await loadTrip();
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

function defaultDepartureInputValue() {
  const d = new Date();
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderDispatchStep(root) {
  const bothReady = trip.driverVerifiedCount && trip.driverConfirmedSeal;
  root.innerHTML = `
    <div class="card" style="max-width:520px">
      <div class="section-title">Dispatch</div>
      <div class="stack gap-2" style="margin-block-end:var(--s4)">
        <div class="row" style="justify-content:space-between">
          <span class="fs-sm">Driver verified count</span>
          ${trip.driverVerifiedCount ? `<span class="row gap-1 fs-sm">${icon('check', 14)} Confirmed</span>` : '<span class="fs-sm muted">Waiting for driver count &amp; seal.</span>'}
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="fs-sm">Driver confirmed seal</span>
          ${trip.driverConfirmedSeal ? `<span class="row gap-1 fs-sm">${icon('check', 14)} Confirmed</span>` : '<span class="fs-sm muted">Waiting for driver count &amp; seal.</span>'}
        </div>
      </div>
      ${bothReady ? `
        <form id="dispatch-form" novalidate>
          <div class="field">
            <label for="departure-time">Departure time</label>
            <input id="departure-time" type="datetime-local" value="${defaultDepartureInputValue()}" required />
            <div class="hint">Must be within 30 minutes of now.</div>
          </div>
          <button type="submit" class="btn btn-primary btn-block" id="dispatch-submit">${icon('send', 16)} Truck departs</button>
        </form>` : `<p class="fs-sm muted">${icon('clock', 14)} Waiting for driver count &amp; seal.</p>`}
    </div>`;

  const form = root.querySelector('#dispatch-form');
  form?.addEventListener('submit', onDispatch);
}

async function onDispatch(e) {
  e.preventDefault();
  if (dispatching) return;
  const input = appEl.querySelector('#departure-time');
  const value = input.value;
  if (!value) { toast('Departure time is required.', 'error'); return; }
  dispatching = true;
  const btn = appEl.querySelector('#dispatch-submit');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Dispatching…';
  try {
    await api.dispatch(tripId, new Date(value).toISOString());
    toast('Truck dispatched.', 'success');
    dispatching = false;
    await loadTrip();
  } catch (err) {
    dispatching = false;
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Truck departs';
    toast(err.message, 'error');
  }
}

function renderDispatchedStep(root) {
  root.innerHTML = `
    <div class="state-block">
      ${icon('check-circle', 48)}
      <p>Dispatched ${trip.departureTime ? esc(fmtDateTime(trip.departureTime)) : ''}.</p>
      <button type="button" class="btn btn-primary" data-action="report">${icon('file-text', 16)} Generate loading report</button>
    </div>
    <div id="report-root"></div>
    <div class="card no-print" style="margin-block-start:var(--s5)">
      <div class="section-title">More flights?</div>
      <div class="row gap-2 wrap">
        <a class="btn btn-secondary" href="#/arr/flights">${icon('plane-landing', 16)} More flights</a>
        <a class="btn btn-primary" href="#/handover">${icon('clipboard-check', 16)} No more flights — shift handover</a>
      </div>
    </div>`;
  root.querySelector('[data-action="report"]').addEventListener('click', onGenerateReport);
}

async function onGenerateReport(e) {
  const btn = e.currentTarget;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    const report = await api.getLoadingReport(tripId);
    const reportRoot = appEl.querySelector('#report-root');
    reportRoot.innerHTML = `
      <div class="receipt card no-print-margin" style="margin-block-start:var(--s4)">
        <div class="stack gap-2">
          <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Trip</span><strong class="mono">${esc(report.trip.id)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Hotel</span><strong>${esc(report.trip.hotel)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Truck</span><strong>${esc(report.trip.truckCode)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Driver</span><strong>${esc(report.trip.driverName)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Generated</span><strong>${esc(fmtDateTime(report.generatedAt))}</strong></div>
        </div>
        <div class="section-title" style="margin-block-start:var(--s4)">Bags (${report.bags.length})</div>
        <div class="stack gap-1">
          ${report.bags.map((b) => `
            <div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
              <span class="fs-sm mono">${esc(b.tagNumber)}</span>
              <span class="fs-xs muted">${esc(b.pilgrimName || '—')}</span>
            </div>`).join('')}
        </div>
      </div>
      <div class="row no-print" style="margin-block-start:var(--s4)">
        <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 16)} Print</button>
      </div>`;
    reportRoot.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}
