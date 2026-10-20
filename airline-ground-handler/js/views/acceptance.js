import * as api from '../api.js';
import {
  esc, icon, toast, announce, fmtDateTime, fmtWeight, skeletonBlock, emptyState, errorState,
  openModal, openDrawer, confirmDialog,
} from '../ui.js';
import { navigate } from '../router.js';
import { getSession } from '../store.js';
import { createScanInput } from '../components/scan-input.js';
import { createSignaturePad } from '../components/signature-pad.js';
import { statusChip } from '../components/status-chip.js';
import { RESOLUTION_OPTIONS, REJECT_REASONS } from '../seed.js';

let appEl = null;
let batchId = null;
let data = null; // { batch, flight, vehicle, bags }
let bsmByTag = {};
let tab = 'scan'; // scan | verify | accept
let loadError = '';
let scanInstance = null;
let sigPad = null;
let verifyingAll = false;
let accepting = false;

/** @param {{id:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  batchId = params.id;
  data = null;
  loadError = '';
  tab = 'scan';
  verifyingAll = false;
  accepting = false;
  load();
  return { destroy, refresh: load, activeBatchId: () => batchId };
}

export function destroy() {
  scanInstance?.destroy();
  scanInstance = null;
  sigPad?.destroy();
  sigPad = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  if (!data) renderSkeleton();
  try {
    const result = await api.getBatch(batchId);
    if (!appEl) return;
    data = result;
    loadError = '';
    if (tab === 'verify') {
      const bsms = await api.getBsms(data.flight.code);
      if (!appEl) return;
      bsmByTag = {};
      bsms.forEach((m) => { if (m.active) bsmByTag[m.airlineTag] = m; });
    }
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

function renderSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Batch</h1></div>${skeletonBlock(6)}`;
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/inbox">${icon('arrow-left', 16)} Back</a></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  const { batch, flight } = data;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/inbox">${icon('arrow-left', 14)} Inbox</a>
        <h1 class="page-title">${esc(batch.id)} <span class="muted fs-sm">· ${esc(flight.code)} · ${esc(batch.vehicleId)} · ${esc(batch.mu)}</span></h1>
        <p class="page-subtitle">${data.bags.length} bags · sent ${fmtDateTime(batch.sentAt)}</p>
      </div>
      ${statusChip(batch.status)}
    </div>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" aria-selected="${tab === 'scan'}" data-tab="scan">Scan</button>
      <button type="button" class="tab" role="tab" aria-selected="${tab === 'verify'}" data-tab="verify">Verify</button>
      <button type="button" class="tab" role="tab" aria-selected="${tab === 'accept'}" data-tab="accept">Accept</button>
    </div>
    <div id="tab-content"></div>`;

  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => onTabClick(btn.dataset.tab)));
  renderTabContent();
}

async function onTabClick(next) {
  if (next === tab) return;
  tab = next;
  renderPage();
  if (tab === 'verify') await load();
  else renderTabContent();
}

function renderTabContent() {
  const root = appEl?.querySelector('#tab-content');
  if (!root) return;
  if (tab === 'scan') renderScanTab(root);
  else if (tab === 'verify') renderVerifyTab(root);
  else renderAcceptTab(root);
}

/* ===================== SCAN tab ===================== */

