import * as api from '../api.js';
import {
  esc, icon, toast, fmtRelative, skeletonBlock, emptyState, errorState, openModal,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';
import { stepperHtml } from '../components/stepper.js';

const STEP_LABELS = ['Unload & scan', 'Verify'];

let appEl = null;
let tripId = null;
let data = null; // { trip, bags, extra }
let discrepancy = null; // { expectedCount, scannedCount, missing, extra }
let accepted = null; // { acceptedCount, tripCode }
let step = 'loading'; // loading | error | unload | verify | done
let errorMessage = '';
let accepting = false;
let scanInstance = null;

/** @param {{sessionId:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  tripId = params.sessionId;
  data = null;
  discrepancy = null;
  accepted = null;
  step = 'loading';
  errorMessage = '';
  accepting = false;
  load();
  return { destroy, refresh, activeTripId: () => tripId };
}

export function destroy() {
  scanInstance?.destroy(); scanInstance = null;
  appEl = null;
}

function refresh() {
  if (step === 'verify') {
    refreshDiscrepancy().then(() => { if (appEl && step === 'verify') renderPage(); });
    return;
  }
  if (step === 'unload') { refreshUnload().then(() => { if (appEl && step === 'unload') renderUnloadStep(); }); return; }
  load();
}

async function load() {
  if (!appEl) return;
  step = 'loading';
  renderPage();
  try {
    data = await api.getUnloadingSession(tripId);
    if (!appEl) return;
    step = 'unload';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    errorMessage = err.message;
    step = 'error';
    renderPage();
  }
}

async function refreshUnload() {
  if (!appEl) return;
  try { data = await api.getUnloadingSession(tripId); } catch (err) { if (appEl) toast(err.message, 'error'); }
}

async function refreshDiscrepancy() {
  if (!appEl) return;
  try { discrepancy = await api.computeDiscrepancy(tripId); } catch (err) { if (appEl) toast(err.message, 'error'); }
}

function renderPage() {
  if (!appEl) return;
  if (step === 'loading') {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Unloading</h1></div>${skeletonBlock(6)}`;
    return;
  }
  if (step === 'error') {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/gate">${icon('arrow-left', 16)} Back to gate</a></div>${errorState({ message: errorMessage })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  if (step === 'done') { renderDoneStep(); return; }
  if (step === 'verify') { renderVerifyStep(); return; }
  renderUnloadStep();
}

/* ===================== STEP 1: unload ===================== */

function renderUnloadStep() {
  scanInstance?.destroy(); scanInstance = null;
  const { trip, bags, extra } = data;
  const scannedCount = bags.filter((b) => b.status !== 'Loaded to Collection Truck').length;

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/gate">${icon('arrow-left', 14)} Gate</a>
        <h1 class="page-title">${esc(trip.code)} <span class="muted fs-sm">· ${esc(trip.truckPlate)}</span></h1>
        <p class="page-subtitle">${esc(trip.centre)} · Bay ${esc(trip.bay || '—')} · Manifest ${esc(trip.manifestNo)}</p>
      </div>
      ${statusChip(trip.status)}
    </div>
    ${stepperHtml(STEP_LABELS, 1)}
    ${!bags.length ? emptyState({ message: 'No bags on this manifest.' }) : `
      <div class="grid grid-cols-2">
        <div><div id="unload-scan-root"></div></div>
        <div class="card">
          <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
            <div class="section-title" style="margin-block-end:0">Manifest</div>
            <strong class="fs-sm" id="unload-count">${scannedCount} / ${bags.length} scanned</strong>
          </div>
          <div class="capacity-bar" style="margin-block-end:var(--s4)">
            <div class="capacity-bar-fill ${scannedCount >= bags.length ? 'full' : ''}" id="unload-fill" style="width:${bags.length ? Math.round((scannedCount / bags.length) * 100) : 0}%"></div>
          </div>
          <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Expected — not yet scanned</div>
          <div id="unload-expected-list" style="margin-block-end:var(--s4)"></div>
          <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Scanned</div>
          <div id="unload-scanned-list"></div>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-block-start:var(--s5)">
        <button type="button" class="btn btn-primary" data-action="to-verify">Unloading complete — verify ${icon('arrow-right', 16)}</button>
      </div>`}`;

  if (!bags.length) return;

  scanInstance = createScanInput(appEl.querySelector('#unload-scan-root'), {
    label: 'Scan bag tag',
    placeholder: 'e.g. RBL-A-0031',
    onSubmit: async (code) => {
      const result = await api.unloadScan(tripId, code);
      await refreshUnload();
      if (!appEl) return result;
      renderUnloadLists();
      return result;
    },
  });
  renderUnloadLists();
  appEl.querySelector('[data-action="to-verify"]').addEventListener('click', onToVerify);
}

function renderUnloadLists() {
  if (!appEl || !data) return;
  const { bags, extra } = data;
  const scannedCount = bags.filter((b) => b.status !== 'Loaded to Collection Truck').length;
  const countEl = appEl.querySelector('#unload-count');
  if (countEl) countEl.textContent = `${scannedCount} / ${bags.length} scanned`;
  const fillEl = appEl.querySelector('#unload-fill');
  if (fillEl) { fillEl.style.width = `${Math.round((scannedCount / bags.length) * 100)}%`; fillEl.classList.toggle('full', scannedCount >= bags.length); }

  const expectedEl = appEl.querySelector('#unload-expected-list');
  if (expectedEl) {
    const expected = bags.filter((b) => b.status === 'Loaded to Collection Truck');
    expectedEl.innerHTML = expected.length ? expected.map((b) => `
      <div class="row" style="justify-content:space-between;padding:4px 0">
        <span class="fs-sm mono">${esc(b.tagNumber)}</span>
        <span class="fs-xs muted">${esc(b.pilgrimName)}</span>
      </div>`).join('') : `<p class="fs-sm muted">None — all scanned.</p>`;
  }
  const scannedEl = appEl.querySelector('#unload-scanned-list');
  if (scannedEl) {
    const scanned = bags.filter((b) => b.status !== 'Loaded to Collection Truck');
    const extraBagIds = new Set((extra || []).map((e) => e.bagId));
    scannedEl.innerHTML = scanned.length ? scanned.map((b) => `
      <div class="row" style="justify-content:space-between;padding:4px 0">
        <span class="fs-sm mono">${esc(b.tagNumber)}</span>
        <span class="row gap-2">${extraBagIds.has(b.id) ? '<span class="chip chip-red">EXTRA</span>' : ''}${statusChip(b.status)}</span>
      </div>`).join('') : `<p class="fs-sm muted">None yet.</p>`;
  }
}

function onToVerify() {
  step = 'verify';
  discrepancy = null;
  renderPage();
  refreshDiscrepancy().then(() => { if (appEl && step === 'verify') renderPage(); });
}

/* ===================== STEP 2: verify ===================== */

function renderVerifyStep() {
  if (!appEl || !data) return;
  const { trip } = data;
  if (!discrepancy) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">${esc(trip.code)}</h1></div>${stepperHtml(STEP_LABELS, 2)}${skeletonBlock(5)}`;
    return;
  }
  const { expectedCount, scannedCount, missing, extra } = discrepancy;
  const difference = missing.length + extra.length;
  const hasDifference = difference > 0;

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${esc(trip.code)} <span class="muted fs-sm">· Verify</span></h1>
        <p class="page-subtitle">Bay ${esc(trip.bay || '—')}</p>
      </div>
      ${statusChip(trip.status)}
    </div>
    ${stepperHtml(STEP_LABELS, 2)}
    <div class="grid grid-cols-3" style="margin-block-end:var(--s6)">
      <div class="kpi-tile"><div class="kpi-label">Expected</div><div class="kpi-value">${expectedCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scanned</div><div class="kpi-value">${scannedCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Difference</div><div class="kpi-value" style="color:${hasDifference ? 'var(--danger)' : 'inherit'}">${difference}</div></div>
    </div>

    ${hasDifference ? `
      <p class="fs-sm" style="margin-block-end:var(--s4)">${icon('alert-triangle', 16)} Discrepancy found: ${missing.length} missing, ${extra.length} extra.</p>
      ${missing.length ? `
        <div class="section-title">Missing</div>
        <div class="stack gap-2" style="margin-block-end:var(--s4)">
          ${missing.map((b) => `<div class="discrepancy-row missing"><strong class="fs-sm mono">${esc(b.tagNumber)}</strong> — ${esc(b.pilgrimName)}</div>`).join('')}
        </div>` : ''}
      ${extra.length ? `
        <div class="section-title">Extra</div>
        <div class="stack gap-1" style="margin-block-end:var(--s5)">
          ${extra.map((e) => `<div class="fs-sm mono">${esc(e.tag)} <span class="muted fs-xs">· ${esc(fmtRelative(e.at))}</span></div>`).join('')}
        </div>` : ''}
      ${!trip.discrepancyRecorded ? `<button type="button" class="btn btn-secondary" data-action="record-discrepancy" style="margin-block-end:var(--s5)">${icon('file-text', 16)} Record discrepancy &amp; notify operations</button>`
        : `<p class="fs-sm muted" style="margin-block-end:var(--s5)">${icon('check', 14)} Discrepancy recorded.</p>`}
    ` : `<div class="state-block" style="padding:var(--s6)">${icon('check-circle', 40)}<p>Expected and scanned match.</p></div>`}

    <div class="row" style="justify-content:space-between;align-items:center;margin-block-start:var(--s5)">
      <button type="button" class="btn btn-ghost" data-action="reopen">${icon('arrow-left', 16)} Re-open unloading</button>
      <button type="button" class="btn btn-primary" data-action="accept" ${accepting ? 'disabled aria-busy="true"' : ''}>
        ${accepting ? `<span class="spinner"></span> Accepting…` : `${icon('check', 16)} Accept baggage at warehouse`}
      </button>
    </div>`;

  appEl.querySelector('[data-action="reopen"]').addEventListener('click', () => { step = 'unload'; renderPage(); });
  appEl.querySelector('[data-action="record-discrepancy"]')?.addEventListener('click', openDiscrepancyModal);
  appEl.querySelector('[data-action="accept"]').addEventListener('click', onAccept);
}

function openDiscrepancyModal() {
  let submitting = false;
  const close = openModal({
    title: 'Record discrepancy & notify operations',
    bodyHtml: `
      <form id="disc-form" novalidate>
        <div class="field">
          <label for="disc-notes">Notes <span class="req">*</span></label>
          <textarea id="disc-notes" placeholder="What did you check before recording this discrepancy? (10–500 characters)" required></textarea>
          <div class="error" id="err-disc-notes" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="disc-submit">Save</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('disc-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const notes = form.querySelector('#disc-notes').value.trim();
    const errBox = form.querySelector('#err-disc-notes');
    if (notes.length < 10 || notes.length > 500) { errBox.textContent = 'Notes must be 10–500 characters.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#disc-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      const result = await api.recordDiscrepancy(tripId, notes);
      close();
      toast(`${result.exceptionsCreated} exception${result.exceptionsCreated === 1 ? '' : 's'} created.`, 'success');
      if (data?.trip) data.trip.discrepancyRecorded = true;
      await refreshDiscrepancy();
      if (step === 'verify') renderPage();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save';
      toast(err.message, 'error');
    }
  });
}

async function onAccept() {
  if (accepting) return;
  accepting = true;
  renderVerifyStep();
  try {
    accepted = await api.acceptReceiving(tripId);
    toast('Baggage accepted at warehouse.', 'success');
    accepting = false;
    step = 'done';
    renderPage();
  } catch (err) {
    accepting = false;
    toast(err.message, 'error');
    renderVerifyStep();
  }
}

/* ===================== DONE ===================== */

function renderDoneStep() {
  if (!appEl || !accepted) return;
  appEl.innerHTML = `
    ${stepperHtml(STEP_LABELS, 3)}
    <div class="state-block">
      ${icon('check-circle', 48)}
      <h2 class="fs-lg">${accepted.acceptedCount} bag${accepted.acceptedCount === 1 ? '' : 's'} accepted</h2>
      <p class="muted">${esc(accepted.tripCode)} is now at the warehouse.</p>
      <div class="row gap-3" style="margin-block-start:var(--s4)">
        <a class="btn btn-primary" href="#/screening">${icon('scan-search', 16)} Go to screening</a>
        <a class="btn btn-secondary" href="#/gate">${icon('truck', 16)} Next truck</a>
      </div>
    </div>`;
}
