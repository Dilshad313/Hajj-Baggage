import * as api from '../api.js';
import {
  esc, icon, toast, skeletonBlock, errorState, openModal,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';

let appEl = null;
let scanInstance = null;
let lastScan = null; // { batch, flight }
let muPositions = null;
let muError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  scanInstance = null;
  lastScan = null;
  muPositions = null;
  muError = '';
  renderShell();
  return { destroy };
}

export function destroy() {
  scanInstance?.destroy();
  scanInstance = null;
  appEl = null;
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Arrivals at make-up</h1>
        <p class="page-subtitle">Scan the vehicle to identify its batch, then direct it to a make-up position.</p>
      </div>
    </div>
    <div class="grid grid-cols-2">
      <div><div id="arrivals-scan-root"></div></div>
      <div id="arrivals-result-root"></div>
    </div>`;
  scanInstance = createScanInput(appEl.querySelector('#arrivals-scan-root'), {
    label: 'Scan vehicle / dolly code',
    placeholder: 'e.g. DOL-02',
    onSubmit: onScanVehicle,
  });
}

async function onScanVehicle(code) {
  // scanVehicle's rejection messages (unknown / empty / other-airline) already read correctly —
  // let them propagate so scan-input shows its own fail banner.
  const result = await api.scanVehicle(code);
  if (!appEl) return { message: 'Scanned.' };
  lastScan = { batch: result.batch, flight: result.flight };
  renderResultPanel();
  return { message: `${result.vehicle.code} — ${result.batch.id} (${result.flight.code}), ${result.batch.bagIds.length} bag(s).` };
}

function renderResultPanel() {
  const root = appEl?.querySelector('#arrivals-result-root');
  if (!root || !lastScan) return;
  const { batch, flight } = lastScan;
  root.innerHTML = `
    <div class="card">
      <div class="section-title">Scanned batch</div>
      <div class="stack gap-1 fs-sm" style="margin-block-end:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted">Batch</span><strong class="mono">${esc(batch.id)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Flight</span><strong>${esc(flight.code)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Bags</span><strong>${batch.bagIds.length}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Current make-up position</span><strong class="mono" id="arrivals-current-mu">${esc(batch.mu)}</strong></div>
      </div>
      <div id="arrivals-confirm-root"></div>
      <div class="section-title">Direct to make-up position</div>
      <div id="arrivals-mu-root"></div>
    </div>`;
  loadMakeup();
}

async function loadMakeup() {
  const root = appEl?.querySelector('#arrivals-mu-root');
  if (!root) return;
  root.innerHTML = skeletonBlock(3);
  try {
    const result = await api.getMakeup();
    if (!appEl) return;
    muPositions = result;
    muError = '';
    renderMuGrid();
  } catch (err) {
    if (!appEl) return;
    muError = err.message;
    renderMuError();
  }
}

function renderMuError() {
  const root = appEl?.querySelector('#arrivals-mu-root');
  if (!root) return;
  root.innerHTML = errorState({ message: muError });
  root.querySelector('[data-action="retry"]').addEventListener('click', loadMakeup);
}

function renderMuGrid() {
  const root = appEl?.querySelector('#arrivals-mu-root');
  if (!root || !lastScan) return;
  const { batch } = lastScan;
  root.innerHTML = `
    <div class="pos-grid">
      ${muPositions.map((p) => {
        const occupied = !!p.batchId && p.batchId !== batch.id;
        const selected = p.code === batch.mu;
        const label = occupied ? esc(p.batchId) : (selected ? 'Assigned' : 'Free');
        return `
          <button type="button" class="pos-card ${occupied ? 'occupied' : ''} ${selected ? 'selected' : ''}" data-action="pick-mu" data-code="${esc(p.code)}"
            aria-label="Position ${esc(p.code)}, ${occupied ? `occupied by ${esc(p.batchId)}` : 'free'}">
            <strong>${esc(p.code)}</strong>
            <div class="fs-xs muted">${label}</div>
          </button>`;
      }).join('')}
    </div>`;
  root.querySelectorAll('[data-action="pick-mu"]').forEach((btn) => btn.addEventListener('click', () => onPickMu(btn.dataset.code)));
}

async function onPickMu(code) {
  if (!lastScan) return;
  if (code === lastScan.batch.mu) {
    // Nothing actually changes when re-picking the already-assigned slot, so the API's
    // reason requirement (only triggered when mu !== batch.mu) never applies here.
    try {
      await commitMakeup(code, null);
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  openReasonModal(code);
}

async function commitMakeup(code, reason) {
  const updated = await api.setMakeup(lastScan.batch.id, code, reason);
  if (!appEl) return;
  lastScan = { ...lastScan, batch: updated };
  toast(`Directed to ${code}.`, 'success');
  const muEl = appEl.querySelector('#arrivals-current-mu');
  if (muEl) muEl.textContent = code;
  renderConfirmation(code);
  await loadMakeup();
}

function renderConfirmation(code) {
  const root = appEl?.querySelector('#arrivals-confirm-root');
  if (!root) return;
  root.innerHTML = `
    <div class="card" style="margin-block-end:var(--s4);border-color:var(--success);background:var(--success-soft)">
      <p class="fs-sm">${icon('check-circle', 16)} Directed to ${esc(code)}.</p>
      <button type="button" class="btn btn-primary btn-block" data-action="go-to-batch" style="margin-block-start:var(--s3)">Go to batch ${icon('arrow-right', 16)}</button>
    </div>`;
  root.querySelector('[data-action="go-to-batch"]').addEventListener('click', () => navigate(`#/acceptance/${lastScan.batch.id}`));
}

function openReasonModal(code) {
  let submitting = false;
  const close = openModal({
    title: `Change make-up position to ${code}`,
    bodyHtml: `
      <form id="mu-reason-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">This batch is currently assigned to <strong class="mono">${esc(lastScan.batch.mu)}</strong>. Moving it to <strong class="mono">${esc(code)}</strong> requires a reason.</p>
        <div class="field">
          <label for="mu-reason-input">Reason <span class="req">*</span></label>
          <textarea id="mu-reason-input" placeholder="Why is this batch being redirected?" required></textarea>
          <div class="error" id="err-mu-reason" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="mu-reason-submit">Direct to ${esc(code)}</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('mu-reason-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reason = form.querySelector('#mu-reason-input').value.trim();
    const errBox = form.querySelector('#err-mu-reason');
    if (!reason) { errBox.textContent = 'A reason is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#mu-reason-submit');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Saving…';
    try {
      await commitMakeup(code, reason);
      close();
    } catch (err) {
      submitting = false;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = `Direct to ${code}`;
      toast(err.message, 'error');
    }
  });
}