function renderScanTab(root) {
  scanInstance?.destroy();
  const scannedCount = data.bags.filter((b) => b.scannedAt).length;
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div><div id="batch-scan-root"></div></div>
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-block-end:var(--s3)">
          <div class="section-title" style="margin-block-end:0">Manifest</div>
          <strong class="fs-sm">${scannedCount} / ${data.bags.length} scanned</strong>
        </div>
        <div class="capacity-bar" style="margin-block-end:var(--s4)"><div class="capacity-bar-fill" style="width:${data.bags.length ? Math.round((scannedCount / data.bags.length) * 100) : 0}%"></div></div>
        <div id="scan-list"></div>
      </div>
    </div>
    <div class="save-bar-like row" style="justify-content:flex-end;margin-block-start:var(--s5)">
      <button type="button" class="btn btn-primary" data-action="to-verify">Unloading complete — verify ${icon('arrow-right', 16)}</button>
    </div>`;

  scanInstance = createScanInput(root.querySelector('#batch-scan-root'), {
    label: 'Scan Rabel or airline tag',
    placeholder: 'e.g. RBL-D-000401',
    onSubmit: async (code) => {
      const result = await api.batchScan(batchId, code);
      await refreshQuiet();
      renderScanList(root);
      return result;
    },
  });
  renderScanList(root);
  root.querySelector('[data-action="to-verify"]').addEventListener('click', () => onTabClick('verify'));
}

async function refreshQuiet() {
  try {
    data = await api.getBatch(batchId);
  } catch (err) { if (appEl) toast(err.message, 'error'); }
}

function renderScanList(root) {
  const list = root.querySelector('#scan-list');
  if (!list) return;
  list.innerHTML = `
    <div class="stack gap-2">
      ${data.bags.map((b) => `
        <div class="row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
          <div>
            <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
            <div class="fs-xs muted">${esc(b.pilgrimName)}</div>
          </div>
          ${b.scannedAt ? '<span class="chip chip-green">Scanned</span>' : '<span class="chip chip-grey">Expected</span>'}
        </div>`).join('')}
    </div>`;
}

/* ===================== VERIFY tab ===================== */

function telexHtml(bsmRec, mismatches) {
  if (!bsmRec) return `<div class="telex-box">No BSM received for this bag.</div>`;
  const dateStr = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(bsmRec.std)).toUpperCase().replace(' ', '');
  const pnrLine = mismatches?.includes('pnr') ? `<span class="telex-mismatch">${esc(bsmRec.pnr)}</span>` : esc(bsmRec.pnr);
  const weightLine = mismatches?.includes('weight') ? `<span class="telex-mismatch">${bsmRec.weightKg.toFixed(1)}</span>` : bsmRec.weightKg.toFixed(1);
  return `<div class="telex-box">.V/1L${esc(bsmRec.destination)}
.F/${esc(bsmRec.flightCode.replace(' ', ''))}/${dateStr}/${esc(bsmRec.destination)}/${esc(bsmRec.classOfService)}
.N/${esc(bsmRec.airlineTag)}
.P/${esc(bsmRec.passengerName)}
.L/${pnrLine}
.W/K/1/${weightLine}</div>`;
}

function bagMismatches(bag) {
  const bsmRec = bsmByTag[bag.airlineTagNumber];
  if (!bsmRec) return { bsmRec: null, mismatches: ['noBsm'] };
  const mismatches = [];
  if (bsmRec.pnr !== bag.pilgrimPnr) mismatches.push('pnr');
  if (Math.abs(bsmRec.weightKg - bag.weightKg) > (data.config?.bsmWeightToleranceKg ?? 1)) mismatches.push('weight');
  return { bsmRec, mismatches };
}

function renderVerifyTab(root) {
  const scanned = data.bags.filter((b) => b.scannedAt);
  const verifiedCount = scanned.filter((b) => b.verified && !b.rejected).length;
  const needsAction = scanned.filter((b) => !b.rejected && b.verified === false).length;
  const readyToAccept = scanned.every((b) => b.verified === true || b.rejected);

  root.innerHTML = `
    ${!scanned.length ? emptyState({ message: 'No bags scanned yet — scan bags on the Scan tab first.' }) : `
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3);margin-block-end:var(--s4)">
        <p class="fs-sm">${verifiedCount} verified, ${needsAction} need action.</p>
        <button type="button" class="btn btn-secondary" data-action="verify-all" ${verifyingAll ? 'disabled aria-busy="true"' : ''}>
          ${verifyingAll ? '<span class="spinner"></span> Verifying…' : `${icon('check-check', 16)} Verify all`}
        </button>
      </div>
      <div id="verify-rows"></div>
      <div class="row" style="justify-content:flex-end;margin-block-start:var(--s5)">
        <button type="button" class="btn btn-primary" data-action="to-accept" ${readyToAccept ? '' : 'disabled aria-disabled="true"'}>Continue to acceptance ${icon('arrow-right', 16)}</button>
      </div>
      ${!readyToAccept ? `<p class="fs-xs muted" style="text-align:end;margin-block-start:var(--s2)">Resolve or reject every bag that needs action first.</p>` : ''}
    `}`;

  if (!scanned.length) return;
  renderVerifyRows(root, scanned);
  root.querySelector('[data-action="verify-all"]').addEventListener('click', onVerifyAll);
  root.querySelector('[data-action="to-accept"]').addEventListener('click', () => { if (readyToAccept) onTabClick('accept'); });
}

function renderVerifyRows(root, scanned) {
  const rowsRoot = root.querySelector('#verify-rows');
  if (!rowsRoot) return;
  rowsRoot.innerHTML = scanned.map((b) => {
    const { bsmRec, mismatches } = bagMismatches(b);
    const okChip = b.rejected ? '<span class="chip chip-red">Rejected</span>'
      : b.verified === true ? '<span class="chip chip-green">Verified</span>'
      : b.verified === false ? '<span class="chip chip-amber">Needs action</span>'
      : '<span class="chip chip-grey">Not verified</span>';
    return `
      <div class="diff-row ${mismatches.length && !b.rejected ? 'mismatch' : 'ok'}" data-bag-row="${esc(b.id)}">
        <button type="button" class="card-tap" data-action="toggle-row" data-id="${esc(b.id)}" style="display:block">
          <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
            <div>
              <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
              <span class="fs-xs muted">· ${esc(b.airlineTagNumber)}</span>
              <div class="fs-sm">${esc(b.pilgrimName)}</div>
            </div>
            ${okChip}
          </div>
        </button>
        <div id="detail-${esc(b.id)}" class="stack gap-3" style="margin-block-start:var(--s3);display:none"></div>
      </div>`;
  }).join('');

  rowsRoot.querySelectorAll('[data-action="toggle-row"]').forEach((btn) => btn.addEventListener('click', () => toggleRow(rowsRoot, btn.dataset.id)));
}

function toggleRow(rowsRoot, bagId) {
  const detail = rowsRoot.querySelector(`#detail-${bagId}`);
  if (!detail) return;
  const open = detail.style.display !== 'none';
  if (open) { detail.style.display = 'none'; return; }
  const bag = data.bags.find((b) => b.id === bagId);
  const { bsmRec, mismatches } = bagMismatches(bag);
  detail.innerHTML = `
    <div class="diff-field"><span class="muted">Passenger</span><span>${esc(bag.pilgrimName)} <span class="muted">/</span> ${esc(bsmRec?.passengerName || '—')}</span></div>
    <div class="diff-field"><span class="muted">PNR</span><span>${esc(bag.pilgrimPnr)} <span class="muted">/</span> <span class="${mismatches.includes('pnr') ? 'diff-mismatch-value' : ''}">${esc(bsmRec?.pnr || '—')}</span></span></div>
    <div class="diff-field"><span class="muted">Weight</span><span>${fmtWeight(bag.weightKg)} <span class="muted">/</span> <span class="${mismatches.includes('weight') ? 'diff-mismatch-value' : ''}">${bsmRec ? fmtWeight(bsmRec.weightKg) : '—'}</span></span></div>
    ${telexHtml(bsmRec, mismatches)}
    <div class="row gap-2 wrap" id="row-actions-${esc(bagId)}"></div>`;
  detail.style.display = 'block';
  renderRowActions(detail.querySelector(`#row-actions-${bagId}`), bag, mismatches);
}

