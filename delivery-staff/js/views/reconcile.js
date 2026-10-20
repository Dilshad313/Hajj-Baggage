import * as api from '../api.js';
import {
  skeletonBlock, errorState, toast, esc, icon, fmtDateTime,
} from '../ui.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let runId = null;
let data = null; // { run, rows, unaccounted, canComplete }
let step = 'review'; // review | completed
let completedRun = null;

/**
 * @param {{id:string}} params
 * @param {HTMLElement} app
 * @returns {{destroy:()=>void}}
 */
export function render(params, app) {
  appEl = app;
  runId = params.id;
  step = 'review';
  completedRun = null;
  load();
  return { destroy };
}

/** Tears down the view. */
export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(8);
  try {
    data = await api.reconcile(runId);
    renderStep();
  } catch (err) {
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderStep() {
  if (step === 'review') renderReview();
  else renderCompleted();
}

const COLUMNS = ['Room', 'Pilgrim', 'Assigned', 'Delivered', 'Proxy', 'Returned', 'On trolley', 'Attempts', 'Status'];

function reconRowHtml(r) {
  const blocker = r.stillOnTrolley > 0;
  return `
    <tr>
      <td data-label="Room">${esc(r.room)}</td>
      <td data-label="Pilgrim">${esc(r.pilgrimName)}</td>
      <td data-label="Assigned">${r.assigned}</td>
      <td data-label="Delivered">${r.delivered}</td>
      <td data-label="Proxy">${r.proxy ? esc(r.proxy) : '—'}</td>
      <td data-label="Returned">${r.returned}</td>
      <td data-label="On trolley" ${blocker ? 'style="color:var(--danger);font-weight:var(--fw-semibold)"' : ''}>${r.stillOnTrolley}</td>
      <td data-label="Attempts">${r.attempts}</td>
      <td data-label="Status">${statusChip(r.status)}</td>
    </tr>`;
}

function reconTableHtml(rows) {
  return `
    <div class="table-wrap">
      <table class="data-table recon-table">
        <thead><tr>${COLUMNS.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(reconRowHtml).join('')}</tbody>
      </table>
    </div>`;
}

function blockerBannerHtml(blockerRows) {
  const bagCount = blockerRows.reduce((sum, r) => sum + r.stillOnTrolley, 0);
  return `
    <div class="state-block error-state" role="alert" style="text-align:start;align-items:flex-start">
      <p><strong>${bagCount} bag${bagCount === 1 ? '' : 's'} still unaccounted for.</strong> This run can't be completed until ${bagCount === 1 ? 'it is' : 'they are'} returned to hold:</p>
      <ul style="margin-block-start:var(--s2)">
        ${blockerRows.map((r) => `<li>${esc(r.room)} — ${r.stillOnTrolley} bag${r.stillOnTrolley === 1 ? '' : 's'}</li>`).join('')}
      </ul>
      <a class="btn btn-secondary" style="margin-block-start:var(--s3)" href="#/run/${esc(runId)}/return">${icon('corner-up-left', 16)} Finish returning bags</a>
    </div>`;
}

function renderReview() {
  const blockerRows = data.rows.filter((r) => r.stillOnTrolley > 0);
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <div class="page-header">
      <h1 class="page-title">Reconcile — ${esc(data.run.code)}</h1>
      ${statusChip(data.run.status)}
    </div>
    ${blockerRows.length ? blockerBannerHtml(blockerRows) : ''}
    ${reconTableHtml(data.rows)}
    <div class="card" style="margin-block:var(--s4)">
      <div class="field">
        <label for="recon-notes">Notes (optional)</label>
        <textarea id="recon-notes" placeholder="Any notes about this run…"></textarea>
      </div>
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" data-action="complete-run" ${data.canComplete ? '' : 'disabled'}>
      ${icon('check-circle', 18)} Complete run
    </button>
    ${!data.canComplete ? `<p class="fs-sm muted" style="margin-block-start:var(--s2)">Return all bags before completing the run.</p>` : ''}`;

  appEl.querySelector('[data-action="complete-run"]').addEventListener('click', completeRunFlow);
}

async function completeRunFlow() {
  const notes = appEl.querySelector('#recon-notes').value.trim();
  const btn = appEl.querySelector('[data-action="complete-run"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    completedRun = await api.completeRun(runId, notes || null);
    step = 'completed';
    renderStep();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

function renderCompleted() {
  const isExceptions = completedRun.status === 'Completed with exceptions';
  appEl.innerHTML = `
    <div class="card receipt-card">
      ${icon(isExceptions ? 'alert-triangle' : 'check-circle', 48)}
      <h1 class="fs-xl" style="margin-block:var(--s4) var(--s2)">Run ${esc(completedRun.status).toLowerCase()}</h1>
      ${statusChip(completedRun.status)}
      <p class="fs-sm text-2" style="margin-block:var(--s3)">${esc(data.run.code)} completed ${completedRun.completedAt ? `at ${esc(fmtDateTime(completedRun.completedAt))}` : ''}.</p>
      ${completedRun.notes ? `<p class="fs-sm muted">Notes: ${esc(completedRun.notes)}</p>` : ''}
      <div class="row gap-2 wrap" style="justify-content:center;margin-block-start:var(--s4)">
        <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 16)} Print report</button>
        <a class="btn btn-primary" href="#/">${icon('list-checks', 16)} Back to runs</a>
      </div>
    </div>
    <h2 class="section-title" style="margin-block-start:var(--s5)">Reconciliation report</h2>
    ${reconTableHtml(data.rows)}`;

  appEl.querySelector('[data-action="print"]').addEventListener('click', () => window.print());
}
