import * as api from '../api.js';
import { esc, icon, fmtDateTime, skeletonBlock, errorState } from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';
import { kpiTile } from '../components/kpi-tile.js';

let appEl = null;
let summary = null;
let loadError = '';
let dataTableInstance = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  summary = null;
  loadError = '';
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  dataTableInstance?.destroy();
  dataTableInstance = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  renderSkeleton();
  try {
    const result = await api.getReportsSummary();
    if (!appEl) return;
    summary = result;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

function renderSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Reports</h1></div>${skeletonBlock(6)}`;
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Reports</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Reports</h1>
        <p class="page-subtitle">Generated at ${esc(fmtDateTime(summary.generatedAt))}</p>
      </div>
      <button type="button" class="btn btn-secondary" data-action="refresh">${icon('refresh-cw', 16)} Refresh</button>
    </div>
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Trucks received', value: summary.trucksReceived })}
      ${kpiTile({ label: 'Bags unloaded', value: summary.bagsUnloaded })}
      ${kpiTile({ label: 'Bags sorted', value: summary.bagsSorted })}
      ${kpiTile({ label: 'Bags out for delivery', value: summary.bagsOutForDelivery })}
      ${kpiTile({ label: 'Open exceptions', value: summary.exceptionsOpen })}
    </div>
    <div class="section-title">Delivery runs</div>
    <div id="runs-report-table"></div>`;

  appEl.querySelector('[data-action="refresh"]').addEventListener('click', load);
  renderRunsTable();
}

function renderRunsTable() {
  const root = appEl.querySelector('#runs-report-table');
  dataTableInstance?.destroy();
  dataTableInstance = createDataTable(root, {
    columns: [
      { key: 'run', label: 'Run', sortable: true, render: (r) => `<span class="mono">${esc(r.run)}</span>` },
      { key: 'building', label: 'Building', sortable: true, render: (r) => `Building ${esc(r.building)}` },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
      { key: 'bags', label: 'Bags', sortable: true, render: (r) => String(r.bags), csvValue: (r) => r.bags },
      { key: 'team', label: 'Team', sortable: true, render: (r) => esc(r.team) },
    ],
    rows: summary.runRows,
    searchKeys: ['run', 'building', 'status', 'team'],
    getRowId: (r) => r.run,
    csvFilename: 'delivery-runs-report',
    emptyMessage: 'No delivery runs yet.',
  });
}
