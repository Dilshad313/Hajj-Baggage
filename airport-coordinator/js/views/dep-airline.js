import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, emptyState, errorState, openModal, confirmDialog,
} from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { createSignaturePad } from '../components/signature-pad.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';
import { stepperHtml } from '../components/stepper.js';
import { REJECT_REASONS, RESOLUTION_ACTIONS } from '../seed.js';

let appEl = null;
let batchId = null; // null => list mode

/* list state */
let readyFlights = null;
let allBatches = null;
let listError = '';
let tableInstance = null;

/* batch state */
let batchData = null; // { id, flightCode, status, bagIds, bags, vehicleId, mu, decision, rejectedBagIds, rejectReason, resolution, receiver }
let batchError = '';
let scanInstance = null;
let sigPad = null;
let recordOnBehalf = false;

const STEP_LABELS = ['Scan bags', 'Send & await decision', 'Resolve & receiver'];

/** @param {{batchId?:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  batchId = params.batchId || null;
  scanInstance = null;
  sigPad = null;
  tableInstance = null;
  recordOnBehalf = false;
  if (batchId) loadBatch(); else loadList();
  return { destroy, refresh: () => (batchId ? loadBatch() : loadList()), activeBatchId: () => batchId };
}

export function destroy() {
  scanInstance?.destroy(); scanInstance = null;
  sigPad?.destroy(); sigPad = null;
  tableInstance?.destroy(); tableInstance = null;
  appEl = null;
}

/* ===================== LIST ===================== */

async function loadList() {
  if (!appEl) return;
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Airline handover</h1></div>${skeletonBlock(6)}`;
  try {
    const [ready, batches] = await Promise.all([api.getFlightsReadyForHandover(), api.getBatches()]);
    if (!appEl) return;
    readyFlights = ready; allBatches = batches; listError = '';
    renderList();
  } catch (err) {
    if (!appEl) return;
    listError = err.message;
    renderList();
  }
}

function renderList() {
  if (!appEl) return;
  tableInstance?.destroy(); tableInstance = null;
  if (listError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Airline handover</h1></div>${errorState({ message: listError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadList);
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Airline handover</h1>
        <p class="page-subtitle">Create a handover batch for each flight, then scan, send and reconcile with the airline.</p>
      </div>
    </div>
    <div class="section-title">Flights ready for handover</div>
    <div id="ready-flights-root" style="margin-block-end:var(--s6)"></div>
    <div class="section-title">Batches</div>
    <div id="batches-table"></div>`;
  renderReadyFlights();
  renderBatchesTable();
}

function renderReadyFlights() {
  const root = appEl.querySelector('#ready-flights-root');
  if (!root) return;
  if (!readyFlights.length) { root.innerHTML = emptyState({ message: 'No flights have bags ready for handover yet.' }); return; }
  root.innerHTML = `<div class="grid grid-auto">${readyFlights.map((f) => `
    <div class="card">
      <strong class="mono">${esc(f.flightCode)}</strong>
      <div class="fs-sm muted" style="margin-block:var(--s2)">${f.bagCount} bag${f.bagCount === 1 ? '' : 's'} ready</div>
      <button type="button" class="btn ${f.openBatch ? 'btn-secondary' : 'btn-primary'} btn-block" data-action="${f.openBatch ? 'open' : 'create'}" data-flight="${esc(f.flightCode)}">
        ${f.openBatch ? 'Open batch' : `${icon('plus', 16)} Create handover batch`}
      </button>
    </div>`).join('')}</div>`;
  root.querySelectorAll('[data-action="create"]').forEach((btn) => btn.addEventListener('click', () => onCreateBatch(btn)));
  root.querySelectorAll('[data-action="open"]').forEach((btn) => btn.addEventListener('click', () => {
    const existing = allBatches.find((b) => b.flightCode === btn.dataset.flight && !['Accepted', 'Rejected'].includes(b.status));
    if (existing) navigate(`#/dep/airline/${existing.id}`);
  }));
}

