import * as api from '../api.js';
import {
  esc, icon, toast, skeletonBlock, emptyState, errorState, openModal,
} from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';
import { OFF_ZONE_REASONS } from '../seed.js';

let appEl = null;
let activeTab = 'sort'; // sort | store

/* ---- Sort tab state ---- */
let sortState = 'loading'; // loading | error | ready
let sortQueue = [];
let sortError = '';
let scanInstance = null;
let sortTargetTimer = null;

/* ---- Store tab state ---- */
let storeState = 'loading'; // loading | error | ready
let storeQueue = [];
let storeError = '';
let storeScanInstance = null;
let suggestion = null; // { bag, zoneCode, destination, quarantine, freeLocations }
let totals = null; // { awaitingScreening, awaitingStorage, stored }

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  activeTab = 'sort';
  sortState = 'loading'; sortQueue = []; sortError = '';
  storeState = 'loading'; storeQueue = []; storeError = ''; suggestion = null; totals = null;
  renderShell();
  loadSort();
  return { destroy, refresh };
}

export function destroy() {
  scanInstance?.destroy(); scanInstance = null;
  storeScanInstance?.destroy(); storeScanInstance = null;
  clearTimeout(sortTargetTimer); sortTargetTimer = null;
  appEl = null;
}

function refresh() {
  if (activeTab === 'sort') loadSort();
  else loadStore();
}

/* ===================== Shell / tabs ===================== */

