import * as api from '../api.js';
import {
  esc, icon, toast, fmtRelative, skeletonBlock, emptyState, errorState, openModal, confirmDialog,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { createSignaturePad } from '../components/signature-pad.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let flightCode = null;
let flight = null;
let expected = null;
let received = null;
let discrepancy = null; // { missing, unidentifiedList }
let sopChecklist = null;
let pir = null;
let loadError = '';
let scanInstance = null;
let handoffSigPad = null;

/** @param {{id:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  flightCode = params.id;
  flight = null; expected = null; received = null; discrepancy = null; sopChecklist = null; pir = null;
  loadError = '';
  load();
  return { destroy, refresh: load, activeFlightCode: () => flightCode };
}

export function destroy() {
  scanInstance?.destroy(); scanInstance = null;
  handoffSigPad?.destroy(); handoffSigPad = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  if (!flight) renderSkeleton();
  try {
    const receiving = await api.getArrReceiving(flightCode);
    const disc = await api.computeArrDiscrepancy(flightCode);
    if (!appEl) return;
    flight = receiving.flight; expected = receiving.expected; received = receiving.received;
    discrepancy = disc;
    if (discrepancy.missing.length || discrepancy.unidentifiedList.length) {
      const sop = await api.getSopState(flightCode);
      if (!appEl) return;
      sopChecklist = sop.sopChecklist; pir = sop.pir;
    } else { sopChecklist = null; pir = null; }
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

function renderSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Receive baggage</h1></div>${skeletonBlock(8)}`;
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/arr/flights">${icon('arrow-left', 16)} Back</a></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  const hasIssues = discrepancy.missing.length > 0 || discrepancy.unidentifiedList.length > 0;
  const readyToAccept = discrepancy.missing.length === 0;

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/arr/flights/${esc(encodeURIComponent(flightCode))}">${icon('arrow-left', 14)} ${esc(flightCode)}</a>
        <h1 class="page-title">Receive baggage — ${esc(flightCode)}</h1>
        <p class="page-subtitle">${received.length} of ${expected.length + received.length} bags received.</p>
      </div>
      ${flight.acceptedAt ? statusChip('Accepted') : ''}
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3)">
        <div class="section-title" style="margin-block-end:0">Ground handler hand-off</div>
        ${flight.handoffRecord ? `<span class="fs-sm muted">${icon('check', 14)} Recorded for ${esc(flight.handoffRecord.repName)}</span>` : ''}
      </div>
      ${!flight.handoffRecord ? `<button type="button" class="btn btn-secondary" style="margin-block-start:var(--s3)" data-action="record-handoff">${icon('user-check', 16)} Record ground handler hand-off</button>` : ''}
    </div>

    <div class="grid grid-cols-2" style="margin-block-end:var(--s6)">
      <div><div id="receiving-scan-root"></div></div>
      <div class="card">
        <div class="section-title">Expected — not yet received (${expected.length})</div>
        <div id="expected-list" style="margin-block-end:var(--s4)"></div>
        <div class="section-title">Received (${received.length})</div>
        <div id="received-list"></div>
      </div>
    </div>

    <div class="card" style="margin-block-end:var(--s6)">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3);margin-block-end:var(--s3)">
        <div class="section-title" style="margin-block-end:0">Verify</div>
        <button type="button" class="btn btn-ghost" data-action="reverify">${icon('rotate-cw', 16)} Re-verify</button>
      </div>
      ${hasIssues ? `
        <div id="verify-lists"></div>
        ${!flight.discrepancyRecorded ? `<button type="button" class="btn btn-secondary" data-action="record-discrepancy" style="margin-block-start:var(--s3)">${icon('file-text', 16)} Record discrepancy &amp; notify operations</button>` : `<p class="fs-sm muted" style="margin-block-start:var(--s3)">${icon('check', 14)} Discrepancy recorded.</p>`}
      ` : `<div class="state-block" style="padding:var(--s6)">${icon('check-circle', 40)}<p>All bags accounted for.</p></div>`}
    </div>

    ${hasIssues ? `<div class="card" id="sop-card" style="margin-block-end:var(--s6)"></div>` : ''}

    <div class="row" style="justify-content:flex-end">
      <button type="button" class="btn btn-primary" data-action="accept" ${readyToAccept ? '' : 'disabled aria-disabled="true"'} title="${readyToAccept ? '' : 'Find or match every missing bag first.'}">
        ${icon('check', 16)} Accept baggage at airport
      </button>
    </div>`;

  scanInstance?.destroy();
  scanInstance = createScanInput(appEl.querySelector('#receiving-scan-root'), {
    label: 'Scan airline tag or Rabel tag',
    placeholder: 'e.g. 0812100001',
    onSubmit: onScan,
  });
  renderExpectedReceivedLists();
  if (hasIssues) renderVerifyLists();
  if (hasIssues) renderSopCard();

  appEl.querySelector('[data-action="record-handoff"]')?.addEventListener('click', openHandoffModal);
  appEl.querySelector('[data-action="reverify"]').addEventListener('click', load);
  appEl.querySelector('[data-action="record-discrepancy"]')?.addEventListener('click', openDiscrepancyModal);
  appEl.querySelector('[data-action="accept"]').addEventListener('click', onAccept);
}

async function onScan(code) {
  const result = await api.arrScanBag(flightCode, code);
  if (result.unidentified) {
    openUnidentifiedModal();
    return { message: result.message };
  }
  await load();
  return { message: result.message };
}

function renderExpectedReceivedLists() {
  const expEl = appEl.querySelector('#expected-list');
  const recEl = appEl.querySelector('#received-list');
  if (expEl) {
    expEl.innerHTML = expected.length ? `<div class="stack gap-1">${expected.map((b) => `
      <div class="row" style="justify-content:space-between;padding:4px 0">
        <span class="fs-sm mono">${esc(b.tagNumber)}</span>
        <span class="fs-xs muted">${esc(b.pilgrimName)} · ${esc(b.hotel || '—')}</span>
      </div>`).join('')}</div>` : `<p class="fs-sm muted">None.</p>`;
  }
  if (recEl) {
    recEl.innerHTML = received.length ? `<div class="stack gap-1">${received.map((b) => `
      <div class="row" style="justify-content:space-between;padding:4px 0">
        <span class="fs-sm mono">${esc(b.tagNumber)}</span>
        ${b.unidentified ? '<span class="chip chip-amber">Unidentified</span>' : `<span class="fs-xs muted">${esc(b.pilgrimName)}</span>`}
      </div>`).join('')}</div>` : `<p class="fs-sm muted">None yet.</p>`;
  }
}

function renderVerifyLists() {
  const root = appEl.querySelector('#verify-lists');
  if (!root) return;
  root.innerHTML = `
    ${discrepancy.missing.length ? `
      <div class="fs-sm fw-medium" style="margin-block-end:var(--s2)">Missing (${discrepancy.missing.length})</div>
      <div class="stack gap-2" style="margin-block-end:var(--s4)">
        ${discrepancy.missing.map((b) => `
          <div class="discrepancy-row missing">
            <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
              <div><strong class="fs-sm mono">${esc(b.tagNumber)}</strong><div class="fs-xs muted">${esc(b.pilgrimName)} · ${esc(b.hotel || '—')}</div></div>
              <button type="button" class="btn btn-secondary" data-action="bag-found" data-id="${esc(b.id)}">${icon('search', 14)} Bag found</button>
            </div>
          </div>`).join('')}
      </div>` : ''}
    ${discrepancy.unidentifiedList.length ? `
      <div class="fs-sm fw-medium" style="margin-block-end:var(--s2)">Unidentified (${discrepancy.unidentifiedList.length})</div>
      <div class="stack gap-2">
        ${discrepancy.unidentifiedList.map((b) => `
          <div class="discrepancy-row unidentified">
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
            <div class="fs-xs muted">${esc(b.description || '')}</div>
          </div>`).join('')}
      </div>` : ''}`;
  root.querySelectorAll('[data-action="bag-found"]').forEach((btn) => btn.addEventListener('click', () => openBagFoundModal(btn.dataset.id)));
}

function openHandoffModal() {
  let submitting = false;
  const close = openModal({
    title: 'Record ground handler hand-off',
    bodyHtml: `
      <form id="handoff-form" novalidate>
        <div class="field">
          <label for="handoff-name">Ground handler representative <span class="req">*</span></label>
          <input id="handoff-name" required />
        </div>
        <div class="field">
          <label>Signature (optional)</label>
          <div id="handoff-sig-root"></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="handoff-submit">Save</button>
        </div>
      </form>`,
  });
  handoffSigPad?.destroy();
  handoffSigPad = createSignaturePad(document.getElementById('handoff-sig-root'));
  const form = document.getElementById('handoff-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const repName = form.querySelector('#handoff-name').value.trim();
    if (!repName) { toast('Representative name is required.', 'error'); return; }
    submitting = true;
    const btn = form.querySelector('#handoff-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.recordGroundHandlerHandoff(flightCode, { repName, signatureDataUrl: handoffSigPad.isEmpty() ? null : handoffSigPad.toDataUrl() });
      close();
      toast('Hand-off recorded.', 'success');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save';
      toast(err.message, 'error');
    }
  });
}

function openUnidentifiedModal() {
  let submitting = false;
  const close = openModal({
    title: 'Unidentified bag',
    bodyHtml: `
      <form id="unid-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">Describe the bag so it can be matched later.</p>
        <div class="field">
          <label for="unid-desc">Description <span class="req">*</span></label>
          <textarea id="unid-desc" placeholder="Colour, size, any name on the tag (5–200 characters)" required></textarea>
          <div class="error" id="err-unid-desc" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="unid-submit">Save</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('unid-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const desc = form.querySelector('#unid-desc').value.trim();
    const errBox = form.querySelector('#err-unid-desc');
    if (desc.length < 5 || desc.length > 200) { errBox.textContent = 'Description must be 5–200 characters.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#unid-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.recordUnidentifiedBag(flightCode, desc);
      close();
      toast('Unidentified bag recorded.', 'info');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save';
      toast(err.message, 'error');
    }
  });
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
      const result = await api.recordArrDiscrepancy(flightCode, notes);
      close();
      toast(`${result.exceptionsCreated} exception(s) created — Operations notified.`, 'success');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save';
      toast(err.message, 'error');
    }
  });
}

function openBagFoundModal(bagId) {
  const bag = discrepancy.missing.find((b) => b.id === bagId);
  if (!bag) return;
  const close = openModal({
    title: `Bag found — ${bag.tagNumber}`,
    bodyHtml: `<div id="bag-found-scan-root"></div>`,
  });
  const instance = createScanInput(document.getElementById('bag-found-scan-root'), {
    label: 'Scan the bag tag to confirm',
    placeholder: bag.tagNumber,
    onSubmit: async (code) => {
      const found = await api.bagFoundArrival(bag.id, code);
      close();
      instance.destroy();
      toast(`${found.tagNumber} found.`, 'success');
      await load();
      return { message: `${found.tagNumber} found.` };
    },
  });
}

function renderSopCard() {
  const root = appEl.querySelector('#sop-card');
  if (!root) return;
  root.innerHTML = `
    <div class="section-title">SOP checklist</div>
    <div id="sop-steps"></div>
    <div class="field" style="margin-block-start:var(--s4);max-width:260px">
      <label for="pir-input">PIR number</label>
      <input id="pir-input" value="${esc(pir || '')}" placeholder="e.g. JEDSV12345" ${pir ? 'disabled' : ''} />
      <div class="hint">8–12 alphanumeric characters.</div>
      <div class="error" id="err-pir" hidden></div>
    </div>
    ${!pir ? `<button type="button" class="btn btn-secondary" style="margin-block-start:var(--s2)" data-action="save-pir">Save PIR</button>` : ''}
    ${discrepancy.unidentifiedList.length && discrepancy.missing.length ? `
      <div class="section-title" style="margin-block-start:var(--s5)">Match unidentified to missing</div>
      <div id="match-unid-root"></div>` : ''}`;

  const stepsRoot = root.querySelector('#sop-steps');
  stepsRoot.innerHTML = sopChecklist.map((s, i) => `
    <div class="sop-step ${s.done ? 'done' : ''}">
      <div class="sop-check">${icon('check', 14)}</div>
      <div class="grow">
        <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
          <strong class="fs-sm">${esc(s.label)}</strong>
          ${s.done ? `<span class="fs-xs muted">${esc(s.staffInitials || '')} · ${esc(fmtRelative(s.at))}</span>` : ''}
        </div>
        ${s.done ? `<p class="fs-xs muted">${esc(s.note || '')}</p>` : `
          <div class="row gap-2 wrap" style="margin-block-start:var(--s2)">
            <input type="text" data-sop-note="${i}" placeholder="Note (required to tick this step)" style="max-width:320px" />
            <button type="button" class="btn btn-secondary" data-action="sop-tick" data-index="${i}">${icon('check', 14)} Tick</button>
          </div>`}
      </div>
    </div>`).join('');
  stepsRoot.querySelectorAll('[data-action="sop-tick"]').forEach((btn) => btn.addEventListener('click', () => onSopTick(btn)));

  root.querySelector('[data-action="save-pir"]')?.addEventListener('click', onSavePir);

  if (discrepancy.unidentifiedList.length && discrepancy.missing.length) renderMatchUnidentified(root);
}

async function onSopTick(btn) {
  const index = Number(btn.dataset.index);
  const note = appEl.querySelector(`[data-sop-note="${index}"]`)?.value.trim();
  if (!note) { toast('A note is required when ticking a step.', 'error'); return; }
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.recordSopStep(flightCode, index, note);
    toast('Step recorded.', 'success');
    await load();
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

async function onSavePir() {
  const input = appEl.querySelector('#pir-input');
  const value = input.value.trim();
  const errBox = appEl.querySelector('#err-pir');
  try {
    await api.setPir(flightCode, value);
    toast('PIR saved.', 'success');
    await load();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  }
}

function renderMatchUnidentified(root) {
  const matchRoot = root.querySelector('#match-unid-root');
  if (!matchRoot) return;
  matchRoot.innerHTML = `
    <form id="match-form" novalidate class="row gap-2 wrap" style="align-items:flex-end">
      <div class="field" style="margin-block-end:0;min-width:220px">
        <label for="match-unid-select">Unidentified bag</label>
        <select id="match-unid-select">
          ${discrepancy.unidentifiedList.map((b) => `<option value="${esc(b.id)}">${esc(b.tagNumber)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="margin-block-end:0;min-width:220px">
        <label for="match-missing-select">Missing bag</label>
        <select id="match-missing-select">
          ${discrepancy.missing.map((b) => `<option value="${esc(b.id)}">${esc(b.tagNumber)} — ${esc(b.pilgrimName)}</option>`).join('')}
        </select>
      </div>
      <button type="submit" class="btn btn-secondary">Match</button>
    </form>`;
  matchRoot.querySelector('#match-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const unidId = matchRoot.querySelector('#match-unid-select').value;
    const missingId = matchRoot.querySelector('#match-missing-select').value;
    try {
      await api.matchUnidentified(unidId, missingId);
      toast('Bags matched.', 'success');
      await load();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function onAccept() {
  const proceed = await confirmDialog({ title: 'Accept baggage at airport', body: `This confirms all bags for ${flightCode} are accounted for and accepted.`, confirmLabel: 'Accept' });
  if (!proceed) return;
  try {
    await api.acceptBaggageAtAirport(flightCode);
    toast('Baggage accepted at airport.', 'success');
    navigate('#/arr/security');
  } catch (err) { toast(err.message, 'error'); }
}
