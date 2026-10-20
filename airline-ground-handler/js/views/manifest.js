import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, fmtWeight, skeletonBlock, emptyState, errorState, confirmDialog,
} from '../ui.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let flights = null;
let flightCode = null;
let flight = null;
let manifest = null;
let loadError = '';
let genError = '';
let generating = false;
let confirming = false;
let closing = false;
let departing = false;
let confirmedThisSession = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  flights = null;
  flightCode = null;
  flight = null;
  manifest = null;
  loadError = '';
  genError = '';
  generating = false;
  confirming = false;
  closing = false;
  departing = false;
  confirmedThisSession = false;
  init();
  return { destroy, refresh: () => loadManifestContent(), activeFlightCode: () => flightCode };
}

export function destroy() {
  appEl = null;
}

async function init() {
  if (!appEl) return;
  renderInitialSkeleton();
  try {
    flights = await api.getFlights();
    if (!appEl) return;
    flightCode = flights[0]?.code || null;
    loadError = '';
    renderShell();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderShell();
  }
}

function pageHeader() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Flight manifest</h1>
        <p class="page-subtitle">Generate and reconcile the final load manifest, then confirm, close and depart.</p>
      </div>
    </div>`;
}

function renderInitialSkeleton() {
  appEl.innerHTML = pageHeader() + skeletonBlock(8);
}

function renderShell() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = pageHeader() + errorState({ message: loadError });
    appEl.querySelector('[data-action="retry"]').addEventListener('click', init);
    return;
  }
  if (!flights.length) {
    appEl.innerHTML = pageHeader() + emptyState({ message: 'No flights to manifest.' });
    return;
  }
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="field" style="max-width:340px;margin-block-end:var(--s4)">
      <label for="flight-select">Flight</label>
      <select id="flight-select">
        ${flights.map((f) => `<option value="${esc(f.code)}" ${f.code === flightCode ? 'selected' : ''}>${esc(f.code)} &rarr; ${esc(f.destination)}</option>`).join('')}
      </select>
    </div>
    <div id="manifest-toolbar" style="margin-block-end:var(--s5)"></div>
    <div id="manifest-content"></div>`;

  appEl.querySelector('#flight-select').addEventListener('change', (e) => {
    flightCode = e.target.value;
    confirmedThisSession = false;
    loadManifestContent();
  });
  loadManifestContent();
}

async function loadManifestContent() {
  if (!appEl || !flightCode) return;
  const content = appEl.querySelector('#manifest-content');
  const toolbar = appEl.querySelector('#manifest-toolbar');
  if (!content || !toolbar) return;
  content.innerHTML = skeletonBlock(8);
  generating = true;
  renderToolbar(toolbar);
  try {
    const [m, freshFlights] = await Promise.all([api.generateManifest(flightCode), api.getFlights()]);
    if (!appEl) return;
    manifest = m;
    flights = freshFlights;
    flight = flights.find((f) => f.code === flightCode) || null;
    genError = '';
  } catch (err) {
    if (!appEl) return;
    genError = err.message;
    manifest = null;
  } finally {
    generating = false;
  }
  renderToolbar(toolbar);
  renderContent(content);
}

function renderToolbar(toolbar) {
  if (!toolbar) return;
  const status = flight?.status;
  const showConfirm = status === 'Open' && !confirmedThisSession;
  const showClose = status === 'Open' && confirmedThisSession;
  const showDepart = status === 'Closed';
  const canConfirm = !!manifest?.complete;

  toolbar.innerHTML = `
    <div class="row gap-3 wrap" style="justify-content:space-between">
      <div class="row gap-2" style="align-items:center">
        ${flight ? statusChip(flight.status) : ''}
      </div>
      <div class="row gap-2 wrap">
        <button type="button" class="btn btn-secondary" data-action="generate" ${generating ? 'disabled aria-busy="true"' : ''}>
          ${generating ? '<span class="spinner"></span> Generating…' : `${icon('refresh-cw', 16)} Generate / refresh`}
        </button>
        <button type="button" class="btn btn-secondary" data-action="print">${icon('printer', 16)} Print</button>
        ${showConfirm ? `
          <button type="button" class="btn btn-primary" data-action="confirm-loaded" ${canConfirm && !confirming ? '' : 'disabled aria-disabled="true"'} ${confirming ? 'aria-busy="true"' : ''} title="${canConfirm ? '' : 'Not all accepted bags are loaded yet.'}">
            ${confirming ? '<span class="spinner"></span> Confirming…' : `${icon('check-circle', 16)} Confirm baggage loaded`}
          </button>` : ''}
        ${showClose ? `
          <button type="button" class="btn btn-primary" data-action="close-baggage" ${closing ? 'disabled aria-busy="true"' : ''}>
            ${closing ? '<span class="spinner"></span> Closing…' : `${icon('lock', 16)} Close baggage for flight`}
          </button>` : ''}
        ${showDepart ? `
          <button type="button" class="btn btn-primary" data-action="mark-departed" ${departing ? 'disabled aria-busy="true"' : ''}>
            ${departing ? '<span class="spinner"></span> Departing…' : `${icon('plane', 16)} Mark flight departed`}
          </button>` : ''}
      </div>
    </div>`;

  toolbar.querySelector('[data-action="generate"]')?.addEventListener('click', () => { if (!generating) loadManifestContent(); });
  toolbar.querySelector('[data-action="print"]')?.addEventListener('click', () => window.print());
  toolbar.querySelector('[data-action="confirm-loaded"]')?.addEventListener('click', onConfirmLoaded);
  toolbar.querySelector('[data-action="close-baggage"]')?.addEventListener('click', onCloseBaggage);
  toolbar.querySelector('[data-action="mark-departed"]')?.addEventListener('click', onMarkDeparted);
}

