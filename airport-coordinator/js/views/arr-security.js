import * as api from '../api.js';
import {
  esc, icon, toast, skeletonBlock, emptyState, errorState, openModal,
} from '../ui.js';
import { PROHIBITED_ITEM_TYPES } from '../seed.js';

let appEl = null;
let filterFlightCode = '';
let flightOptions = null;
let queue = null;
let loadError = '';
let scanningBagId = null; // bag currently showing the scan animation

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  filterFlightCode = '';
  flightOptions = null;
  queue = null;
  loadError = '';
  scanningBagId = null;
  load();
  return { destroy, refresh: load, poll, activeFlightCode: () => filterFlightCode || null };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  if (!queue) appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Security check</h1></div>${skeletonBlock(5)}`;
  try {
    const [flights, bags] = await Promise.all([
      api.getArrFlights(),
      api.getSecurityQueue(filterFlightCode || undefined),
    ]);
    if (!appEl) return;
    flightOptions = flights;
    queue = bags;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

async function poll() {
  if (!appEl || scanningBagId) return;
  try {
    const bags = await api.getSecurityQueue(filterFlightCode || undefined);
    if (!appEl) return;
    queue = bags;
    loadError = '';
    renderPage();
  } catch (e) { /* silent — keep showing the last known queue */ }
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Security check</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Security check</h1>
        <p class="page-subtitle">Screen each bag by X-ray or manual inspection before it's released for loading.</p>
      </div>
    </div>
    <div class="field" style="max-width:280px;margin-block-end:var(--s5)">
      <label for="flight-filter">Flight</label>
      <select id="flight-filter">
        <option value="">All flights</option>
        ${flightOptions.map((f) => `<option value="${esc(f.code)}" ${f.code === filterFlightCode ? 'selected' : ''}>${esc(f.code)}</option>`).join('')}
      </select>
    </div>
    <div id="queue-root"></div>`;

  appEl.querySelector('#flight-filter').addEventListener('change', (e) => {
    filterFlightCode = e.target.value;
    load();
  });

  renderQueue();
}

function renderQueue() {
  const root = appEl.querySelector('#queue-root');
  if (!root) return;
  if (!queue.length) {
    root.innerHTML = emptyState({ message: 'No bags waiting for a security check.' });
    return;
  }
  root.innerHTML = `<div class="stack gap-2">${queue.map((b) => `
    <div class="card" data-bag-row="${esc(b.id)}">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3)">
        <div>
          <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
          <div class="fs-xs muted">${esc(b.pilgrimName || '—')} · ${esc(b.hotel || '—')} · ${esc(b.flightCode)}</div>
        </div>
        <div class="row gap-2" data-action-area>
          <button type="button" class="btn btn-secondary" data-action="scan" data-method="xray" data-id="${esc(b.id)}">${icon('scan-search', 16)} X-Ray</button>
          <button type="button" class="btn btn-secondary" data-action="scan" data-method="manual" data-id="${esc(b.id)}">${icon('search', 16)} Manual</button>
        </div>
      </div>
      <div class="xray-scan-root" style="display:none;margin-block-start:var(--s3)"></div>
    </div>`).join('')}</div>`;
  root.querySelectorAll('[data-action="scan"]').forEach((btn) => btn.addEventListener('click', () => onScan(btn.dataset.id, btn.dataset.method)));
}

async function onScan(bagId, method) {
  if (scanningBagId) return;
  scanningBagId = bagId;
  const row = appEl.querySelector(`[data-bag-row="${CSS.escape(bagId)}"]`);
  const actionArea = row?.querySelector('[data-action-area]');
  const scanRoot = row?.querySelector('.xray-scan-root');
  if (actionArea) actionArea.style.display = 'none';
  if (scanRoot) {
    scanRoot.style.display = '';
    scanRoot.innerHTML = `<div class="xray-scanner">${method === 'xray' ? 'Scanning (X-ray)…' : 'Inspecting (manual)…'}</div>`;
  }
  const apiPromise = api.securityScan(bagId, method);
  const minDelay = delay(1100);
  try {
    const [result] = await Promise.all([apiPromise, minDelay]);
    scanningBagId = null;
    if (result.result === 'Clear') {
      toast(`${result.bag.tagNumber} cleared.`, 'success');
      await load();
      return;
    }
    openProhibitedFlow(result.bag);
  } catch (err) {
    scanningBagId = null;
    toast(err.message, 'error');
    await load();
  }
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function openProhibitedFlow(bag) {
  let submitting = false;
  const close = openModal({
    title: `Prohibited items — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="prohibited-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">Remove the prohibited item(s), then record what was found.</p>
        <div class="field">
          <label>Item type(s) <span class="req">*</span></label>
          ${PROHIBITED_ITEM_TYPES.map((t) => `<label class="checkbox-row"><input type="checkbox" name="prohibited-item" value="${esc(t)}" /> ${esc(t)}</label>`).join('')}
        </div>
        <div class="field">
          <label for="prohibited-notes">Notes <span class="req">*</span></label>
          <textarea id="prohibited-notes" required></textarea>
          <div class="error" id="err-prohibited-notes" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="prohibited-submit">Record items</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('prohibited-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const items = Array.from(form.querySelectorAll('input[name="prohibited-item"]:checked')).map((i) => i.value);
    const notes = form.querySelector('#prohibited-notes').value.trim();
    const errBox = form.querySelector('#err-prohibited-notes');
    if (!items.length) { toast('Select at least one item type.', 'error'); return; }
    if (!notes) { errBox.textContent = 'Notes are required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#prohibited-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.recordProhibitedItems(bag.id, { items, notes });
      renderResealStage(bag, close);
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Record items';
      toast(err.message, 'error');
    }
  });
}

function renderResealStage(bag, close) {
  const modal = document.querySelector('.overlay .modal-body');
  if (!modal) return;
  modal.innerHTML = `
    <p class="fs-sm muted" style="margin-block-end:var(--s4)">Prohibited item(s) removed and recorded. Re-seal the bag to continue.</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" id="reseal-submit">${icon('check', 16)} Re-seal bag</button>
    </div>`;
  const btn = modal.querySelector('#reseal-submit');
  let submitting = false;
  btn.addEventListener('click', async () => {
    if (submitting) return;
    submitting = true;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Resealing…';
    try {
      await api.resealBag(bag.id);
      close();
      toast(`${bag.tagNumber} re-sealed — security checked.`, 'success');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Re-seal bag';
      toast(err.message, 'error');
    }
  });
}
