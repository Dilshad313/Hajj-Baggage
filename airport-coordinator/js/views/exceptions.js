import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, fmtRelative, skeletonBlock, errorState, openDrawer,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { EXCEPTION_TYPES, SEVERITIES, EXCEPTION_STATUSES } from '../seed.js';

let appEl = null;
let exceptions = null;
let loadError = '';
let tableInstance = null;
let filters = {};

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  exceptions = null; loadError = ''; filters = {};
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  tableInstance?.destroy(); tableInstance = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Exceptions</h1></div>${skeletonBlock(6)}`;
  try {
    const list = await api.getExceptions(filters);
    if (!appEl) return;
    exceptions = list;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

function renderPage() {
  if (!appEl) return;
  tableInstance?.destroy(); tableInstance = null;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Exceptions</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Exceptions</h1>
        <p class="page-subtitle">All open and resolved exceptions across departure and arrival.</p>
      </div>
    </div>
    <div id="exceptions-table"></div>`;

  const root = appEl.querySelector('#exceptions-table');
  tableInstance = createDataTable(root, {
    columns: [
      {
        key: 'time', label: 'Time', sortable: true,
        render: (r) => `<span title="${esc(fmtDateTime(r.time))}">${esc(fmtRelative(r.time))}</span>`,
        csvValue: (r) => fmtDateTime(r.time),
      },
      { key: 'type', label: 'Type', sortable: true, render: (r) => esc(r.type) },
      { key: 'severity', label: 'Severity', sortable: true, render: (r) => severityChip(r.severity) },
      { key: 'status', label: 'Status', sortable: true, render: (r) => statusChip(r.status) },
      { key: 'assignee', label: 'Assignee', sortable: true, render: (r) => esc(r.assignee || '—') },
    ],
    rows: exceptions,
    searchKeys: ['id', 'type', 'severity', 'status', 'assignee', 'flightCode'],
    getRowId: (r) => r.id,
    onRowClick: (r) => openExceptionDrawer(r),
    csvFilename: 'exceptions',
    emptyMessage: 'No exceptions found.',
    toolbarExtraHtml: filtersHtml(),
  });
  bindFilterSelects(root);
}

