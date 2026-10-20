import * as api from '../api.js';
import {
  esc, icon, toast, fmtRelative, fmtDateTime, skeletonBlock, emptyState, errorState, openModal,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let scanInstance = null;

let trip = null; // the trip currently shown in the result panel, or null
let lastCode = '';
let showUnknown = false;
let showNotExpected = false;
let openingGate = false;

let baysState = 'loading'; // loading | error | ready
let bays = null;
let baysError = '';

let eventsState = 'loading';
let events = null;
let eventsError = '';

let waitingState = 'loading';
let waitingTrucks = null;
let waitingError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  trip = null;
  lastCode = '';
  showUnknown = false;
  showNotExpected = false;
  openingGate = false;
  baysState = 'loading'; bays = null; baysError = '';
  eventsState = 'loading'; events = null; eventsError = '';
  waitingState = 'loading'; waitingTrucks = null; waitingError = '';
  renderShell();
  loadBays();
  loadGateEvents();
  loadWaiting();
  return { destroy, refresh, activeTripId: () => (trip ? trip.id : null) };
}

export function destroy() {
  scanInstance?.destroy();
  scanInstance = null;
  appEl = null;
}

function refresh() {
  loadBays();
  loadGateEvents();
  loadWaiting();
}

/* ===================== shell ===================== */

function renderShell() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Gate</h1>
        <p class="page-subtitle">Scan an arriving truck, resolve any issues, then assign a bay and open the gate.</p>
      </div>
    </div>
    <div class="grid grid-cols-2">
      <div>
        <div class="card">
          <div class="section-title">Scan incoming truck</div>
          <div id="gate-scan-root"></div>
        </div>
        <div id="gate-unknown-root"></div>
        <div id="gate-notexpected-root"></div>
      </div>
      <div id="gate-result-root"></div>
    </div>
    <div id="gate-waiting-root"></div>
    <div class="section-title">Recent gate events</div>
    <div id="gate-events-root"></div>`;

  scanInstance = createScanInput(appEl.querySelector('#gate-scan-root'), {
    label: 'Scan truck QR / plate',
    placeholder: 'e.g. TRK-14',
    onSubmit: onScanSubmit,
  });
  renderUnknownPanel();
  renderNotExpectedPanel();
  renderResultPanel();
}

async function onScanSubmit(code) {
  lastCode = code;
  try {
    const t = await api.gateScan(code);
    trip = t;
    showUnknown = false;
    showNotExpected = false;
    renderUnknownPanel();
    renderNotExpectedPanel();
    renderResultPanel();
    loadGateEvents();
    return { message: `${t.code} admitted.` };
  } catch (err) {
    trip = null;
    showUnknown = err.code === 'unknown';
    showNotExpected = err.code === 'not-expected';
    renderUnknownPanel();
    renderNotExpectedPanel();
    renderResultPanel();
    loadGateEvents();
    throw err;
  }
}

/* ===================== unknown truck panel ===================== */

function renderUnknownPanel() {
  const root = appEl?.querySelector('#gate-unknown-root');
  if (!root) return;
  if (!showUnknown) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <div class="card" style="border-color:var(--danger);background:var(--danger-soft);margin-block-start:var(--s4)">
      <div class="row gap-2" style="margin-block-end:var(--s3)">${icon('alert-circle', 18)}<strong>Unknown truck</strong></div>
      <p class="fs-sm" style="margin-block-end:var(--s3)">This plate/code isn't in the system. Reject and contact the transport coordinator.</p>
      <form id="unknown-form" novalidate>
        <div class="field">
          <label for="unknown-plate">Plate <span class="req">*</span></label>
          <input id="unknown-plate" type="text" value="${esc(lastCode)}" required />
        </div>
        <div class="field">
          <label for="unknown-driver">Driver name <span class="req">*</span></label>
          <input id="unknown-driver" type="text" required />
        </div>
        <div class="field">
          <label for="unknown-phone">Phone</label>
          <input id="unknown-phone" type="text" placeholder="+9665XXXXXXXX" />
          <div class="hint">Optional. Must start with + and have 8–15 digits.</div>
        </div>
        <div class="field">
          <label for="unknown-notes">Notes</label>
          <textarea id="unknown-notes" maxlength="300"></textarea>
          <div class="hint">Optional, max 300 characters.</div>
        </div>
        <div class="error" id="err-unknown" hidden></div>
        <button type="submit" class="btn btn-danger" id="unknown-submit">${icon('phone-off', 16)} Reject &amp; contact transport coordinator</button>
      </form>
    </div>`;
  root.querySelector('#unknown-form').addEventListener('submit', onUnknownSubmit);
}

