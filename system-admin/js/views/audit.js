import * as api from '../api.js';
import {
  skeletonBlock, errorState, toast, openDrawer, fmtDateTime, fmtRelative, esc, diffHtml,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';

const ROLE_LABELS = [
  'Check-in Staff', 'Warehouse Staff', 'Driver', 'Airport Coordinator', 'Airline',
  'Ground Handler', 'Accommodation Receiving Staff', 'Delivery Staff', 'Operations Manager', 'System Admin',
];
const ACTIONS = [
  'Login', 'Create user', 'Edit user', 'Disable user', 'Update config',
  'Test connection', 'Resolve error', 'Escalate error', 'Export data', 'Update master data',
];
const ENTITIES = ['Session', 'User', 'Config', 'Integration', 'ErrorLog', 'Export', 'MasterData'];

let appEl = null;
let table = null;
let requestToken = 0;
let filters = { role: '', action: '', entity: '', from: '', to: '' };

/**
 * Renders the global audit log view.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:() => void, refresh:() => void}}
 */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, refresh: load };
}

/** Tears down view state when the router navigates away. */
export function destroy() {
  appEl = null;
  table = null;
}

function apiFilters() {
  const f = {};
  if (filters.role) f.role = filters.role;
  if (filters.action) f.action = filters.action;
  if (filters.entity) f.entity = filters.entity;
  if (filters.from) f.from = filters.from;
  if (filters.to) f.to = filters.to;
  return f;
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Audit logs</h1><p class="page-subtitle">Searchable record of administrative actions across the platform.</p></div>
    </div>
    <div id="audit-table-root"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell() + skeletonBlock(8);
  try {
    const list = await api.searchAudit(apiFilters());
    renderTable(list);
  } catch (err) {
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function applyFilters() {
  if (!table) return;
  const token = ++requestToken;
  try {
    const list = await api.searchAudit(apiFilters());
    if (token !== requestToken) return;
    table.setRows(list);
  } catch (err) {
    if (token !== requestToken) return;
    toast(err.message, 'error');
  }
}

function toolbarExtraHtml() {
  return `
    <select aria-label="Filter by role" data-flt="role">
      <option value="">All roles</option>
      ${ROLE_LABELS.map((r) => `<option value="${esc(r)}" ${filters.role === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
    </select>
    <select aria-label="Filter by action" data-flt="action">
      <option value="">All actions</option>
      ${ACTIONS.map((a) => `<option value="${esc(a)}" ${filters.action === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
    </select>
    <select aria-label="Filter by entity" data-flt="entity">
      <option value="">All entities</option>
      ${ENTITIES.map((e) => `<option value="${esc(e)}" ${filters.entity === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}
    </select>
    <div class="row gap-1" style="align-items:center">
      <label class="fs-xs muted" for="aud-flt-from">From</label>
      <input id="aud-flt-from" type="date" aria-label="From date" data-flt="from" value="${esc(filters.from)}" />
      <label class="fs-xs muted" for="aud-flt-to">To</label>
      <input id="aud-flt-to" type="date" aria-label="To date" data-flt="to" value="${esc(filters.to)}" />
    </div>`;
}

function renderTable(rows) {
  appEl.innerHTML = pageShell();
  const root = appEl.querySelector('#audit-table-root');

  table = createDataTable(root, {
    rows,
    searchKeys: ['userName', 'roleLabel', 'action', 'entity', 'entityId', 'device', 'ip'],
    getRowId: (r) => r.id,
    csvFilename: 'audit-log',
    emptyMessage: 'No audit entries match these filters.',
    toolbarExtraHtml: toolbarExtraHtml(),
    onRowClick: (row) => openAuditDrawer(row),
    columns: [
      {
        key: 'time', label: 'Time', sortable: true,
        render: (r) => `<span title="${esc(fmtRelative(r.time))}">${esc(fmtDateTime(r.time))}</span>`,
        csvValue: (r) => r.time,
      },
      { key: 'userName', label: 'User', sortable: true },
      { key: 'roleLabel', label: 'Role', sortable: true },
      { key: 'action', label: 'Action', sortable: true },
      { key: 'entity', label: 'Entity', sortable: true },
      { key: 'entityId', label: 'Entity ID', sortable: true, render: (r) => `<span class="mono">${esc(r.entityId)}</span>` },
      {
        key: 'ip', label: 'IP / device',
        render: (r) => `${esc(r.ip)}<br><span class="muted fs-xs">${esc(r.device)}</span>`,
        csvValue: (r) => `${r.ip} (${r.device})`,
      },
      {
        key: 'result', label: 'Result', sortable: true,
        render: (r) => statusChip(r.result, { color: r.result === 'Success' ? 'green' : 'red' }),
      },
    ],
  });

  root.querySelectorAll('[data-flt]').forEach((el) => el.addEventListener('change', () => {
    filters[el.dataset.flt] = el.value;
    applyFilters();
  }));
}

function openAuditDrawer(entry) {
  openDrawer({
    title: `Audit entry — ${entry.entityId}`,
    bodyHtml: `
      <div class="stack gap-3">
        <div class="row gap-2" style="justify-content:space-between">
          <span class="fs-sm muted">Time</span>
          <span class="fs-sm" title="${esc(fmtRelative(entry.time))}">${esc(fmtDateTime(entry.time))}</span>
        </div>
        <div class="row gap-2" style="justify-content:space-between">
          <span class="fs-sm muted">User</span>
          <span class="fs-sm">${esc(entry.userName)} <span class="muted">(${esc(entry.roleLabel)})</span></span>
        </div>
        <div class="row gap-2" style="justify-content:space-between">
          <span class="fs-sm muted">Action</span>
          <span class="fs-sm">${esc(entry.action)}</span>
        </div>
        <div class="row gap-2" style="justify-content:space-between">
          <span class="fs-sm muted">Entity</span>
          <span class="fs-sm">${esc(entry.entity)} <span class="mono">${esc(entry.entityId)}</span></span>
        </div>
        <div class="row gap-2" style="justify-content:space-between">
          <span class="fs-sm muted">IP address</span>
          <span class="fs-sm mono">${esc(entry.ip)}</span>
        </div>
        <div class="row gap-2" style="justify-content:space-between">
          <span class="fs-sm muted">Device</span>
          <span class="fs-sm">${esc(entry.device)}</span>
        </div>
        <div class="row gap-2" style="justify-content:space-between">
          <span class="fs-sm muted">Result</span>
          ${statusChip(entry.result, { color: entry.result === 'Success' ? 'green' : 'red' })}
        </div>
        <div>
          <h2 class="section-title">Field changes</h2>
          ${diffHtml(entry.before, entry.after)}
        </div>
      </div>`,
  });
}
