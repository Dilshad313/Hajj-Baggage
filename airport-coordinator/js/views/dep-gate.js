import * as api from '../api.js';
import {
  esc, icon, toast, fmtRelative, skeletonBlock, emptyState, errorState,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';

const BAYS = ['OFF-1', 'OFF-2', 'OFF-3', 'OFF-4', 'OFF-5', 'OFF-6'];

let appEl = null;
let gateScanInstance = null;
let sealScanInstance = null;
let lastAttemptedCode = '';
let unknownPanelVisible = false;
let resultTrip = null; // the trip currently shown in the result panel, or null

let trucksData = null;
let trucksError = '';
let holdsData = null;
let holdsError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  gateScanInstance = null;
  sealScanInstance = null;
  lastAttemptedCode = '';
  unknownPanelVisible = false;
  resultTrip = null;
  trucksData = null; trucksError = '';
  holdsData = null; holdsError = '';
  renderShell();
  refreshLists();
  return { destroy, refresh: refreshLists, activeTripId: () => (resultTrip ? resultTrip.id : null) };
}

export function destroy() {
  gateScanInstance?.destroy(); gateScanInstance = null;
  sealScanInstance?.destroy(); sealScanInstance = null;
  appEl = null;
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Gate &amp; holds</h1>
        <p class="page-subtitle">Scan arriving trucks, resolve exceptions, assign a bay.</p>
      </div>
    </div>
    <div class="grid grid-cols-2">
      <div>
        <div id="gate-scan-root"></div>
        <div id="unknown-truck-root"></div>
      </div>
      <div id="gate-result-root"></div>
    </div>
    <div class="section-title" style="margin-block-start:var(--s6)">Trucks at gate</div>
    <div id="trucks-at-gate-root"></div>
    <div class="section-title" style="margin-block-start:var(--s6)">Security holds</div>
    <div id="security-holds-root"></div>`;
  gateScanInstance = createScanInput(appEl.querySelector('#gate-scan-root'), {
    label: 'Scan truck plate or trip code',
    placeholder: 'e.g. TRK-D13',
    onSubmit: onGateScan,
  });
}

/* ===================== GATE SCAN & RESULT PANEL ===================== */

async function onGateScan(code) {
  lastAttemptedCode = code;
  try {
    const trip = await api.gateScan(code);
    hideUnknownPanel();
    resultTrip = trip;
    renderResultPanel();
    await refreshLists();
    return { message: `${trip.code} — ${trip.truckPlate} identified.` };
  } catch (err) {
    if (err.code === 'unknown') showUnknownPanel();
    else hideUnknownPanel();
    throw err;
  }
}

async function refreshResultTrip() {
  if (!resultTrip) return;
  const forId = resultTrip.id;
  try {
    const { trip } = await api.getDepReceiving(forId);
    if (!appEl || !resultTrip || resultTrip.id !== forId) return;
    resultTrip = trip;
  } catch (err) {
    if (!appEl) return;
    toast(err.message, 'error');
  }
}

function renderResultPanel() {
  const root = appEl?.querySelector('#gate-result-root');
  if (!root || !resultTrip) return;
  sealScanInstance?.destroy();
  root.innerHTML = `
    <div class="card" id="gate-result-card">
      <div id="gate-result-header"></div>
      <div id="gate-release-hold-root"></div>
      <div class="section-title">Verify seal</div>
      <div id="gate-seal-scan-root"></div>
      <div class="section-title">Assign bay</div>
      <div id="gate-bay-grid-root"></div>
      <div id="gate-to-receiving-root"></div>
    </div>`;
  sealScanInstance = createScanInput(root.querySelector('#gate-seal-scan-root'), {
    label: 'Scan the truck seal number',
    placeholder: resultTrip.sealNumber,
    onSubmit: async (code) => {
      try {
        const trip = await api.verifySeal(resultTrip.id, code);
        resultTrip = trip;
        renderResultHeaderAndExtras();
        await refreshLists();
        return { message: 'Seal verified.' };
      } catch (err) {
        await refreshResultTrip();
        renderResultHeaderAndExtras();
        await refreshLists();
        throw err;
      }
    },
  });
  renderResultHeaderAndExtras();
}

function renderResultHeaderAndExtras() {
  if (!appEl || !resultTrip) return;
  const header = appEl.querySelector('#gate-result-header');
  if (header) {
    header.innerHTML = `
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3)">
        <div>
          <h2 class="fs-lg">${esc(resultTrip.code)}</h2>
          <p class="fs-sm muted">${esc(resultTrip.truckPlate)} · ${esc(resultTrip.driverName)}</p>
        </div>
        ${statusChip(resultTrip.status)}
      </div>
      <div class="stack gap-1 fs-sm" style="margin-block:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted">Flight</span><strong>${esc(resultTrip.flightCode)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Seal number</span><strong class="mono">${esc(resultTrip.sealNumber)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Bay</span><strong>${esc(resultTrip.bay || '—')}</strong></div>
      </div>`;
  }
  renderReleaseHoldSection();
  renderBayGrid();
  renderToReceivingButton();
}

async function renderReleaseHoldSection() {
  const root = appEl?.querySelector('#gate-release-hold-root');
  if (!root || !resultTrip) return;
  if (resultTrip.status !== 'Security Hold') { root.innerHTML = ''; return; }
  const forId = resultTrip.id;
  root.innerHTML = skeletonBlock(2);
  try {
    const holds = await api.getSecurityHolds();
    if (!appEl || !resultTrip || resultTrip.id !== forId) return;
    const hold = holds.find((h) => h.tripId === forId);
    if (!hold) { root.innerHTML = ''; return; }
    root.innerHTML = releaseHoldCardHtml(hold.id, hold.reason);
    root.querySelector('.release-hold-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submitReleaseHold(e.currentTarget, async () => {
        await refreshResultTrip();
        renderResultHeaderAndExtras();
        await refreshLists();
      });
    });
  } catch (err) {
    if (!appEl) return;
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', renderReleaseHoldSection);
  }
}

function releaseHoldCardHtml(holdId, reason) {
  return `
    <div class="card" style="border-color:var(--warning);margin-block-end:var(--s4)">
      <div class="section-title">Release hold</div>
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">${esc(reason)}</p>
      <form class="release-hold-form" data-hold-id="${esc(holdId)}" novalidate>
        <div class="field">
          <label for="release-notes-${esc(holdId)}">Notes <span class="req">*</span></label>
          <textarea id="release-notes-${esc(holdId)}" placeholder="Why is this hold being released? (5–300 characters)" required></textarea>
          <div class="error" data-err hidden></div>
        </div>
        <button type="submit" class="btn btn-primary">${icon('unlock', 16)} Release hold</button>
      </form>
    </div>`;
}

async function submitReleaseHold(form, onSuccess) {
  const holdId = form.dataset.holdId;
  const textarea = form.querySelector('textarea');
  const errBox = form.querySelector('[data-err]');
  const notes = textarea.value.trim();
  if (notes.length < 5 || notes.length > 300) {
    errBox.textContent = 'Notes must be 5–300 characters.';
    errBox.hidden = false;
    return;
  }
  errBox.hidden = true;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.releaseHold(holdId, notes);
    toast('Hold released.', 'success');
    await onSuccess();
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

function renderBayGrid() {
  const root = appEl?.querySelector('#gate-bay-grid-root');
  if (!root || !resultTrip) return;
  root.innerHTML = `<div class="pos-grid">${BAYS.map((bay) => {
    const selected = resultTrip.bay === bay;
    return `
      <button type="button" class="pos-card ${selected ? 'selected' : ''}" data-bay="${esc(bay)}" aria-label="Bay ${esc(bay)}${selected ? ', assigned' : ''}">
        ${icon('warehouse', 24)}
        <div class="fs-sm fw-medium" style="margin-block-start:var(--s2)">${esc(bay)}</div>
      </button>`;
  }).join('')}</div>`;
  root.querySelectorAll('[data-bay]').forEach((btn) => btn.addEventListener('click', () => onAssignBay(btn)));
}

async function onAssignBay(btn) {
  if (!resultTrip) return;
  const bay = btn.dataset.bay;
  const root = appEl.querySelector('#gate-bay-grid-root');
  root.querySelectorAll('[data-bay]').forEach((b) => { b.disabled = true; });
  try {
    const trip = await api.assignBay(resultTrip.id, bay);
    resultTrip = trip;
    toast(`${bay} assigned.`, 'success');
    renderResultHeaderAndExtras();
    await refreshLists();
  } catch (err) {
    root.querySelectorAll('[data-bay]').forEach((b) => { b.disabled = false; });
    toast(err.message, 'error');
  }
}

function renderToReceivingButton() {
  const root = appEl?.querySelector('#gate-to-receiving-root');
  if (!root || !resultTrip) return;
  const canGo = !!resultTrip.bay && resultTrip.status !== 'Security Hold';
  if (!canGo) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <button type="button" class="btn btn-primary btn-block" style="margin-block-start:var(--s4)" data-action="to-receiving">
      ${icon('arrow-right-circle', 16)} Direct to receiving &amp; unloading
    </button>`;
  root.querySelector('[data-action="to-receiving"]').addEventListener('click', () => navigate(`#/dep/receiving/${resultTrip.id}`));
}

/* ===================== UNKNOWN TRUCK PANEL ===================== */

function showUnknownPanel() {
  unknownPanelVisible = true;
  renderUnknownPanel();
}

function hideUnknownPanel() {
  if (!unknownPanelVisible) return;
  unknownPanelVisible = false;
  renderUnknownPanel();
}

function renderUnknownPanel() {
  const root = appEl?.querySelector('#unknown-truck-root');
  if (!root) return;
  if (!unknownPanelVisible) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <div class="card" style="border-color:var(--warning);margin-block-start:var(--s4)">
      <div class="section-title">Unknown truck</div>
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Unknown truck — not admitted. Contact the transport coordinator and log the details.</p>
      <form id="unknown-truck-form" novalidate>
        <div class="field">
          <label for="ut-plate">Plate <span class="req">*</span></label>
          <input id="ut-plate" value="${esc(lastAttemptedCode)}" required />
        </div>
        <div class="field">
          <label for="ut-driver">Driver name <span class="req">*</span></label>
          <input id="ut-driver" required />
        </div>
        <div class="field">
          <label for="ut-phone">Driver phone</label>
          <input id="ut-phone" placeholder="+9665XXXXXXXX" />
        </div>
        <div class="field">
          <label for="ut-notes">Notes</label>
          <textarea id="ut-notes" maxlength="300" placeholder="Up to 300 characters"></textarea>
          <div class="error" id="err-ut-notes" hidden></div>
        </div>
        <button type="submit" class="btn btn-secondary btn-block" id="ut-submit">${icon('phone', 16)} Contact transport coordinator</button>
      </form>
    </div>`;
  root.querySelector('#unknown-truck-form').addEventListener('submit', onUnknownTruckSubmit);
}

async function onUnknownTruckSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const plate = form.querySelector('#ut-plate').value.trim();
  const driverName = form.querySelector('#ut-driver').value.trim();
  const phone = form.querySelector('#ut-phone').value.trim();
  const notes = form.querySelector('#ut-notes').value.trim();
  const errBox = form.querySelector('#err-ut-notes');
  if (notes.length > 300) { errBox.textContent = 'Notes must be 300 characters or fewer.'; errBox.hidden = false; return; }
  errBox.hidden = true;
  if (!plate || !driverName) { toast('Plate and driver name are required.', 'error'); return; }
  const btn = form.querySelector('#ut-submit');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.contactTransportCoordinator({ plate, driverName, phone: phone || null, notes: notes || null });
    toast('Transport coordinator notified.', 'success');
    hideUnknownPanel();
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

/* ===================== LISTS: TRUCKS AT GATE / SECURITY HOLDS ===================== */

function refreshLists() {
  return Promise.all([loadTrucksAtGate(), loadSecurityHolds()]);
}

async function loadTrucksAtGate() {
  const root = appEl?.querySelector('#trucks-at-gate-root');
  if (!root) return;
  root.innerHTML = skeletonBlock(3);
  try {
    trucksData = await api.getTrucksAtGate();
    if (!appEl) return;
    trucksError = '';
    renderTrucksAtGate();
  } catch (err) {
    if (!appEl) return;
    trucksError = err.message;
    renderTrucksAtGateError();
  }
}

function renderTrucksAtGateError() {
  const root = appEl?.querySelector('#trucks-at-gate-root');
  if (!root) return;
  root.innerHTML = errorState({ message: trucksError });
  root.querySelector('[data-action="retry"]').addEventListener('click', loadTrucksAtGate);
}

function renderTrucksAtGate() {
  const root = appEl?.querySelector('#trucks-at-gate-root');
  if (!root) return;
  if (!trucksData.length) { root.innerHTML = emptyState({ message: 'No trucks currently at the gate.' }); return; }
  root.innerHTML = `<div class="stack gap-2">${trucksData.map((t) => `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);padding:var(--s2) 0;border-bottom:1px solid var(--border)">
      <div>
        <strong class="fs-sm mono">${esc(t.code)}</strong>
        <div class="fs-xs muted">${esc(t.truckPlate)} · ${esc(t.flightCode)}</div>
      </div>
      <div class="row gap-2">${statusChip(t.status)}<span class="fs-sm">${esc(t.bay || '—')}</span></div>
    </div>`).join('')}</div>`;
}

async function loadSecurityHolds() {
  const root = appEl?.querySelector('#security-holds-root');
  if (!root) return;
  root.innerHTML = skeletonBlock(3);
  try {
    holdsData = await api.getSecurityHolds();
    if (!appEl) return;
    holdsError = '';
    renderSecurityHolds();
  } catch (err) {
    if (!appEl) return;
    holdsError = err.message;
    renderSecurityHoldsError();
  }
}

function renderSecurityHoldsError() {
  const root = appEl?.querySelector('#security-holds-root');
  if (!root) return;
  root.innerHTML = errorState({ message: holdsError });
  root.querySelector('[data-action="retry"]').addEventListener('click', loadSecurityHolds);
}

function tripCodeFor(tripId) {
  return trucksData?.find((t) => t.id === tripId)?.code || tripId;
}

function renderSecurityHolds() {
  const root = appEl?.querySelector('#security-holds-root');
  if (!root) return;
  if (!holdsData.length) { root.innerHTML = emptyState({ message: 'No active security holds.' }); return; }
  root.innerHTML = `<div class="stack gap-3">${holdsData.map((h) => `
    <div class="discrepancy-row extra">
      <strong class="fs-sm mono">${esc(tripCodeFor(h.tripId))}</strong>
      <div class="fs-xs muted">${esc(h.reason)}</div>
      <div class="fs-xs muted">${esc(fmtRelative(h.createdAt))}</div>
      <form class="release-hold-form" data-hold-id="${esc(h.id)}" novalidate style="margin-block-start:var(--s3);max-width:420px">
        <div class="field">
          <label for="hold-notes-${esc(h.id)}">Release notes <span class="req">*</span></label>
          <textarea id="hold-notes-${esc(h.id)}" placeholder="Why is this hold being released? (5–300 characters)" required></textarea>
          <div class="error" data-err hidden></div>
        </div>
        <button type="submit" class="btn btn-secondary">${icon('unlock', 16)} Release hold</button>
      </form>
    </div>`).join('')}</div>`;
  root.querySelectorAll('.release-hold-form').forEach((form) => form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitReleaseHold(e.currentTarget, async () => {
      await refreshResultTrip();
      renderResultHeaderAndExtras();
      await refreshLists();
    });
  }));
}