async function onUnknownSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const plate = form.querySelector('#unknown-plate').value.trim();
  const driverName = form.querySelector('#unknown-driver').value.trim();
  const phone = form.querySelector('#unknown-phone').value.trim();
  const notes = form.querySelector('#unknown-notes').value.trim();
  const errBox = form.querySelector('#err-unknown');
  if (!plate || !driverName) { errBox.textContent = 'Plate and driver name are required.'; errBox.hidden = false; return; }
  if (phone && !/^\+\d{8,15}$/.test(phone)) { errBox.textContent = 'Phone must start with + and have 8–15 digits.'; errBox.hidden = false; return; }
  if (notes.length > 300) { errBox.textContent = 'Notes must be 300 characters or fewer.'; errBox.hidden = false; return; }
  errBox.hidden = true;
  const btn = form.querySelector('#unknown-submit');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Contacting…';
  try {
    await api.contactTransportCoordinator({ plate, driverName, phone: phone || undefined, notes: notes || undefined });
    showUnknown = false;
    toast('Transport coordinator contacted.', 'success');
    renderUnknownPanel();
    loadGateEvents();
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = `${icon('phone-off', 16)} Reject &amp; contact transport coordinator`;
    errBox.textContent = err.message; errBox.hidden = false;
  }
}

/* ===================== not-expected panel ===================== */

function renderNotExpectedPanel() {
  const root = appEl?.querySelector('#gate-notexpected-root');
  if (!root) return;
  if (!showNotExpected) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <div class="card" style="border-color:var(--warning);background:var(--warning-soft);margin-block-start:var(--s4)">
      <div class="row gap-2" style="margin-block-end:var(--s3)">${icon('alert-triangle', 18)}<strong>Not expected</strong></div>
      <p class="fs-sm" style="margin-block-end:var(--s3)">This truck isn't currently admittable. A supervisor can override, or reject it.</p>
      <div class="row gap-2 wrap">
        <button type="button" class="btn btn-secondary" data-action="admit-pin">${icon('key', 16)} Admit with PIN</button>
        <button type="button" class="btn btn-danger" data-action="reject-truck">${icon('x-circle', 16)} Reject</button>
      </div>
    </div>`;
  root.querySelector('[data-action="admit-pin"]').addEventListener('click', openAdmitPinModal);
  root.querySelector('[data-action="reject-truck"]').addEventListener('click', openRejectModal);
}

/** Resolves a trip id from the last-scanned code, regardless of status (the
 * 'not-expected' case is specifically a 'Received' trip, which getIncoming()
 * excludes — so that list can't be used to look it back up). */
async function resolveTripId(code) {
  try {
    const t = await api.findTripByCode(code);
    return t.id;
  } catch (err) {
    return null;
  }
}

function openAdmitPinModal() {
  const close = openModal({
    title: 'Admit with PIN',
    bodyHtml: `
      <form id="admit-pin-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">Supervisor override — admits the truck even though it isn't currently expected.</p>
        <div class="field">
          <label for="admit-pin-input">Supervisor PIN <span class="req">*</span></label>
          <input id="admit-pin-input" type="password" inputmode="numeric" autocomplete="off" required />
          <div class="error" id="err-admit-pin" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="admit-pin-submit">Admit</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('admit-pin-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = form.querySelector('#admit-pin-input').value.trim();
    const errBox = form.querySelector('#err-admit-pin');
    if (!pin) { errBox.textContent = 'PIN is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    const btn = form.querySelector('#admit-pin-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Admitting…';
    try {
      const id = await resolveTripId(lastCode);
      if (!id) throw new Error('Could not find a matching trip for that code.');
      const t = await api.admitWithPin(id, pin);
      trip = t;
      showNotExpected = false;
      close();
      toast(`${t.code} admitted with PIN.`, 'success');
      renderNotExpectedPanel();
      renderResultPanel();
      loadGateEvents();
    } catch (err) {
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Admit';
      errBox.textContent = err.message; errBox.hidden = false;
    }
  });
}