async function onCreateBatch(btn) {
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    const batch = await api.createBatch(btn.dataset.flight);
    navigate(`#/dep/airline/${batch.id}`);
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

function renderBatchesTable() {
  const root = appEl.querySelector('#batches-table');
  if (!root) return;
  if (!allBatches.length) { root.innerHTML = emptyState({ message: 'No handover batches yet.' }); return; }
  tableInstance = createDataTable(root, {
    columns: [
      { key: 'id', label: 'Batch', sortable: true, render: (r) => `<span class="mono">${esc(r.id)}</span>` },
      { key: 'flightCode', label: 'Flight', sortable: true },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
      { key: 'bagIds', label: 'Bags', sortable: true, render: (r) => String(r.bagIds.length), csvValue: (r) => r.bagIds.length },
      { key: 'rejectedBagIds', label: 'Rejected', render: (r) => String(r.rejectedBagIds.length), csvValue: (r) => r.rejectedBagIds.length },
    ],
    rows: allBatches,
    getRowId: (r) => r.id,
    searchKeys: ['id', 'flightCode', 'status'],
    onRowClick: (r) => navigate(`#/dep/airline/${r.id}`),
    csvFilename: 'handover-batches',
    emptyMessage: 'No matching batches.',
  });
}

/* ===================== BATCH DETAIL ===================== */

async function loadBatch() {
  if (!appEl) return;
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Batch</h1></div>${skeletonBlock(6)}`;
  try {
    batchData = await api.getBatch(batchId);
    batchError = '';
    renderBatch();
  } catch (err) {
    if (!appEl) return;
    batchError = err.message;
    renderBatch();
  }
}

function stepIndexFor(status) {
  if (status === 'Open') return 1;
  if (status === 'Sent') return 2;
  return 3;
}

function renderBatch() {
  if (!appEl) return;
  if (batchError) {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/dep/airline">${icon('arrow-left', 16)} Back</a></div>${errorState({ message: batchError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadBatch);
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/dep/airline">${icon('arrow-left', 14)} All batches</a>
        <h1 class="page-title">${esc(batchData.id)} <span class="muted fs-sm">· ${esc(batchData.flightCode)}</span></h1>
      </div>
      ${statusChip(batchData.status)}
    </div>
    ${stepIndexFor(batchData.status) <= 3 ? stepperHtml(STEP_LABELS, Math.min(stepIndexFor(batchData.status), STEP_LABELS.length)) : ''}
    <div id="batch-step-root"></div>`;

  const root = appEl.querySelector('#batch-step-root');
  if (batchData.status === 'Open') renderScanStep(root);
  else if (batchData.status === 'Sent') renderDecisionStep(root);
  else if (['Decided', 'Partially Rejected', 'Rejected'].includes(batchData.status)) {
    if (batchData.rejectedBagIds.length) renderResolveStep(root);
    else renderReceiverStep(root);
  } else if (batchData.status === 'Accepted') {
    renderAcceptedStep(root);
  }
}

function renderScanStep(root) {
  scanInstance?.destroy();
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div><div id="batch-scan-root"></div></div>
      <div class="card">
        <div class="section-title">Bags in this batch (${batchData.bags.length})</div>
        <div id="batch-bag-list"></div>
      </div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-block-start:var(--s5)">
      <button type="button" class="btn btn-primary" data-action="send" ${batchData.bags.length ? '' : 'disabled aria-disabled="true"'}>Send to airline ${icon('arrow-right', 16)}</button>
    </div>`;
  scanInstance = createScanInput(root.querySelector('#batch-scan-root'), {
    label: 'Scan Rabel tag',
    placeholder: 'e.g. RBL-A-0070',
    onSubmit: async (code) => {
      const result = await api.batchScanBag(batchId, code);
      await refreshQuiet();
      renderBagList(root);
      const sendBtn = root.querySelector('[data-action="send"]');
      if (sendBtn) sendBtn.disabled = !batchData.bags.length;
      return result;
    },
  });
  renderBagList(root);
  root.querySelector('[data-action="send"]').addEventListener('click', openSendModal);
}

async function refreshQuiet() {
  try { batchData = await api.getBatch(batchId); } catch (err) { if (appEl) toast(err.message, 'error'); }
}

function renderBagList(root) {
  const list = root.querySelector('#batch-bag-list');
  if (!list) return;
  if (!batchData.bags.length) { list.innerHTML = emptyState({ message: 'Scan bags to add them.' }); return; }
  list.innerHTML = `<div class="stack gap-2">${batchData.bags.map((b) => `
    <div class="row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
      <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
      <span class="fs-xs muted">${esc(b.pilgrimName)}</span>
    </div>`).join('')}</div>`;
}

function openSendModal() {
  let submitting = false;
  let options;
  const close = openModal({
    title: 'Send to airline',
    bodyHtml: `<div id="send-form-root">${skeletonBlock(3)}</div>`,
  });
  api.getHandoverOptions().then((result) => {
    options = result;
    const root = document.getElementById('send-form-root');
    if (!root) return;
    root.innerHTML = `
      <form id="send-batch-form" novalidate>
        <div class="field">
          <label for="send-vehicle">Delivery vehicle <span class="req">*</span></label>
          <select id="send-vehicle" required>
            <option value="">Select…</option>
            ${options.deliveryVehicles.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="send-mu">Make-up position <span class="req">*</span></label>
          <select id="send-mu" required>
            <option value="">Select…</option>
            ${options.makeupPositions.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('')}
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="send-batch-submit">Send</button>
        </div>
      </form>`;
    root.querySelector('[data-act="cancel"]').addEventListener('click', close);
    root.querySelector('#send-batch-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      const vehicleId = root.querySelector('#send-vehicle').value;
      const mu = root.querySelector('#send-mu').value;
      if (!vehicleId || !mu) { toast('Vehicle and make-up position are both required.', 'error'); return; }
      submitting = true;
      const btn = root.querySelector('#send-batch-submit');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Sending…';
      try {
        await api.sendBatch(batchId, { vehicleId, mu });
        close();
        toast('Batch sent to the airline.', 'success');
        await loadBatch();
      } catch (err) {
        submitting = false;
        btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Send';
        toast(err.message, 'error');
      }
    });
  }).catch((err) => { toast(err.message, 'error'); close(); });
}

async function renderDecisionStep(root) {
  root.innerHTML = skeletonBlock(4);
  let decisionInfo;
  try {
    decisionInfo = await api.getAirlineDecision(batchId);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => renderDecisionStep(root));
    return;
  }
  if (!appEl) return;
  if (decisionInfo.decided) {
    root.innerHTML = `
      <div class="card">
        <div class="section-title">Airline decision</div>
        <p class="fs-sm">Decision: <strong>${esc(decisionInfo.decision)}</strong></p>
        ${decisionInfo.decision === 'reject' ? `<p class="fs-sm muted">Reason: ${esc(decisionInfo.rejectReason || '')}</p>` : ''}
      </div>`;
    return;
  }
  root.innerHTML = `
    <div class="card">
      <div class="section-title">Waiting for the airline</div>
      <p class="fs-sm muted" style="margin-block-end:var(--s4)">The airline hasn't recorded a decision in their own app yet.</p>
      <label class="checkbox-row" style="margin-block-end:var(--s4)">
        <input type="checkbox" id="record-on-behalf" ${recordOnBehalf ? 'checked' : ''} />
        Airline has no app access — record on behalf
      </label>
      <div id="fallback-actions" style="${recordOnBehalf ? '' : 'display:none'}">
        <div class="row gap-2 wrap">
          <button type="button" class="btn btn-primary" data-action="accept-decision">${icon('check', 16)} Accept</button>
          <button type="button" class="btn btn-danger" data-action="reject-decision">${icon('x-circle', 16)} Reject</button>
        </div>
      </div>
    </div>`;
  root.querySelector('#record-on-behalf').addEventListener('change', (e) => {
    recordOnBehalf = e.target.checked;
    root.querySelector('#fallback-actions').style.display = recordOnBehalf ? '' : 'none';
  });
  root.querySelector('[data-action="accept-decision"]').addEventListener('click', onAcceptDecision);
  root.querySelector('[data-action="reject-decision"]').addEventListener('click', onRejectDecisionPrompt);
}

async function onAcceptDecision() {
  const proceed = await confirmDialog({ title: 'Accept on behalf of the airline', body: 'This records the airline as having accepted the full batch.', confirmLabel: 'Accept' });
  if (!proceed) return;
  try {
    await api.recordDecisionFallback(batchId, { decision: 'accept' });
    toast('Decision recorded.', 'success');
    await loadBatch();
  } catch (err) { toast(err.message, 'error'); }
}

function onRejectDecisionPrompt() {
  let submitting = false;
  const close = openModal({
    title: 'Reject on behalf of the airline',
    large: true,
    bodyHtml: `
      <form id="reject-decision-form" novalidate>
        <div class="field">
          <label for="reject-reason">Reason <span class="req">*</span></label>
          <select id="reject-reason" required>
            <option value="">Select…</option>
            ${REJECT_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Bags to reject <span class="req">*</span></label>
          ${batchData.bags.map((b) => `<label class="checkbox-row"><input type="checkbox" name="rejbag" value="${esc(b.id)}" /> ${esc(b.tagNumber)} — ${esc(b.pilgrimName)}</label>`).join('')}
        </div>
        <div class="field">
          <label for="reject-notes">Notes <span class="req">*</span></label>
          <textarea id="reject-notes" required></textarea>
          <div class="error" id="err-reject-notes" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="reject-decision-submit">Reject</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('reject-decision-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reason = form.querySelector('#reject-reason').value;
    const rejectedBagIds = Array.from(form.querySelectorAll('input[name="rejbag"]:checked')).map((i) => i.value);
    const notes = form.querySelector('#reject-notes').value.trim();
    const errBox = form.querySelector('#err-reject-notes');
    if (!reason) { toast('Select a reason.', 'error'); return; }
    if (!rejectedBagIds.length) { toast('Select at least one bag to reject.', 'error'); return; }
    if (!notes) { errBox.textContent = 'Notes are required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#reject-decision-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Rejecting…';
    try {
      await api.recordDecisionFallback(batchId, { decision: 'reject', rejectedBagIds, reason, notes });
      close();
      toast(`Airline rejected ${rejectedBagIds.length} bag(s): ${reason}.`, 'info');
      await loadBatch();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Reject';
      toast(err.message, 'error');
    }
  });
}

function renderResolveStep(root) {
  const rejected = batchData.bags.filter((b) => batchData.rejectedBagIds.includes(b.id));
  root.innerHTML = `
    <div class="card" style="margin-block-end:var(--s5)">
      <div class="section-title">Rejected bags</div>
      <div class="stack gap-2">
        ${rejected.map((b) => `
          <div class="discrepancy-row extra">
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong> — ${esc(b.pilgrimName)}
            <div class="fs-xs muted">${esc(b.rejectReason || '')}</div>
          </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="section-title">Resolve with airline</div>
      <form id="resolve-form" novalidate>
        <div class="field">
          <label>Action <span class="req">*</span></label>
          ${RESOLUTION_ACTIONS.map((a, i) => `<label class="checkbox-row"><input type="radio" name="resolve-action" value="${esc(a)}" ${i === 0 ? 'checked' : ''} /> ${esc(a)}</label>`).join('')}
        </div>
        <div class="field">
          <label for="resolve-notes">Notes <span class="req">*</span></label>
          <textarea id="resolve-notes" required></textarea>
          <div class="error" id="err-resolve-notes" hidden></div>
        </div>
        <button type="submit" class="btn btn-primary" id="resolve-submit">Resolve &amp; prepare to resubmit</button>
      </form>
    </div>`;
  const form = root.querySelector('#resolve-form');
  let submitting = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const action = form.querySelector('input[name="resolve-action"]:checked')?.value;
    const notes = form.querySelector('#resolve-notes').value.trim();
    const errBox = form.querySelector('#err-resolve-notes');
    if (!notes) { errBox.textContent = 'Notes are required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#resolve-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Resolving…';
    try {
      await api.resolveWithAirline(batchId, { action, notes });
      toast('Resolved — re-scan the bag(s) and resubmit.', 'success');
      await loadBatch();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Resolve & prepare to resubmit';
      toast(err.message, 'error');
    }
  });
}

function renderReceiverStep(root) {
  root.innerHTML = `
    <div class="card" style="max-width:520px">
      <div class="section-title">Receiving party</div>
      <form id="receiver-form" novalidate>
        <div class="field">
          <label for="recv-name">Name <span class="req">*</span></label>
          <input id="recv-name" required />
          <div class="error" id="err-recv-name" hidden></div>
        </div>
        <div class="field">
          <label for="recv-id">Staff ID <span class="req">*</span></label>
          <input id="recv-id" required />
          <div class="error" id="err-recv-id" hidden></div>
        </div>
        <div class="field">
          <label for="recv-company">Company <span class="req">*</span></label>
          <input id="recv-company" required />
        </div>
        <div class="field">
          <label for="recv-role">Role <span class="req">*</span></label>
          <select id="recv-role" required>
            <option value="">Select…</option>
            <option value="Ramp Supervisor">Ramp Supervisor</option>
            <option value="Ground Handling Agent">Ground Handling Agent</option>
            <option value="Duty Manager">Duty Manager</option>
          </select>
        </div>
        <div class="field">
          <label>Signature <span class="req">*</span></label>
          <div id="receiver-sig-root"></div>
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="receiver-submit">Record receiver &amp; generate receipt</button>
      </form>
    </div>`;
  sigPad?.destroy();
  sigPad = createSignaturePad(root.querySelector('#receiver-sig-root'));
  const form = root.querySelector('#receiver-form');
  let submitting = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const name = form.querySelector('#recv-name').value.trim();
    const staffId = form.querySelector('#recv-id').value.trim();
    const company = form.querySelector('#recv-company').value.trim();
    const role = form.querySelector('#recv-role').value;
    let hasError = false;
    const errName = form.querySelector('#err-recv-name');
    const errId = form.querySelector('#err-recv-id');
    if (name.length < 3 || name.length > 80) { errName.textContent = 'Name must be 3–80 characters.'; errName.hidden = false; hasError = true; } else errName.hidden = true;
    if (staffId.length < 4 || staffId.length > 20) { errId.textContent = 'Staff ID must be 4–20 characters.'; errId.hidden = false; hasError = true; } else errId.hidden = true;
    if (!company) { toast('Company is required.', 'error'); return; }
    if (!role) { toast('Role is required.', 'error'); return; }
    if (sigPad.isEmpty()) { toast('A signature is required.', 'error'); return; }
    if (hasError) return;
    submitting = true;
    const btn = form.querySelector('#receiver-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.recordReceiver(batchId, { name, staffId, company, role, signatureDataUrl: sigPad.toDataUrl() });
      toast('Baggage handed over — receipt generated.', 'success');
      await loadBatch();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Record receiver & generate receipt';
      toast(err.message, 'error');
    }
  });
}

async function renderAcceptedStep(root) {
  root.innerHTML = skeletonBlock(6);
  let receipt;
  try {
    receipt = await api.getHandoverReceipt(batchId);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => renderAcceptedStep(root));
    return;
  }
  if (!appEl) return;
  root.innerHTML = `
    <div class="receipt card no-print-margin">
      <div class="state-block" style="padding-block:var(--s4)">
        ${icon('check-circle', 48)}
        <h2 class="fs-lg">Rabel → Airline receipt</h2>
      </div>
      <div class="stack gap-2" style="margin-block-start:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Batch</span><strong class="mono">${esc(receipt.batch.id)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Flight</span><strong>${esc(receipt.batch.flightCode)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Bags handed over</span><strong>${receipt.bags.filter((b) => !b.rejected).length}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Receiver</span><strong>${esc(receipt.batch.receiver?.name || '')} (${esc(receipt.batch.receiver?.company || '')})</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Generated</span><strong>${esc(fmtDateTime(receipt.generatedAt))}</strong></div>
      </div>
      ${receipt.batch.receiver?.signatureDataUrl ? `<div class="field" style="margin-block-start:var(--s4)"><label>Signature</label><div style="border:1px solid var(--border);border-radius:var(--r);padding:var(--s2);max-width:300px"><img src="${esc(receipt.batch.receiver.signatureDataUrl)}" alt="Receiver signature" style="max-width:100%;display:block" /></div></div>` : ''}
    </div>
    <div class="row gap-2 wrap no-print" style="margin-block-start:var(--s5)">
      <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 16)} Print</button>
      <button type="button" class="btn btn-secondary" data-action="report">${icon('file-text', 16)} Generate handover report</button>
      <button type="button" class="btn btn-secondary" data-action="notify">${icon('bell', 16)} Notify Operations Manager</button>
    </div>
    <div id="report-root" class="no-print"></div>
    <div class="card no-print" style="margin-block-start:var(--s5)">
      <div class="section-title">More trucks?</div>
      <div class="row gap-2 wrap">
        <a class="btn btn-secondary" href="#/dep/incoming">${icon('truck', 16)} More trucks</a>
        <a class="btn btn-primary" href="#/handover">${icon('clipboard-check', 16)} No more trucks — shift handover</a>
      </div>
    </div>`;

  root.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
  root.querySelector('[data-action="notify"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.notifyOperationsManager(`${receipt.batch.id} handed over to the airline.`);
      toast('Operations Manager notified.', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  });
  root.querySelector('[data-action="report"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const report = await api.generateHandoverReport(receipt.batch.flightCode);
      const reportRoot = root.querySelector('#report-root');
      reportRoot.innerHTML = `
        <div class="card" style="margin-block-start:var(--s4)">
          <div class="section-title">Handover report — ${esc(report.flightCode)}</div>
          <p class="fs-sm">Handed over: <strong>${report.handedCount}</strong> / ${report.totalCount} bags</p>
          <div class="stack gap-1" style="margin-block-start:var(--s2)">
            ${report.batches.map((b) => `<div class="fs-sm">${esc(b.id)} — ${statusChip(b.status)} — ${b.bagCount} bags${b.rejectedCount ? `, ${b.rejectedCount} rejected` : ''}</div>`).join('')}
          </div>
        </div>`;
    } catch (err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  });
}