function renderRowActions(root, bag, mismatches) {
  if (bag.rejected) { root.innerHTML = `<span class="fs-sm muted">Rejected: ${esc(bag.rejectReason || '')}</span>`; return; }
  if (bag.verified === true) { root.innerHTML = `<span class="fs-sm muted">${icon('check', 14)} Verified — no action needed.</span>`; return; }
  if (mismatches.includes('noBsm')) {
    root.innerHTML = `
      <button type="button" class="btn btn-secondary" data-act="request-bsm">${icon('file-plus', 16)} Request BSM</button>
      <button type="button" class="btn btn-danger" data-act="reject-bag">${icon('x-circle', 16)} Reject bag</button>`;
    root.querySelector('[data-act="request-bsm"]').addEventListener('click', () => onRequestBsm(bag));
    root.querySelector('[data-act="reject-bag"]').addEventListener('click', () => onRejectBagPrompt(bag));
    return;
  }
  if (mismatches.includes('weight') && !mismatches.includes('pnr')) {
    root.innerHTML = `
      <button type="button" class="btn btn-secondary" data-act="reweigh">${icon('scale', 16)} Re-weigh</button>
      <button type="button" class="btn btn-secondary" data-act="accept-note">${icon('check', 16)} Accept with note</button>
      <button type="button" class="btn btn-danger" data-act="reject-bag">${icon('x-circle', 16)} Reject bag</button>`;
    root.querySelector('[data-act="reweigh"]').addEventListener('click', () => onReweighPrompt(bag));
    root.querySelector('[data-act="accept-note"]').addEventListener('click', () => onAcceptWithNotePrompt(bag));
    root.querySelector('[data-act="reject-bag"]').addEventListener('click', () => onRejectBagPrompt(bag));
    return;
  }
  root.innerHTML = `
    <button type="button" class="btn btn-secondary" data-act="investigate">${icon('search', 16)} Investigate &amp; resolve</button>
    <button type="button" class="btn btn-danger" data-act="reject-bag">${icon('x-circle', 16)} Reject bag</button>`;
  root.querySelector('[data-act="investigate"]').addEventListener('click', () => openInvestigateDrawer(bag));
  root.querySelector('[data-act="reject-bag"]').addEventListener('click', () => onRejectBagPrompt(bag));
}

