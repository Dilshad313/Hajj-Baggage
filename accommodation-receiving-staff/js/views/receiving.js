import * as api from '../api.js';
import {
  esc, icon, toast, announce, fmtRelative, fmtDateTime, skeletonBlock, emptyState, errorState,
  openModal, confirmDialog, openDrawer,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { stepperHtml } from '../components/stepper.js';
import { DAMAGE_TYPES, DAMAGE_SEVERITIES, INVESTIGATE_CHECKLIST } from '../seed.js';

let appEl = null;
let tripId = null;
let data = null; // { trip, bags, extra }
let discrepancy = null; // { expectedCount, scannedCount, missing, damaged, extra }
let step = 'loading'; // loading | error | unload | verify | receipt | already-done
let errorMessage = '';
let receipt = null;
let scanInputInstance = null;
let accepting = false;

const STEP_LABELS = ['Unload & scan bags', 'Verify & reconcile', 'Accept shipment'];

/** @param {{id:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  tripId = params.id;
  data = null;
  discrepancy = null;
  step = 'loading';
  errorMessage = '';
  receipt = null;
  accepting = false;
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  scanInputInstance?.destroy();
  scanInputInstance = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  step = 'loading';
  renderPage();
  try {
    const result = await api.getReceiving(tripId);
    if (!appEl) return;
    data = result;
    step = data.trip.status === 'Unloaded' ? 'already-done' : 'unload';
    renderPage();
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
    data = await api.getReceiving(tripId);
  } catch (err) {
    if (!appEl) return;
    toast(err.message, 'error');
  }
}

async function refreshDiscrepancy() {
  if (!appEl) return;
  try {
    discrepancy = await api.computeDiscrepancy(tripId);
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
    appEl.innerHTML = errorState({ message: errorMessage });
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  if (step === 'already-done') {
    appEl.innerHTML = `
      <div class="page-header"><h1 class="page-title">${esc(data.trip.code)}</h1></div>
      <div class="state-block">
        ${icon('check-circle', 48)}
        <p>This truck has already been unloaded and accepted.</p>
        <div class="row gap-3"><a class="btn btn-primary" href="#/sorting">Go to sorting</a><a class="btn btn-secondary" href="#/">Back to dashboard</a></div>
      </div>`;
    return;
  }
  if (step === 'receipt') { renderReceiptStep(); return; }
  if (step === 'verify') { renderVerifyStep(); return; }
  renderUnloadStep();
}

/* ===================== STEP 1: unload ===================== */

function renderUnloadStep() {
  scanInputInstance?.destroy();
  scanInputInstance = null;
  const { trip, bags, extra } = data;
  const scannedCount = bags.filter((b) => b.status !== 'Expected').length;

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${esc(trip.code)} <span class="muted fs-sm">· ${esc(trip.truckPlate)}</span></h1>
        <p class="page-subtitle">${esc(trip.driverName)} · ${esc(trip.flightCode)} · Bay ${esc(trip.bay || '—')} · Seal ${esc(trip.sealNumber)}</p>
      </div>
      ${statusChip(trip.status)}
    </div>
    ${stepperHtml(STEP_LABELS, 1)}
    <div class="grid grid-cols-2">
      <div><div id="scan-root"></div></div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
          <div class="section-title" style="margin-block-end:0">Manifest</div>
          <strong class="fs-sm">${scannedCount} / ${bags.length} scanned</strong>
        </div>
        <div class="capacity-bar" style="margin-block-end:var(--s4)"><div class="capacity-bar-fill" style="width:${bags.length ? Math.round((scannedCount / bags.length) * 100) : 0}%"></div></div>
        <div id="unload-list"></div>
      </div>
    </div>
    <div class="save-bar">
      <span class="fs-sm muted">${extra.length ? `${extra.length} extra/unknown tag${extra.length === 1 ? '' : 's'} scanned` : 'All scans match the manifest so far.'}</span>
      <button type="button" class="btn btn-primary" data-action="to-verify">Verify &amp; reconcile ${icon('arrow-right', 16)}</button>
    </div>`;

  scanInputInstance = createScanInput(appEl.querySelector('#scan-root'), {
    label: 'Scan bag tag',
    placeholder: 'e.g. RBL-A-000301',
    onSubmit: async (code) => {
      const result = await api.scanBag(tripId, code);
      await refreshReceiving();
      if (!appEl) return result;
      renderUnloadList();
      return result;
    },
  });
  renderUnloadList();

  appEl.querySelector('[data-action="to-verify"]').addEventListener('click', async () => {
    step = 'verify';
    renderPage();
    await refreshDiscrepancy();
    if (!appEl || step !== 'verify') return;
    renderVerifyStep();
  });
}

function renderUnloadList() {
  const root = appEl?.querySelector('#unload-list');
  if (!root) return;
  const { bags, extra } = data;
  if (!bags.length) { root.innerHTML = emptyState({ message: 'No bags on this manifest.' }); return; }
  root.innerHTML = `
    <div class="stack gap-2">
      ${bags.map((b) => `
        <div class="row" style="justify-content:space-between;align-items:flex-start;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
          <div>
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
            <div class="fs-xs muted">${esc(b.pilgrimName)} · ${esc(b.room || '—')}</div>
          </div>
          <div class="stack gap-1" style="align-items:flex-end">
            <span class="row gap-2">${statusChip(b.status)}${b.damaged ? '<span class="chip chip-amber">Damaged</span>' : ''}</span>
            ${b.status !== 'Expected' && !b.damaged ? `<button type="button" class="btn btn-ghost" style="height:28px;padding-inline:8px;font-size:12px" data-action="damage" data-bag-id="${esc(b.id)}">${icon('alert-triangle', 14)} Report damage</button>` : ''}
          </div>
        </div>`).join('')}
    </div>
    ${extra.length ? `
      <div style="margin-block-start:var(--s4)">
        <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Extra / unknown tags</div>
        ${extra.map((e) => `<div class="fs-sm mono">${esc(e.tag)} <span class="muted fs-xs">· ${fmtRelative(e.at)}</span></div>`).join('')}
      </div>` : ''}`;
  root.querySelectorAll('[data-action="damage"]').forEach((btn) => btn.addEventListener('click', () => openDamageModal(btn.dataset.bagId)));
}

function openDamageModal(bagId) {
  const bag = data.bags.find((b) => b.id === bagId);
  if (!bag) return;
  let submitting = false;
  const close = openModal({
    title: `Report damage — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="damage-form" novalidate>
        <div class="field">
          <label for="damage-type">Damage type <span class="req">*</span></label>
          <select id="damage-type" required>
            <option value="">Select…</option>
            ${DAMAGE_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Severity <span class="req">*</span></label>
          <div class="row gap-4">
            ${DAMAGE_SEVERITIES.map((s, i) => `<label class="checkbox-row"><input type="radio" name="severity" value="${esc(s)}" ${i === 0 ? 'checked' : ''}/> ${esc(s)}</label>`).join('')}
          </div>
          <div class="hint">Major damage automatically opens a claims exception.</div>
        </div>
        <div class="field">
          <label for="damage-desc">Description <span class="req">*</span></label>
          <textarea id="damage-desc" placeholder="Describe the damage (10–300 characters)" required></textarea>
          <div class="error" id="err-desc" hidden></div>
        </div>
        <div class="field">
          <label for="damage-photo">Photo reference (optional)</label>
          <input id="damage-photo" type="text" placeholder="e.g. photo-00123" />
        </div>
        <label class="checkbox-row" style="margin-block-end:var(--s4)"><input type="checkbox" id="damage-repaired" /> Repaired on the spot</label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="damage-submit">Save damage report</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('damage-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const type = form.querySelector('#damage-type').value;
    const severity = form.querySelector('input[name="severity"]:checked')?.value;
    const description = form.querySelector('#damage-desc').value.trim();
    const photoRef = form.querySelector('#damage-photo').value.trim();
    const repaired = form.querySelector('#damage-repaired').checked;
    const errBox = form.querySelector('#err-desc');
    if (description.length < 10 || description.length > 300) {
      errBox.textContent = 'Description must be 10–300 characters.'; errBox.hidden = false;
      form.querySelector('#damage-desc').setAttribute('aria-invalid', 'true');
      return;
    }
    errBox.hidden = true;
    submitting = true;
    const submitBtn = form.querySelector('#damage-submit');
    submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); submitBtn.textContent = 'Saving…';
    try {
      const result = await api.recordDamage(bagId, { type, severity, description, photoRef: photoRef || null, repaired });
      close();
      toast(result.claimsTag ? `${bag.tagNumber} flagged damaged — claims exception opened.` : `${bag.tagNumber} flagged damaged.`, 'success');
      await refreshReceiving();
      if (step === 'unload') renderUnloadList();
    } catch (err) {
      submitting = false;
      submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); submitBtn.textContent = 'Save damage report';
      toast(err.message, 'error');
    }
  });
}

