import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, errorState, openDrawer, closeDrawer,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { createScanInput } from '../components/scan-input.js';
import { EXCEPTION_TYPES, SEVERITIES, EXCEPTION_STATUSES } from '../seed.js';

const DONE_STATUSES = ['Resolved', 'Closed'];

let appEl = null;
let step = 'loading'; // loading | error | ready
let errorMessage = '';
let rows = [];
let table = null;
let filters = { status: '', severity: '', type: '' };
let drawerScanInstance = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  step = 'loading';
  errorMessage = '';
  rows = [];
  table = null;
  filters = { status: '', severity: '', type: '' };
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  closeDrawer();
  drawerScanInstance?.destroy();
  drawerScanInstance = null;
  table?.destroy();
  table = null;
  appEl = null;
}

function cleanFilters() {
  const f = {};
  if (filters.status) f.status = filters.status;
  if (filters.severity) f.severity = filters.severity;
  if (filters.type) f.type = filters.type;
  return f;
}

async function load() {
  if (!appEl) return;
  step = 'loading';
  renderPage();
  try {
    rows = await api.getExceptions(cleanFilters());
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

async function refreshRows() {
  if (!appEl) return;
  try {
    rows = await api.getExceptions(cleanFilters());
    table?.setRows(rows);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function pageHeader() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Exceptions</h1>
        <p class="page-subtitle">Track and resolve baggage and operational exceptions.</p>
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

function filterSelectsHtml() {
  const option = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
  return `
    <select data-filter="status" aria-label="Filter by status">
      ${option('', 'All statuses', !filters.status)}
      ${EXCEPTION_STATUSES.map((s) => option(s, s, filters.status === s)).join('')}
    </select>
    <select data-filter="severity" aria-label="Filter by severity">
      ${option('', 'All severities', !filters.severity)}
      ${SEVERITIES.map((s) => option(s, s, filters.severity === s)).join('')}
    </select>
    <select data-filter="type" aria-label="Filter by type">
      ${option('', 'All types', !filters.type)}
      ${EXCEPTION_TYPES.map((t) => option(t, t, filters.type === t)).join('')}
    </select>`;
}

function renderReady() {
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="card">
      <div id="exceptions-table-root"></div>
    </div>`;
  const root = appEl.querySelector('#exceptions-table-root');
  table = createDataTable(root, {
    rows,
    searchKeys: ['type', 'status', 'severity', 'tripId', 'bagId', 'flightCode'],
    getRowId: (e) => e.id,
    csvFilename: 'exceptions',
    emptyMessage: 'No exceptions to show.',
    onRowClick: (e) => openExceptionDrawer(e),
    toolbarExtraHtml: filterSelectsHtml(),
    columns: [
      { key: 'time', label: 'Time', sortable: true, render: (e) => esc(fmtDateTime(e.time)), csvValue: (e) => fmtDateTime(e.time) },
      { key: 'type', label: 'Type', sortable: true, render: (e) => esc(e.type) },
      { key: 'severity', label: 'Severity', sortable: true, render: (e) => severityChip(e.severity), csvValue: (e) => e.severity },
      { key: 'status', label: 'Status', sortable: true, render: (e) => statusChip(e.status), csvValue: (e) => e.status },
    ],
  });
  root.querySelectorAll('[data-filter]').forEach((sel) => sel.addEventListener('change', onFilterChange));
}

async function onFilterChange() {
  const root = appEl?.querySelector('#exceptions-table-root');
  if (!root) return;
  filters.status = root.querySelector('[data-filter="status"]').value;
  filters.severity = root.querySelector('[data-filter="severity"]').value;
  filters.type = root.querySelector('[data-filter="type"]').value;
  await refreshRows();
}

/* ===================== Exception drawer ===================== */

function detailRow(label, valueHtml) {
  return `<div class="row" style="justify-content:space-between"><span class="muted">${esc(label)}</span>${valueHtml}</div>`;
}

function openExceptionDrawer(exc) {
  const isDone = DONE_STATUSES.includes(exc.status);
  const isHigh = ['High', 'Critical'].includes(exc.severity);
  const canBagFound = !!exc.bagId && exc.type === 'Missing Bag' && !isDone;

  const drawer = openDrawer({
    title: `${exc.type} — ${exc.id}`,
    bodyHtml: `
      <div class="stack gap-2 fs-sm" style="margin-block-end:var(--s5)">
        ${detailRow('Type', `<strong>${esc(exc.type)}</strong>`)}
        ${detailRow('Severity', severityChip(exc.severity))}
        ${detailRow('Status', statusChip(exc.status))}
        ${detailRow('Raised', `<strong>${esc(fmtDateTime(exc.time))}</strong>`)}
        ${exc.tripId ? detailRow('Trip', `<strong class="mono">${esc(exc.tripId)}</strong>`) : ''}
        ${exc.flightCode ? detailRow('Flight', `<strong class="mono">${esc(exc.flightCode)}</strong>`) : ''}
        ${exc.bagId ? detailRow('Bag', `<strong class="mono">${esc(exc.bagId)}</strong>`) : ''}
      </div>

      <div class="section-title">Notes</div>
      <div class="stack gap-2" style="margin-block-end:var(--s5)">
        ${exc.notes.length ? exc.notes.map((n) => `
          <div style="border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
            <p class="fs-sm">${esc(n.text)}</p>
            <p class="fs-xs muted">${esc(fmtDateTime(n.at))}</p>
          </div>`).join('') : '<p class="fs-sm muted">No notes yet.</p>'}
      </div>

      ${canBagFound ? `
        <div class="section-title">Bag found</div>
        <div id="bag-found-root" style="margin-block-end:var(--s5)"></div>` : ''}

      <div class="section-title">Resolve</div>
      <div id="resolve-root"></div>
    `,
    onClose: () => { drawerScanInstance?.destroy(); drawerScanInstance = null; },
  });

  if (canBagFound) {
    drawerScanInstance = createScanInput(drawer.el.querySelector('#bag-found-root'), {
      label: "Scan the found bag's tag",
      placeholder: 'e.g. RBL-A-0031',
      onSubmit: async (code) => {
        const bag = await api.bagFound(exc.bagId, code);
        drawer.close();
        toast(`${bag.tagNumber} found — exception resolved.`, 'success');
        await refreshRows();
        return { message: `${bag.tagNumber} found.` };
      },
    });
  }

  renderResolveSection(drawer, exc, isDone, isHigh);
}

function renderResolveSection(drawer, exc, isDone, isHigh) {
  const root = drawer.el.querySelector('#resolve-root');
  if (!root) return;
  if (isDone) {
    root.innerHTML = `
      <p class="fs-sm"><strong>Outcome:</strong> ${esc(exc.resolutionOutcome || '—')}</p>
      <p class="fs-xs muted">Resolved ${esc(fmtDateTime(exc.resolvedAt))}</p>`;
    return;
  }
  if (isHigh) {
    root.innerHTML = `<p class="fs-sm muted">${icon('shield-alert', 16)} High-severity items can't be closed by staff.</p>`;
    return;
  }
  root.innerHTML = `
    <form id="resolve-form" novalidate>
      <div class="field">
        <label for="resolve-notes">Resolution notes</label>
        <textarea id="resolve-notes" placeholder="Optional notes"></textarea>
      </div>
      <button type="submit" class="btn btn-primary" id="resolve-submit">${icon('check', 16)} Resolve</button>
    </form>`;
  const form = root.querySelector('#resolve-form');
  let submitting = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;
    const btn = form.querySelector('#resolve-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Resolving…';
    try {
      await api.resolveExceptionLocal(exc.id, form.querySelector('#resolve-notes').value.trim());
      drawer.close();
      toast('Exception resolved.', 'success');
      await refreshRows();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = `${icon('check', 16)} Resolve`;
      toast(err.message, 'error');
    }
  });
}
