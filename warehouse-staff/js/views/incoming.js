import * as api from '../api.js';
import {
  esc, fmtDateTime, fmtCountdown, skeletonBlock, emptyState, errorState, openDrawer,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, countdownChip } from '../components/status-chip.js';

let appEl = null;
let table = null;
let step = 'loading'; // loading | error | ready
let errorMessage = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  step = 'loading';
  errorMessage = '';
  load();
  return { destroy, poll, refresh: load };
}

export function destroy() {
  table?.destroy();
  table = null;
  appEl = null;
}

function pageHeader() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Incoming trucks</h1>
        <p class="page-subtitle">Collection trucks heading to, or already at, the warehouse.</p>
      </div>
    </div>`;
}

async function load() {
  if (!appEl) return;
  step = 'loading';
  table?.destroy();
  table = null;
  appEl.innerHTML = `${pageHeader()}${skeletonBlock(6)}`;
  try {
    const trips = await api.getIncoming();
    if (!appEl) return;
    step = 'ready';
    renderData(trips);
  } catch (err) {
    if (!appEl) return;
    step = 'error';
    errorMessage = err.message;
    appEl.innerHTML = `${pageHeader()}${errorState({ message: errorMessage })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
  }
}

async function poll() {
  if (!appEl || step !== 'ready') return;
  try {
    const trips = await api.getIncoming();
    if (!appEl) return;
    if (!table || !trips.length) { renderData(trips); return; }
    table.setRows(sortByEta(trips));
  } catch (e) { /* silent background refresh */ }
}

function sortByEta(trips) {
  return [...trips].sort((a, b) => new Date(a.eta).getTime() - new Date(b.eta).getTime());
}

function isLate(trip) {
  return trip.status === 'En route' && new Date(trip.eta).getTime() < Date.now();
}

function renderData(trips) {
  if (!trips.length) {
    appEl.innerHTML = `${pageHeader()}${emptyState({ message: 'No inbound trucks right now.' })}`;
    return;
  }
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="card">
      <div id="incoming-table-root"></div>
    </div>`;
  const root = appEl.querySelector('#incoming-table-root');
  table = createDataTable(root, {
    rows: sortByEta(trips),
    searchKeys: ['code', 'truckPlate', 'driverName', 'centre', 'manifestNo', 'status', 'bay'],
    getRowId: (t) => t.id,
    csvFilename: 'incoming-trucks',
    emptyMessage: 'No matching trucks.',
    onRowClick: (t) => openManifestDrawer(t),
    columns: [
      { key: 'code', label: 'Truck QR', sortable: true, render: (t) => `<span class="mono">${esc(t.code)}</span>` },
      { key: 'truckPlate', label: 'Plate', sortable: true, render: (t) => esc(t.truckPlate) },
      { key: 'centre', label: 'From centre', sortable: true, render: (t) => esc(t.centre) },
      { key: 'driverName', label: 'Driver', sortable: true, render: (t) => esc(t.driverName) },
      {
        key: 'eta',
        label: 'ETA',
        sortable: true,
        csvValue: (t) => t.eta,
        render: (t) => `
          <span class="row gap-2">
            <span title="${esc(fmtDateTime(t.eta))}">${esc(fmtCountdown(t.eta))}</span>
            ${isLate(t) ? countdownChip('Late', 'critical') : ''}
          </span>`,
      },
      { key: 'bags', label: 'Bags', sortable: true, render: (t) => String(t.bagIds.length), csvValue: (t) => t.bagIds.length },
      { key: 'status', label: 'Status', sortable: true, render: (t) => statusChip(t.status), csvValue: (t) => t.status },
      { key: 'bay', label: 'Bay', sortable: true, render: (t) => esc(t.bay || '—'), csvValue: (t) => t.bay || '' },
    ],
  });
}

/* ===================== Manifest drawer ===================== */

function manifestListHtml(bags) {
  return `
    <div class="stack gap-2">
      ${bags.map((b) => `
        <div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
          <span class="fs-sm"><strong class="mono">${esc(b.tagNumber)}</strong> &middot; ${esc(b.pilgrimName)}</span>
          ${statusChip(b.status)}
        </div>`).join('')}
    </div>`;
}

function openManifestDrawer(trip) {
  const drawer = openDrawer({
    title: `${trip.code} — manifest`,
    bodyHtml: `<div id="manifest-body">${skeletonBlock(4)}</div>`,
    footerHtml: `<button type="button" class="btn btn-secondary" data-action="print">Print</button>`,
  });
  const body = drawer.el.querySelector('#manifest-body');
  drawer.el.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());

  async function loadManifest() {
    body.innerHTML = skeletonBlock(4);
    try {
      const bags = await api.getTripManifest(trip.id);
      body.innerHTML = bags.length ? manifestListHtml(bags) : emptyState({ message: 'No bags on this truck yet.' });
    } catch (err) {
      body.innerHTML = errorState({ message: err.message });
      body.querySelector('[data-action="retry"]')?.addEventListener('click', loadManifest);
    }
  }

  loadManifest();
}
