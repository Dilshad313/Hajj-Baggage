import * as api from '../api.js';
import { getDirection } from '../store.js';
import {
  skeletonBlock, errorState, emptyState, toast, confirmDialog, openModal, fmtDateTime, fmtNumber, esc, icon, toCsv, downloadBlob,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';
import { DISCREPANCY_OUTCOMES } from '../seed.js';
import { navigate } from '../router.js';

let appEl = null;
let flightId = null;
let initiated = false;
let flightsCache = null;

export function render(params, app) {
  appEl = app;
  flightId = params.flightId || null;
  initiated = false;
  load();
  // No background polling here: this is a deliberate workflow screen, and a
  // silent re-render would blow away the unaccounted-bags table's search/sort
  // state and any open discrepancy report. Direction-switch and manual
  // navigation already call `refresh`.
  return { destroy, refresh: load };
}

export function destroy() { appEl = null; }

function pageHeader() {
  return `<div class="page-header"><div><h1 class="page-title">Reconciliation</h1><p class="page-subtitle">Compare expected, received and delivered bag counts per flight.</p></div></div>`;
}

async function load() {
  if (!appEl) return;
  if (!flightId) { await renderPicker(); return; }
  appEl.innerHTML = pageHeader() + skeletonBlock(8);
  try {
    const data = await api.getReconciliation(flightId);
    renderFlight(data);
  } catch (err) {
    appEl.innerHTML = pageHeader() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function renderPicker() {
  appEl.innerHTML = pageHeader() + skeletonBlock(4);
  try {
    const direction = getDirection();
    const dash = await api.getDashboard(direction);
    flightsCache = dash.flights.filter((f) => !f.closed);
    if (!flightsCache.length) {
      appEl.innerHTML = pageHeader() + emptyState({ message: 'No open flights for this direction.' });
      return;
    }
    appEl.innerHTML = pageHeader() + `
      <div class="grid grid-auto">
        ${flightsCache.map((f) => `
          <button type="button" class="card card-tap" data-pick="${esc(f.id)}">
            <div class="row" style="justify-content:space-between">
              <strong>${esc(f.code)}</strong>${statusChip(f.risk)}
            </div>
            <p class="fs-sm muted" style="margin-block-start:var(--s2)">${esc(f.route)}</p>
            <p class="fs-sm" style="margin-block-start:var(--s2)">${f.checkpoints.c} / ${f.totalBags} ${esc(f.checkpointLabels[2].toLowerCase())}</p>
          </button>`).join('')}
      </div>`;
    appEl.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => navigate(`#/reconciliation/${btn.dataset.pick}`)));
  } catch (err) {
    appEl.innerHTML = pageHeader() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', renderPicker);
  }
}

function renderFlight(data) {
  const { flight, unaccounted, undocumentedCount, canApprove } = data;
  const diff = flight.totalBags - flight.checkpoints.c;
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
      <a class="btn btn-ghost" href="#/reconciliation">${icon('arrow-left', 16)} All flights</a>
      <span class="grow"></span>
      ${flight.status === 'Completed'
        ? `<a class="btn btn-primary" href="#/closure/${esc(flight.id)}">${icon('flag', 16)} Go to closure</a>`
        : `<button type="button" class="btn btn-primary" data-action="approve" ${canApprove ? '' : 'disabled'}>${icon('check-circle', 16)} Approve flight closure</button>`}
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
        <div><h2 class="section-title" style="margin:0">${esc(flight.code)}</h2><p class="fs-sm muted">${esc(flight.route)}</p></div>
        ${statusChip(flight.status)}
      </div>
    </div>

    <div class="grid grid-cols-3 recon-table" style="margin-block-end:var(--s5)">
      <div class="kpi-tile"><div class="kpi-label">${esc(flight.checkpointLabels[0])}</div><div class="kpi-value">${fmtNumber(flight.checkpoints.a)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">${esc(flight.checkpointLabels[1])}</div><div class="kpi-value">${fmtNumber(flight.checkpoints.b)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">${esc(flight.checkpointLabels[2])}</div><div class="kpi-value">${fmtNumber(flight.checkpoints.c)}</div></div>
    </div>
    <p class="fs-sm ${diff > 0 ? 'diff-nonzero' : 'text-2'}" style="margin-block-end:var(--s5)">
      ${diff > 0 ? `${fmtNumber(diff)} of ${fmtNumber(flight.totalBags)} bags not yet at "${esc(flight.checkpointLabels[2])}".` : `All ${fmtNumber(flight.totalBags)} bags accounted for.`}
    </p>

    ${!canApprove ? `<p class="fs-sm" style="color:var(--warning);margin-block-end:var(--s4)">${icon('alert-triangle', 16)} ${undocumentedCount} bag${undocumentedCount === 1 ? '' : 's'} unaccounted — document them first.</p>` : ''}

    ${!initiated && diff > 0 ? `
      <button type="button" class="btn btn-secondary" data-action="initiate">${icon('search', 16)} Initiate reconciliation</button>
    ` : diff > 0 ? `
      <div class="page-header" style="margin-block-end:var(--s3)">
        <h2 class="section-title" style="margin:0">Unaccounted bags</h2>
        <button type="button" class="btn btn-secondary" data-action="discrepancy-report">${icon('file-text', 16)} Generate discrepancy report</button>
      </div>
      <div id="unaccounted-table"></div>
    ` : ''}
    <div id="discrepancy-report-panel"></div>`;

  appEl.querySelector('[data-action="initiate"]')?.addEventListener('click', () => { initiated = true; renderFlight(data); });
  appEl.querySelector('[data-action="discrepancy-report"]')?.addEventListener('click', () => runDiscrepancyReport(flight));
  appEl.querySelector('[data-action="approve"]')?.addEventListener('click', () => approveClosureFlow(flight, canApprove, undocumentedCount));

  if (initiated && diff > 0) renderUnaccountedTable(flight, unaccounted);
}

function renderUnaccountedTable(flight, unaccounted) {
  const root = appEl.querySelector('#unaccounted-table');
  if (!root) return;
  const isArrival = flight.direction === 'arrival';
  createDataTable(root, {
    rows: unaccounted,
    searchKeys: ['tagNumber', 'pilgrimName'],
    getRowId: (b) => b.id,
    csvFilename: `discrepancies-${flight.code}`,
    emptyMessage: 'No unaccounted bags.',
    columns: [
      { key: 'tagNumber', label: 'Tag', sortable: true, render: (b) => `<span class="mono">${esc(b.tagNumber)}</span>` },
      { key: 'pilgrimName', label: 'Pilgrim', sortable: true },
      { key: 'currentStage', label: 'Current stage', sortable: true },
      { key: 'stuckHours', label: 'Stuck (h)', sortable: true },
      {
        key: 'discrepancy', label: isArrival ? 'Outcome' : 'Status',
        render: (b) => b.discrepancy ? `${esc(b.discrepancy.outcome)} ${b.discrepancy.documented ? statusChip('Documented') : statusChip('Undocumented')}` : (isArrival ? statusChip('Undocumented') : '—'),
        csvValue: (b) => b.discrepancy ? `${b.discrepancy.outcome} (${b.discrepancy.documented ? 'documented' : 'undocumented'})` : '',
      },
      ...(isArrival ? [{
        key: 'actions', label: 'Actions', csvValue: () => '',
        render: (b) => `
          <div class="row gap-1" data-stop-row-click>
            ${!b.discrepancy ? `<button type="button" class="btn btn-secondary" data-act="resolve" data-id="${esc(b.id)}">Resolve</button>` : ''}
            ${b.discrepancy && !b.discrepancy.documented ? `<button type="button" class="btn btn-primary" data-act="document" data-id="${esc(b.id)}">Document</button>` : ''}
          </div>`,
      }] : []),
    ],
  });
  root.addEventListener('click', (e) => {
    const zone = e.target.closest('[data-stop-row-click]');
    if (!zone) return;
    e.stopPropagation();
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'resolve') openResolveModal(flight.id, btn.dataset.id);
    if (btn.dataset.act === 'document') documentFlow(flight.id, btn.dataset.id);
  });
}

function openResolveModal(flightIdArg, bagId) {
  const close = openModal({
    title: 'Resolve discrepancy',
    bodyHtml: `
      <div class="field">
        <label for="rd-outcome">Outcome <span class="req">*</span></label>
        <select id="rd-outcome">${DISCREPANCY_OUTCOMES.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label for="rd-notes">Notes <span class="req">*</span></label>
        <textarea id="rd-notes" placeholder="Describe what happened to this bag"></textarea>
        <div class="error" id="err-rd-notes" hidden></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-act="confirm">Save</button>
      </div>`,
    onMount: (overlay) => {
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
      overlay.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
        const outcome = overlay.querySelector('#rd-outcome').value;
        const notes = overlay.querySelector('#rd-notes').value.trim();
        const errEl = overlay.querySelector('#err-rd-notes');
        if (!notes) { errEl.textContent = 'Notes are required.'; errEl.hidden = false; return; }
        errEl.hidden = true;
        const btn = overlay.querySelector('[data-act="confirm"]');
        btn.disabled = true; btn.setAttribute('aria-busy', 'true');
        try {
          await api.resolveDiscrepancy(flightIdArg, bagId, { outcome, notes });
          toast('Discrepancy resolved.', 'success');
          close();
          load();
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false; btn.removeAttribute('aria-busy');
        }
      });
    },
  });
}

async function documentFlow(flightIdArg, bagId) {
  try {
    await api.documentResolution(flightIdArg, bagId);
    toast('Resolution documented.', 'success');
    load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function runDiscrepancyReport(flight) {
  const panel = appEl.querySelector('#discrepancy-report-panel');
  panel.innerHTML = skeletonBlock(4);
  try {
    const report = await api.discrepancyReport(flight.id);
    panel.innerHTML = `
      <h2 class="section-title" style="margin-block-start:var(--s5)">Discrepancy report — ${esc(report.flightCode)}</h2>
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Generated ${esc(fmtDateTime(report.generatedAt))} · ${report.rows.length} bag${report.rows.length === 1 ? '' : 's'}</p>
      <div class="row gap-2" style="margin-block-end:var(--s3)">
        <button type="button" class="btn btn-secondary" data-action="print-report">${icon('printer', 16)} Print</button>
        <button type="button" class="btn btn-secondary" data-action="csv-report">${icon('download', 16)} Export CSV</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th scope="col">Tag</th><th scope="col">Pilgrim</th><th scope="col">Current stage</th><th scope="col">Stuck (h)</th><th scope="col">Outcome</th><th scope="col">Documented</th></tr></thead>
          <tbody>${report.rows.map((r) => `
            <tr>
              <td data-label="Tag"><span class="mono">${esc(r.tagNumber)}</span></td>
              <td data-label="Pilgrim">${esc(r.pilgrimName)}</td>
              <td data-label="Current stage">${esc(r.currentStage)}</td>
              <td data-label="Stuck (h)">${esc(r.stuckHours)}</td>
              <td data-label="Outcome">${esc(r.outcome || '—')}</td>
              <td data-label="Documented">${r.documented ? 'Yes' : 'No'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
    panel.querySelector('[data-action="print-report"]').addEventListener('click', () => window.print());
    panel.querySelector('[data-action="csv-report"]').addEventListener('click', () => {
      const csv = toCsv(report.rows, ['tagNumber', 'pilgrimName', 'currentStage', 'stuckHours', 'outcome', 'documented']);
      downloadBlob(`discrepancy-report-${flight.code.replace(/\s/g, '')}.csv`, csv, 'text/csv');
    });
  } catch (err) {
    panel.innerHTML = errorState({ message: err.message });
  }
}

async function approveClosureFlow(flight, canApprove, undocumentedCount) {
  if (!canApprove) {
    toast(`${undocumentedCount} bag${undocumentedCount === 1 ? '' : 's'} unaccounted — document them first.`, 'error');
    return;
  }
  const ok = await confirmDialog({
    title: 'Approve flight closure?',
    body: `${fmtNumber(flight.checkpoints.c)} of ${fmtNumber(flight.totalBags)} bags accounted for on ${flight.code}. This marks the flight Completed and ready for final closure.`,
    confirmLabel: 'Approve closure',
  });
  if (!ok) return;
  try {
    await api.approveClosure(flight.id);
    toast(`${flight.code} closure approved.`, 'success');
    load();
  } catch (err) {
    toast(err.message, 'error');
  }
}
