import * as api from '../api.js';
import {
  skeletonBlock, errorState, esc, icon, toast, openModal, fmtDateTime, toCsv, downloadBlob,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { statusChip } from '../components/status-chip.js';

const CSV_COLUMNS = ['run', 'hotel', 'building', 'status', 'bags'];

let appEl = null;
let me = null;
let summaryData = null;

/**
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:()=>void}}
 */
export function render(params, app) {
  appEl = app;
  me = null;
  summaryData = null;
  load();
  return { destroy };
}

/** Releases this view's reference to its mount point. */
export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    me = await api.getMe();
    renderPage();
  } catch (err) {
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderPage() {
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Profile</h1></div>
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <div class="row gap-3">
        <div class="pilgrim-avatar">${icon('user-circle', 28)}</div>
        <div>
          <strong class="fs-md">${esc(me.name)}</strong>
          <div class="fs-sm muted mono">${esc(me.employeeId)}</div>
          <div class="fs-sm muted">${esc(me.hotel)}</div>
        </div>
      </div>
    </div>

    <h2 class="section-title">Delivery summary</h2>
    <div class="card" id="summary-card" style="margin-block-end:var(--s5)">
      <div class="row gap-2 wrap">
        <button type="button" class="btn btn-primary" data-action="generate-summary">${icon('bar-chart-2', 16)} Generate</button>
        <button type="button" class="btn btn-secondary" data-action="print-summary" hidden>${icon('printer', 16)} Print</button>
        <button type="button" class="btn btn-secondary" data-action="export-csv" hidden>${icon('download', 16)} Export CSV</button>
      </div>
      <div id="summary-body" style="margin-block-start:var(--s4)"></div>
    </div>

    <h2 class="section-title">End shift</h2>
    <div class="card" id="end-shift-card">
      <p class="fs-sm text-2" style="margin-block-end:var(--s3)">Ending your shift checks that every run is closed out, every bag is accounted for, and every trolley has been returned.</p>
      <div id="end-shift-error"></div>
      <button type="button" class="btn btn-danger" data-action="end-shift">${icon('log-out', 16)} End shift</button>
    </div>`;

  appEl.querySelector('[data-action="generate-summary"]').addEventListener('click', generateSummaryFlow);
  appEl.querySelector('[data-action="print-summary"]').addEventListener('click', () => window.print());
  appEl.querySelector('[data-action="export-csv"]').addEventListener('click', exportCsvFlow);
  appEl.querySelector('[data-action="end-shift"]').addEventListener('click', endShiftFlow);
}

async function generateSummaryFlow() {
  const btn = appEl.querySelector('[data-action="generate-summary"]');
  const body = appEl.querySelector('#summary-body');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  body.innerHTML = skeletonBlock(3);
  try {
    summaryData = await api.summary();
    renderSummary();
  } catch (err) {
    body.innerHTML = errorState({ message: err.message, retryAttr: 'data-action="retry-summary"' });
    body.querySelector('[data-action="retry-summary"]')?.addEventListener('click', generateSummaryFlow);
  } finally {
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

function renderSummary() {
  const body = appEl.querySelector('#summary-body');
  const s = summaryData;
  body.innerHTML = `
    <p class="fs-xs muted" style="margin-block-end:var(--s3)">Generated ${esc(fmtDateTime(s.generatedAt))}</p>
    <div class="grid grid-auto gap-3" style="margin-block-end:var(--s4)">
      ${kpiTile({ label: 'Runs completed', value: s.runsCompleted })}
      ${kpiTile({ label: 'Bags delivered', value: s.bagsDelivered })}
      ${kpiTile({ label: 'Bags returned', value: s.bagsReturned })}
      ${kpiTile({ label: 'Exceptions', value: s.exceptions })}
    </div>
    ${s.rows.length ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th scope="col">Run</th><th scope="col">Hotel</th><th scope="col">Building</th><th scope="col">Status</th><th scope="col">Bags</th></tr></thead>
          <tbody>
            ${s.rows.map((r) => `
              <tr>
                <td data-label="Run">${esc(r.run)}</td>
                <td data-label="Hotel">${esc(r.hotel)}</td>
                <td data-label="Building">${esc(r.building)}</td>
                <td data-label="Status">${statusChip(r.status)}</td>
                <td data-label="Bags">${esc(r.bags)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<p class="fs-sm muted">No runs to show.</p>`}`;

  appEl.querySelector('[data-action="print-summary"]').hidden = false;
  appEl.querySelector('[data-action="export-csv"]').hidden = false;
}

function exportCsvFlow() {
  if (!summaryData) return;
  const csv = toCsv(summaryData.rows, CSV_COLUMNS);
  downloadBlob('delivery-summary.csv', csv, 'text/csv');
}

function splitBlockers(message) {
  return message.split('. ').map((s) => s.trim()).filter(Boolean).map((s) => (s.endsWith('.') ? s : `${s}.`));
}

function renderEndShiftError(message) {
  const errRoot = appEl.querySelector('#end-shift-error');
  const blockers = splitBlockers(message);
  const body = blockers.length > 1
    ? `<ul style="margin:0;padding-inline-start:var(--s5)">${blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
    : `<p style="margin:0">${esc(message)}</p>`;
  errRoot.innerHTML = `
    <div class="field error" role="alert" style="background:var(--danger-soft);padding:var(--s3);border-radius:var(--r-sm);margin-block-end:var(--s3)">
      <strong class="fs-sm" style="display:block;margin-block-end:var(--s1)">Can't end shift yet</strong>
      ${body}
    </div>`;
}

async function endShiftFlow() {
  const btn = appEl.querySelector('[data-action="end-shift"]');
  const errRoot = appEl.querySelector('#end-shift-error');
  errRoot.innerHTML = '';
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.endShift();
    btn.disabled = false; btn.removeAttribute('aria-busy');
    await new Promise((resolve) => {
      const close = openModal({
        title: 'Shift ended',
        bodyHtml: `
          <p class="fs-sm text-2">No blockers were found. You'll be signed out now.</p>
          <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="continue">Continue</button></div>`,
        onDismiss: resolve,
        onMount: (overlay) => overlay.querySelector('[data-act="continue"]').addEventListener('click', () => { close(); resolve(); }),
      });
    });
    api.logout();
    window.location.href = '../index.html';
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    renderEndShiftError(err.message);
    toast(err.message, 'error');
  }
}