function renderShell() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Sorting &amp; storage</h1>
        <p class="page-subtitle">Sort screened bags into their zone, then store them at a location.</p>
      </div>
    </div>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" aria-selected="${activeTab === 'sort'}" data-tab="sort">Sort</button>
      <button type="button" class="tab" role="tab" aria-selected="${activeTab === 'store'}" data-tab="store">Store</button>
    </div>
    <div id="storage-tab-root"></div>`;

  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.tab === activeTab) return;
    activeTab = btn.dataset.tab;
    appEl.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === activeTab)));
    renderTabRoot();
    if (activeTab === 'sort' && sortState === 'loading') loadSort();
    if (activeTab === 'store' && storeState === 'loading') loadStore();
  }));
  renderTabRoot();
}

function renderTabRoot() {
  const root = appEl?.querySelector('#storage-tab-root');
  if (!root) return;
  if (activeTab === 'sort') renderSortTab(root);
  else renderStoreTab(root);
}

/* ===================== Sort tab ===================== */

async function loadSort() {
  if (!appEl) return;
  sortState = 'loading';
  if (activeTab === 'sort') renderTabRoot();
  try {
    sortQueue = await api.getSortQueue();
    if (!appEl) return;
    sortState = 'ready';
  } catch (err) {
    if (!appEl) return;
    sortError = err.message;
    sortState = 'error';
  }
  if (activeTab === 'sort') renderTabRoot();
}

function renderSortTab(root) {
  scanInstance?.destroy(); scanInstance = null;
  clearTimeout(sortTargetTimer); sortTargetTimer = null;
  if (sortState === 'loading') { root.innerHTML = skeletonBlock(6); return; }
  if (sortState === 'error') {
    root.innerHTML = errorState({ message: sortError });
    root.querySelector('[data-action="retry"]').addEventListener('click', loadSort);
    return;
  }
  root.innerHTML = `
    <div id="sort-target-root" style="margin-block-end:var(--s5)"></div>
    <div class="grid grid-cols-2">
      <div><div id="sort-scan-root"></div></div>
      <div class="card">
        <div class="section-title">Waiting to sort</div>
        <div id="sort-queue-list"></div>
      </div>
    </div>`;

  showSortTarget(null);
  scanInstance = createScanInput(root.querySelector('#sort-scan-root'), {
    label: 'Scan bag tag',
    placeholder: 'e.g. RBL-A-0031',
    onSubmit: async (code) => {
      const result = await api.sortBag(code);
      showSortTarget(result.lane);
      await refreshSortQueue();
      const message = result.lane.quarantine
        ? `${result.bag.tagNumber} sent to quarantine.`
        : `${result.bag.tagNumber} → ${result.lane.zoneCode}.`;
      return { message };
    },
  });
  renderSortQueueList();
}

function showSortTarget(lane) {
  const root = appEl?.querySelector('#sort-target-root');
  if (!root) return;
  clearTimeout(sortTargetTimer);
  if (!lane) {
    root.innerHTML = `<div class="card"><p class="sort-target muted" style="font-size:var(--fs-lg)">Scan a bag to see its sort target.</p></div>`;
    return;
  }
  const label = lane.quarantine
    ? `${icon('alert-triangle', 28)} QUARANTINE &middot; Zone ${esc(lane.zoneCode)}`
    : `${icon('arrow-right', 28)} Zone ${esc(lane.zoneCode)} &middot; ${esc(lane.flightCode)} &middot; ${esc(lane.destination)}`;
  root.innerHTML = `<div class="card"><p class="sort-target ${lane.quarantine ? 'quarantine' : ''}">${label}</p></div>`;
  sortTargetTimer = setTimeout(() => { if (appEl) showSortTarget(null); }, 2500);
}

function renderSortQueueList() {
  const root = appEl?.querySelector('#sort-queue-list');
  if (!root) return;
  if (!sortQueue.length) { root.innerHTML = emptyState({ message: 'Nothing waiting to be sorted.' }); return; }
  root.innerHTML = `
    <div class="stack gap-2">
      ${sortQueue.map((b) => `
        <div class="row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
          <div>
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
            <div class="fs-xs muted">${esc(b.pilgrimName)} &middot; ${esc(b.flightCode)} &middot; ${esc(b.destination)}</div>
          </div>
          ${statusChip(b.status)}
        </div>`).join('')}
    </div>`;
}

async function refreshSortQueue() {
  try {
    sortQueue = await api.getSortQueue();
  } catch (err) {
    if (appEl) toast(err.message, 'error');
    return;
  }
  if (!appEl) return;
  renderSortQueueList();
}

/* ===================== Store tab ===================== */

async function loadStore() {
  if (!appEl) return;
  storeState = 'loading';
  suggestion = null;
  if (activeTab === 'store') renderTabRoot();
  try {
    const [queue, t] = await Promise.all([api.getStoreQueue(), api.getProcessingTotals()]);
    if (!appEl) return;
    storeQueue = queue;
    totals = t;
    storeState = 'ready';
  } catch (err) {
    if (!appEl) return;
    storeError = err.message;
    storeState = 'error';
  }
  if (activeTab === 'store') renderTabRoot();
}

function renderStoreTab(root) {
  storeScanInstance?.destroy(); storeScanInstance = null;
  if (storeState === 'loading') { root.innerHTML = skeletonBlock(6); return; }
  if (storeState === 'error') {
    root.innerHTML = errorState({ message: storeError });
    root.querySelector('[data-action="retry"]').addEventListener('click', loadStore);
    return;
  }
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div>
        <div id="store-scan-root"></div>
        <div id="store-suggestion-root" style="margin-block-start:var(--s4)"></div>
      </div>
      <div class="card">
        <div class="section-title">Waiting to store</div>
        <div id="store-queue-list"></div>
      </div>
    </div>
    <div class="card" id="store-totals-card" style="margin-block-start:var(--s5)"></div>`;

  storeScanInstance = createScanInput(root.querySelector('#store-scan-root'), {
    label: 'Scan bag tag',
    placeholder: 'e.g. RBL-A-0031',
    onSubmit: onStoreScan,
  });
  renderStoreQueueList();
  renderSuggestion();
  renderTotalsCard();
}

async function onStoreScan(code) {
  const q = String(code).trim().toLowerCase();
  const bag = storeQueue.find((b) => b.tagNumber.toLowerCase() === q);
  if (!bag) throw new Error('Unrecognised tag, or this bag is not ready to store.');
  const sug = await api.suggestZone(bag.id);
  suggestion = { bag, ...sug };
  renderSuggestion();
  return { message: `Suggested zone ${sug.zoneCode} — pick a location.` };
}

function renderStoreQueueList() {
  const root = appEl?.querySelector('#store-queue-list');
  if (!root) return;
  if (!storeQueue.length) { root.innerHTML = emptyState({ message: 'Nothing waiting to be stored.' }); return; }
  root.innerHTML = `
    <div class="stack gap-2">
      ${storeQueue.map((b) => `
        <div class="row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
          <div>
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
            <div class="fs-xs muted">${esc(b.pilgrimName)} &middot; Zone ${esc(b.sortedLane?.zoneCode || '—')}</div>
          </div>
          ${b.sortedLane?.quarantine ? '<span class="chip chip-red">Quarantine</span>' : statusChip(b.status)}
        </div>`).join('')}
    </div>`;
}

