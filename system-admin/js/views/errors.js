import * as api from '../api.js';
import {
  skeletonBlock, errorState, emptyState, toast, openDrawer, closeDrawer, fmtDateTime, fmtRelative, esc, icon,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let mode = 'list'; // 'list' | 'detail'
let errorId = null;
let allErrors = [];
let table = null;
let filters = { service: '', severity: '', status: '' };
let serviceOptionsCache = null;
let detailError = null;
let incidentHistory = null;

const CATEGORIES = ['Config', 'Network', 'Vendor', 'Data', 'Code'];
const FIX_ACTIONS = [
  { value: 'retry-queue', label: 'Retry queue' },
  { value: 'rotate-key', label: 'Rotate key' },
  { value: 'restart-connector', label: 'Restart connector' },
  { value: 'correct-config', label: 'Correct config' },
];
const VENDORS = ['Nusuk', 'Garuda Indonesia', 'PIA', 'Biman Bangladesh', 'Scanner vendor', 'GPS provider'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

/**
 * Renders the error logs view at #/errors (list) and #/errors/:id (detail).
 * @param {{id?:string}} params
 * @param {HTMLElement} app
 * @returns {{destroy:Function, poll:Function, refresh:Function}}
 */
export function render(params, app) {
  appEl = app;
  errorId = params.id || null;
  mode = errorId ? 'detail' : 'list';
  load();
  return { destroy, poll, refresh: load };
}

/** Tears down the view. */
export function destroy() {
  appEl = null;
  table = null;
  detailError = null;
  incidentHistory = null;
}

function poll() {
  if (mode === 'list') refreshListQuiet();
}

function load() {
  if (!appEl) return;
  if (mode === 'detail') loadDetail();
  else loadList();
}

/* ===================== List ===================== */

async function ensureServiceOptions() {
  if (serviceOptionsCache) return serviceOptionsCache;
  const all = await api.getErrors({});
  serviceOptionsCache = Array.from(new Set(all.map((e) => e.service))).sort();
  return serviceOptionsCache;
}

function listShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Error logs</h1><p class="page-subtitle">Service errors across the platform, with root-cause and resolution workflow.</p></div>
    </div>
    <div id="errors-table-root"></div>`;
}

async function loadList() {
  appEl.innerHTML = listShell() + skeletonBlock(8);
  try {
    const [serviceOptions, list] = await Promise.all([ensureServiceOptions(), api.getErrors(filters)]);
    allErrors = list;
    renderListTable(serviceOptions);
  } catch (err) {
    appEl.innerHTML = listShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', loadList);
  }
}

async function refreshListQuiet() {
  if (!appEl || !table) return;
  try {
    allErrors = await api.getErrors(filters);
    table.setRows(allErrors);
  } catch (e) { /* silent background refresh */ }
}

function renderListTable(serviceOptions) {
  appEl.innerHTML = listShell();
  const root = appEl.querySelector('#errors-table-root');

  const toolbarExtraHtml = `
    <select aria-label="Filter by service" data-flt="service">
      <option value="">All services</option>
      ${serviceOptions.map((s) => `<option value="${esc(s)}" ${filters.service === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
    </select>
    <select aria-label="Filter by severity" data-flt="severity">
      <option value="">All severities</option>
      ${['Low', 'Medium', 'High', 'Critical'].map((s) => `<option value="${s}" ${filters.severity === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <select aria-label="Filter by status" data-flt="status">
      <option value="">All statuses</option>
      ${['Open', 'Resolved', 'Escalated'].map((s) => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>`;

  table = createDataTable(root, {
    rows: allErrors,
    searchKeys: ['message', 'code', 'service'],
    getRowId: (e) => e.id,
    csvFilename: 'errors',
    emptyMessage: 'No errors match these filters.',
    toolbarExtraHtml,
    onRowClick: (row) => navigate(`#/errors/${row.id}`),
    columns: [
      { key: 'time', label: 'Time', sortable: true, render: (e) => `<span title="${esc(fmtDateTime(e.time))}">${fmtRelative(e.time)}</span>`, csvValue: (e) => e.time },
      { key: 'service', label: 'Service', sortable: true },
      { key: 'severity', label: 'Severity', sortable: true, render: (e) => severityChip(e.severity) },
      { key: 'code', label: 'Code', sortable: true, render: (e) => `<span class="mono">${esc(e.code)}</span>` },
      { key: 'message', label: 'Message', sortable: true },
      { key: 'count', label: 'Count', sortable: true },
      { key: 'status', label: 'Status', sortable: true, render: (e) => statusChip(e.status) },
    ],
  });

  root.querySelectorAll('[data-flt]').forEach((sel) => sel.addEventListener('change', () => {
    filters[sel.dataset.flt] = sel.value;
    loadList();
  }));
}

/* ===================== Detail ===================== */

function detailShell() {
  return `<a class="btn btn-ghost" href="#/errors">${icon('arrow-left', 16)} Back to error logs</a>`;
}

async function loadDetail() {
  appEl.innerHTML = detailShell() + skeletonBlock(8);
  try {
    detailError = await api.getError(errorId);
    incidentHistory = null;
    renderDetail();
  } catch (err) {
    appEl.innerHTML = detailShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', loadDetail);
  }
}

function renderDetail() {
  const e = detailError;
  appEl.innerHTML = `
    ${detailShell()}
    <div class="page-header">
      <div>
        <h1 class="page-title">${esc(e.code)} <span class="mono fs-sm muted">${esc(e.id)}</span></h1>
        <p class="page-subtitle">${esc(e.service)} · <span title="${esc(fmtDateTime(e.time))}">${fmtRelative(e.time)}</span></p>
      </div>
      <div class="row gap-2">${severityChip(e.severity)}${statusChip(e.status)}</div>
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Message</h2>
      <p>${esc(e.message)} <span class="muted fs-sm">(${e.count} occurrence${e.count === 1 ? '' : 's'})</span></p>
    </div>

    <div class="grid grid-cols-2" style="margin-block-end:var(--s5)">
      <div class="card">
        <h2 class="section-title">Stack trace</h2>
        <pre class="mono fs-xs" style="white-space:pre-wrap;overflow-x:auto">${esc(e.stack)}</pre>
      </div>
      <div class="card">
        <h2 class="section-title">Payload</h2>
        <pre class="mono fs-xs" style="white-space:pre-wrap;overflow-x:auto">${esc(e.payload)}</pre>
      </div>
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Related audit events</h2>
      <div id="related-audit">${relatedAuditHtml(e.related)}</div>
    </div>

    <div id="workflow-root"></div>

    <div class="card" id="incident-history-card" style="margin-block-start:var(--s5)">
      <h2 class="section-title">Incident history</h2>
      <div id="incident-history-body">${skeletonBlock(3)}</div>
    </div>`;

  renderWorkflow();
  loadIncidentHistory();
}

function relatedAuditHtml(related) {
  if (!related || !related.length) return `<p class="muted fs-sm">No audit events recorded for this error yet.</p>`;
  return `<div class="stack gap-3">${related.map((a) => `
    <div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
      <span class="fs-sm">${esc(a.action)} <span class="muted">· ${esc(a.userName)}</span></span>
      <span class="fs-xs muted" title="${esc(fmtDateTime(a.time))}">${fmtRelative(a.time)}</span>
    </div>`).join('')}</div>`;
}

function renderWorkflow() {
  const root = appEl.querySelector('#workflow-root');
  if (!root) return;
  const e = detailError;

  if (e.status === 'Resolved') {
    root.innerHTML = `
      <div class="card" style="border-color:var(--success);background:var(--success-soft);margin-block-end:var(--s5)">
        <h2 class="section-title">Resolved</h2>
        <p class="fs-sm">This error has been resolved and the linked service is now reporting Healthy.</p>
      </div>`;
    return;
  }
  if (e.status === 'Escalated') {
    root.innerHTML = `
      <div class="card" style="border-color:var(--warning);background:var(--warning-soft);margin-block-end:var(--s5)">
        <h2 class="section-title">Escalated to vendor</h2>
        <p class="fs-sm">Vendor ticket <strong class="mono">${esc(e.vendorTicket)}</strong> is open for this error.</p>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Root cause</h2>
      ${e.rootCause ? rootCauseSummaryHtml(e.rootCause) : `<p class="muted fs-sm" style="margin-block-end:var(--s3)">No root cause recorded yet.</p>`}
      <button type="button" class="btn btn-secondary" data-act="identify-root-cause">${icon('search', 16)} ${e.rootCause ? 'Update root cause' : 'Identify root cause'}</button>
    </div>
    ${e.rootCause ? resolvableBranchHtml() : ''}`;

  root.querySelector('[data-act="identify-root-cause"]').addEventListener('click', openRootCauseDrawer);
  if (e.rootCause) wireResolvableBranch(root);
}

function rootCauseSummaryHtml(rc) {
  return `
    <div style="margin-block-end:var(--s3)">
      <span class="chip chip-blue">${esc(rc.category)}</span>
      <p class="fs-sm" style="margin-block-start:var(--s2)">${esc(rc.note)}</p>
      <p class="fs-xs muted">Recorded ${fmtRelative(rc.at)}</p>
    </div>`;
}

function resolvableBranchHtml() {
  return `
    <h2 class="section-title">Resolvable?</h2>
    <div class="grid grid-cols-2">
      <div class="card">
        <h2 class="section-title">Apply fix</h2>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">Resolve this error automatically and restore the linked service.</p>
        <div class="field">
          <label for="fix-action">Fix action <span class="req">*</span></label>
          <select id="fix-action">
            <option value="">Select an action…</option>
            ${FIX_ACTIONS.map((f) => `<option value="${f.value}">${esc(f.label)}</option>`).join('')}
          </select>
          <div class="error" id="err-fix-action" hidden></div>
        </div>
        <button type="button" class="btn btn-primary" data-act="apply-fix">${icon('wrench', 16)} Apply fix</button>
      </div>
      <div class="card">
        <h2 class="section-title">Escalate to vendor</h2>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">Open a ticket with the responsible vendor.</p>
        <div class="field">
          <label for="esc-vendor">Vendor <span class="req">*</span></label>
          <select id="esc-vendor">
            <option value="">Select a vendor…</option>
            ${VENDORS.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
          </select>
          <div class="error" id="err-esc-vendor" hidden></div>
        </div>
        <div class="field">
          <label for="esc-priority">Priority <span class="req">*</span></label>
          <select id="esc-priority">
            ${PRIORITIES.map((p) => `<option value="${p}">${esc(p)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="esc-description">Description <span class="req">*</span></label>
          <textarea id="esc-description" minlength="20" maxlength="2000" placeholder="Describe the issue for the vendor (20–2000 characters)"></textarea>
          <div class="error" id="err-esc-description" hidden></div>
        </div>
        <button type="button" class="btn btn-secondary" data-act="escalate-vendor">${icon('send', 16)} Escalate to vendor</button>
      </div>
    </div>`;
}

function wireResolvableBranch(root) {
  root.querySelector('[data-act="apply-fix"]')?.addEventListener('click', applyFixFlow);
  root.querySelector('[data-act="escalate-vendor"]')?.addEventListener('click', escalateVendorFlow);
}

async function applyFixFlow() {
  const sel = appEl.querySelector('#fix-action');
  const err = appEl.querySelector('#err-fix-action');
  const action = sel.value;
  if (!action) {
    err.textContent = 'Select a fix action.'; err.hidden = false; sel.setAttribute('aria-invalid', 'true');
    return;
  }
  err.hidden = true; sel.removeAttribute('aria-invalid');
  const btn = appEl.querySelector('[data-act="apply-fix"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    const result = await api.applyFix(errorId, { action });
    detailError.status = result.error.status;
    const label = FIX_ACTIONS.find((f) => f.value === action)?.label || action;
    toast(`Fix applied (${label}).${result.service ? ` ${result.service.name} is now Healthy.` : ''}`, 'success');
    renderWorkflow();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

async function escalateVendorFlow() {
  const vendorSel = appEl.querySelector('#esc-vendor');
  const prioritySel = appEl.querySelector('#esc-priority');
  const descEl = appEl.querySelector('#esc-description');
  const vendor = vendorSel.value;
  const priority = prioritySel.value;
  const description = descEl.value.trim();
  let valid = true;
  const vendorErr = appEl.querySelector('#err-esc-vendor');
  const descErr = appEl.querySelector('#err-esc-description');
  if (!vendor) {
    vendorErr.textContent = 'Select a vendor.'; vendorErr.hidden = false; vendorSel.setAttribute('aria-invalid', 'true'); valid = false;
  } else {
    vendorErr.hidden = true; vendorSel.removeAttribute('aria-invalid');
  }
  if (description.length < 20 || description.length > 2000) {
    descErr.textContent = 'Description must be 20–2000 characters.'; descErr.hidden = false; descEl.setAttribute('aria-invalid', 'true'); valid = false;
  } else {
    descErr.hidden = true; descEl.removeAttribute('aria-invalid');
  }
  if (!valid) return;
  const btn = appEl.querySelector('[data-act="escalate-vendor"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    const { ticketNo } = await api.escalateVendor(errorId, { vendor, priority, description });
    detailError.status = 'Escalated';
    detailError.vendorTicket = ticketNo;
    toast(`Escalated — ticket ${ticketNo}`, 'success');
    renderWorkflow();
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

function openRootCauseDrawer() {
  const existing = detailError.rootCause;
  const drawer = openDrawer({
    title: 'Identify root cause',
    bodyHtml: `
      <div class="field">
        <label for="rc-category">Category <span class="req">*</span></label>
        <select id="rc-category">
          <option value="">Select a category…</option>
          ${CATEGORIES.map((c) => `<option value="${c}" ${existing?.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
        <div class="error" id="err-rc-category" hidden></div>
      </div>
      <div class="field">
        <label for="rc-note">Note <span class="req">*</span></label>
        <textarea id="rc-note" minlength="10" maxlength="1000" placeholder="Describe the root cause (10–1000 characters)">${esc(existing?.note || '')}</textarea>
        <div class="error" id="err-rc-note" hidden></div>
      </div>`,
    footerHtml: `
      <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-act="save">Save root cause</button>`,
  });

  drawer.el.querySelector('[data-act="cancel"]').addEventListener('click', () => drawer.close());
  drawer.el.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const category = drawer.el.querySelector('#rc-category').value;
    const note = drawer.el.querySelector('#rc-note').value.trim();
    let valid = true;
    const catErr = drawer.el.querySelector('#err-rc-category');
    const noteErr = drawer.el.querySelector('#err-rc-note');
    if (!category) { catErr.textContent = 'Select a category.'; catErr.hidden = false; valid = false; } else catErr.hidden = true;
    if (note.length < 10 || note.length > 1000) { noteErr.textContent = 'Note must be 10–1000 characters.'; noteErr.hidden = false; valid = false; } else noteErr.hidden = true;
    if (!valid) return;
    const btn = drawer.el.querySelector('[data-act="save"]');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const updated = await api.setRootCause(errorId, { category, note });
      detailError.rootCause = updated.rootCause;
      toast('Root cause recorded.', 'success');
      closeDrawer();
      renderWorkflow();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });
}

async function loadIncidentHistory() {
  const body = appEl.querySelector('#incident-history-body');
  if (!body) return;
  try {
    incidentHistory = await api.getIncidentHistory();
    renderIncidentHistory();
  } catch (err) {
    body.innerHTML = errorState({ message: err.message });
    body.querySelector('[data-action="retry"]')?.addEventListener('click', loadIncidentHistory);
  }
}

function renderIncidentHistory() {
  const body = appEl.querySelector('#incident-history-body');
  if (!body) return;
  if (!incidentHistory.length) {
    body.innerHTML = emptyState({ message: 'No past incidents resolved or escalated yet.' });
    return;
  }
  body.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th scope="col">Time</th><th scope="col">Service</th><th scope="col">Severity</th><th scope="col">Code</th><th scope="col">Status</th></tr></thead>
        <tbody>
          ${incidentHistory.slice(0, 20).map((i) => `
            <tr>
              <td data-label="Time"><span title="${esc(fmtDateTime(i.time))}">${fmtRelative(i.time)}</span></td>
              <td data-label="Service">${esc(i.service)}</td>
              <td data-label="Severity">${severityChip(i.severity)}</td>
              <td data-label="Code"><span class="mono">${esc(i.code)}</span></td>
              <td data-label="Status">${statusChip(i.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
