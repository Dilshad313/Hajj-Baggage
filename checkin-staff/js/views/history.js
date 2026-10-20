import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, fmtDateTime, fmtWeight, openModal } from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { timelineHtml } from '../components/bag-timeline.js';

let appEl = null;
let table = null;

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: refreshQuiet, refresh: load };
}

export function destroy() { table = null; appEl = null; }

function pageShell() {
  return `<div class="page-header"><div><h1 class="page-title">Check-in history</h1></div></div><div id="history-table-root"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell();
  const root = appEl.querySelector('#history-table-root');
  root.innerHTML = skeletonBlock(6);
  try {
    const rows = await api.getHistory();
    if (!appEl) return;
    initTable(root, rows);
  } catch (err) {
    if (!appEl) return;
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || !table) return;
  try { const rows = await api.getHistory(); if (!appEl || !table) return; table.setRows(rows); } catch (e) { /* silent */ }
}

function initTable(root, rows) {
  table = createDataTable(root, {
    rows, searchKeys: ['pilgrimName', 'passportNo', 'bookingCode', 'receiptNo'], pageSize: 25,
    getRowId: (h) => h.sessionId, csvFilename: 'checkin-history',
    emptyMessage: 'No completed check-ins yet.',
    columns: [
      { key: 'completedAt', label: 'Completed', sortable: true, render: (h) => fmtDateTime(h.completedAt), csvValue: (h) => h.completedAt },
      { key: 'pilgrimName', label: 'Pilgrim', sortable: true },
      { key: 'bookingCode', label: 'Booking code' },
      { key: 'receiptNo', label: 'Receipt no.' },
      { key: 'bagsCount', label: 'Bags', sortable: true },
      { key: 'totalKg', label: 'Weight', render: (h) => fmtWeight(h.totalKg), csvValue: (h) => h.totalKg },
      {
        key: 'actions', label: 'Actions',
        render: (h) => `
          <div class="row gap-2">
            <button type="button" class="btn btn-secondary" style="height:32px;font-size:12px" data-act="receipt" data-id="${esc(h.sessionId)}">Receipt</button>
            <button type="button" class="btn btn-secondary" style="height:32px;font-size:12px" data-act="tag" data-receipt="${esc(h.receiptNo)}">Tag</button>
            <button type="button" class="btn btn-secondary" style="height:32px;font-size:12px" data-act="timeline" data-receipt="${esc(h.receiptNo)}">Timeline</button>
          </div>`,
      },
    ],
  });
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.stopPropagation();
    const act = btn.dataset.act;
    const row = rows.find((r) => r.sessionId === btn.dataset.id || r.receiptNo === btn.dataset.receipt);
    if (act === 'receipt') openReceiptModal(row);
    else if (act === 'tag') openTagModal(row);
    else if (act === 'timeline') openTimelineModal(row);
  });
}

function openReceiptModal(row) {
  openModal({
    title: `Receipt ${row.receiptNo}`,
    bodyHtml: `<div id="receipt-modal-body"></div>`,
    onMount: (overlay) => {
      const body = overlay.querySelector('#receipt-modal-body');
      body.innerHTML = `
        <div class="print-area">
          <div class="receipt-preview">
            <div class="receipt-head"><strong class="fs-lg">Rabel Baggage Receipt</strong><div class="fs-sm muted">${row.receiptNo}</div></div>
            <div class="fs-sm">Pilgrim: ${row.pilgrimName}</div>
            <div class="fs-sm">Booking: ${row.bookingCode}</div>
            <table><thead><tr><th>Tag</th></tr></thead><tbody>${row.tagNumbers.map((t) => `<tr><td class="mono">${t}</td></tr>`).join('')}</tbody></table>
            <div class="receipt-total"><span>Total</span><span>${row.bagsCount} bags · ${fmtWeight(row.totalKg)}</span></div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary" style="margin-block-start:var(--s4)" id="print-receipt-btn">${icon('printer', 16)} Print</button>`;
      body.querySelector('#print-receipt-btn').addEventListener('click', () => window.print());
    },
  });
}

/** Resolves directly to the one tag, or shows a quick picker when a check-in had more than one bag. */
function pickTag(row, onPick) {
  if (row.tagNumbers.length === 1) { onPick(row.tagNumbers[0]); return; }
  openModal({
    title: 'Select a bag',
    bodyHtml: `<div class="stack gap-2">${row.tagNumbers.map((t) => `<button type="button" class="btn btn-secondary btn-block" data-pick="${t}">${t}</button>`).join('')}</div>`,
    onMount: (overlay) => {
      overlay.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => {
        overlay.closest('.overlay')?.remove();
        onPick(btn.dataset.pick);
      }));
    },
  });
}

function openTagModal(row) {
  pickTag(row, (tagNumber) => {
    openModal({
      title: 'Reprint tag',
      bodyHtml: `<div id="tag-modal-body"></div>`,
      onMount: (overlay) => {
        const body = overlay.querySelector('#tag-modal-body');
        body.innerHTML = `
          <div class="print-area">
            <div class="tag-preview">
              <div class="tag-no">${tagNumber}</div>
              <div class="tag-barcode"><svg id="reprint-barcode"></svg></div>
              <div class="tag-meta">Pilgrim: ${row.pilgrimName}</div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary" style="margin-block-start:var(--s4)" id="print-tag-btn">${icon('printer', 16)} Print</button>`;
        if (window.JsBarcode) {
          try { window.JsBarcode('#reprint-barcode', tagNumber, { format: 'CODE128', width: 1.5, height: 40, displayValue: false }); } catch (e) { /* ignore */ }
        }
        body.querySelector('#print-tag-btn').addEventListener('click', () => window.print());
      },
    });
  });
}

function openTimelineModal(row) {
  pickTag(row, async (tagNumber) => {
    let data;
    try { data = await api.getBagTimeline(tagNumber); } catch (e) { toast(e.message, 'error'); return; }
    openModal({ title: `Bag timeline — ${data.bag.tagNumber}`, bodyHtml: timelineHtml(data.timeline) });
  });
}
