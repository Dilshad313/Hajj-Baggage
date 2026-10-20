import * as api from '../api.js';
import {
  skeletonBlock, errorState, emptyState, fmtDateTime, fmtNumber, fmtPercent, toCsv, downloadBlob, esc, icon,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { statusChip } from '../components/status-chip.js';
import { createDataTable } from '../components/data-table.js';

let appEl = null;
let activeTab = 'shift';

let shiftState = { status: 'idle', data: null, error: null };
let kpiState = { status: 'idle', data: null, error: null };
let postSeasonState = { status: 'idle', data: null, error: null };

let kpiTable = null;
let postFlightTable = null;
const charts = { onTime: null, excType: null, rates: null };

const TABS = [
  { id: 'shift', label: 'Shift report' },
  { id: 'kpi', label: 'KPI review' },
  { id: 'postseason', label: 'Post-season report' },
];

/**
 * Renders the reports view.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy: Function}}
 */
export function render(params, app) {
  appEl = app;
  renderPage();
  return { destroy };
}

/** Destroys the reports view, releasing chart instances and table listeners. */
export function destroy() {
  destroyCharts();
  if (kpiTable) { kpiTable.destroy(); kpiTable = null; }
  if (postFlightTable) { postFlightTable.destroy(); postFlightTable = null; }
  appEl = null;
}

function destroyCharts() {
  charts.onTime?.destroy(); charts.onTime = null;
  charts.excType?.destroy(); charts.excType = null;
  charts.rates?.destroy(); charts.rates = null;
}

function renderPage() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Reports</h1><p class="page-subtitle">Generate shift, KPI and post-season reports for stakeholders.</p></div>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${activeTab === t.id}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="reports-tab-root"></div>`;
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => onTabClick(btn.dataset.tab)));
  if (activeTab === 'kpi' && kpiState.status === 'idle') loadKpi();
  else renderTabRoot();
}

function onTabClick(tab) {
  if (tab === activeTab) return;
  activeTab = tab;
  appEl.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === activeTab)));
  if (activeTab === 'kpi' && kpiState.status === 'idle') loadKpi();
  else renderTabRoot();
}

function renderTabRoot() {
  if (!appEl) return;
  destroyCharts();
  if (kpiTable) { kpiTable.destroy(); kpiTable = null; }
  if (postFlightTable) { postFlightTable.destroy(); postFlightTable = null; }
  const root = appEl.querySelector('#reports-tab-root');
  if (!root) return;
  if (activeTab === 'shift') {
    root.innerHTML = shiftTabHtml();
    bindShiftTab(root);
  } else if (activeTab === 'kpi') {
    root.innerHTML = kpiTabHtml();
    bindKpiTab(root);
  } else {
    root.innerHTML = postSeasonTabHtml();
    bindPostSeasonTab(root);
  }
}

/* ===================== Shift report ===================== */

function shiftTabHtml() {
  const header = `
    <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
      <button type="button" class="btn btn-primary" data-action="generate-shift" ${shiftState.status === 'loading' ? 'disabled aria-busy="true"' : ''}>${icon('refresh-cw', 16)} Generate shift report</button>
      ${shiftState.status === 'success' ? `
        <button type="button" class="btn btn-secondary" data-action="print-shift">${icon('printer', 16)} Print</button>
        <button type="button" class="btn btn-secondary" data-action="csv-shift">${icon('download', 16)} Export CSV</button>` : ''}
    </div>`;
  let body;
  if (shiftState.status === 'loading') body = skeletonBlock(6);
  else if (shiftState.status === 'error') body = errorState({ message: shiftState.error, retryAttr: 'data-action="retry-shift"' });
  else if (shiftState.status === 'success') body = shiftReportHtml(shiftState.data);
  else body = emptyState({ message: 'Generate a shift report to see bag volumes per stage and exception counts for the last shift window.' });
  return header + body;
}

function shiftReportHtml(data) {
  const stageRows = data.volumesPerStage.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th scope="col">Stage</th><th scope="col">Bag count</th></tr></thead>
        <tbody>${data.volumesPerStage.map((r) => `
          <tr><td data-label="Stage">${esc(r.stage)}</td><td data-label="Bag count">${fmtNumber(r.count)}</td></tr>`).join('')}</tbody>
      </table>
    </div>` : emptyState({ message: 'No stage volume data available for this window.' });

  return `
    <p class="fs-sm muted" style="margin-block-end:var(--s4)">Generated ${esc(fmtDateTime(data.generatedAt))} · covering the last ${data.windowHours} hours</p>
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Exceptions opened', value: fmtNumber(data.exceptionsOpened) })}
      ${kpiTile({ label: 'Exceptions closed', value: fmtNumber(data.exceptionsClosed) })}
      ${kpiTile({ label: 'Delays', value: fmtNumber(data.delays) })}
      ${kpiTile({ label: 'Cut-off misses', value: fmtNumber(data.cutoffMisses) })}
    </div>
    <h2 class="section-title">Volumes per stage</h2>
    ${stageRows}`;
}