function filtersHtml() {
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

function bindFilterSelects(container) {
  container.querySelectorAll('[data-filter]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const key = sel.dataset.filter;
      filters = { ...filters, [key]: sel.value || undefined };
      try {
        const list = await api.getExceptions(filters);
        exceptions = list;
        tableInstance.setRows(exceptions);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function patchLocal(updated) {
  const idx = exceptions.findIndex((e) => e.id === updated.id);
  if (idx !== -1) exceptions[idx] = updated;
  tableInstance?.setRows(exceptions);
}

function openExceptionDrawer(exc) {
  const { el } = openDrawer({ title: `${exc.type} — ${exc.id}`, large: true, bodyHtml: '' });
  renderDrawerBody(el, exc);
}

function navHintHtml(exc) {
  const links = [];
  if (exc.tripId) links.push(`<a class="btn btn-secondary" href="#/dep/gate">${icon('shield-alert', 16)} Go to gate</a>`);
  if (exc.flightCode) links.push(`<a class="btn btn-secondary" href="#/arr/flights/${esc(encodeURIComponent(exc.flightCode))}">${icon('plane-landing', 16)} Go to flight</a>`);
  return links.length ? `<div class="row gap-2 wrap" style="margin-block-end:var(--s4)">${links.join('')}</div>` : '';
}

function resolveSectionHtml(exc) {
  if (['Resolved', 'Closed'].includes(exc.status)) {
    return `
      <div class="section-title">Resolution</div>
      <p class="fs-sm">${esc(exc.resolutionOutcome || '—')}</p>
      <p class="fs-xs muted">${esc(fmtDateTime(exc.resolvedAt))}</p>`;
  }
  if (['High', 'Critical'].includes(exc.severity)) {
    return `
      <div class="section-title">Resolution</div>
      <p class="fs-sm muted">High-severity exceptions must be resolved by Operations Management.</p>`;
  }
  return `
    <div class="section-title">Resolve</div>
    <form id="resolve-exc-form" novalidate>
      <div class="field">
        <label for="resolve-exc-notes">Notes</label>
        <textarea id="resolve-exc-notes" placeholder="Optional resolution notes"></textarea>
      </div>
      <button type="submit" class="btn btn-primary" id="resolve-exc-submit">${icon('check', 16)} Resolve</button>
    </form>`;
}

function drawerBodyHtml(exc) {
  return `
    ${navHintHtml(exc)}
    <div class="stack gap-2 fs-sm" style="margin-block-end:var(--s5)">
      <div class="row" style="justify-content:space-between"><span class="muted">Type</span><strong>${esc(exc.type)}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted">Severity</span>${severityChip(exc.severity)}</div>
      <div class="row" style="justify-content:space-between"><span class="muted">Status</span>${statusChip(exc.status)}</div>
      <div class="row" style="justify-content:space-between"><span class="muted">Assignee</span><strong>${esc(exc.assignee || '—')}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted">Raised</span><strong>${esc(fmtDateTime(exc.time))}</strong></div>
    </div>
    ${!exc.assignee ? `<button type="button" class="btn btn-secondary" id="assign-me-btn" style="margin-block-end:var(--s5)">${icon('user-check', 16)} Assign to me</button>` : ''}
    <div class="section-title">Notes</div>
    <div id="notes-list" class="stack gap-2" style="margin-block-end:var(--s4)"></div>
    <form id="add-note-form" novalidate style="margin-block-end:var(--s6)">
      <div class="field">
        <label for="add-note-text">Add note <span class="req">*</span></label>
        <textarea id="add-note-text" required></textarea>
        <div class="error" id="err-add-note" hidden></div>
      </div>
      <button type="submit" class="btn btn-secondary" id="add-note-submit">${icon('plus', 16)} Add note</button>
    </form>
    <div id="resolve-section-root">${resolveSectionHtml(exc)}</div>`;
}

function renderNotesList(el, exc) {
  const notesRoot = el.querySelector('#notes-list');
  if (!notesRoot) return;
  if (!exc.notes.length) { notesRoot.innerHTML = `<p class="fs-sm muted">No notes yet.</p>`; return; }
  notesRoot.innerHTML = exc.notes.map((n) => `
    <div style="padding:var(--s2) 0;border-bottom:1px solid var(--border)">
      <p class="fs-sm">${esc(n.text)}</p>
      <p class="fs-xs muted">${esc(fmtDateTime(n.at))}</p>
    </div>`).join('');
}

function renderDrawerBody(el, exc) {
  const body = el.querySelector('.drawer-body');
  body.innerHTML = drawerBodyHtml(exc);
  renderNotesList(el, exc);

  el.querySelector('#assign-me-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const updated = await api.assignToMe(exc.id);
      patchLocal(updated);
      toast('Assigned to you.', 'success');
      renderDrawerBody(el, updated);
    } catch (err) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      toast(err.message, 'error');
    }
  });

  const noteForm = el.querySelector('#add-note-form');
  let addingNote = false;
  noteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (addingNote) return;
    const text = noteForm.querySelector('#add-note-text').value.trim();
    const errBox = noteForm.querySelector('#err-add-note');
    if (!text) { errBox.textContent = 'A note is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    addingNote = true;
    const btn = noteForm.querySelector('#add-note-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      const updated = await api.addExceptionNote(exc.id, text);
      patchLocal(updated);
      toast('Note added.', 'success');
      addingNote = false;
      renderDrawerBody(el, updated);
    } catch (err) {
      addingNote = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Add note';
      toast(err.message, 'error');
    }
  });

  const resolveForm = el.querySelector('#resolve-exc-form');
  let resolving = false;
  resolveForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (resolving) return;
    const notes = resolveForm.querySelector('#resolve-exc-notes').value.trim();
    resolving = true;
    const btn = resolveForm.querySelector('#resolve-exc-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Resolving…';
    try {
      await api.resolveExceptionLocal(exc.id, notes);
      toast('Exception resolved.', 'success');
      el.querySelector('[data-act="close-drawer"]')?.click();
      await load();
    } catch (err) {
      resolving = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Resolve';
      toast(err.message, 'error');
    }
  });
}