function openRejectModal() {
  const close = openModal({
    title: 'Reject truck',
    bodyHtml: `
      <form id="reject-form" novalidate>
        <div class="field">
          <label for="reject-reason-input">Reason <span class="req">*</span></label>
          <input id="reject-reason-input" type="text" required />
          <div class="error" id="err-reject-reason" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="reject-submit">Reject</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('reject-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = form.querySelector('#reject-reason-input').value.trim();
    const errBox = form.querySelector('#err-reject-reason');
    if (!reason) { errBox.textContent = 'Reason is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    const btn = form.querySelector('#reject-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Rejecting…';
    try {
      const id = await resolveTripId(lastCode);
      if (!id) throw new Error('Could not find a matching trip for that code.');
      const t = await api.rejectTruck(id, reason);
      trip = t;
      showNotExpected = false;
      close();
      toast(`${t.code} rejected.`, 'info');
      renderNotExpectedPanel();
      renderResultPanel();
      loadGateEvents();
    } catch (err) {
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Reject';
      errBox.textContent = err.message; errBox.hidden = false;
    }
  });
}

/* ===================== result panel (trip + bay assignment) ===================== */

function renderResultPanel() {
  const root = appEl?.querySelector('#gate-result-root');
  if (!root) return;
  if (!trip) { root.innerHTML = emptyState({ message: 'Scan a truck to see its details here.' }); return; }
  const canAssignBay = trip.status === 'At Gate';
  root.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong class="mono">${esc(trip.code)}</strong>
          <div class="fs-sm muted">${esc(trip.truckPlate)} · ${esc(trip.driverName)}</div>
        </div>
        ${statusChip(trip.status)}
      </div>
      <div class="stack gap-1 fs-sm" style="margin-block:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted">Centre</span><strong>${esc(trip.centre)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Bags</span><strong>${trip.bagIds.length}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Manifest</span><strong class="mono">${esc(trip.manifestNo)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Bay</span><strong>${esc(trip.bay || '—')}</strong></div>
      </div>
      ${canAssignBay ? `
        <div class="section-title">Assign bay</div>
        <div id="gate-bays-root"></div>
        <div class="row" style="justify-content:flex-end;margin-block-start:var(--s4)">
          <button type="button" class="btn btn-primary" data-action="open-gate" ${!trip.bay || openingGate ? 'disabled' : ''} ${openingGate ? 'aria-busy="true"' : ''}>
            ${openingGate ? '<span class="spinner"></span> Opening…' : `${icon('door-open', 16)} Open gate &amp; direct to bay`}
          </button>
        </div>` : ''}
    </div>`;
  if (canAssignBay) {
    renderBaysSection();
    root.querySelector('[data-action="open-gate"]').addEventListener('click', onOpenGate);
  }
}

async function onOpenGate() {
  if (!trip || !trip.bay || openingGate) return;
  openingGate = true;
  renderResultPanel();
  try {
    const tripId = trip.id;
    await api.startReceiving(tripId);
    navigate(`#/unloading/${tripId}`);
  } catch (err) {
    openingGate = false;
    toast(err.message, 'error');
    renderResultPanel();
  }
}

/* ===================== bays ===================== */

async function loadBays() {
  baysState = 'loading';
  renderBaysSection();
  try {
    bays = await api.getBays();
    baysState = 'ready';
  } catch (err) {
    baysState = 'error';
    baysError = err.message;
  }
  renderBaysSection();
  renderWaitingSection();
}

function renderBaysSection() {
  const root = appEl?.querySelector('#gate-bays-root');
  if (!root) return;
  if (baysState === 'loading') { root.innerHTML = skeletonBlock(2); return; }
  if (baysState === 'error') {
    root.innerHTML = errorState({ message: baysError });
    root.querySelector('[data-action="retry"]').addEventListener('click', loadBays);
    return;
  }
  root.innerHTML = `<div class="pos-grid">${bays.map((b) => {
    const outOfService = b.status === 'Out of Service';
    const occupiedByOther = b.status === 'Occupied' && b.tripId !== trip.id;
    const selected = b.tripId === trip.id;
    const classes = ['pos-card'];
    if (outOfService) classes.push('out-of-service');
    if (occupiedByOther) classes.push('occupied');
    if (selected) classes.push('selected');
    return `
      <button type="button" class="${classes.join(' ')}" data-bay="${esc(b.code)}" ${outOfService ? 'disabled' : ''}>
        <strong>${esc(b.code)}</strong>
        <div class="fs-xs muted">${esc(b.status)}</div>
      </button>`;
  }).join('')}</div>`;
  root.querySelectorAll('[data-bay]').forEach((btn) => btn.addEventListener('click', () => onAssignBay(btn.dataset.bay)));
}

async function onAssignBay(bayCode) {
  if (!trip) return;
  try {
    trip = await api.assignBay(trip.id, bayCode);
    await loadBays();
    renderResultPanel();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ===================== gate events ===================== */

async function loadGateEvents() {
  eventsState = 'loading';
  renderEventsSection();
  try {
    events = await api.getGateEvents();
    eventsState = 'ready';
  } catch (err) {
    eventsState = 'error';
    eventsError = err.message;
  }
  renderEventsSection();
}

function renderEventsSection() {
  const root = appEl?.querySelector('#gate-events-root');
  if (!root) return;
  if (eventsState === 'loading') { root.innerHTML = skeletonBlock(4); return; }
  if (eventsState === 'error') {
    root.innerHTML = errorState({ message: eventsError });
    root.querySelector('[data-action="retry"]').addEventListener('click', loadGateEvents);
    return;
  }
  if (!events.length) { root.innerHTML = emptyState({ message: 'No gate events yet.' }); return; }
  root.innerHTML = `<div class="stack gap-2">${events.map((e) => `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);padding:var(--s2) 0;border-bottom:1px solid var(--border)">
      <div>
        <span class="mono fs-sm">${esc(e.plate)}</span>
        <span class="fs-xs muted"> · ${esc(e.message)}</span>
      </div>
      <div class="row gap-2">
        ${statusChip(e.outcome)}
        <span class="fs-xs muted" title="${esc(fmtDateTime(e.time))}">${esc(fmtRelative(e.time))}</span>
      </div>
    </div>`).join('')}</div>`;
}

/* ===================== trucks waiting for a bay ===================== */

async function loadWaiting() {
  waitingState = 'loading';
  renderWaitingSection();
  try {
    waitingTrucks = await api.getIncoming();
    waitingState = 'ready';
  } catch (err) {
    waitingState = 'error';
    waitingError = err.message;
  }
  renderWaitingSection();
}

function renderWaitingSection() {
  const root = appEl?.querySelector('#gate-waiting-root');
  if (!root) return;
  if (waitingState === 'error') {
    root.innerHTML = `<div class="section-title">Trucks waiting for a bay</div>${errorState({ message: waitingError })}`;
    root.querySelector('[data-action="retry"]').addEventListener('click', loadWaiting);
    return;
  }
  if (waitingState !== 'ready' || baysState !== 'ready') { root.innerHTML = ''; return; }
  const allBusy = bays.filter((b) => b.status !== 'Out of Service').every((b) => b.status === 'Occupied');
  const waiting = waitingTrucks.filter((t) => t.status === 'At Gate' && !t.bay);
  if (!allBusy || !waiting.length) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <div class="section-title">${icon('alert-triangle', 16)} All bays busy — trucks waiting</div>
    <div class="stack gap-2" style="margin-block-end:var(--s6)">
      ${waiting.map((t) => `
        <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);padding:var(--s2) 0;border-bottom:1px solid var(--border)">
          <span class="fs-sm"><strong class="mono">${esc(t.code)}</strong> · ${esc(t.truckPlate)} · ${esc(t.driverName)}</span>
          <span class="fs-xs muted">${esc(fmtRelative(t.arrivedAt || t.eta))}</span>
        </div>`).join('')}
    </div>`;
}
