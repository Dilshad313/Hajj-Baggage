import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, emptyState, errorState, toCsv, downloadBlob,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';

const PERIODS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

let appEl = null;
let step = 'loading'; // loading | error | ready
let errorMessage = '';
let history = [];
let currentReport = null;
let period = 'today';
let generating = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  step = 'loading';
  errorMessage = '';
  history = [];
  currentReport = null;
  period = 'today';
  generating = false;
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  step = 'loading';
  renderPage();
  try {
    history = await api.getReportHistory();
    if (!appEl) return;
    step = 'ready';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    errorMessage = err.message;
    step = 'error';
    renderPage();
  }
}

function pageHeader() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Reports</h1>
        <p class="page-subtitle">Generate a snapshot of warehouse activity for a period.</p>
      </div>
    </div>`;
}

function renderPage() {
  if (!appEl) return;
  if (step === 'loading') {
    appEl.innerHTML = `${pageHeader()}${skeletonBlock(6)}`;
    return;
  }
  if (step === 'error') {
    appEl.innerHTML = `${pageHeader()}${errorState({ message: errorMessage })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  renderReady();
}

function renderReady() {
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="card" style="margin-block-end:var(--s6);max-width:520px">
      <div class="row gap-3 wrap" style="align-items:flex-end">
        <div class="field" style="margin-block-end:0;min-width:180px">
          <label for="report-period">Period</label>
          <select id="report-period">
            ${PERIODS.map((p) => `<option value="${esc(p.value)}" ${p.value === period ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="btn btn-primary" id="generate-btn" ${generating ? 'disabled aria-busy="true"' : ''}>
          ${generating ? '<span class="spinner"></span> Generating…' : `${icon('bar-chart-2', 16)} Generate`}
        </button>
      </div>
    </div>
    <div id="report-display" style="margin-block-end:var(--s6)"></div>
    <div class="section-title">Report history</div>
    <div class="card" id="history-root"></div>`;

  appEl.querySelector('#report-period').addEventListener('change', (e) => { period = e.target.value; });
  appEl.querySelector('#generate-btn').addEventListener('click', onGenerate);

  renderReportDisplay();
  renderHistory();
}

function renderReportDisplay() {
  const root = appEl.querySelector('#report-display');
  if (!root) return;
  if (!currentReport) {
    root.innerHTML = emptyState({ message: 'Generate a report to see it here.' });
    return;
  }
  root.innerHTML = reportHtml(currentReport);
  root.querySelector('[data-action="print-report"]').addEventListener('click', () => window.print());
  root.querySelector('[data-action="export-csv"]').addEventListener('click', () => onExportCsv(currentReport));
}

function reportHtml(report) {
  return `
    <div class="card no-print-margin">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3);margin-block-end:var(--s4)">
        <div>
          <div class="section-title" style="margin-block-end:0">Report — ${esc(report.period)}</div>
          <p class="fs-sm muted">Generated at ${esc(fmtDateTime(report.generatedAt))}</p>
        </div>
        <div class="row gap-2 no-print">
          <button type="button" class="btn btn-secondary" data-action="print-report">${icon('printer', 16)} Print</button>
          <button type="button" class="btn btn-secondary" data-action="export-csv">${icon('download', 16)} Export CSV</button>
        </div>
      </div>

      <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Inbound</div>
      <div class="grid grid-cols-2" style="margin-block-end:var(--s5)">
        ${kpiTile({ label: 'Trucks received', value: report.inbound.trucksReceived })}
        ${kpiTile({ label: 'Bags received', value: report.inbound.bagsReceived })}
      </div>

      <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Screening</div>
      <div class="grid grid-cols-2" style="margin-block-end:var(--s5)">
        ${kpiTile({ label: 'Screened', value: report.screening.screened })}
        ${kpiTile({ label: 'Prohibited', value: report.screening.prohibited })}
      </div>

      <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Storage</div>
      <div class="grid grid-cols-2" style="margin-block-end:var(--s5)">
        ${kpiTile({ label: 'Stored', value: report.storage.stored })}
      </div>

      <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Outbound</div>
      <div class="grid grid-cols-2" style="margin-block-end:var(--s5)">
        ${kpiTile({ label: 'Loaded', value: report.outbound.loaded })}
        ${kpiTile({ label: 'Trucks departed', value: report.outbound.trucksDeparted })}
      </div>

      <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Pending</div>
      <div class="grid grid-cols-2" style="margin-block-end:var(--s5)">
        ${kpiTile({ label: 'Awaiting screening', value: report.pending.awaitingScreening })}
        ${kpiTile({ label: 'Awaiting storage', value: report.pending.awaitingStorage })}
      </div>

      <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Exceptions</div>
      <div class="grid grid-cols-2">
        ${kpiTile({ label: 'Open', value: report.exceptions.open })}
      </div>
    </div>`;
}

async function onGenerate() {
  if (generating) return;
  generating = true;
  renderReady();
  try {
    currentReport = await api.generateReport(period);
    if (!appEl) return;
    history = await api.getReportHistory();
    generating = false;
    renderReady();
    toast('Report generated.', 'success');
  } catch (err) {
    if (!appEl) return;
    generating = false;
    renderReady();
    toast(err.message, 'error');
  }
}

function onExportCsv(report) {
  const row = {
    trucksReceived: report.inbound.trucksReceived,
    bagsReceived: report.inbound.bagsReceived,
    screened: report.screening.screened,
    prohibited: report.screening.prohibited,
    stored: report.storage.stored,
    loaded: report.outbound.loaded,
    trucksDeparted: report.outbound.trucksDeparted,
    awaitingScreening: report.pending.awaitingScreening,
    awaitingStorage: report.pending.awaitingStorage,
    open: report.exceptions.open,
  };
  const columns = ['trucksReceived', 'bagsReceived', 'screened', 'prohibited', 'stored', 'loaded', 'trucksDeparted', 'awaitingScreening', 'awaitingStorage', 'open'];
  const csv = toCsv([row], columns);
  downloadBlob(`report-${report.id}.csv`, csv, 'text/csv');
}

function renderHistory() {
  const root = appEl.querySelector('#history-root');
  if (!root) return;
  if (!history.length) {
    root.innerHTML = `<p class="fs-sm muted">No reports generated yet.</p>`;
    return;
  }
  root.innerHTML = `<div class="stack gap-2">${history.map((r) => `
    <button type="button" class="card card-tap" data-report-id="${esc(r.id)}">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
        <strong class="fs-sm">${esc(r.period)}</strong>
        <span class="fs-xs muted">${esc(fmtDateTime(r.generatedAt))}</span>
      </div>
      <div class="fs-xs muted" style="margin-block-start:var(--s1)">
        ${r.inbound.bagsReceived} bags received &middot; ${r.storage.stored} stored &middot; ${r.exceptions.open} open exceptions
      </div>
    </button>`).join('')}</div>`;
  root.querySelectorAll('[data-report-id]').forEach((el) => el.addEventListener('click', () => {
    const report = history.find((r) => r.id === el.dataset.reportId);
    if (!report) return;
    currentReport = report;
    renderReportDisplay();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}