function renderSuggestion() {
  const root = appEl?.querySelector('#store-suggestion-root');
  if (!root) return;
  if (!suggestion) { root.innerHTML = ''; return; }
  const { bag, zoneCode, destination, quarantine, freeLocations } = suggestion;
  root.innerHTML = `
    <div class="card ${quarantine ? 'quarantine' : ''}">
      <div class="row" style="justify-content:space-between">
        <div>
          <strong class="fs-sm mono">${esc(bag.tagNumber)}</strong>
          <div class="fs-xs muted">${esc(bag.pilgrimName)}</div>
        </div>
        ${quarantine ? '<span class="chip chip-red">Quarantine</span>' : ''}
      </div>
      <p class="fs-sm" style="margin-block:var(--s3)">Suggested zone <strong>${esc(zoneCode)}</strong> &middot; ${esc(destination)}</p>
      ${freeLocations.length ? `
        <div class="pos-grid">
          ${freeLocations.map((l) => `
            <button type="button" class="pos-card" data-action="pick-location" data-code="${esc(l.code)}" aria-label="Location ${esc(l.code)}, ${l.free} free">
              <strong class="mono">${esc(l.code)}</strong>
              <div class="fs-xs muted">${l.free} free</div>
            </button>`).join('')}
        </div>` : `<p class="fs-sm muted">No free locations in this zone.</p>`}
    </div>`;
  root.querySelectorAll('[data-action="pick-location"]').forEach((btn) => btn.addEventListener('click', () => onPickLocation(btn.dataset.code)));
}

async function onPickLocation(locationCode) {
  if (!suggestion) return;
  await attemptStore(suggestion.bag, locationCode, undefined);
}

async function attemptStore(bag, locationCode, reason) {
  try {
    await api.storeBag(bag.id, locationCode, reason);
    toast(`${bag.tagNumber} stored at ${locationCode}.`, 'success');
    suggestion = null;
    renderSuggestion();
    await refreshStoreQueueAndTotals();
  } catch (err) {
    if (err.code === 'wrong-zone') { openOffZoneReasonModal(bag, locationCode); return; }
    toast(err.message, 'error');
  }
}

function openOffZoneReasonModal(bag, locationCode) {
  let submitting = false;
  const close = openModal({
    title: 'Store off-zone',
    bodyHtml: `
      <form id="off-zone-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">${esc(locationCode)} is outside ${esc(bag.tagNumber)}'s suggested zone. Choose a reason to continue.</p>
        <div class="field">
          <label for="off-zone-reason">Reason <span class="req">*</span></label>
          <select id="off-zone-reason" required>
            <option value="">Select…</option>
            ${OFF_ZONE_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
          <div class="error" id="err-off-zone" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="off-zone-submit">Store</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('off-zone-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reason = form.querySelector('#off-zone-reason').value;
    const errBox = form.querySelector('#err-off-zone');
    if (!reason) { errBox.textContent = 'Reason is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#off-zone-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Storing…';
    try {
      await api.storeBag(bag.id, locationCode, reason);
      close();
      toast(`${bag.tagNumber} stored at ${locationCode}.`, 'success');
      suggestion = null;
      renderSuggestion();
      await refreshStoreQueueAndTotals();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Store';
      errBox.textContent = err.message; errBox.hidden = false;
    }
  });
}

async function refreshStoreQueueAndTotals() {
  try {
    const [queue, t] = await Promise.all([api.getStoreQueue(), api.getProcessingTotals()]);
    storeQueue = queue;
    totals = t;
  } catch (err) {
    if (appEl) toast(err.message, 'error');
    return;
  }
  if (!appEl) return;
  renderStoreQueueList();
  renderTotalsCard();
}

function renderTotalsCard() {
  const root = appEl?.querySelector('#store-totals-card');
  if (!root || !totals) return;
  const allDone = totals.awaitingScreening === 0 && totals.awaitingStorage === 0;
  root.innerHTML = `
    <div class="section-title" style="margin-block-end:var(--s2)">All bags processed?</div>
    <p class="fs-sm muted">${totals.awaitingScreening} awaiting screening &middot; ${totals.awaitingStorage} awaiting storage &middot; ${totals.stored} stored</p>
    ${allDone ? `<a class="btn btn-primary" style="margin-block-start:var(--s3)" href="#/reports">${icon('bar-chart-2', 16)} Generate warehouse report</a>` : ''}`;
}