/* ===================== STEP 2: verify & reconcile ===================== */

function renderVerifyStep() {
  const { trip } = data;
  if (!discrepancy) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">${esc(trip.code)}</h1></div>${stepperHtml(STEP_LABELS, 2)}${skeletonBlock(5)}`;
    return;
  }
  const { expectedCount, scannedCount, missing, damaged, extra } = discrepancy;
  const readyToAccept = missing.length === 0;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${esc(trip.code)} <span class="muted fs-sm">· Verify &amp; reconcile</span></h1>
        <p class="page-subtitle">Bay ${esc(trip.bay || '—')}</p>
      </div>
      ${statusChip(trip.status)}
    </div>
    ${stepperHtml(STEP_LABELS, 2)}
    <div class="grid grid-cols-4" style="margin-block-end:var(--s6)">
      <div class="kpi-tile"><div class="kpi-label">Expected</div><div class="kpi-value">${expectedCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Scanned</div><div class="kpi-value">${scannedCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Missing</div><div class="kpi-value" style="color:${missing.length ? 'var(--danger)' : 'inherit'}">${missing.length}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Damaged</div><div class="kpi-value">${damaged.length}</div></div>
    </div>

    ${missing.length ? `
      <div class="section-title">Missing bags</div>
      <div id="missing-list"></div>
      ${!trip.discrepancyRecorded ? `<button type="button" class="btn btn-secondary" data-action="record-discrepancy" style="margin-block-end:var(--s6)">${icon('file-text', 16)} Record discrepancy notes</button>` : `<p class="fs-sm muted" style="margin-block-end:var(--s6)">${icon('check', 14)} Discrepancy notes recorded.</p>`}
    ` : `<div class="state-block" style="padding:var(--s6)">${icon('check-circle', 40)}<p>No bags are missing.</p></div>`}

    ${damaged.length ? `
      <div class="section-title">Damaged bags</div>
      <div class="stack gap-2" style="margin-block-end:var(--s6)">
        ${damaged.map((b) => `
          <div class="discrepancy-row damaged">
            <div class="row" style="justify-content:space-between">
              <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
              ${severityChip(b.damageInfo?.severity === 'Major' ? 'High' : 'Medium')}
            </div>
            <div class="fs-sm">${esc(b.pilgrimName)} · ${esc(b.room || '—')}</div>
            <div class="fs-sm muted">${esc(b.damageInfo?.type || '')} — ${esc(b.damageInfo?.description || '')}</div>
          </div>`).join('')}
      </div>` : ''}

    ${extra.length ? `
      <div class="section-title">Extra / unknown tags</div>
      <div class="stack gap-1" style="margin-block-end:var(--s6)">
        ${extra.map((e) => `<div class="fs-sm mono">${esc(e.tag)} <span class="muted fs-xs">· ${fmtRelative(e.at)}</span></div>`).join('')}
      </div>` : ''}

    <div class="save-bar">
      <button type="button" class="btn btn-ghost" data-action="back-unload">${icon('arrow-left', 16)} Back to unloading</button>
      <button type="button" class="btn btn-primary" data-action="accept" ${accepting ? 'disabled aria-busy="true"' : ''}>
        ${accepting ? `<span class="spinner"></span> Accepting…` : `${icon('check', 16)} Accept shipment`}
      </button>
    </div>
    ${!readyToAccept ? `<p class="fs-xs muted" style="margin-block-start:var(--s2)">Find or escalate every missing bag before accepting.</p>` : ''}`;

  if (missing.length) renderMissingList(missing);

  appEl.querySelector('[data-action="back-unload"]').addEventListener('click', () => { step = 'unload'; renderPage(); });
  appEl.querySelector('[data-action="record-discrepancy"]')?.addEventListener('click', openDiscrepancyModal);
  appEl.querySelector('[data-action="accept"]').addEventListener('click', doAccept);
}

function renderMissingList(missing) {
  const root = appEl.querySelector('#missing-list');
  if (!root) return;
  root.innerHTML = `
    <div class="stack gap-2" style="margin-block-end:var(--s4)">
      ${missing.map((b) => {
        const exc = findExceptionNote(b.id);
        return `
        <div class="discrepancy-row missing">
          <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
            <div>
              <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
              <div class="fs-sm">${esc(b.pilgrimName)} · ${esc(b.room || '—')}</div>
            </div>
            <div class="row gap-2">
              ${exc ? statusChip(exc.status) : ''}
              <button type="button" class="btn btn-secondary" data-action="investigate" data-bag-id="${esc(b.id)}">${icon('search', 14)} Investigate</button>
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  root.querySelectorAll('[data-action="investigate"]').forEach((btn) => btn.addEventListener('click', () => openInvestigateDrawer(btn.dataset.bagId)));
}

// Exceptions aren't fetched directly here; a lightweight local cache keeps
// each missing bag's exception status in sync after investigate/escalate
// actions without a full exceptions-list round trip.
let exceptionNotesByBag = {};
function findExceptionNote(bagId) { return exceptionNotesByBag[bagId] || null; }

function openDiscrepancyModal() {
  let submitting = false;
  const close = openModal({
    title: 'Record discrepancy notes',
    bodyHtml: `
      <form id="disc-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">This opens a missing-bag exception for every bag not yet scanned, so it can be tracked and escalated.</p>
        <div class="field">
          <label for="disc-notes">Notes <span class="req">*</span></label>
          <textarea id="disc-notes" placeholder="What did you check before recording this discrepancy? (10–500 characters)" required></textarea>
          <div class="error" id="err-notes" hidden></div>
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
    const errBox = form.querySelector('#err-notes');
    if (notes.length < 10 || notes.length > 500) {
      errBox.textContent = 'Notes must be 10–500 characters.'; errBox.hidden = false;
      return;
    }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#disc-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      const result = await api.recordDiscrepancy(tripId, notes);
      close();
      toast(`${result.exceptionsCreated} exception${result.exceptionsCreated === 1 ? '' : 's'} created.`, 'success');
      data.trip.discrepancyRecorded = true;
      await refreshDiscrepancy();
      if (step === 'verify') renderVerifyStep();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save';
      toast(err.message, 'error');
    }
  });
}

function openInvestigateDrawer(bagId) {
  const bag = discrepancy.missing.find((b) => b.id === bagId);
  if (!bag) return;
  let scanInstance = null;
  const { el, close } = openDrawer({
    title: `Investigate — ${bag.tagNumber}`,
    bodyHtml: `
      <p class="fs-sm">${esc(bag.pilgrimName)} · ${esc(bag.room || '—')}</p>
      <div class="section-title" style="margin-block-start:var(--s5)">Checklist</div>
      ${INVESTIGATE_CHECKLIST.map((item, i) => `
        <label class="investigate-checklist-item">
          <input type="checkbox" data-checklist-item="${i}" />
          <span>${esc(item)}</span>
        </label>`).join('')}
      <div class="field" style="margin-block-start:var(--s4)">
        <label for="investigate-notes">Investigation notes</label>
        <textarea id="investigate-notes" placeholder="What did you find?"></textarea>
      </div>
      <button type="button" class="btn btn-secondary btn-block" data-act="save-notes" style="margin-block-end:var(--s5)">${icon('save', 16)} Save investigation notes</button>
      <div class="section-title">Found the bag?</div>
      <div id="found-scan-root"></div>
    `,
    footerHtml: `<button type="button" class="btn btn-danger" data-act="escalate">${icon('arrow-up-circle', 16)} Escalate to Operations</button>`,
  });

  scanInstance = createScanInput(el.querySelector('#found-scan-root'), {
    label: 'Scan the bag tag to confirm',
    placeholder: bag.tagNumber,
    onSubmit: async (code) => {
      const found = await api.bagFound(bag.id, code);
      toast(`${found.tagNumber} found and marked received.`, 'success');
      delete exceptionNotesByBag[bag.id];
      close();
      await refreshDiscrepancy();
      if (step === 'verify') renderVerifyStep();
      return { message: `${found.tagNumber} found and marked received.` };
    },
  });

  el.querySelector('[data-act="save-notes"]').addEventListener('click', async () => {
    const checklist = Array.from(el.querySelectorAll('[data-checklist-item]')).map((cb) => cb.checked);
    const notes = el.querySelector('#investigate-notes').value.trim();
    try {
      await api.investigate(bag.id, { checklist, notes });
      exceptionNotesByBag[bag.id] = { status: 'In Progress' };
      toast('Investigation notes saved.', 'success');
      if (step === 'verify') renderMissingList(discrepancy.missing);
    } catch (err) { toast(err.message, 'error'); }
  });

  el.querySelector('[data-act="escalate"]').addEventListener('click', async () => {
    const proceed = await confirmDialog({
      title: 'Escalate to Operations',
      body: `${bag.tagNumber} will be handed off to Operations Management as a high-severity missing-bag exception.`,
      confirmLabel: 'Escalate',
      danger: true,
    });
    if (!proceed) return;
    const notes = el.querySelector('#investigate-notes')?.value.trim() || '';
    try {
      await api.escalateMissing(bag.id, notes);
      exceptionNotesByBag[bag.id] = { status: 'Escalated' };
      toast(`${bag.tagNumber} escalated to Operations.`, 'success');
      close();
      await refreshDiscrepancy();
      if (step === 'verify') renderVerifyStep();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function doAccept() {
  if (accepting) return;
  const proceed = await confirmDialog({
    title: 'Accept shipment',
    body: 'This closes unloading for this truck and makes its bags available for sorting.',
    confirmLabel: 'Accept',
  });
  if (!proceed) return;
  accepting = true;
  renderVerifyStep();
  try {
    receipt = await api.accept(tripId);
    step = 'receipt';
    renderPage();
  } catch (err) {
    accepting = false;
    toast(err.message, 'error');
    renderVerifyStep();
  }
}

/* ===================== STEP 3: receipt ===================== */

function renderReceiptStep() {
  appEl.innerHTML = `
    ${stepperHtml(STEP_LABELS, 3)}
    <div class="card room-receipt">
      <div class="state-block" style="padding-block:var(--s4)">
        ${icon('check-circle', 48)}
        <h2 class="fs-lg">Shipment accepted</h2>
      </div>
      <div class="stack gap-2" style="margin-block-start:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Trip</span><strong class="mono">${esc(receipt.tripCode)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Hotel</span><strong>${esc(receipt.hotel)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Bay</span><strong>${esc(receipt.bay || '—')}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Accepted</span><strong>${fmtDateTime(receipt.acceptedAt)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Total bags</span><strong>${receipt.totalBags}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Damaged</span><strong>${receipt.damagedCount}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Extra / unknown</span><strong>${receipt.extraCount}</strong></div>
      </div>
      <div class="row gap-3" style="margin-block-start:var(--s6);justify-content:center">
        <a class="btn btn-primary" href="#/sorting">${icon('layout-grid', 16)} Go to sorting</a>
        <a class="btn btn-secondary" href="#/">Back to dashboard</a>
      </div>
    </div>`;
}
