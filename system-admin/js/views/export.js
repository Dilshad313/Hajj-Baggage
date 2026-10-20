import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, toast, fmtDateTime, fmtRelative, esc, icon } from '../ui.js';
import { createDataTable } from '../components/data-table.js';

const ENTITIES = ['Pilgrims', 'Bags', 'ScanEvents', 'Exceptions', 'Trips', 'Manifests', 'Receipts', 'Users', 'AuditLog'];
const MAX_RANGE_DAYS = 366;

let appEl = null;
let exportsList = [];
let pending = false;

/**
 * Renders the data export view at #/export.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:Function}}
 */
export function render(params, app) {
  appEl = app;
  pending = false;
  renderPage();
  loadHistory();
  return { destroy };
}

/** Tears down the view. */
export function destroy() { appEl = null; }

function renderPage() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Data export</h1><p class="page-subtitle">Export entity data for offline analysis or backup.</p></div>
    </div>
    <div class="card" style="max-width:760px">
      <h2 class="section-title">New export</h2>
      <div class="field">
        <label>Entities <span class="req">*</span></label>
        <div class="export-check-list">
          ${ENTITIES.map((e) => `
            <label class="checkbox-row" for="ex-ent-${esc(e)}">
              <input type="checkbox" id="ex-ent-${esc(e)}" data-entity="${esc(e)}" />
              ${esc(e)}
            </label>`).join('')}
        </div>
        <div class="error" id="err-entities" hidden></div>
      </div>
      <div class="grid grid-cols-2">
        <div class="field">
          <label for="ex-from">From <span class="req">*</span></label>
          <input id="ex-from" type="date" />
        </div>
        <div class="field">
          <label for="ex-to">To <span class="req">*</span></label>
          <input id="ex-to" type="date" />
        </div>
      </div>
      <div class="error" id="err-range" hidden style="margin-block-end:var(--s4)"></div>
      <div class="field">
        <label>Format <span class="req">*</span></label>
        <div class="row gap-4">
          <label class="checkbox-row"><input type="radio" name="ex-format" value="CSV" checked /> CSV</label>
          <label class="checkbox-row"><input type="radio" name="ex-format" value="JSON" /> JSON</label>
        </div>
      </div>
      <div class="field">
        <label class="checkbox-row" for="ex-maskpii">
          <input id="ex-maskpii" type="checkbox" checked /> Mask PII
        </label>
        <div class="hint">When on, passport numbers and phone numbers are masked in the exported data.</div>
      </div>
      <button type="button" class="btn btn-primary" data-action="generate">
        ${icon('download', 16)}<span class="label">Generate export</span>
      </button>
    </div>

    <h2 class="section-title" style="margin-block-start:var(--s6)">Export history</h2>
    <div id="export-history">${skeletonBlock(4)}</div>`;

  appEl.addEventListener('click', onPageClick);
}

function onPageClick(e) {
  if (e.target.closest('[data-action="generate"]')) { generate(); return; }
  if (e.target.closest('[data-action="download"]')) { toast('This is a demo — no real file is generated.', 'info'); return; }
  if (e.target.closest('[data-action="retry"]')) loadHistory();
}

async function loadHistory() {
  const root = appEl?.querySelector('#export-history');
  if (!root) return;
  root.innerHTML = skeletonBlock(4);
  try {
    exportsList = await api.getExports();
    renderHistory();
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
  }
}

function renderHistory() {
  const root = appEl?.querySelector('#export-history');
  if (!root) return;
  if (!exportsList.length) {
    root.innerHTML = emptyState({ message: 'No exports have been generated yet.' });
    return;
  }
  createDataTable(root, {
    rows: exportsList,
    getRowId: (x) => x.id,
    csvFilename: 'export-history',
    emptyMessage: 'No exports have been generated yet.',
    columns: [
      { key: 'id', label: 'Export ID', sortable: true, render: (x) => `<span class="mono">${esc(x.id)}</span>` },
      { key: 'entities', label: 'Entities', render: (x) => esc(x.entities.length === ENTITIES.length ? 'All entities' : x.entities.join(', ')), csvValue: (x) => x.entities.join('; ') },
      { key: 'format', label: 'Format', sortable: true },
      { key: 'sizeKb', label: 'Size', sortable: true, render: (x) => `${x.sizeKb} KB` },
      { key: 'createdAt', label: 'Created', sortable: true, render: (x) => fmtDateTime(x.createdAt) },
      { key: 'expiresAt', label: 'Expires', sortable: true, render: (x) => `<span title="${esc(fmtDateTime(x.expiresAt))}">${fmtRelative(x.expiresAt)}</span>`, csvValue: (x) => x.expiresAt },
      { key: 'actions', label: 'Actions', render: (x) => `<button type="button" class="btn btn-secondary" data-action="download" data-id="${esc(x.id)}">${icon('download', 16)} Download</button>`, csvValue: () => '' },
    ],
  });
}

function setFieldError(id, message) {
  const el = appEl.querySelector(`#${id}`);
  if (!el) return;
  if (message) { el.textContent = message; el.hidden = false; } else el.hidden = true;
}

async function generate() {
  if (pending || !appEl) return;
  const entities = Array.from(appEl.querySelectorAll('[data-entity]')).filter((cb) => cb.checked).map((cb) => cb.dataset.entity);
  const from = appEl.querySelector('#ex-from').value;
  const to = appEl.querySelector('#ex-to').value;
  const format = appEl.querySelector('input[name="ex-format"]:checked').value;
  const maskPii = appEl.querySelector('#ex-maskpii').checked;

  let valid = true;
  if (!entities.length) { setFieldError('err-entities', 'Select at least one data entity.'); valid = false; } else setFieldError('err-entities', '');

  if (!from || !to) {
    setFieldError('err-range', 'Select both a "from" and "to" date.'); valid = false;
  } else {
    const diffDays = (new Date(to) - new Date(from)) / 86400000;
    if (diffDays < 0) { setFieldError('err-range', 'The "to" date must be on or after the "from" date.'); valid = false; }
    else if (diffDays > MAX_RANGE_DAYS) { setFieldError('err-range', `Date range must be ${MAX_RANGE_DAYS} days or fewer.`); valid = false; }
    else setFieldError('err-range', '');
  }
  if (!valid) return;

  const btn = appEl.querySelector('[data-action="generate"]');
  const label = btn.querySelector('.label');
  pending = true;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  label.textContent = 'Generating…';
  try {
    const exp = await api.generateExport({ entities, range: { from, to }, format, maskPii });
    exportsList = [exp, ...exportsList];
    renderHistory();
    toast('Export ready — expires in 24 h.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    pending = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    label.textContent = 'Generate export';
  }
}