function generateShift() {
  shiftState = { status: 'loading', data: null, error: null };
  renderTabRoot();
  api.shiftReport().then((data) => {
    shiftState = { status: 'success', data, error: null };
    renderTabRoot();
  }).catch((err) => {
    shiftState = { status: 'error', data: null, error: err.message };
    renderTabRoot();
  });
}

function bindShiftTab(root) {
  root.querySelector('[data-action="generate-shift"]')?.addEventListener('click', generateShift);
  root.querySelector('[data-action="retry-shift"]')?.addEventListener('click', generateShift);
  root.querySelector('[data-action="print-shift"]')?.addEventListener('click', () => window.print());
  root.querySelector('[data-action="csv-shift"]')?.addEventListener('click', () => {
    const csv = toCsv(shiftState.data.volumesPerStage, ['stage', 'count']);
    downloadBlob('shift-report.csv', csv, 'text/csv');
  });
}

/* ===================== KPI review ===================== */

function exceptionsByTypeEntries(data) {
  return Object.entries(data.exceptionsByType).sort((a, b) => b[1] - a[1]);
}

function kpiTabHtml() {
  if (kpiState.status === 'loading' || kpiState.status === 'idle') return skeletonBlock(8);
  if (kpiState.status === 'error') return errorState({ message: kpiState.error, retryAttr: 'data-action="retry-kpi"' });

  const data = kpiState.data;
  if (!data.history.length) return emptyState({ message: 'No KPI history available for this period.' });

  const excEntries = exceptionsByTypeEntries(data);

  return `
    <div class="grid grid-cols-2" style="align-items:start;margin-block-end:var(--s6)">
      <div class="card">
        <h2 class="section-title">On-time % over time</h2>
        <canvas id="kpi-ontime-chart" role="img" aria-label="On-time percentage over the last 14 days" height="280"></canvas>
      </div>
      <div class="card">
        <h2 class="section-title">Exceptions by type</h2>
        <canvas id="kpi-exctype-chart" role="img" aria-label="Exceptions by type" height="280"></canvas>
      </div>
    </div>
    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Damage, missing and delivery success rates</h2>
      <canvas id="kpi-rates-chart" role="img" aria-label="Damage rate, missing rate and delivery success rate over the last 14 days" height="280"></canvas>
    </div>

    <h2 class="section-title">Exceptions by type (data)</h2>
    <div class="table-wrap" style="margin-block-end:var(--s6)">
      <table class="data-table">
        <thead><tr><th scope="col">Type</th><th scope="col">Count</th></tr></thead>
        <tbody>${excEntries.map(([type, count]) => `
          <tr><td data-label="Type">${esc(type)}</td><td data-label="Count">${fmtNumber(count)}</td></tr>`).join('')}</tbody>
      </table>
    </div>

    <h2 class="section-title">History (14 days)</h2>
    <div id="kpi-history-table"></div>`;
}

