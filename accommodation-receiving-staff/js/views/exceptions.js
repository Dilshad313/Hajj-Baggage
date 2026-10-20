import * as api from '../api.js';
import {
  esc, toast, fmtRelative, fmtDateTime, skeletonBlock, errorState, openDrawer,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { EXCEPTION_TYPES, SEVERITIES, EXCEPTION_STATUSES } from '../seed.js';

let appEl = null;
let rows = null;
let loadError = '';
let dataTableInstance = null;
const filters = { status: '', severity: '', type: '' };

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  rows = null;
  loadError = '';
  filters.status = '';
  filters.severity = '';
  filters.type = '';
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
    const result = await api.getExceptions({ ...filters });
    if (!appEl) return;
    rows = result;
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
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Exceptions</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Exceptions</h1>
        <p class="page-subtitle">${rows.length} exception${rows.length === 1 ? '' : 's'} matching the current filters.</p>
      </div>
    </div>
    <div id="exceptions-table"></div>`;
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
  dataTableInstance?.destroy();
  dataTableInstance = createDataTable(root, {
    columns: [
      {
        key: 'time', label: 'Time', sortable: true,
        render: (e) => `<span title="${esc(fmtDateTime(e.time))}">${esc(fmtRelative(e.time))}</span>`,
        csvValue: (e) => fmtDateTime(e.time),
      },
      { key: 'type', label: 'Type', sortable: true, render: (e) => esc(e.type) },
      { key: 'severity', label: 'Severity', sortable: true, render: (e) => severityChip(e.severity) },
      { key: 'status', label: 'Status', sortable: true, render: (e) => statusChip(e.status) },
      { key: 'room', label: 'Room', sortable: true, render: (e) => esc(e.room || '—') },
    ],
    rows,
    searchKeys: ['type', 'status', 'severity', 'room', 'tripId', 'bagId'],
    getRowId: (e) => e.id,
    onRowClick: openExceptionDrawer,
    csvFilename: 'exceptions',
    toolbarExtraHtml: filterSelectsHtml(),
    emptyMessage: 'No exceptions match these filters.',
  });
  // Bound once per table build — createDataTable's renderBody() rebuilds only
  // the table body on search/sort/page, so these toolbar listeners survive;
  // filter changes below use setRows() rather than rebuilding the table.
  root.querySelector('[data-filter="status"]').addEventListener('change', onFilterChange);
  root.querySelector('[data-filter="severity"]').addEventListener('change', onFilterChange);
  root.querySelector('[data-filter="type"]').addEventListener('change', onFilterChange);
}

async function onFilterChange() {
  const root = appEl.querySelector('#exceptions-table');
  filters.status = root.querySelector('[data-filter="status"]').value;
  filters.severity = root.querySelector('[data-filter="severity"]').value;
  filters.type = root.querySelector('[data-filter="type"]').value;
  try {
    rows = await api.getExceptions({ ...filters });
    if (!appEl) return;
    dataTableInstance.setRows(rows);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openExceptionDrawer(exc) {
  const notesHtml = exc.notes.length
    ? exc.notes.map((n) => `
      <div class="stack gap-1" style="padding:var(--s2) 0;border-bottom:1px solid var(--border)">
        <span class="fs-xs muted">${esc(fmtDateTime(n.at))}</span>
        <p class="fs-sm">${esc(n.text)}</p>
      </div>`).join('')
    : `<p class="fs-sm muted">No notes yet.</p>`;

  const isResolved = ['Resolved', 'Closed'].includes(exc.status);
  let resolveSectionHtml;
  if (isResolved) {
    resolveSectionHtml = `
      <div class="section-title" style="margin-block-start:var(--s5)">Resolution</div>
      <p class="fs-sm">${esc(exc.resolutionOutcome || '—')}</p>
      <p class="fs-xs muted">Resolved ${esc(fmtDateTime(exc.resolvedAt))}</p>`;
  } else if (['Low', 'Medium'].includes(exc.severity)) {
    resolveSectionHtml = `
      <div class="section-title" style="margin-block-start:var(--s5)">Resolve</div>
      <form id="resolve-form" novalidate>
        <div class="field">
          <label for="resolve-notes">Resolution notes (optional)</label>
          <textarea id="resolve-notes" placeholder="What was done to resolve this?"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-block" id="resolve-submit">Resolve</button>
      </form>`;
  } else {
    resolveSectionHtml = `
      <div class="section-title" style="margin-block-start:var(--s5)">Resolve</div>
      <p class="fs-sm muted">High-severity exceptions must be resolved by Operations Management.</p>`;
  }

  const { el, close } = openDrawer({
    title: `${exc.type} — ${exc.id}`,
    bodyHtml: `
      <div class="stack gap-2 fs-sm" style="margin-block-end:var(--s4)">
        <div class="row" style="justify-content:space-between"><span class="muted">Type</span><strong>${esc(exc.type)}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Severity</span>${severityChip(exc.severity)}</div>
        <div class="row" style="justify-content:space-between"><span class="muted">Status</span>${statusChip(exc.status)}</div>
        <div class="row" style="justify-content:space-between"><span class="muted">Room</span><strong>${esc(exc.room || '—')}</strong></div>
        <div class="row" style="justify-content:space-between"><span class="muted">Opened</span><strong>${esc(fmtDateTime(exc.time))}</strong></div>
        ${exc.escalated ? `<div class="row" style="justify-content:space-between"><span class="muted">Escalated</span><strong>Yes</strong></div>` : ''}
        ${exc.claimsTag ? `<div class="row" style="justify-content:space-between"><span class="muted">Claims tag</span><strong>Yes</strong></div>` : ''}
      </div>
      <div class="section-title">Notes</div>
      <div class="stack gap-1" style="margin-block-end:var(--s4)">${notesHtml}</div>
      ${resolveSectionHtml}`,
  });

  const form = el.querySelector('#resolve-form');
  if (!form) return;
  let submitting = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const notes = form.querySelector('#resolve-notes').value.trim();
    submitting = true;
    const btn = form.querySelector('#resolve-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Resolving…';
    try {
      await api.resolveExceptionLocal(exc.id, notes);
      close();
      toast('Exception resolved.', 'success');
      await load();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Resolve';
      toast(err.message, 'error');
    }
  });
}
