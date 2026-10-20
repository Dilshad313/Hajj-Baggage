import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, fmtRelative, skeletonBlock, emptyState, errorState, openDrawer,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { EXCEPTION_TYPES, SEVERITIES, EXCEPTION_STATUSES } from '../seed.js';

const EMPTY_MESSAGE = 'No exceptions to show.';

let appEl = null;
let exceptions = null;
let loadError = '';
let filters = { status: '', severity: '', type: '' };
let tableInstance = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  exceptions = null;
  loadError = '';
  filters = { status: '', severity: '', type: '' };
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  tableInstance?.destroy();
  tableInstance = null;
  appEl = null;
}

function buildFilters() {
  const f = {};
  if (filters.status) f.status = filters.status;
  if (filters.severity) f.severity = filters.severity;
  if (filters.type) f.type = filters.type;
  return f;
}

async function load() {
  if (!appEl) return;
  if (!exceptions) renderSkeleton();
  try {
    const result = await api.getExceptions(buildFilters());
    if (!appEl) return;
    exceptions = result;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

function renderSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Exceptions</h1></div>${skeletonBlock(6)}`;
}

function renderPage() {
  if (!appEl) return;
  tableInstance?.destroy();
  tableInstance = null;
  const header = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Exceptions</h1>
        <p class="page-subtitle">PNR mismatches, no-BSM, weight mismatches, handover rejections and more.</p>
      </div>
    </div>`;
  if (loadError) {
    appEl.innerHTML = `${header}${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  if (!exceptions.length) {
    appEl.innerHTML = `${header}${emptyState({ message: EMPTY_MESSAGE })}`;
    return;
  }
  appEl.innerHTML = `${header}<div id="exceptions-table"></div>`;
  renderTable();
}

function filterSelectsHtml() {
  return `
    <select data-filter="status" aria-label="Filter by status">
      <option value="">All statuses</option>
      ${EXCEPTION_STATUSES.map((s) => `<option value="${esc(s)}" ${filters.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
    </select>
    <select data-filter="severity" aria-label="Filter by severity">
      <option value="">All severities</option>
      ${SEVERITIES.map((s) => `<option value="${esc(s)}" ${filters.severity === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
    </select>
    <select data-filter="type" aria-label="Filter by type">
      <option value="">All types</option>
      ${EXCEPTION_TYPES.map((t) => `<option value="${esc(t)}" ${filters.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select>`;
}

function renderTable() {
  const root = appEl.querySelector('#exceptions-table');
  if (!root) return;
  tableInstance = createDataTable(root, {
    columns: [
      { key: 'time', label: 'Time', sortable: true, render: (r) => `<span title="${esc(fmtDateTime(r.time))}">${esc(fmtRelative(r.time))}</span>`, csvValue: (r) => fmtDateTime(r.time) },
      { key: 'type', label: 'Type', sortable: true },
      { key: 'severity', label: 'Severity', sortable: true, render: (r) => severityChip(r.severity) },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
      { key: 'flightCode', label: 'Flight', render: (r) => esc(r.flightCode || '—') },
    ],
    rows: exceptions,
    getRowId: (r) => r.id,
    searchKeys: ['type', 'flightCode', 'batchId', 'bagId'],
    csvFilename: 'exceptions',
    emptyMessage: EMPTY_MESSAGE,
    onRowClick: (row) => openExceptionDrawer(row),
    toolbarExtraHtml: filterSelectsHtml(),
  });
  root.querySelectorAll('[data-filter]').forEach((sel) => sel.addEventListener('change', onFilterChange));
}

async function onFilterChange(e) {
  const key = e.target.dataset.filter;
  filters = { ...filters, [key]: e.target.value };
  try {
    const result = await api.getExceptions(buildFilters());
    if (!appEl) return;
    exceptions = result;
    tableInstance?.setRows(exceptions);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function notesThreadHtml(notes) {
  if (!notes.length) return '<p class="fs-sm muted">No notes yet.</p>';
  return `<div class="stack gap-2">${notes.map((n) => `
    <div>
      <span class="fs-xs muted">${esc(fmtDateTime(n.at))}</span>
      <p class="fs-sm">${esc(n.text)}</p>
    </div>`).join('')}</div>`;
}

function resolveSectionHtml(exc) {
  const isDone = ['Resolved', 'Closed'].includes(exc.status);
  const isHigh = ['High', 'Critical'].includes(exc.severity);
  if (isDone) {
    return `
      <div class="section-title">Resolution</div>
      <p class="fs-sm">${esc(exc.resolutionOutcome || '—')}</p>
      <p class="fs-xs muted">Resolved ${esc(fmtDateTime(exc.resolvedAt))}</p>`;
  }
  if (isHigh) {
    return `
      <div class="section-title">Resolution</div>
      <p class="fs-sm muted">High-severity exceptions must be resolved by Operations Management.</p>`;
  }
  return `
    <div class="section-title">Resolve</div>
    <form id="resolve-exc-form" novalidate>
      <div class="field">
        <label for="resolve-exc-notes">Notes (optional)</label>
        <textarea id="resolve-exc-notes" placeholder="What was done?"></textarea>
      </div>
      <button type="submit" class="btn btn-primary btn-block" id="resolve-exc-submit">Resolve</button>
    </form>`;
}

function openExceptionDrawer(exc) {
  const canResolve = ['Low', 'Medium'].includes(exc.severity) && !['Resolved', 'Closed'].includes(exc.status);

  const { el, close } = openDrawer({
    title: exc.type,
    bodyHtml: `
      <div class="stack gap-2 fs-sm" style="margin-block-end:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted">Severity</span>${severityChip(exc.severity)}</div>
        <div class="row" style="justify-content:space-between"><span class="muted">Status</span>${statusChip(exc.status)}</div>
        <div class="row" style="justify-content:space-between"><span class="muted">Flight</span><strong>${esc(exc.flightCode || '—')}</strong></div>
      </div>
      <div class="section-title">Notes</div>
      <div style="margin-block-end:var(--s4)">${notesThreadHtml(exc.notes)}</div>
      ${resolveSectionHtml(exc)}`,
  });

  if (!canResolve) return;
  const form = el.querySelector('#resolve-exc-form');
  let submitting = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    const btn = form.querySelector('#resolve-exc-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Resolving…';
    const notes = form.querySelector('#resolve-exc-notes').value.trim();
    try {
      await api.resolveExceptionLocal(exc.id, notes);
      close();
      if (!appEl) return;
      toast('Exception resolved.', 'success');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Resolve';
      toast(err.message, 'error');
    }
  });
}
