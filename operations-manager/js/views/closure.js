import * as api from '../api.js';
import { getDirection } from '../store.js';
import {
  skeletonBlock, errorState, emptyState, toast, confirmDialog, fmtDateTime, fmtNumber, esc, icon,
} from '../ui.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let flightId = null;

/**
 * Renders the Closure view: a picker of flights ready for final closure (plus
 * a closed-flights archive) when no flightId is given, or the per-flight
 * closure checklist when one is.
 * @param {{flightId?:string}} params
 * @param {HTMLElement} app
 * @returns {{destroy:Function, refresh:Function}}
 */
export function render(params, app) {
  appEl = app;
  flightId = params.flightId || null;
  load();
  // No background polling here: closing a flight is a deliberate, one-shot
  // action, and a silent re-render could disrupt the user mid-confirmation
  // (same reasoning as reconciliation.js). Direction-switch and manual
  // navigation already call `refresh`.
  return { destroy, refresh: load };
}

export function destroy() { appEl = null; }

function pageHeader() {
  return `<div class="page-header"><div><h1 class="page-title">Closure</h1><p class="page-subtitle">Final checklist and closure for flights approved in Reconciliation.</p></div></div>`;
}

async function load() {
  if (!appEl) return;
  if (!flightId) { renderPicker(); return; }
  appEl.innerHTML = pageHeader() + skeletonBlock(6);
  try {
    const data = await api.closureChecklist(flightId);
    renderChecklist(data);
  } catch (err) {
    appEl.innerHTML = pageHeader() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderPicker() {
  appEl.innerHTML = `
    ${pageHeader()}
    <div id="closure-picker">${skeletonBlock(4)}</div>
    <h2 class="section-title" style="margin-block-start:var(--s6)">Closed flights archive</h2>
    <div id="closure-archive">${skeletonBlock(4)}</div>`;
  loadPickerSection();
  loadArchiveSection();
}

async function loadPickerSection() {
  const root = appEl?.querySelector('#closure-picker');
  if (!root) return;
  try {
    const direction = getDirection();
    const dash = await api.getDashboard(direction);
    const flights = dash.flights.filter((f) => f.status === 'Completed');
    if (!flights.length) {
      root.innerHTML = emptyState({
        message: "No flights are ready for final closure yet — approve a flight's reconciliation first.",
        actionLabel: 'Go to Reconciliation',
        actionAttr: 'data-action="goto-reconciliation"',
      });
      root.querySelector('[data-action="goto-reconciliation"]')?.addEventListener('click', () => navigate('#/reconciliation'));
      return;
    }
    root.innerHTML = `
      <div class="grid grid-auto">
        ${flights.map((f) => `
          <button type="button" class="card card-tap" data-pick="${esc(f.id)}">
            <div class="row" style="justify-content:space-between">
              <strong>${esc(f.code)}</strong>${statusChip(f.status)}
            </div>
            <p class="fs-sm muted" style="margin-block-start:var(--s2)">${esc(f.route)}</p>
            <p class="fs-sm" style="margin-block-start:var(--s2)">${fmtNumber(f.checkpoints.c)} / ${fmtNumber(f.totalBags)} ${esc(f.checkpointLabels[2].toLowerCase())}</p>
          </button>`).join('')}
      </div>`;
    root.querySelectorAll('[data-pick]').forEach((btn) => btn.addEventListener('click', () => navigate(`#/closure/${btn.dataset.pick}`)));
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', loadPickerSection);
  }
}

async function loadArchiveSection() {
  const root = appEl?.querySelector('#closure-archive');
  if (!root) return;
  try {
    const flights = await api.getClosedFlights();
    if (!flights.length) {
      root.innerHTML = emptyState({ message: 'No flights have been closed yet.' });
      return;
    }
    root.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th scope="col">Flight</th><th scope="col">Direction</th><th scope="col">Route</th><th scope="col">Bags</th><th scope="col">Closed</th></tr></thead>
          <tbody>${flights.map((f) => `
            <tr>
              <td data-label="Flight"><span class="mono">${esc(f.code)}</span></td>
              <td data-label="Direction">${esc(f.direction)}</td>
              <td data-label="Route">${esc(f.route)}</td>
              <td data-label="Bags">${fmtNumber(f.checkpoints.c)} / ${fmtNumber(f.totalBags)} ${esc(f.checkpointLabels[2].toLowerCase())}</td>
              <td data-label="Closed">${esc(fmtDateTime(f.closedAt))}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', loadArchiveSection);
  }
}

function checklistItem(label, done, extraHtml = '') {
  return `
    <div class="checklist-item ${done ? 'done' : 'pending'}">
      <span class="checklist-icon">${icon(done ? 'check-circle' : 'clock', 20)}</span>
      <div style="flex:1">
        <div>${esc(label)}</div>
        ${extraHtml}
      </div>
    </div>`;
}

function renderChecklist(data) {
  const { flight, allBagsAccounted, investigateList, finalReportGenerated, kpisUpdated, auditLogEntry, archivedForArrival } = data;
  const isArrival = flight.direction === 'arrival';
  const needsApproval = flight.status !== 'Completed' && !flight.closed;
  const canClose = flight.status === 'Completed' && !flight.closed && allBagsAccounted;

  const items = [
    checklistItem('All bags accounted', allBagsAccounted, allBagsAccounted ? '' : `
      <p class="fs-sm muted" style="margin-block-start:4px">
        ${fmtNumber(investigateList.length)} bag${investigateList.length === 1 ? '' : 's'} still unaccounted —
        <a href="#/reconciliation/${esc(flight.id)}">resolve in Reconciliation</a>
      </p>`),
    checklistItem('Final report generated', finalReportGenerated),
    checklistItem('KPIs updated', kpisUpdated),
    checklistItem('Audit log entry', auditLogEntry),
  ];
  if (isArrival) items.push(checklistItem('Archived for arrival', !!archivedForArrival));

  appEl.innerHTML = `
    ${pageHeader()}
    <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
      <a class="btn btn-ghost" href="#/closure">${icon('arrow-left', 16)} All flights</a>
      <span class="grow"></span>
      ${needsApproval ? `<a class="btn btn-secondary" href="#/reconciliation/${esc(flight.id)}">${icon('git-compare', 16)} Go to reconciliation</a>` : ''}
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
        <div><h2 class="section-title" style="margin:0">${esc(flight.code)}</h2><p class="fs-sm muted">${esc(flight.route)}</p></div>
        ${statusChip(flight.closed ? 'Closed' : flight.status)}
      </div>
    </div>

    ${needsApproval ? `<p class="fs-sm" style="color:var(--warning);margin-block-end:var(--s4)">${icon('alert-triangle', 16)} Approve flight closure in Reconciliation before closing.</p>` : ''}
    ${flight.closed ? `<p class="fs-sm" style="color:var(--success);margin-block-end:var(--s4)">${icon('check-circle', 16)} Closed ${esc(fmtDateTime(flight.closedAt))}.</p>` : ''}

    <div style="margin-block-end:var(--s5)">${items.join('')}</div>

    ${!flight.closed ? `
      <button type="button" class="btn btn-primary btn-lg" data-action="close-flight" ${canClose ? '' : 'disabled'}>${icon('flag', 16)} Close flight</button>
      ${!canClose ? `<p class="fs-sm muted" style="margin-block-start:var(--s2)">${needsApproval ? 'Approve flight closure in Reconciliation before closing.' : 'Resolve all discrepancies in Reconciliation first.'}</p>` : ''}
    ` : `<a class="btn btn-secondary" href="#/closure">${icon('archive', 16)} Back to archive</a>`}
  `;

  appEl.querySelector('[data-action="close-flight"]')?.addEventListener('click', () => closeFlightFlow(flight));
}

async function closeFlightFlow(flight) {
  const confirmed = await confirmDialog({
    title: 'Close flight?',
    body: `${fmtNumber(flight.checkpoints.c)} of ${fmtNumber(flight.totalBags)} bags ${flight.checkpointLabels[2].toLowerCase()} on ${flight.code}. Closing finalizes the flight and cannot be undone.`,
    confirmLabel: 'Close flight',
  });
  if (!confirmed) return;
  try {
    await api.closeFlight(flight.id);
    toast(`${flight.code} closed.`, 'success');
    load();
  } catch (err) {
    toast(err.message, 'error');
  }
}
