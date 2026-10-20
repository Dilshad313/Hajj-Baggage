import * as api from '../api.js';
import {
  esc, fmtDateTime, skeletonBlock, errorState,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let data = null; // { generatedAt, receipts, loadReports, dcsMessages, dailySummary }
let loadError = '';
let tables = [];

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  data = null;
  loadError = '';
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  destroyTables();
  appEl = null;
}

function destroyTables() {
  tables.forEach((t) => t.destroy());
  tables = [];
}

async function load() {
  if (!appEl) return;
  if (!data) renderSkeleton();
  try {
    const result = await api.getReportsSummary();
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
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Reports</h1></div>${skeletonBlock(8)}`;
}

function renderPage() {
  if (!appEl) return;
  destroyTables();
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Reports</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  const { generatedAt, receipts, loadReports, dcsMessages, dailySummary } = data;

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Reports</h1>
        <p class="page-subtitle">Generated at ${esc(fmtDateTime(generatedAt))}</p>
      </div>
    </div>

    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Bags handled', value: dailySummary.bagsHandled })}
      ${kpiTile({ label: 'Open exceptions', value: dailySummary.exceptionsOpen })}
    </div>

    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Receipts</h2>
      <div id="receipts-table"></div>
    </div>

    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Load reports</h2>
      <div id="load-reports-table"></div>
    </div>

    <div class="card">
      <h2 class="section-title">DCS messages</h2>
      <div id="dcs-table"></div>
    </div>`;

  tables.push(createDataTable(appEl.querySelector('#receipts-table'), {
    columns: [
      { key: 'batch', label: 'Batch', sortable: true },
      { key: 'flight', label: 'Flight', sortable: true },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
      { key: 'accepted', label: 'Accepted', sortable: true },
      { key: 'rejected', label: 'Rejected', sortable: true },
    ],
    rows: receipts,
    getRowId: (r) => r.batch,
    searchKeys: ['batch', 'flight'],
    csvFilename: 'receipts',
    emptyMessage: 'None yet.',
  }));

  tables.push(createDataTable(appEl.querySelector('#load-reports-table'), {
    columns: [
      { key: 'flight', label: 'Flight', sortable: true },
      { key: 'destination', label: 'Destination', sortable: true },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
      { key: 'expected', label: 'Expected', sortable: true },
      { key: 'loaded', label: 'Loaded', sortable: true },
    ],
    rows: loadReports,
    getRowId: (r) => r.flight,
    searchKeys: ['flight', 'destination'],
    csvFilename: 'load-reports',
    emptyMessage: 'None yet.',
  }));

  tables.push(createDataTable(appEl.querySelector('#dcs-table'), {
    columns: [
      { key: 'batch', label: 'Batch', sortable: true },
      { key: 'flight', label: 'Flight', sortable: true },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
      { key: 'at', label: 'At', sortable: true, render: (r) => esc(fmtDateTime(r.at)), csvValue: (r) => fmtDateTime(r.at) },
    ],
    rows: dcsMessages,
    getRowId: (r) => `${r.batch}-${r.at}`,
    searchKeys: ['batch', 'flight'],
    csvFilename: 'dcs-messages',
    emptyMessage: 'None yet.',
  }));
}
