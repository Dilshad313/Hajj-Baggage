import * as api from '../api.js';
import {
  skeletonBlock, errorState, toast, announce, confirmDialog, openDrawer, closeDrawer, openModal,
  fmtDateTime, fmtRelative, esc, icon,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { EXCEPTION_TYPES, SEVERITIES, TEAMS } from '../seed.js';

let appEl = null;
let table = null;
let allExceptions = [];
let filters = { type: '', severity: '', team: '', tab: 'all' };
let openExceptionId = null;

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'escalated', label: 'Escalated' },
  { id: 'resolved-today', label: 'Resolved today' },
];

export function render(params, app) {
  appEl = app;
  if (params.id) openExceptionId = params.id;
  load();
  return { destroy, poll: refreshQuiet, refresh: load };
}

export function destroy() {
  appEl = null;
  table = null;
}

function apiFilters() {
  const f = {};
  if (filters.type) f.type = filters.type;
  if (filters.severity) f.severity = filters.severity;
  if (filters.team) f.team = filters.team;
  if (filters.tab !== 'all') f.tab = filters.tab;
  return f;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell() + skeletonBlock(8);
  try {
    allExceptions = await api.getExceptions(apiFilters());
    renderTable();
    if (openExceptionId) { const id = openExceptionId; openExceptionId = null; openDetailDrawer(id); }
  } catch (err) {
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || !table) return;
  try {
    allExceptions = await api.getExceptions(apiFilters());
    table.setRows(allExceptions);
  } catch (e) { /* silent background refresh */ }
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Exceptions queue</h1><p class="page-subtitle">Track, assign and resolve exceptions raised across the platform.</p></div>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${filters.tab === t.id}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="exceptions-table-root"></div>`;
}

function slaInfo(exception) {
  if (['Resolved', 'Closed'].includes(exception.status)) return { label: null, cls: '' };
  const ageMin = Math.round((Date.now() - new Date(exception.time).getTime()) / 60000);
  if (ageMin >= 60) return { label: `${ageMin} min`, cls: 'sla-red' };
  if (ageMin >= 30) return { label: `${ageMin} min`, cls: 'sla-amber' };
  return { label: `${ageMin} min`, cls: '' };
}

function renderTable() {
  appEl.innerHTML = pageShell();
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    if (filters.tab === btn.dataset.tab) return;
    filters.tab = btn.dataset.tab;
    load();
  }));
  const root = appEl.querySelector('#exceptions-table-root');

  const toolbarExtraHtml = `
    <select aria-label="Filter by type" data-flt="type">
      <option value="">All types</option>
      ${EXCEPTION_TYPES.map((t) => `<option value="${esc(t)}" ${filters.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select>
    <select aria-label="Filter by severity" data-flt="severity">
      <option value="">All severities</option>
      ${SEVERITIES.map((s) => `<option value="${s}" ${filters.severity === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <select aria-label="Filter by team" data-flt="team">
      <option value="">All teams</option>
      ${TEAMS.map((t) => `<option value="${esc(t)}" ${filters.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-secondary" data-act="bulk-assign" hidden>${icon('users', 16)} Bulk assign</button>
  `;

  table = createDataTable(root, {
    rows: allExceptions,
    searchKeys: ['type', 'flightCode', 'bagTag', 'description'],
    getRowId: (e) => e.id,
    csvFilename: 'exceptions',
    emptyMessage: 'No exceptions match these filters.',
    selectable: true,
    highlightNewRows: true,
    toolbarExtraHtml,
    onRowClick: (row) => openDetailDrawer(row.id),
    onSelectionChange: (ids) => {
      const btn = root.querySelector('[data-act="bulk-assign"]');
      if (btn) btn.hidden = ids.length === 0;
    },
    columns: [
      { key: 'time', label: 'Time', sortable: true, render: (e) => `<span title="${esc(fmtDateTime(e.time))}">${fmtRelative(e.time)}</span>`, csvValue: (e) => e.time },
      { key: 'type', label: 'Type', sortable: true },
      { key: 'severity', label: 'Severity', sortable: true, render: (e) => severityChip(e.severity) },
      { key: 'flightCode', label: 'Flight', sortable: true },
      { key: 'bagTag', label: 'Bag / truck', render: (e) => e.bagTag ? `<span class="mono">${esc(e.bagTag)}</span>` : '—' },
      { key: 'raisedByRole', label: 'Raised by', sortable: true },
      {
        key: 'age', label: 'Age (SLA)', sortable: true,
        render: (e) => { const s = slaInfo(e); return s.label ? `<span class="${s.cls}">${s.label}</span>` : '—'; },
        csvValue: (e) => Math.round((Date.now() - new Date(e.time).getTime()) / 60000),
      },
      { key: 'status', label: 'Status', sortable: true, render: (e) => statusChip(e.status) },
      { key: 'team', label: 'Team', sortable: true, render: (e) => e.team ? esc(e.team) : '—' },
    ],
  });

  root.querySelectorAll('[data-flt]').forEach((sel) => sel.addEventListener('change', () => {
    filters[sel.dataset.flt] = sel.value;
    load();
  }));
  root.querySelector('[data-act="bulk-assign"]')?.addEventListener('click', () => openAssignModal(table.getSelected()));
}

/* ===================== Bulk / single assign ===================== */

function assignModalBody(suggestedTeam) {
  return `
    <div class="field">
      <label for="asg-team">Team <span class="req">*</span></label>
      <select id="asg-team">
        ${TEAMS.map((t) => `<option value="${esc(t)}" ${t === suggestedTeam ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label for="asg-assignee">Assignee</label>
      <input id="asg-assignee" placeholder="Optional — person's name" />
    </div>
    <div class="field">
      <label for="asg-due">Due time <span class="req">*</span></label>
      <input id="asg-due" type="datetime-local" />
      <div class="error" id="err-asg-due" hidden></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-act="confirm">Assign</button>
    </div>`;
}

function defaultDueLocal(minutesFromNow) {
  const d = new Date(Date.now() + minutesFromNow * 60000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openAssignModal(ids) {
  if (!ids.length) return;
  const suggested = ids.length === 1 ? (allExceptions.find((e) => e.id === ids[0])?.suggestedTeam) : TEAMS[0];
  const close = openModal({
    title: ids.length === 1 ? 'Assign exception' : `Assign ${ids.length} exceptions`,
    bodyHtml: assignModalBody(suggested),
    onMount: (overlay) => {
      overlay.querySelector('#asg-due').value = defaultDueLocal(60);
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
      overlay.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
        const team = overlay.querySelector('#asg-team').value;
        const assignee = overlay.querySelector('#asg-assignee').value.trim();
        const dueRaw = overlay.querySelector('#asg-due').value;
        const errEl = overlay.querySelector('#err-asg-due');
        if (!dueRaw) { errEl.textContent = 'Due time is required.'; errEl.hidden = false; return; }
        const dueAt = new Date(dueRaw).toISOString();
        if (new Date(dueAt) < new Date()) { errEl.textContent = 'Due time must be in the future.'; errEl.hidden = false; return; }
        errEl.hidden = true;
        const btn = overlay.querySelector('[data-act="confirm"]');
        btn.disabled = true; btn.setAttribute('aria-busy', 'true');
        try {
          if (ids.length === 1) await api.assignException(ids[0], { team, assignee, dueAt });
          else await api.bulkAssign(ids, { team, assignee, dueAt });
          toast(`Assigned to ${team}${assignee ? ` (${assignee})` : ''}.`, 'success');
          close();
          table?.clearSelection();
          load();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false; btn.removeAttribute('aria-busy');
        }
      });
    },
  });
}

/* ===================== Detail drawer ===================== */

async function openDetailDrawer(id) {
  let exception;
  try {
    exception = await api.getException(id);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const drawer = openDrawer({
    title: `${exception.type} — ${exception.id}`,
    bodyHtml: `<div id="exc-detail-body"></div>`,
    large: true,
  });

  function renderBody() {
    const body = drawer.el.querySelector('#exc-detail-body');
    const terminal = ['Resolved', 'Closed'].includes(exception.status);
    const s = slaInfo(exception);
    body.innerHTML = `
      <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
        ${severityChip(exception.severity)}${statusChip(exception.status)}
        ${s.label ? `<span class="chip chip-grey ${s.cls}">Age: ${s.label}</span>` : ''}
      </div>
      <p class="fs-sm text-2">${esc(exception.description)}</p>
      <div class="grid grid-cols-2 fs-sm" style="margin-block:var(--s4)">
        <div><span class="muted">Flight</span><br><strong>${esc(exception.flightCode)}</strong></div>
        <div><span class="muted">Bag / truck</span><br><strong>${exception.bagTag ? esc(exception.bagTag) : '—'}</strong></div>
        <div><span class="muted">Raised by</span><br><strong>${esc(exception.raisedByRole)}</strong></div>
        <div><span class="muted">Raised</span><br><strong title="${esc(fmtDateTime(exception.time))}">${fmtRelative(exception.time)}</strong></div>
      </div>

      ${!terminal ? `
      <div class="card" style="margin-block-end:var(--s4)">
        <h2 class="section-title">Assign</h2>
        <div class="row gap-2 wrap" style="align-items:flex-end">
          <div class="field" style="margin:0;min-width:160px">
            <label for="d-team">Team</label>
            <select id="d-team">${TEAMS.map((t) => `<option value="${esc(t)}" ${(exception.team || exception.suggestedTeam) === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          </div>
          <div class="field" style="margin:0;min-width:160px">
            <label for="d-assignee">Assignee</label>
            <input id="d-assignee" value="${esc(exception.assignee || '')}" placeholder="Optional" />
          </div>
          <div class="field" style="margin:0;min-width:200px">
            <label for="d-due">Due time</label>
            <input id="d-due" type="datetime-local" value="${exception.dueAt ? defaultDueLocal(Math.round((new Date(exception.dueAt) - Date.now()) / 60000)) : defaultDueLocal(60)}" />
          </div>
          <button type="button" class="btn btn-primary" data-act="assign">${exception.team ? 'Re-assign' : 'Assign'}</button>
        </div>
        <div class="error" id="err-d-due" hidden style="margin-block-start:var(--s2)"></div>
      </div>` : ''}

      <div class="card" style="margin-block-end:var(--s4)">
        <h2 class="section-title">Notes</h2>
        <div class="stack gap-3" style="margin-block-end:var(--s3)">
          ${exception.notes.length ? exception.notes.map((n) => `
            <div style="border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
              <div class="fs-sm">${esc(n.text)}</div>
              <div class="fs-xs muted">${esc(n.author)} · ${fmtRelative(n.time)}</div>
            </div>`).join('') : `<p class="muted fs-sm">No updates yet.</p>`}
        </div>
        ${!terminal ? `
          <div class="field">
            <label for="d-update">Add update</label>
            <textarea id="d-update" minlength="5" maxlength="1000" placeholder="5–1000 characters"></textarea>
            <div class="error" id="err-d-update" hidden></div>
          </div>
          <button type="button" class="btn btn-secondary" data-act="add-update">${icon('message-square', 16)} Add update</button>` : ''}
      </div>

      ${!terminal ? `
      <div class="card" style="margin-block-end:var(--s4)">
        <h2 class="section-title">Escalate</h2>
        <div class="field">
          <label for="d-escalate-reason">Reason <span class="req">*</span></label>
          <textarea id="d-escalate-reason" minlength="10" maxlength="500" placeholder="10–500 characters"></textarea>
          <div class="error" id="err-d-escalate-reason" hidden></div>
        </div>
        <button type="button" class="btn btn-secondary" data-act="escalate">${icon('arrow-up-circle', 16)} Escalate to senior management</button>
      </div>` : ''}

      ${exception.status !== 'Closed' ? `
      <div class="card">
        <h2 class="section-title">${exception.status === 'Resolved' ? 'Close' : 'Resolve'}</h2>
        ${exception.status !== 'Resolved' ? `
          <div class="field">
            <label for="d-resolution">Resolution notes <span class="req">*</span></label>
            <textarea id="d-resolution" minlength="10" maxlength="1000" placeholder="10–1000 characters"></textarea>
            <div class="error" id="err-d-resolution" hidden></div>
          </div>
          <button type="button" class="btn btn-primary" data-act="resolve">${icon('check-circle', 16)} Mark resolved</button>
        ` : `
          <p class="fs-sm text-2" style="margin-block-end:var(--s3)">${esc(exception.resolutionNotes || '')}</p>
          <button type="button" class="btn btn-primary" data-act="close-exc">${icon('check', 16)} Close exception</button>
        `}
      </div>` : ''}
    `;
    wireActions();
  }

  function setErr(id, msg) {
    const el = drawer.el.querySelector(`#err-${id}`);
    if (!el) return;
    if (msg) { el.textContent = msg; el.hidden = false; } else el.hidden = true;
  }

  async function refetchAndRender() {
    exception = await api.getException(exception.id);
    renderBody();
  }

  function wireActions() {
    drawer.el.querySelector('[data-act="assign"]')?.addEventListener('click', async () => {
      const team = drawer.el.querySelector('#d-team').value;
      const assignee = drawer.el.querySelector('#d-assignee').value.trim();
      const dueRaw = drawer.el.querySelector('#d-due').value;
      if (!dueRaw) { setErr('d-due', 'Due time is required.'); return; }
      const dueAt = new Date(dueRaw).toISOString();
      if (new Date(dueAt) < new Date()) { setErr('d-due', 'Due time must be in the future.'); return; }
      setErr('d-due', '');
      try {
        await api.assignException(exception.id, { team, assignee, dueAt });
        toast(`Assigned to ${team}${assignee ? ` (${assignee})` : ''} — due ${new Date(dueAt).toLocaleTimeString()}.`, 'success');
        await refetchAndRender();
        refreshQuiet();
      } catch (err) { toast(err.message, 'error'); }
    });

    drawer.el.querySelector('[data-act="add-update"]')?.addEventListener('click', async () => {
      const text = drawer.el.querySelector('#d-update').value.trim();
      if (text.length < 5 || text.length > 1000) { setErr('d-update', 'Update must be 5–1000 characters.'); return; }
      setErr('d-update', '');
      try {
        await api.addUpdate(exception.id, text);
        toast('Update added.', 'success');
        await refetchAndRender();
        refreshQuiet();
      } catch (err) { toast(err.message, 'error'); }
    });

    drawer.el.querySelector('[data-act="escalate"]')?.addEventListener('click', async () => {
      const reason = drawer.el.querySelector('#d-escalate-reason').value.trim();
      if (reason.length < 10 || reason.length > 500) { setErr('d-escalate-reason', 'Reason must be 10–500 characters.'); return; }
      setErr('d-escalate-reason', '');
      const ok = await confirmDialog({ title: 'Escalate to senior management?', body: 'This raises the severity to Critical and flags it for senior review.', confirmLabel: 'Escalate', danger: true });
      if (!ok) return;
      try {
        await api.escalate(exception.id, reason);
        toast('Escalated to senior management.', 'success');
        announce('Exception escalated.');
        await refetchAndRender();
        refreshQuiet();
      } catch (err) { toast(err.message, 'error'); }
    });

    drawer.el.querySelector('[data-act="resolve"]')?.addEventListener('click', async () => {
      const notes = drawer.el.querySelector('#d-resolution').value.trim();
      if (notes.length < 10 || notes.length > 1000) { setErr('d-resolution', 'Resolution notes must be 10–1000 characters.'); return; }
      setErr('d-resolution', '');
      try {
        await api.resolve(exception.id, notes);
        toast('Exception marked resolved.', 'success');
        await refetchAndRender();
        refreshQuiet();
      } catch (err) { toast(err.message, 'error'); }
    });

    drawer.el.querySelector('[data-act="close-exc"]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Close this exception?', body: 'This closes the exception permanently.', confirmLabel: 'Close exception' });
      if (!ok) return;
      try {
        await api.close(exception.id);
        toast('Exception closed.', 'success');
        closeDrawer();
        load();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  renderBody();
}
