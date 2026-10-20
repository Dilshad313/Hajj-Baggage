import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, fmtDateTime, fmtNumber, esc, icon, toCsv, downloadBlob } from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, severityChip } from '../components/status-chip.js';

const REPORT_TYPES = [
  'User activity',
  'Login / failed login',
  'Integration uptime',
  'Error summary',
  'Config change history',
  'Data volume by entity',
];

const TYPE_ICONS = {
  'User activity': 'users',
  'Login / failed login': 'log-in',
  'Integration uptime': 'plug-zap',
  'Error summary': 'alert-triangle',
  'Config change history': 'settings',
  'Data volume by entity': 'database',
};

const MAX_RANGE_DAYS = 366;

let appEl = null;
let chartInstance = null;
let currentType = REPORT_TYPES[0];
let currentFrom = '';
let currentTo = '';

function toInputDate(d) { return d.toISOString().slice(0, 10); }

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 3600 * 1000);
  return { from: toInputDate(from), to: toInputDate(to) };
}

function validateRange(from, to) {
  if (!from || !to) return 'Select a start and end date.';
  const fromD = new Date(from);
  const toD = new Date(to);
  if (fromD > toD) return 'The start date must be before the end date.';
  const days = (toD - fromD) / 86400000;
  if (days > MAX_RANGE_DAYS) return `Date range cannot exceed ${MAX_RANGE_DAYS} days.`;
  return null;
}

