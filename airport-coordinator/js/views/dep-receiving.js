import * as api from '../api.js';
import {
  esc, icon, toast, fmtRelative, fmtDateTime, skeletonBlock, emptyState, errorState, openModal,
} from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';
import { stepperHtml } from '../components/stepper.js';

const STEP_LABELS = ['Unload & verify', 'Reconcile'];

let appEl = null;
let tripId = null;
let data = null; // { trip, bags, extra }
let discrepancy = null; // { expectedCount, scannedCount, missing, extra }
let receipt = null;
let step = 'loading'; // loading | error | unload | reconcile | receipt
let errorMessage = '';
let reconciling = false;
let scanInstance = null;

/** @param {{id:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  tripId = params.id;
  data = null;
  discrepancy = null;
  receipt = null;
  step = 'loading';
  errorMessage = '';
  reconciling = false;
  load();
  return { destroy, refresh, activeTripId: () => tripId };
}

export function destroy() {
  scanInstance?.destroy(); scanInstance = null;
  appEl = null;
}

function refresh() {
  if (step === 'reconcile') {
    refreshDiscrepancy().then(() => { if (appEl && step === 'reconcile') renderReconcileStep(); });
    return;
  }
  if (step === 'receipt') { loadReceipt(); return; }
  load();
}

async function load() {
  if (!appEl) return;
  step = 'loading';
  renderPage();
  try {
    data = await api.getDepReceiving(tripId);
    if (!appEl) return;
    if (data.trip.reconciledAt) {
      await loadReceipt();
    } else {
      discrepancy = null;
      step = 'unload';
      renderPage();
    }
  } catch (err) {
    if (!appEl) return;
    errorMessage = err.message;
    step = 'error';
    renderPage();
  }
}

async function refreshReceiving() {
  if (!appEl) return;
  try {
    data = await api.getDepReceiving(tripId);
  } catch (err) {
    if (!appEl) return;
    toast(err.message, 'error');
  }
}

async function refreshDiscrepancy() {
  if (!appEl) return;
  try {
    discrepancy = await api.depComputeDiscrepancy(tripId);
  } catch (err) {
    if (!appEl) return;
    toast(err.message, 'error');
  }
}

function renderPage() {
  if (!appEl) return;
  if (step === 'loading') {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Receiving</h1></div>${skeletonBlock(6)}`;
    return;
  }
  if (step === 'error') {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/dep/gate">${icon('arrow-left', 16)} Back to gate</a></div>${errorState({ message: errorMessage })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  if (step === 'receipt') { renderReceiptStep(); return; }
  if (step === 'reconcile') { renderReconcileStep(); return; }
  renderUnloadStep();
}

/* ===================== STEP 1: unload & scan ===================== */

