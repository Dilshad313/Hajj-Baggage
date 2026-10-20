import * as api from '../api.js';
import {
  esc, icon, toast, skeletonBlock, emptyState, errorState, openModal,
} from '../ui.js';
import { PROHIBITED_CATEGORIES, DISPOSAL_OPTIONS } from '../seed.js';

const CHECKLIST_ITEMS = [
  'Checked all compartments',
  'Checked lining and pockets',
  'Compared against passenger declaration',
  'Checked for concealed items along seams',
];

let appEl = null;
let queueState = 'loading'; // loading | error | ready
let queue = null;
let queueError = '';

let inspectingBagId = null; // bag mid X-ray animation or manual checklist — blocks poll
let prohibitedModalOpen = false; // the 3-step prohibited-items modal is open — blocks poll

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  queueState = 'loading';
  queue = null;
  queueError = '';
  inspectingBagId = null;
  prohibitedModalOpen = false;
  load();
  return { destroy, refresh: load, poll };
}

export function destroy() {
  appEl = null;
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Screening</h1>
        <p class="page-subtitle">X-ray or manually inspect each bag before it moves to storage.</p>
      </div>
    </div>
    <div id="queue-root"></div>`;
}

async function load() {
  if (!appEl) return;
  renderShell();
  queueState = 'loading';
  renderQueue();
  try {
    queue = await api.getScreeningQueue();
    queueState = 'ready';
  } catch (err) {
    queueState = 'error';
    queueError = err.message;
  }
  renderQueue();
}

async function poll() {
  if (!appEl || inspectingBagId || prohibitedModalOpen) return;
  try {
    const q = await api.getScreeningQueue();
    if (!appEl) return;
    queue = q;
    queueState = 'ready';
    renderQueue();
  } catch (e) { /* silent background refresh */ }
}

function findQueueBag(bagId) {
  return (queue || []).find((b) => b.id === bagId);
}

function renderQueue() {
  const root = appEl?.querySelector('#queue-root');
  if (!root) return;
  if (queueState === 'loading') { root.innerHTML = skeletonBlock(5); return; }
  if (queueState === 'error') {
    root.innerHTML = errorState({ message: queueError });
    root.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  if (!queue.length) { root.innerHTML = emptyState({ message: 'No bags waiting for screening.' }); return; }
  root.innerHTML = `<div class="stack gap-2">${queue.map((b) => `
    <div class="card" data-bag-row="${esc(b.id)}">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3)">
        <div>
          <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
          <div class="fs-xs muted">${esc(b.pilgrimName || '—')} · ${esc(b.flightCode)} → ${esc(b.destination)}</div>
        </div>
        <div class="row gap-2 wrap" data-action-area>
          ${b.priority ? '<span class="chip chip-amber">Priority</span>' : ''}
          <button type="button" class="btn btn-secondary" data-action="xray" data-id="${esc(b.id)}">${icon('scan-search', 16)} X-Ray</button>
          <button type="button" class="btn btn-secondary" data-action="manual" data-id="${esc(b.id)}">${icon('search', 16)} Manual</button>
        </div>
      </div>
      <div class="inspect-root" style="display:none;margin-block-start:var(--s3)"></div>
    </div>`).join('')}</div>`;
  root.querySelectorAll('[data-action="xray"]').forEach((btn) => btn.addEventListener('click', () => onXray(btn.dataset.id)));
  root.querySelectorAll('[data-action="manual"]').forEach((btn) => btn.addEventListener('click', () => onManual(btn.dataset.id)));
}

function getRowRoots(bagId) {
  const row = appEl?.querySelector(`[data-bag-row="${CSS.escape(bagId)}"]`);
  return { row, actionArea: row?.querySelector('[data-action-area]'), inspectRoot: row?.querySelector('.inspect-root') };
}

/* ===================== X-ray ===================== */

async function onXray(bagId) {
  if (inspectingBagId) return;
  inspectingBagId = bagId;
  const { actionArea, inspectRoot } = getRowRoots(bagId);
  if (actionArea) actionArea.style.display = 'none';
  if (inspectRoot) {
    inspectRoot.style.display = '';
    inspectRoot.innerHTML = `<div class="xray-scanner"><div class="xray-bag"></div></div><p class="fs-sm muted" style="margin-block-start:var(--s2)">Scanning…</p>`;
  }
  const bag = findQueueBag(bagId);
  const apiPromise = api.screenXray(bagId);
  const minDelay = new Promise((resolve) => setTimeout(resolve, 3000));
  try {
    const [result] = await Promise.all([apiPromise, minDelay]);
    inspectingBagId = null;
    if (result.result === 'Clear') {
      await api.clearBag(bagId);
      toast(`${bag?.tagNumber || 'Bag'} cleared.`, 'success');
      await load();
      return;
    }
    toast('Suspicious item detected.', 'error');
    openProhibitedFlow(bagId);
  } catch (err) {
    inspectingBagId = null;
    toast(err.message, 'error');
    await load();
  }
}

/* ===================== Manual ===================== */

function onManual(bagId) {
  if (inspectingBagId) return;
  inspectingBagId = bagId;
  const { actionArea, inspectRoot } = getRowRoots(bagId);
  if (actionArea) actionArea.style.display = 'none';
  if (!inspectRoot) return;
  inspectRoot.style.display = '';
  inspectRoot.innerHTML = `
    <p class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Inspection checklist</p>
    <div class="stack gap-1" style="margin-block-end:var(--s3)">
      ${CHECKLIST_ITEMS.map((item, i) => `<label class="checkbox-row"><input type="checkbox" data-check="${i}" /> ${esc(item)}</label>`).join('')}
    </div>
    <div class="row gap-2 wrap">
      <button type="button" class="btn btn-secondary" data-action="manual-clear">${icon('check', 16)} Clear — no prohibited items</button>
      <button type="button" class="btn btn-danger" data-action="manual-prohibited">${icon('alert-triangle', 16)} Prohibited items found</button>
      <button type="button" class="btn btn-ghost" data-action="manual-cancel">Cancel</button>
    </div>`;
  inspectRoot.querySelector('[data-action="manual-clear"]').addEventListener('click', () => onManualClear(bagId));
  inspectRoot.querySelector('[data-action="manual-prohibited"]').addEventListener('click', () => openProhibitedFlow(bagId));
  inspectRoot.querySelector('[data-action="manual-cancel"]').addEventListener('click', () => { inspectingBagId = null; renderQueue(); });
}

async function onManualClear(bagId) {
  const bag = findQueueBag(bagId);
  try {
    await api.clearBag(bagId);
    toast(`${bag?.tagNumber || 'Bag'} cleared.`, 'success');
    inspectingBagId = null;
    await load();
  } catch (err) {
    inspectingBagId = null;
    toast(err.message, 'error');
    renderQueue();
  }
}

/* ===================== Prohibited items — 3-step flow ===================== */

function randomAlphaNum(len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function openProhibitedFlow(bagId) {
  prohibitedModalOpen = true;
  inspectingBagId = bagId;
  const bag = findQueueBag(bagId);
  let rows = [{ category: '', description: '', quantity: 1 }];
  let savedRows = null;
  let savedDisposal = null;

  const close = openModal({
    title: `Prohibited items${bag ? ` — ${bag.tagNumber}` : ''}`,
    bodyHtml: stepRemoveHtml(),
    onDismiss: () => { prohibitedModalOpen = false; inspectingBagId = null; renderQueue(); },
  });

  function modalBody() { return document.querySelector('.overlay .modal-body'); }

  function stepRemoveHtml() {
    return `
      <form id="prohibited-remove-form" novalidate>
        <div id="prohibited-rows"></div>
        <button type="button" class="btn btn-ghost" data-act="add-row" style="margin-block:var(--s2)">${icon('plus', 16)} Add another item</button>
        <div class="field">
          <label for="prohibited-disposal">Disposal <span class="req">*</span></label>
          <select id="prohibited-disposal" required>
            <option value="">Select…</option>
            ${DISPOSAL_OPTIONS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
          </select>
        </div>
        <div class="error" id="err-prohibited" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="prohibited-save">Save</button>
        </div>
      </form>`;
  }

  function rowHtml(row, idx) {
    return `
      <div class="row gap-2 wrap" data-row="${idx}" style="align-items:flex-end;margin-block-end:var(--s2)">
        <div class="field" style="flex:1;min-width:160px;margin-block-end:0">
          <label>Category <span class="req">*</span></label>
          <select data-field="category">
            <option value="">Select…</option>
            ${PROHIBITED_CATEGORIES.map((c) => `<option value="${esc(c)}" ${row.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:2;min-width:160px;margin-block-end:0">
          <label>Description <span class="req">*</span></label>
          <input type="text" data-field="description" value="${esc(row.description)}" maxlength="200" />
        </div>
        <div class="field" style="width:90px;margin-block-end:0">
          <label>Qty <span class="req">*</span></label>
          <input type="number" data-field="quantity" min="1" max="50" value="${esc(row.quantity)}" />
        </div>
        ${idx > 0 ? `<button type="button" class="btn btn-ghost btn-icon" data-act="remove-row" data-idx="${idx}" aria-label="Remove item">${icon('trash-2', 16)}</button>` : ''}
      </div>`;
  }

  function renderRows() {
    const rowsRoot = document.getElementById('prohibited-rows');
    if (!rowsRoot) return;
    rowsRoot.innerHTML = rows.map((r, i) => rowHtml(r, i)).join('');
    rowsRoot.querySelectorAll('[data-row]').forEach((rowEl) => {
      const idx = Number(rowEl.dataset.row);
      rowEl.querySelector('[data-field="category"]').addEventListener('change', (e) => { rows[idx].category = e.target.value; });
      rowEl.querySelector('[data-field="description"]').addEventListener('input', (e) => { rows[idx].description = e.target.value; });
      rowEl.querySelector('[data-field="quantity"]').addEventListener('input', (e) => { rows[idx].quantity = e.target.value; });
      rowEl.querySelector('[data-act="remove-row"]')?.addEventListener('click', () => { rows.splice(idx, 1); renderRows(); });
    });
  }

  function wireStepRemove() {
    renderRows();
    const form = document.getElementById('prohibited-remove-form');
    form.querySelector('[data-act="add-row"]').addEventListener('click', () => { rows.push({ category: '', description: '', quantity: 1 }); renderRows(); });
    // close() alone skips onDismiss (it only fires for backdrop/✕/Escape dismissal per
    // ui.js's contract), so the flags it resets must be cleared here explicitly too.
    form.querySelector('[data-act="cancel"]').addEventListener('click', () => {
      close();
      prohibitedModalOpen = false;
      inspectingBagId = null;
      renderQueue();
    });
    form.addEventListener('submit', onSaveRemove);
  }

  async function onSaveRemove(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const disposal = form.querySelector('#prohibited-disposal').value;
    const errBox = form.querySelector('#err-prohibited');
    for (const r of rows) {
      if (!r.category || !String(r.description).trim() || !r.quantity) {
        errBox.textContent = 'Fill in category, description and quantity for every row.';
        errBox.hidden = false;
        return;
      }
    }
    if (!disposal) { errBox.textContent = 'Disposal is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    const btn = form.querySelector('#prohibited-save');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Saving…';
    const payloadRows = rows.map((r) => ({ category: r.category, description: String(r.description).trim(), quantity: Number(r.quantity) }));
    try {
      await api.recordProhibited(bagId, { rows: payloadRows, disposal });
      savedRows = payloadRows;
      savedDisposal = disposal;
      renderStepRecord();
    } catch (err) {
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save';
      errBox.textContent = err.message; errBox.hidden = false;
    }
  }

  function renderStepRecord() {
    const body = modalBody();
    if (!body) return;
    body.innerHTML = `
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Items removed and recorded. Confirm to continue to re-sealing.</p>
      <div class="stack gap-2" style="margin-block-end:var(--s4)">
        ${savedRows.map((r) => `
          <div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
            <span class="fs-sm">${esc(r.category)} — ${esc(r.description)}</span>
            <span class="fs-sm mono">x${esc(r.quantity)}</span>
          </div>`).join('')}
        <div class="row" style="justify-content:space-between;margin-block-start:var(--s2)">
          <span class="fs-sm muted">Disposal</span>
          <strong class="fs-sm">${esc(savedDisposal)}</strong>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-act="confirm-record">${icon('check', 16)} Confirm</button>
      </div>`;
    body.querySelector('[data-act="confirm-record"]').addEventListener('click', renderStepReseal);
  }

  function renderStepReseal() {
    const body = modalBody();
    if (!body) return;
    body.innerHTML = `
      <form id="reseal-form" novalidate>
        <div class="field">
          <label for="reseal-input">Re-seal number <span class="req">*</span></label>
          <div class="row gap-2">
            <input id="reseal-input" placeholder="RS-XXXXXX" style="flex:1" required />
            <button type="button" class="btn btn-secondary" data-act="generate-reseal">Generate</button>
          </div>
          <div class="error" id="err-reseal" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary" id="reseal-submit">${icon('lock', 16)} Bag re-sealed with security tape</button>
        </div>
      </form>`;
    body.querySelector('[data-act="generate-reseal"]').addEventListener('click', () => {
      body.querySelector('#reseal-input').value = `RS-${randomAlphaNum(6)}`;
    });
    const form = body.querySelector('#reseal-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = form.querySelector('#reseal-input').value.trim();
      const errBox = form.querySelector('#err-reseal');
      if (!value) { errBox.textContent = 'Re-seal number is required.'; errBox.hidden = false; return; }
      errBox.hidden = true;
      const btn = form.querySelector('#reseal-submit');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Resealing…';
      try {
        await api.reseal(bagId, value);
        prohibitedModalOpen = false;
        inspectingBagId = null;
        close();
        toast('Bag re-sealed — screening complete.', 'success');
        await load();
      } catch (err) {
        btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Bag re-sealed with security tape';
        errBox.textContent = err.message; errBox.hidden = false;
      }
    });
  }

  wireStepRemove();
}