function bindKpiTab(root) {
  root.querySelector('[data-action="retry-kpi"]')?.addEventListener('click', loadKpi);
  if (kpiState.status !== 'success' || !kpiState.data.history.length) return;

  const data = kpiState.data;
  const tableRoot = root.querySelector('#kpi-history-table');
  if (tableRoot) {
    kpiTable = createDataTable(tableRoot, {
      rows: data.history,
      getRowId: (r) => r.date,
      searchKeys: ['date'],
      csvFilename: 'kpi-history',
      emptyMessage: 'No KPI history available.',
      columns: [
        { key: 'date', label: 'Date', sortable: true },
        { key: 'onTimePct', label: 'On-time %', sortable: true, render: (r) => fmtPercent(r.onTimePct) },
        { key: 'avgHandlingMin', label: 'Avg handling (min)', sortable: true, render: (r) => fmtNumber(r.avgHandlingMin) },
        { key: 'exceptionsOpened', label: 'Exceptions opened', sortable: true, render: (r) => fmtNumber(r.exceptionsOpened) },
        { key: 'exceptionsClosed', label: 'Exceptions closed', sortable: true, render: (r) => fmtNumber(r.exceptionsClosed) },
        { key: 'damageRatePct', label: 'Damage rate', sortable: true, render: (r) => fmtPercent(r.damageRatePct) },
        { key: 'missingRatePct', label: 'Missing rate', sortable: true, render: (r) => fmtPercent(r.missingRatePct) },
        { key: 'deliverySuccessPct', label: 'Delivery success', sortable: true, render: (r) => fmtPercent(r.deliverySuccessPct) },
      ],
    });
  }
  drawKpiCharts(root, data);
}

function drawKpiCharts(root, data) {
  destroyCharts();
  if (!window.Chart) return;
  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--accent').trim() || '#0D9488';
  const danger = styles.getPropertyValue('--danger').trim() || '#DC2626';
  const warning = styles.getPropertyValue('--warning').trim() || '#D97706';
  const success = styles.getPropertyValue('--success').trim() || '#16A34A';

  const sortedHistory = [...data.history].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sortedHistory.map((r) => r.date);

  const onTimeCanvas = root.querySelector('#kpi-ontime-chart');
  if (onTimeCanvas) {
    charts.onTime?.destroy();
    charts.onTime = new window.Chart(onTimeCanvas, {
      type: 'line',
      data: { labels, datasets: [{ label: 'On-time %', data: sortedHistory.map((r) => r.onTimePct), borderColor: accent, backgroundColor: accent, tension: 0.3 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: '%' } } } },
    });
  }

  const excEntries = exceptionsByTypeEntries(data);
  const excCanvas = root.querySelector('#kpi-exctype-chart');
  if (excCanvas) {
    charts.excType?.destroy();
    charts.excType = new window.Chart(excCanvas, {
      type: 'bar',
      data: { labels: excEntries.map((e) => e[0]), datasets: [{ label: 'Exceptions', data: excEntries.map((e) => e[1]), backgroundColor: accent }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, title: { display: true, text: 'Count' } } },
      },
    });
  }

  const ratesCanvas = root.querySelector('#kpi-rates-chart');
  if (ratesCanvas) {
    charts.rates?.destroy();
    charts.rates = new window.Chart(ratesCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Delivery success %', data: sortedHistory.map((r) => r.deliverySuccessPct), borderColor: success, backgroundColor: success, tension: 0.3 },
          { label: 'Damage rate %', data: sortedHistory.map((r) => r.damageRatePct), borderColor: danger, backgroundColor: danger, tension: 0.3 },
          { label: 'Missing rate %', data: sortedHistory.map((r) => r.missingRatePct), borderColor: warning, backgroundColor: warning, tension: 0.3 },
        ],
      },
      options: { responsive: true, plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true, title: { display: true, text: '%' } } } },
    });
  }
}

function loadKpi() {
  kpiState = { status: 'loading', data: null, error: null };
  renderTabRoot();
  api.kpis().then((data) => {
    kpiState = { status: 'success', data, error: null };
    renderTabRoot();
  }).catch((err) => {
    kpiState = { status: 'error', data: null, error: err.message };
    renderTabRoot();
  });
}

