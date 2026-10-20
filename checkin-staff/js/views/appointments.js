import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, fmtTime, confirmDialog } from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let table = null;
let dateFilter = 'today';
let statusFilter = 'All';
let search = '';

const STATUS_TABS = ['All', 'Booked', 'In Progress', 'Checked-in', 'On Hold', 'No-show', 'Cancelled'];

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: refreshQuiet, refresh: load };
}

export function destroy() { table = null; appEl = null; }

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Today's appointments</h1></div>
      <div class="row gap-2">
        <select id="date-filter" aria-label="Date">
          <option value="today" ${dateFilter === 'today' ? 'selected' : ''}>Today</option>
          <option value="tomorrow" ${dateFilter === 'tomorrow' ? 'selected' : ''}>Tomorrow</option>
          <option value="all" ${dateFilter === 'all' ? 'selected' : ''}>All dates</option>
        </select>
      </div>
    </div>
    <div class="tabs" role="tablist">
      ${STATUS_TABS.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${statusFilter === t}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <div id="appt-table-root"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell();
  wireControls();
  const root = appEl.querySelector('#appt-table-root');
  root.innerHTML = skeletonBlock(6);
  try {
    const rows = await api.getAppointments({ date: dateFilter, status: statusFilter, search });
    if (!appEl) return;
    initTable(root, rows);
  } catch (err) {
    if (!appEl) return;
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || !table) return;
  try {
    const rows = await api.getAppointments({ date: dateFilter, status: statusFilter, search });
    if (!appEl || !table) return;
    table.setRows(rows);
  } catch (e) { /* silent */ }
}

function wireControls() {
  appEl.querySelector('#date-filter').addEventListener('change', (e) => { dateFilter = e.target.value; load(); });
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    if (statusFilter === btn.dataset.tab) return;
    statusFilter = btn.dataset.tab;
    load();
  }));
}

function initTable(root, rows) {
  table = createDataTable(root, {
    rows, searchKeys: ['pilgrimName', 'nusukId', 'passportNo', 'bookingCode'],
    getRowId: (a) => a.id, csvFilename: 'appointments',
    emptyMessage: 'No appointments match this filter.',
    onRowClick: (a) => navigate(`#/checkin?appt=${a.id}`),
    rowClassName: (a) => (a.overdue ? 'row-overdue' : ''),
    columns: [
      { key: 'slotAt', label: 'Time', sortable: true, render: (a) => fmtTime(a.slotAt), csvValue: (a) => a.slotAt },
      { key: 'pilgrimName', label: 'Pilgrim', sortable: true },
      { key: 'nusukId', label: 'Nusuk ID' },
      { key: 'flightCode', label: 'Flight', sortable: true },
      { key: 'declaredBags', label: 'Bags', sortable: true },
      { key: 'status', label: 'Status', sortable: true, render: (a) => statusChip(a.status) },
      {
        key: 'actions', label: 'Actions',
        render: (a) => {
          if (a.status === 'Booked') {
            return `<div class="row gap-2">
              <button type="button" class="btn btn-secondary" style="height:32px;font-size:12px" data-act="start" data-id="${esc(a.id)}">Start check-in</button>
              ${a.overdue ? `<button type="button" class="btn btn-danger" style="height:32px;font-size:12px" data-act="noshow" data-id="${esc(a.id)}">Mark no-show</button>` : ''}
            </div>`;
          }
          if (a.status === 'No-show' || a.status === 'Cancelled') return `<button type="button" class="btn btn-secondary" style="height:32px;font-size:12px" data-act="reinstate" data-id="${esc(a.id)}">Reinstate</button>`;
          if (a.status === 'Checked-in') return `<button type="button" class="btn btn-secondary" style="height:32px;font-size:12px" data-act="history" data-id="${esc(a.id)}">View receipt</button>`;
          if (a.status === 'On Hold') return `<button type="button" class="btn btn-secondary" style="height:32px;font-size:12px" data-act="exception" data-id="${esc(a.id)}">View exception</button>`;
          return '—';
        },
      },
    ],
  });
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    e.stopPropagation();
    const id = btn.dataset.id;
    const act = btn.dataset.act;
    if (act === 'start') { navigate(`#/checkin?appt=${id}`); return; }
    if (act === 'history') { navigate('#/history'); return; }
    if (act === 'exception') { navigate('#/exceptions'); return; }
    if (act === 'reinstate') {
      try { await api.reinstate(id); toast('Appointment reinstated.', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
      return;
    }
    if (act === 'noshow') {
      const ok = await confirmDialog({ title: 'Mark no-show', body: 'Mark this appointment as a no-show?', confirmLabel: 'Mark no-show', danger: true });
      if (!ok) return;
      try { await api.markNoShow(id); toast('Marked as no-show.', 'info'); load(); } catch (err) { toast(err.message, 'error'); }
    }
  });
}