async function onConfirmLoaded() {
  if (confirming || !manifest?.complete) return;
  const proceed = await confirmDialog({
    title: 'Confirm baggage loaded',
    body: `This confirms ${manifest.totals.totalBags} bags, ${fmtWeight(manifest.totals.totalWeight)}, are loaded on ${flightCode}.`,
    confirmLabel: 'Confirm loaded',
  });
  if (!proceed) return;
  confirming = true;
  renderToolbar(appEl?.querySelector('#manifest-toolbar'));
  try {
    const result = await api.confirmLoaded(flightCode);
    confirmedThisSession = true;
    toast(result.message, 'success');
    await loadManifestContent();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    confirming = false;
    renderToolbar(appEl?.querySelector('#manifest-toolbar'));
  }
}

async function onCloseBaggage() {
  if (closing) return;
  closing = true;
  renderToolbar(appEl?.querySelector('#manifest-toolbar'));
  try {
    await api.closeBaggage(flightCode);
    toast('Baggage closed for this flight.', 'success');
    await loadManifestContent();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    closing = false;
    renderToolbar(appEl?.querySelector('#manifest-toolbar'));
  }
}

async function onMarkDeparted() {
  if (departing) return;
  departing = true;
  renderToolbar(appEl?.querySelector('#manifest-toolbar'));
  try {
    await api.markDeparted(flightCode);
    toast(`${flightCode} marked departed.`, 'success');
    await loadManifestContent();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    departing = false;
    renderToolbar(appEl?.querySelector('#manifest-toolbar'));
  }
}

function renderContent(content) {
  if (!content) return;
  if (genError) {
    content.innerHTML = errorState({ message: genError });
    content.querySelector('[data-action="retry"]').addEventListener('click', loadManifestContent);
    return;
  }
  if (!manifest) return;
  content.innerHTML = `
    <p class="fs-sm muted" style="margin-block-end:var(--s4)">Generated at ${esc(fmtDateTime(manifest.generatedAt))}</p>

    <div class="table-wrap" style="margin-block-end:var(--s6)">
      <table class="data-table">
        <thead>
          <tr><th>ULD</th><th>Position</th><th>Bags</th><th>Weight</th></tr>
        </thead>
        <tbody>
          ${manifest.uldRows.length ? manifest.uldRows.map((r) => `
            <tr>
              <td data-label="ULD"><span class="mono">${esc(r.uldCode)}</span></td>
              <td data-label="Position">${esc(r.position)}</td>
              <td data-label="Bags">${esc(r.bagCount)}</td>
              <td data-label="Weight">${esc(fmtWeight(r.weightKg))}</td>
            </tr>`).join('') : `
            <tr><td colspan="4" class="fs-sm muted">No ULDs have been loaded for this flight yet.</td></tr>`}
        </tbody>
        <tfoot>
          <tr>
            <td data-label="Total"><strong>Total</strong></td>
            <td data-label=""></td>
            <td data-label="Total bags"><strong>${esc(manifest.totals.totalBags)}</strong></td>
            <td data-label="Total weight"><strong>${esc(fmtWeight(manifest.totals.totalWeight))}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>

    ${manifest.offloaded.length ? `
      <div class="card" style="margin-block-end:var(--s6)">
        <div class="section-title">Offloaded</div>
        <div class="stack gap-2">
          ${manifest.offloaded.map((u) => `
            <div class="row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
              <strong class="fs-sm mono">${esc(u.code)}</strong>
              <span class="fs-xs muted">${esc(u.bagIds.length)} bag${u.bagIds.length === 1 ? '' : 's'}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

    ${manifest.notLoaded.length ? `
      <div class="diff-row mismatch" style="margin-block-end:var(--s6)">
        <div class="section-title" style="color:var(--danger)">${icon('alert-triangle', 16)} Not loaded</div>
        <div class="stack gap-1">
          ${manifest.notLoaded.map((b) => `
            <div class="row" style="justify-content:space-between;padding:4px 0">
              <span class="fs-sm mono">${esc(b.tagNumber)}</span>
              <span class="fs-sm">${esc(b.pilgrimName)}</span>
            </div>`).join('')}
        </div>
      </div>` : `
      <p class="fs-sm row gap-2" style="color:var(--success);margin-block-end:var(--s6)">${icon('check-circle', 16)} All accepted bags are loaded.</p>`}

    ${manifest.bsmNotLoaded.length ? `
      <div class="card">
        <div class="section-title">Active BSMs without a loaded bag</div>
        <div class="stack gap-1">
          ${manifest.bsmNotLoaded.map((m) => `
            <div class="row" style="justify-content:space-between;padding:4px 0">
              <span class="fs-sm mono">${esc(m.airlineTag)}</span>
              <span class="fs-sm">${esc(m.passengerName)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}`;
}