function renderUnloadStep() {
  scanInstance?.destroy(); scanInstance = null;
  const { trip, bags, extra } = data;
  const scannedCount = bags.filter((b) => b.status !== 'In Transit to Airport').length;

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/dep/gate">${icon('arrow-left', 14)} Gate &amp; holds</a>
        <h1 class="page-title">${esc(trip.code)} <span class="muted fs-sm">· ${esc(trip.truckPlate)}</span></h1>
        <p class="page-subtitle">${esc(trip.flightCode)} · Bay ${esc(trip.bay || '—')} · Seal ${esc(trip.sealNumber)}</p>
      </div>
      ${statusChip(trip.status)}
    </div>
    ${stepperHtml(STEP_LABELS, 1)}
    ${!bags.length ? emptyState({ message: 'No bags on this manifest.' }) : `
      <div class="grid grid-cols-2">
        <div><div id="dep-scan-root"></div></div>
        <div class="card">
          <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
            <div class="section-title" style="margin-block-end:0">Manifest</div>
            <strong class="fs-sm" id="dep-scan-count">${scannedCount} / ${bags.length} scanned</strong>
          </div>
          <div class="capacity-bar" style="margin-block-end:var(--s4)">
            <div class="capacity-bar-fill ${scannedCount >= bags.length ? 'full' : ''}" id="dep-capacity-fill" style="width:${bags.length ? Math.round((scannedCount / bags.length) * 100) : 0}%"></div>
          </div>
          <div id="dep-bag-list"></div>
        </div>
      </div>
      <div class="row" style="justify-content:space-between;align-items:center;margin-block-start:var(--s5)">
        <span class="fs-sm muted" id="dep-extra-note">${extra.length ? `${extra.length} extra tag${extra.length === 1 ? '' : 's'} flagged` : 'All scans match the manifest so far.'}</span>
        <button type="button" class="btn btn-primary" data-action="to-reconcile">Verify &amp; reconcile ${icon('arrow-right', 16)}</button>
      </div>`}`;

  if (!bags.length) return;

  scanInstance = createScanInput(appEl.querySelector('#dep-scan-root'), {
    label: 'Scan bag tag',
    placeholder: 'e.g. RBL-A-0050',
    onSubmit: async (code) => {
      const result = await api.depScanBag(tripId, code);
      await refreshReceiving();
      if (!appEl) return result;
      renderBagList();
      updateScanProgress();
      return result;
    },
  });
  renderBagList();
  appEl.querySelector('[data-action="to-reconcile"]').addEventListener('click', onToReconcile);
}

function updateScanProgress() {
  if (!appEl || !data) return;
  const { bags, extra } = data;
  const scannedCount = bags.filter((b) => b.status !== 'In Transit to Airport').length;
  const countEl = appEl.querySelector('#dep-scan-count');
  if (countEl) countEl.textContent = `${scannedCount} / ${bags.length} scanned`;
  const fillEl = appEl.querySelector('#dep-capacity-fill');
  if (fillEl) {
    fillEl.style.width = `${bags.length ? Math.round((scannedCount / bags.length) * 100) : 0}%`;
    fillEl.classList.toggle('full', scannedCount >= bags.length);
  }
  const extraNote = appEl.querySelector('#dep-extra-note');
  if (extraNote) extraNote.textContent = extra.length ? `${extra.length} extra tag${extra.length === 1 ? '' : 's'} flagged` : 'All scans match the manifest so far.';
}

function renderBagList() {
  const root = appEl?.querySelector('#dep-bag-list');
  if (!root || !data) return;
  const { bags, extra } = data;
  root.innerHTML = `
    <div class="stack gap-2">
      ${bags.map((b) => `
        <div class="row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
          <div>
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
            <div class="fs-xs muted">${esc(b.pilgrimName)}</div>
          </div>
          ${statusChip(b.status)}
        </div>`).join('')}
    </div>
    ${extra.length ? `
      <div style="margin-block-start:var(--s4)">
        <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Extra / unrecognised tags</div>
        ${extra.map((e) => `<div class="fs-sm mono">${esc(e.tag)} <span class="muted fs-xs">· ${esc(fmtRelative(e.at))}</span></div>`).join('')}
      </div>` : ''}`;
}

async function onToReconcile() {
  step = 'reconcile';
  discrepancy = null;
  renderPage();
  await refreshDiscrepancy();
  if (!appEl || step !== 'reconcile') return;
  renderReconcileStep();
}

/* ===================== STEP 2: reconcile ===================== */

function renderReconcileStep() {
  if (!appEl || !data) return;
  const { trip } = data;
  if (!discrepancy) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">${esc(trip.code)}</h1></div>${stepperHtml(STEP_LABELS, 2)}${skeletonBlock(5)}`;
    return;
  }
  const { expectedCount, scannedCount, missing, extra } = discrepancy;
  const hasMissing = missing.length > 0;

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${esc(trip.code)} <span class="muted fs-sm">· Reconcile</span></h1>
        <p class="page-subtitle">Bay ${esc(trip.bay || '—')}</p>
      </div>
      ${statusChip(trip.status)}
    </div>
    ${stepperHtml(STEP_LABELS, 2)}
    <div class="grid grid-cols-3" style="margin-block-end:var(--s6)">
      <div class="kpi-tile"><div class="kpi-label">Expected</div><div class="kpi-value">${expectedCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scanned</div><div class="kpi-value">${scannedCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Missing</div><div class="kpi-value" style="color:${hasMissing ? 'var(--danger)' : 'inherit'}">${missing.length}</div></div>
    </div>

    ${hasMissing ? `
      <div class="section-title">Missing bags</div>
      <div class="stack gap-2" style="margin-block-end:var(--s4)">
        ${missing.map((b) => `
          <div class="discrepancy-row missing">
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong> — ${esc(b.pilgrimName)}
          </div>`).join('')}
      </div>
      ${!trip.discrepancyRecorded ? `<button type="button" class="btn btn-secondary" data-action="record-discrepancy" style="margin-block-end:var(--s5)">${icon('file-text', 16)} Record discrepancy &amp; notify operations</button>` : `<p class="fs-sm muted" style="margin-block-end:var(--s5)">${icon('check', 14)} Discrepancy recorded.</p>`}
    ` : `<div class="state-block" style="padding:var(--s6)">${icon('check-circle', 40)}<p>No bags are missing.</p></div>`}

    ${extra.length ? `
      <div class="section-title">Extra / unrecognised tags</div>
      <div class="stack gap-1" style="margin-block-end:var(--s5)">
        ${extra.map((e) => `<div class="fs-sm mono">${esc(e.tag)} <span class="muted fs-xs">· ${esc(fmtRelative(e.at))}</span></div>`).join('')}
      </div>` : ''}

    <div class="row" style="justify-content:space-between;align-items:center;margin-block-start:var(--s5)">
      <button type="button" class="btn btn-ghost" data-action="back-unload">${icon('arrow-left', 16)} Back to unloading</button>
      <button type="button" class="btn btn-primary" data-action="reconcile" ${reconciling ? 'disabled aria-busy="true"' : ''}>
        ${reconciling ? `<span class="spinner"></span> Reconciling…` : `${icon('check', 16)} Reconcile baggage`}
      </button>
    </div>`;

  appEl.querySelector('[data-action="back-unload"]').addEventListener('click', () => { step = 'unload'; renderPage(); });
  appEl.querySelector('[data-action="record-discrepancy"]')?.addEventListener('click', openDiscrepancyModal);
  appEl.querySelector('[data-action="reconcile"]').addEventListener('click', onReconcile);
}

function openDiscrepancyModal() {
  let submitting = false;
  const close = openModal({
    title: 'Record discrepancy & notify operations',
    bodyHtml: `
      <form id="dep-disc-form" novalidate>
        <div class="field">
          <label for="dep-disc-notes">Notes <span class="req">*</span></label>
          <textarea id="dep-disc-notes" placeholder="What did you check before recording this discrepancy? (10–500 characters)" required></textarea>
          <div class="error" id="dep-err-disc-notes" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="dep-disc-submit">Save</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('dep-disc-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const notes = form.querySelector('#dep-disc-notes').value.trim();
    const errBox = form.querySelector('#dep-err-disc-notes');
    if (notes.length < 10 || notes.length > 500) { errBox.textContent = 'Notes must be 10–500 characters.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#dep-disc-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      const result = await api.depRecordDiscrepancy(tripId, notes);
      close();
      toast(`${result.exceptionsCreated} exception${result.exceptionsCreated === 1 ? '' : 's'} created.`, 'success');
      if (data?.trip) data.trip.discrepancyRecorded = true;
      await refreshDiscrepancy();
      if (step === 'reconcile') renderReconcileStep();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save';
      toast(err.message, 'error');
    }
  });
}