async function onVerifyAll() {
  verifyingAll = true;
  renderTabContent();
  try {
    await api.verifyAll(batchId);
    await load();
  } catch (err) {
    verifyingAll = false;
    toast(err.message, 'error');
    renderTabContent();
  } finally {
    verifyingAll = false;
  }
}

async function onRequestBsm(bag) {
  try {
    const result = await api.requestBsm(bag.id);
    toast(result.message, 'success');
    await load();
  } catch (err) { toast(err.message, 'error'); }
}

function onRejectBagPrompt(bag) {
  let submitting = false;
  const close = openModal({
    title: `Reject bag — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="reject-bag-form" novalidate>
        <div class="field">
          <label for="reject-bag-reason">Reason <span class="req">*</span></label>
          <textarea id="reject-bag-reason" placeholder="Why is this bag being rejected?" required></textarea>
          <div class="error" id="err-reject-bag-reason" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="reject-bag-submit">Reject bag</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('reject-bag-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reason = form.querySelector('#reject-bag-reason').value.trim();
    const errBox = form.querySelector('#err-reject-bag-reason');
    if (!reason) { errBox.textContent = 'A reason is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#reject-bag-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Rejecting…';
    try {
      await api.rejectBag(bag.id, reason);
      close();
      toast(`${bag.tagNumber} rejected.`, 'info');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Reject bag';
      toast(err.message, 'error');
    }
  });
}

function onReweighPrompt(bag) {
  let submitting = false;
  const close = openModal({
    title: `Re-weigh — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="reweigh-form" novalidate>
        <div class="field">
          <label for="reweigh-input">New weight (kg) <span class="req">*</span></label>
          <input id="reweigh-input" type="number" min="1" max="40" step="0.1" value="${bag.weightKg}" required />
          <div class="error" id="err-reweigh" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="reweigh-submit">Save weight</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('reweigh-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const weight = Number(form.querySelector('#reweigh-input').value);
    const errBox = form.querySelector('#err-reweigh');
    if (!Number.isFinite(weight) || weight < 1 || weight > 40) { errBox.textContent = 'Weight must be between 1 and 40 kg.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#reweigh-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.reweigh(bag.id, weight);
      close();
      toast(`${bag.tagNumber} re-weighed.`, 'success');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save weight';
      toast(err.message, 'error');
    }
  });
}

function onAcceptWithNotePrompt(bag) {
  let submitting = false;
  const close = openModal({
    title: `Accept with note — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="accept-note-form" novalidate>
        <div class="field">
          <label for="accept-note-input">Note <span class="req">*</span></label>
          <textarea id="accept-note-input" placeholder="Why is this being accepted despite the weight mismatch?" required></textarea>
          <div class="error" id="err-accept-note" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="accept-note-submit">Accept bag</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('accept-note-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const note = form.querySelector('#accept-note-input').value.trim();
    const errBox = form.querySelector('#err-accept-note');
    if (!note) { errBox.textContent = 'A note is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#accept-note-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.acceptWithNote(bag.id, note);
      close();
      toast(`${bag.tagNumber} accepted with note.`, 'success');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Accept bag';
      toast(err.message, 'error');
    }
  });
}

function openInvestigateDrawer(bag) {
  const { el, close } = openDrawer({
    title: `Investigate — ${bag.tagNumber}`,
    bodyHtml: `
      <div class="section-title">Pilgrim record (Rabel)</div>
      <div class="stack gap-1 fs-sm" style="margin-block-end:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted">Name</span><strong>${esc(bag.pilgrimName)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">PNR</span><strong class="mono">${esc(bag.pilgrimPnr)}</strong></div>
      </div>
      <div class="section-title">BSM (airline)</div>
      <div id="investigate-telex" style="margin-block-end:var(--s3)"></div>
      <button type="button" class="btn btn-secondary btn-block" data-act="lookup-dcs" style="margin-block-end:var(--s5)">${icon('search', 16)} Look up booking in DCS</button>
      <div id="dcs-result" style="margin-block-end:var(--s4)"></div>
      <div class="section-title">Resolution</div>
      <form id="resolve-form" novalidate>
        <div class="field">
          <label>How was this resolved? <span class="req">*</span></label>
          ${RESOLUTION_OPTIONS.map((r, i) => `<label class="checkbox-row"><input type="radio" name="resolution" value="${esc(r)}" ${i === 0 ? 'checked' : ''} /> ${esc(r)}</label>`).join('')}
        </div>
        <div class="field">
          <label for="resolve-notes">Notes <span class="req">*</span></label>
          <textarea id="resolve-notes" placeholder="What did you find? (5–300 characters)" required></textarea>
          <div class="error" id="err-resolve-notes" hidden></div>
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="resolve-submit">Save resolution</button>
      </form>`,
  });
  const { bsmRec, mismatches } = bagMismatches(bag);
  el.querySelector('#investigate-telex').innerHTML = telexHtml(bsmRec, mismatches);
  el.querySelector('[data-act="lookup-dcs"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const result = await api.lookupDcs(bag.id);
      el.querySelector('#dcs-result').innerHTML = `<p class="fs-sm">DCS booking: <strong>${esc(result.passengerName)}</strong> · PNR <strong class="mono">${esc(result.correctPnr)}</strong></p>`;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });
  const form = el.querySelector('#resolve-form');
  let submitting = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const resolution = form.querySelector('input[name="resolution"]:checked')?.value;
    const notes = form.querySelector('#resolve-notes').value.trim();
    const errBox = form.querySelector('#err-resolve-notes');
    if (notes.length < 5 || notes.length > 300) { errBox.textContent = 'Notes must be 5–300 characters.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#resolve-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.resolveBag(bag.id, { resolution, notes });
      close();
      toast('Resolution saved.', 'success');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save resolution';
      toast(err.message, 'error');
    }
  });
}

/* ===================== ACCEPT tab ===================== */

async function renderAcceptTab(root) {
  root.innerHTML = skeletonBlock(5);
  let summary;
  try {
    summary = await api.getAcceptanceSummary(batchId);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => renderAcceptTab(root));
    return;
  }
  if (!appEl) return;
  const partial = summary.toRejectCount > 0 || summary.notReceivedCount > 0;
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div class="card">
        <div class="section-title">Summary</div>
        <div class="stack gap-2 fs-sm">
          <div class="row" style="justify-content:space-between"><span class="muted">Total bags</span><strong>${summary.total}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Verified (will be accepted)</span><strong>${summary.verifiedCount}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">To reject</span><strong>${summary.toRejectCount}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Not received</span><strong>${summary.notReceivedCount}</strong></div>
        </div>
        <div class="field" style="margin-block-start:var(--s5)">
          <label>Receiver</label>
          <input type="text" value="${esc(getSession()?.name || '')}" disabled id="accept-receiver" />
        </div>
        <div class="field">
          <label for="accept-notes">Notes (optional)</label>
          <textarea id="accept-notes" placeholder="Any notes for this handover"></textarea>
        </div>
        <div class="field">
          <label>Signature <span class="req">*</span></label>
          <div id="signature-root"></div>
        </div>
        <div class="row gap-2 wrap" style="margin-block-start:var(--s4)">
          <button type="button" class="btn btn-primary" data-action="accept-batch" ${accepting ? 'disabled aria-busy="true"' : ''}>
            ${accepting ? '<span class="spinner"></span> Accepting…' : `${icon('check', 16)} Accept baggage${partial ? ' (partial)' : ''}`}
          </button>
          <button type="button" class="btn btn-danger" data-action="reject-batch">${icon('x-circle', 16)} Reject entire batch</button>
        </div>
      </div>
      <div class="card">
        <div class="section-title">Not yet resolved</div>
        ${summary.toRejectCount || summary.notReceivedCount
          ? `<p class="fs-sm muted">${summary.toRejectCount} bag(s) will be rejected and ${summary.notReceivedCount} bag(s) were never scanned — accepting now creates a partial acceptance.</p>`
          : `<p class="fs-sm muted">${icon('check-circle', 16)} All bags are accounted for.</p>`}
      </div>
    </div>`;

  sigPad?.destroy();
  sigPad = createSignaturePad(root.querySelector('#signature-root'));

  root.querySelector('[data-action="accept-batch"]').addEventListener('click', () => onAcceptBatch(root, summary.verifiedCount));
  root.querySelector('[data-action="reject-batch"]').addEventListener('click', onRejectBatchPrompt);
}

async function onAcceptBatch(root, verifiedCount) {
  if (accepting) return;
  if (!verifiedCount) { toast('At least one bag must be verified before accepting.', 'error'); return; }
  if (sigPad.isEmpty()) { toast('A signature is required.', 'error'); return; }
  accepting = true;
  const btn = root.querySelector('[data-action="accept-batch"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Accepting…';
  try {
    const batch = await api.accept(batchId, {
      receiverName: getSession()?.name || 'Staff',
      signatureDataUrl: sigPad.toDataUrl(),
      notes: root.querySelector('#accept-notes')?.value || '',
    });
    toast(`Baggage accepted — ${batch.acceptedCount} bag(s).`, 'success');
    navigate(`#/receipt/${batchId}`);
  } catch (err) {
    accepting = false;
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = `${icon('check', 16)} Accept baggage`;
    toast(err.message, 'error');
  }
}

function onRejectBatchPrompt() {
  let submitting = false;
  const close = openModal({
    title: 'Reject entire batch',
    bodyHtml: `
      <form id="reject-batch-form" novalidate>
        <div class="field">
          <label for="reject-batch-reason">Reason <span class="req">*</span></label>
          <select id="reject-batch-reason" required>
            <option value="">Select a reason…</option>
            ${REJECT_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="reject-batch-notes">Notes</label>
          <textarea id="reject-batch-notes" placeholder="Additional detail (optional)"></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="reject-batch-submit">Reject batch</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('reject-batch-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reasonSelect = form.querySelector('#reject-batch-reason').value;
    const notes = form.querySelector('#reject-batch-notes').value.trim();
    if (!reasonSelect) { toast('Select a reason.', 'error'); return; }
    submitting = true;
    const btn = form.querySelector('#reject-batch-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Rejecting…';
    try {
      await api.rejectBatch(batchId, notes ? `${reasonSelect} — ${notes}` : reasonSelect);
      close();
      toast('Batch rejected.', 'info');
      navigate(`#/receipt/${batchId}`);
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Reject batch';
      toast(err.message, 'error');
    }
  });
}