function slug(type) { return type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

function titleCase(key) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.split(/\s+/).filter(Boolean)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function renderCell(key, value) {
  if (value == null || value === '') return '—';
  switch (key) {
    case 'time': return esc(fmtDateTime(value));
    case 'uptime': return `${esc(value)}%`;
    case 'count': return esc(fmtNumber(value));
    case 'status': return statusChip(value);
    case 'severity': return severityChip(value);
    case 'result': return `<span class="chip chip-${value === 'Success' ? 'green' : 'red'}">${esc(value)}</span>`;
    default: return esc(String(value));
  }
}

function buildColumns(rows) {
  return Object.keys(rows[0]).map((key) => ({
    key,
    label: titleCase(key),
    sortable: true,
    render: (row) => renderCell(key, row[key]),
    csvValue: (row) => row[key],
  }));
}

/**
 * Renders the Reports view.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:() => void}}
 */
export function render(params, app) {
  appEl = app;
  currentType = REPORT_TYPES[0];
  const def = defaultRange();
  currentFrom = def.from;
  currentTo = def.to;
  drawShell();
  return { destroy };
}

/** Tears down the Reports view, destroying any live chart instance. */
export function destroy() {
  chartInstance?.destroy();
  chartInstance = null;
  appEl = null;
}

function drawShell() {
  if (!appEl) return;
  chartInstance?.destroy();
  chartInstance = null;
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Reports</h1><p class="page-subtitle">Generate on-demand reports across the platform.</p></div>
    </div>
    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Report type</h2>
      <div class="grid grid-auto" role="group" aria-label="Report type" style="margin-block-end:var(--s5)">
        ${REPORT_TYPES.map((t) => `
          <button type="button" class="card card-tap" data-type="${esc(t)}" aria-pressed="${t === currentType}"
            style="${t === currentType ? 'border-color:var(--accent);box-shadow:0 0 0 2px var(--accent) inset;' : ''}">
            <div class="row gap-2">${icon(TYPE_ICONS[t] || 'file-text', 18)}<strong class="fs-sm">${esc(t)}</strong></div>
          </button>`).join('')}
      </div>
      <div class="row gap-4 wrap" style="align-items:flex-end">
        <div class="field" style="margin:0"><label for="rpt-from">From</label><input id="rpt-from" type="date" value="${esc(currentFrom)}" /></div>
        <div class="field" style="margin:0"><label for="rpt-to">To</label><input id="rpt-to" type="date" value="${esc(currentTo)}" /></div>
        <button type="button" class="btn btn-primary" data-action="generate">${icon('play', 16)} Generate</button>
      </div>
      <div class="error" id="rpt-range-err" hidden></div>
    </div>
    <div id="report-results"></div>`;

  appEl.querySelectorAll('[data-type]').forEach((btn) => btn.addEventListener('click', () => {
    currentType = btn.dataset.type;
    drawShell();
  }));
  appEl.querySelector('#rpt-from').addEventListener('change', (e) => { currentFrom = e.target.value; });
  appEl.querySelector('#rpt-to').addEventListener('change', (e) => { currentTo = e.target.value; });
  appEl.querySelector('[data-action="generate"]').addEventListener('click', handleGenerate);
}

async function handleGenerate() {
  if (!appEl) return;
  const errEl = appEl.querySelector('#rpt-range-err');
  const message = validateRange(currentFrom, currentTo);
  if (message) {
    errEl.textContent = message;
    errEl.hidden = false;
    return;
  }
  errEl.hidden = true;
  errEl.textContent = '';

  const resultsEl = appEl.querySelector('#report-results');
  const genBtn = appEl.querySelector('[data-action="generate"]');
  chartInstance?.destroy();
  chartInstance = null;
  genBtn.disabled = true;
  resultsEl.innerHTML = skeletonBlock(6);
  try {
    const report = await api.generateReport(currentType, { from: currentFrom, to: currentTo });
    renderResults(report);
  } catch (err) {
    resultsEl.innerHTML = errorState({ message: err.message });
    resultsEl.querySelector('[data-action="retry"]')?.addEventListener('click', handleGenerate);
  } finally {
    if (appEl) genBtn.disabled = false;
  }
}

function renderResults(report) {
  const resultsEl = appEl.querySelector('#report-results');
  if (!resultsEl) return;
  const hasRows = report.rows.length > 0;
  const chartHtml = report.chart
    ? `<div class="card" style="margin-block-end:var(--s5)"><canvas id="report-chart" role="img" aria-label="${esc(report.type)} chart"></canvas></div>`
    : '';
  const toolbarHtml = `
    <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
      <span class="muted fs-sm">Generated ${esc(fmtDateTime(report.generatedAt))} · ${fmtNumber(report.rows.length)} record${report.rows.length === 1 ? '' : 's'}</span>
      <span class="grow"></span>
      <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 16)} Print</button>
      ${hasRows ? `<button type="button" class="btn btn-secondary" data-action="export-all">${icon('download', 16)} Export full CSV</button>` : ''}
    </div>`;

  resultsEl.innerHTML = chartHtml + toolbarHtml + (hasRows
    ? `<div id="report-table"></div>`
    : emptyState({ message: 'No records found for this report and date range.' }));

  if (hasRows) {
    const columns = buildColumns(report.rows);
    createDataTable(resultsEl.querySelector('#report-table'), {
      columns,
      rows: report.rows,
      pageSize: 25,
      searchKeys: columns.map((c) => c.key),
      csvFilename: `report-${slug(report.type)}`,
      emptyMessage: 'No matching records.',
    });
  }

  if (report.chart) {
    const canvas = resultsEl.querySelector('#report-chart');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb';
    chartInstance = new window.Chart(canvas, {
      type: 'bar',
      data: { labels: report.chart.labels, datasets: [{ label: report.type, data: report.chart.data, backgroundColor: accent }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
  }

  resultsEl.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());
  resultsEl.querySelector('[data-action="export-all"]')?.addEventListener('click', () => {
    const columns = buildColumns(report.rows);
    const csvRows = report.rows.map((row) => {
      const out = {};
      for (const c of columns) out[c.label] = row[c.key];
      return out;
    });
    const csv = toCsv(csvRows, columns.map((c) => c.label));
    downloadBlob(`report-${slug(report.type)}-full.csv`, csv, 'text/csv');
  });
}