/* ===================== Post-season report ===================== */

function postSeasonTabHtml() {
  const header = `
    <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
      <button type="button" class="btn btn-primary" data-action="generate-postseason" ${postSeasonState.status === 'loading' ? 'disabled aria-busy="true"' : ''}>${icon('refresh-cw', 16)} Generate post-season report</button>
      ${postSeasonState.status === 'success' ? `
        <button type="button" class="btn btn-secondary" data-action="print-postseason">${icon('printer', 16)} Print</button>
        <button type="button" class="btn btn-secondary" data-action="csv-postseason">${icon('download', 16)} Export CSV</button>` : ''}
    </div>`;
  let body;
  if (postSeasonState.status === 'loading') body = skeletonBlock(6);
  else if (postSeasonState.status === 'error') body = errorState({ message: postSeasonState.error, retryAttr: 'data-action="retry-postseason"' });
  else if (postSeasonState.status === 'success') body = `<div id="postseason-body"></div>`;
  else body = emptyState({ message: 'Generate the post-season report to see totals and flight-by-flight outcomes.' });
  return header + body;
}

function renderPostSeasonBody(root) {
  if (postSeasonState.status !== 'success') return;
  const container = root.querySelector('#postseason-body');
  if (!container) return;
  const data = postSeasonState.data;
  container.innerHTML = `
    <p class="fs-sm muted" style="margin-block-end:var(--s4)">Generated ${esc(fmtDateTime(data.generatedAt))}</p>
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Total flights', value: fmtNumber(data.totalFlights) })}
      ${kpiTile({ label: 'Total bags', value: fmtNumber(data.totalBags) })}
      ${kpiTile({ label: 'Total exceptions', value: fmtNumber(data.totalExceptions) })}
    </div>
    <h2 class="section-title">Flights</h2>
    <div id="postseason-flight-table"></div>`;

  if (!data.byFlight.length) {
    container.querySelector('#postseason-flight-table').outerHTML = emptyState({ message: 'No flights recorded this season.' });
    return;
  }

  postFlightTable = createDataTable(container.querySelector('#postseason-flight-table'), {
    rows: data.byFlight,
    getRowId: (r) => r.flight,
    searchKeys: ['flight', 'direction', 'status'],
    csvFilename: 'post-season-flights',
    emptyMessage: 'No flights match this search.',
    columns: [
      { key: 'flight', label: 'Flight', sortable: true },
      { key: 'direction', label: 'Direction', sortable: true, render: (r) => esc(r.direction === 'departure' ? 'Departure' : 'Arrival') },
      { key: 'totalBags', label: 'Total bags', sortable: true, render: (r) => fmtNumber(r.totalBags) },
      { key: 'delivered', label: 'Delivered', sortable: true, render: (r) => fmtNumber(r.delivered) },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
    ],
  });
}

function generatePostSeason() {
  postSeasonState = { status: 'loading', data: null, error: null };
  renderTabRoot();
  api.postSeason().then((data) => {
    postSeasonState = { status: 'success', data, error: null };
    renderTabRoot();
  }).catch((err) => {
    postSeasonState = { status: 'error', data: null, error: err.message };
    renderTabRoot();
  });
}

function bindPostSeasonTab(root) {
  root.querySelector('[data-action="generate-postseason"]')?.addEventListener('click', generatePostSeason);
  root.querySelector('[data-action="retry-postseason"]')?.addEventListener('click', generatePostSeason);
  root.querySelector('[data-action="print-postseason"]')?.addEventListener('click', () => window.print());
  root.querySelector('[data-action="csv-postseason"]')?.addEventListener('click', () => {
    const csv = toCsv(postSeasonState.data.byFlight, ['flight', 'direction', 'totalBags', 'delivered', 'status']);
    downloadBlob('post-season-report.csv', csv, 'text/csv');
  });
  renderPostSeasonBody(root);
}
