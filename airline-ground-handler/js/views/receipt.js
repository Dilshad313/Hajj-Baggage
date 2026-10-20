import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, errorState,
} from '../ui.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let batchId = null;
let data = null; // { batch, flight, accepted, rejected, notReceived, generatedAt }
let loadError = '';
let dcsState = 'idle'; // idle | sending | acknowledged | failed

/** @param {{id:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  batchId = params.id;
  data = null;
  loadError = '';
  dcsState = 'idle';
  load();
  return { destroy };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  if (!data) renderSkeleton();
  try {
    const result = await api.getReceipt(batchId);
    if (!appEl) return;
    data = result;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

function renderSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Receipt</h1></div>${skeletonBlock(8)}`;
}

function bagLineHtml(b) {
  return `
    <div class="row" style="justify-content:space-between;padding:var(--s1) 0">
      <span class="fs-sm mono">${esc(b.tagNumber)}</span>
      <span class="fs-sm">${esc(b.pilgrimName)}</span>
    </div>`;
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Receipt</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  const { batch, flight, accepted, rejected, notReceived, generatedAt } = data;

  appEl.innerHTML = `
    <a class="fs-sm muted no-print" href="#/">${icon('arrow-left', 14)} Dashboard</a>

    <div class="receipt card" style="margin-block-start:var(--s3)">
      <div class="row" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:var(--s3)">
        <div>
          <h1 class="fs-xl mono">${esc(batch.id)}</h1>
          <p class="fs-sm muted">${esc(flight.code)} · ${esc(flight.destination)}</p>
          <p class="fs-xs muted">Generated ${esc(fmtDateTime(generatedAt))}</p>
        </div>
        <div id="receipt-qr"></div>
      </div>

      <div class="section-title" style="margin-block-start:var(--s5)">Accepted (${accepted.length})</div>
      ${accepted.length
        ? `<div class="stack gap-1">${accepted.map(bagLineHtml).join('')}</div>`
        : `<p class="fs-sm muted">None.</p>`}

      ${rejected.length ? `
        <div class="section-title" style="margin-block-start:var(--s5)">Rejected (${rejected.length})</div>
        <div class="stack gap-1">${rejected.map(bagLineHtml).join('')}</div>` : ''}

      ${notReceived.length ? `
        <div class="section-title" style="margin-block-start:var(--s5)">Not received (${notReceived.length})</div>
        <div class="stack gap-1">${notReceived.map(bagLineHtml).join('')}</div>` : ''}

      <div class="section-title" style="margin-block-start:var(--s5)">Receiver</div>
      ${batch.receiverName ? `
        <p class="fs-sm">${esc(batch.receiverName)}</p>
        <div class="field">
          <label>Signature</label>
          <div style="border:1px solid var(--border);border-radius:var(--r-md);padding:var(--s2);max-width:300px">
            ${batch.signatureDataUrl
              ? `<img src="${esc(batch.signatureDataUrl)}" alt="Signature" style="max-width:100%;display:block" />`
              : `<p class="fs-sm muted">No signature on file.</p>`}
          </div>
        </div>` : `
        <p class="fs-sm">Batch rejected — reason: ${esc(batch.rejectReason || '—')}</p>`}
    </div>

    <div class="row gap-2 wrap no-print" style="margin-block-start:var(--s5)">
      <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 16)} Print</button>
      <button type="button" class="btn btn-secondary" data-action="send-rabel">${icon('send', 16)} Send to Rabel</button>
    </div>

    <div class="card no-print" style="margin-block-start:var(--s4)">
      <div class="section-title">Update airline system (DCS)</div>
      <div id="dcs-panel"></div>
    </div>`;

  const qrEl = appEl.querySelector('#receipt-qr');
  if (qrEl && window.QRCode) new window.QRCode(qrEl, { text: batch.id, width: 120, height: 120 });

  appEl.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
  appEl.querySelector('[data-action="send-rabel"]').addEventListener('click', () => toast('Receipt sent to Rabel.', 'success'));
  renderDcsPanel();
}

function renderDcsPanel() {
  const root = appEl?.querySelector('#dcs-panel');
  if (!root) return;
  const chip = dcsState === 'idle' ? '<span class="chip chip-grey">Not sent</span>'
    : dcsState === 'sending' ? '<span class="chip dcs-sent">Sent</span>'
    : dcsState === 'acknowledged' ? statusChip('Acknowledged')
    : statusChip('Failed');
  const button = dcsState === 'idle'
    ? `<button type="button" class="btn btn-secondary" data-action="dcs-send">${icon('send', 16)} Update airline system</button>`
    : dcsState === 'failed'
    ? `<button type="button" class="btn btn-secondary" data-action="dcs-retry">${icon('rotate-ccw', 16)} Retry</button>`
    : '';
  const note = dcsState === 'acknowledged' ? '' : `<p class="fs-xs" style="color:var(--warning);margin-block-start:var(--s2)">${icon('alert-triangle', 14)} DCS not updated</p>`;

  root.innerHTML = `
    <div class="row gap-3 wrap" style="align-items:center">${chip}${button}</div>
    ${note}`;
  root.querySelector('[data-action="dcs-send"]')?.addEventListener('click', onDcsSend);
  root.querySelector('[data-action="dcs-retry"]')?.addEventListener('click', onDcsRetry);
}

async function onDcsSend() {
  dcsState = 'sending';
  renderDcsPanel();
  try {
    await api.sendDcs(data.batch.id);
    if (!appEl) return;
    dcsState = 'acknowledged';
  } catch (err) {
    if (!appEl) return;
    dcsState = 'failed';
  }
  renderDcsPanel();
}

async function onDcsRetry() {
  dcsState = 'sending';
  renderDcsPanel();
  try {
    await api.retryDcs(data.batch.id);
    if (!appEl) return;
    dcsState = 'acknowledged';
  } catch (err) {
    if (!appEl) return;
    dcsState = 'failed';
  }
  renderDcsPanel();
}
