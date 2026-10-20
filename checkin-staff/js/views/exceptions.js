import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, fmtDateTime, openDrawer } from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let table = null;
let statusFilter = 'All';
let deepLinkId = null;

const STATUS_TABS = ['All', 'Open', 'Assigned', 'In Progress', 'Escalated', 'Resolved', 'Closed'];

export function render(params, app) {
  appEl = app;
  deepLinkId = params.id || null;
  load();
  return { destroy, poll: refreshQuiet, refresh: load };
}

export function destroy() { table = null; appEl = null; }

function pageShell() {
  return `
    <div class="page-header"><div><h1 class="page-title">Centre exceptions</h1></div></div>
    <div class="tabs" role="tablist">
      ${STATUS_TABS.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${statusFilter === t}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <div id="exc-table-root"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell();
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => { statusFilter = btn.dataset.tab; load(); }));
  const root = appEl.querySelector('#exc-table-root');
  root.innerHTML = skeletonBlock(6);
  try {
    const rows = await api.getExceptions({ status: statusFilter });
    if (!appEl) return;
    initTable(root, rows);
    if (deepLinkId) { openDetail(deepLinkId); deepLinkId = null; }
  } catch (err) {
    if (!appEl) return;
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || !table) return;
  try {
    const rows = await api.getExceptions({ status: statusFilter });
    if (!appEl || !table) return;
    table.setRows(rows);
  } catch (e) { /* silent */ }
}

function initTable(root, rows) {
  table = createDataTable(root, {
    rows, searchKeys: ['type', 'pilgrimName', 'notes'],
    getRowId: (e) => e.id, csvFilename: 'exceptions',
    emptyMessage: 'No exceptions for this filter.',
    onRowClick: (e) => openDetail(e.id),
    columns: [
      { key: 'time', label: 'Time', sortable: true, render: (e) => fmtDateTime(e.time), csvValue: (e) => e.time },
      { key: 'type', label: 'Type', sortable: true },
      { key: 'pilgrimName', label: 'Pilgrim / bag', render: (e) => esc(e.pilgrimName || '—') },
      { key: 'severity', label: 'Severity', sortable: true, render: (e) => severityChip(e.severity) },
      { key: 'status', label: 'Status', sortable: true, render: (e) => statusChip(e.status) },
    ],
  });
}

async function openDetail(id) {
  let exc;
  try { exc = await api.getException(id); } catch (err) { toast(err.message, 'error'); return; }
  const drawer = openDrawer({ title: exc.type, bodyHtml: `<div id="exc-detail-body"></div>` });

  function renderBody() {
    const body = drawer.el.querySelector('#exc-detail-body');
    const canResume = exc.session && exc.session.status === 'on-hold' && exc.status !== 'Resolved';
    body.innerHTML = `
      <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">${severityChip(exc.severity)}${statusChip(exc.status)}</div>
      <p class="fs-sm"><strong>${esc(exc.pilgrimName || 'Unassigned')}</strong></p>
      <p class="fs-sm muted">${esc(exc.notes || 'No notes.')}</p>
      <p class="fs-xs muted">${fmtDateTime(exc.time)}</p>
      ${exc.resolutionNotes ? `<div class="result-card success" style="margin-block-start:var(--s4)">${icon('check-circle', 18)} Resolved: ${esc(exc.resolutionNotes)}</div>` : ''}

      ${exc.status !== 'Resolved' && exc.status !== 'Closed' ? `
        <div class="card" style="margin-block-start:var(--s4)">
          <h2 class="section-title fs-sm">Assign</h2>
          <button type="button" class="btn btn-secondary" data-act="assign">${icon('user-check', 16)} Assign to me</button>
        </div>
        <div class="card" style="margin-block-start:var(--s4)">
          <h2 class="section-title fs-sm">Resolve</h2>
          <div class="field"><label for="resolve-notes">Resolution notes <span class="req">*</span></label><textarea id="resolve-notes" maxlength="300"></textarea></div>
          <div class="error" id="err-resolve" hidden></div>
          <button type="button" class="btn btn-secondary" data-act="resolve">${icon('check', 16)} Resolve with notes</button>
          ${canResume ? `
            <div class="field" style="margin-block-start:var(--s3)"><label for="override-pin">Supervisor PIN <span class="req">*</span></label><input id="override-pin" type="password" inputmode="numeric" maxlength="4" /></div>
            <button type="button" class="btn btn-primary" data-act="override">${icon('shield-check', 16)} Override &amp; allow check-in</button>
          ` : ''}
        </div>` : ''}
      ${exc.session ? `
        <div class="card" style="margin-block-start:var(--s4)">
          <h2 class="section-title fs-sm">Linked check-in</h2>
          <p class="fs-sm">${esc(exc.session.appointment?.pilgrimName || '')} — ${esc(exc.session.status)}</p>
          ${exc.session.status === 'active' ? `<button type="button" class="btn btn-primary" data-act="resume">${icon('arrow-right-circle', 16)} Resume check-in</button>` : ''}
        </div>` : ''}`;

    body.querySelector('[data-act="assign"]')?.addEventListener('click', async () => {
      try { exc = { ...exc, ...(await api.assignToMe(exc.id)) }; toast('Assigned to you.', 'success'); renderBody(); } catch (e) { toast(e.message, 'error'); }
    });
    body.querySelector('[data-act="resolve"]')?.addEventListener('click', async () => {
      const notes = body.querySelector('#resolve-notes').value;
      const err = body.querySelector('#err-resolve');
      try { await api.resolveException(exc.id, notes); toast('Exception resolved.', 'success'); drawer.close(); load(); } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
    body.querySelector('[data-act="override"]')?.addEventListener('click', async () => {
      const notes = body.querySelector('#resolve-notes').value;
      const pin = body.querySelector('#override-pin').value;
      const err = body.querySelector('#err-resolve');
      try {
        await api.supervisorApprove(exc.id, { pin, notes });
        toast('Overridden — check-in may continue.', 'success');
        drawer.close();
        load();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
    body.querySelector('[data-act="resume"]')?.addEventListener('click', () => { drawer.close(); navigate('#/checkin'); });
  }

  renderBody();
}