async function onReconcile() {
  if (reconciling) return;
  reconciling = true;
  renderReconcileStep();
  try {
    await api.depReconcile(tripId);
    toast('Baggage reconciled.', 'success');
    reconciling = false;
    await loadReceipt();
  } catch (err) {
    reconciling = false;
    toast(err.message, 'error');
    renderReconcileStep();
  }
}

/* ===================== RECEIPT ===================== */

async function loadReceipt() {
  if (!appEl) return;
  step = 'receipt';
  renderPage();
  try {
    receipt = await api.getDepReceipt(tripId);
    if (!appEl) return;
    renderPage();
  } catch (err) {
    if (!appEl) return;
    errorMessage = err.message;
    step = 'error';
    renderPage();
  }
}

function renderReceiptStep() {
  if (!appEl) return;
  if (!receipt) {
    appEl.innerHTML = `${stepperHtml(STEP_LABELS, 2)}${skeletonBlock(6)}`;
    return;
  }
  const { trip, received, missing, generatedAt } = receipt;
  appEl.innerHTML = `
    ${stepperHtml(STEP_LABELS, 2)}
    <div class="receipt card no-print-margin">
      <div class="state-block" style="padding-block:var(--s4)">
        ${icon('check-circle', 48)}
        <h2 class="fs-lg">Airport reconciliation receipt</h2>
      </div>
      <div class="stack gap-2" style="margin-block-start:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Trip</span><strong class="mono">${esc(trip.code)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Flight</span><strong>${esc(trip.flightCode)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Seal</span><strong class="mono">${esc(trip.sealNumber)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Generated</span><strong>${esc(fmtDateTime(generatedAt))}</strong></div>
      </div>
      <div class="section-title" style="margin-block-start:var(--s5)">Received (${received.length})</div>
      <div class="stack gap-1">
        ${received.map((b) => `
          <div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
            <span class="fs-sm mono">${esc(b.tagNumber)}</span>
            <span class="fs-xs muted">${esc(b.pilgrimName)}</span>
          </div>`).join('')}
      </div>
      ${missing.length ? `
        <div class="section-title" style="margin-block-start:var(--s5)">Missing (${missing.length})</div>
        <div class="stack gap-1">
          ${missing.map((b) => `
            <div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
              <span class="fs-sm mono">${esc(b.tagNumber)}</span>
              <span class="fs-xs muted">${esc(b.pilgrimName)}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>
    <div class="row gap-2 wrap no-print" style="margin-block-start:var(--s5)">
      <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 16)} Print</button>
      <a class="btn btn-primary" href="#/dep/gate">${icon('arrow-left', 16)} Back to gate</a>
    </div>`;
  appEl.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
}
