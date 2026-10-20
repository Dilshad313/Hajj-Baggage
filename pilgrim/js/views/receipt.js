import * as api from '../api.js';
import { icon, esc, fmtDateTime, fmtWeight, skeletonBlock, errorState } from '../ui.js';

let appEl = null;
let mounted = false;
let receiptId = null;
let data = null;
let loading = true;
let loadError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  receiptId = params.id;
  data = null; loading = true; loadError = '';
  renderShell();
  load();
  return { destroy };
}

/** No timers to clean up. */
export function destroy() {
  mounted = false;
  appEl = null;
}

async function load() {
  loading = true; loadError = '';
  renderShell();
  try {
    const res = await api.getReceipt(receiptId);
    if (!mounted) return;
    data = res;
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Receipt</h1>
    </div>
    <div id="receipt-body">${bodyHtml()}</div>
  `;
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(6);
  if (loadError) return errorState({ message: loadError });
  const { receipt, booking, passportMasked, bags } = data;
  return `
    <div class="receipt card">
      <div class="stack gap-1" style="text-align:center;margin-block-end:var(--s5)">
        <span class="fs-lg" style="color:var(--accent);font-weight:var(--fw-bold)">Rabel</span>
        <span class="fs-xs muted">رابل — خدمة أمتعة الحجاج</span>
        <h1 class="fs-lg" style="margin-block-start:var(--s3)">Check-in Receipt</h1>
        <p class="mono fs-sm muted">${esc(receipt.receiptNo)}</p>
      </div>
      <div class="stack gap-3">
        <div class="row" style="justify-content:space-between">
          <span class="fs-sm muted">Centre</span><span class="fs-sm fw-medium">${esc(receipt.centreName)}</span>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="fs-sm muted">Staff</span><span class="fs-sm fw-medium">${esc(receipt.staffName)}</span>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="fs-sm muted">Generated</span><span class="fs-sm fw-medium">${esc(fmtDateTime(receipt.generatedAt))}</span>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="fs-sm muted">Passport</span><span class="fs-sm fw-medium masked-passport">${esc(passportMasked)}</span>
        </div>
        <div class="row" style="justify-content:space-between">
          <span class="fs-sm muted">Booking</span><span class="fs-sm fw-medium mono">${esc(receipt.bookingId)}</span>
        </div>
        ${booking ? `
        <div class="row" style="justify-content:space-between">
          <span class="fs-sm muted">Flight</span><span class="fs-sm fw-medium">${esc(booking.flightCode)}</span>
        </div>` : ''}
      </div>
      <div class="stack gap-2" style="margin-block-start:var(--s5)">
        <h2 class="section-title">Bags (${bags.length})</h2>
        ${bags.map((b) => `
          <div class="row" style="justify-content:space-between;padding-block:var(--s2);border-bottom:1px solid var(--border)">
            <span class="mono fs-sm">${esc(b.tagNumber)}</span>
            <span class="fs-sm muted">${fmtWeight(b.weightKg)}</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="footer-bar">
      <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 18)} Print</button>
      ${booking
        ? `<a class="btn btn-primary" href="#/booking/${esc(booking.id)}">Back to booking</a>`
        : `<a class="btn btn-primary" href="#/track">Back to tracking</a>`}
    </div>`;
}

function wireBody() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  appEl.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());
}
