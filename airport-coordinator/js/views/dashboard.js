import * as api from '../api.js';
import {
  esc, icon, fmtDateTime, skeletonBlock, errorState,
} from '../ui.js';
import { getFocus } from '../store.js';
import { kpiTile } from '../components/kpi-tile.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  appEl = null;
}

function pageShell() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Departure and arrival at a glance.</p>
      </div>
    </div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell() + skeletonBlock(8);
  const focus = getFocus();
  try {
    if (focus === 'departure') {
      const data = await api.getDashboardDeparture();
      if (!appEl) return;
      appEl.innerHTML = pageShell() + departureSectionHtml(data);
    } else if (focus === 'arrival') {
      const data = await api.getDashboardArrival();
      if (!appEl) return;
      appEl.innerHTML = pageShell() + arrivalSectionHtml(data);
    } else {
      const [dep, arr] = await Promise.all([api.getDashboardDeparture(), api.getDashboardArrival()]);
      if (!appEl) return;
      appEl.innerHTML = `${pageShell()}
        <h2 class="section-title">Departure</h2>
        ${departureSectionHtml(dep)}
        <h2 class="section-title">Arrival</h2>
        ${arrivalSectionHtml(arr)}`;
    }
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function departureSectionHtml(d) {
  return `
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'En route', value: d.enRoute })}
      ${kpiTile({ label: 'At gate', value: d.atGate })}
      ${kpiTile({ label: 'Received today', value: d.receivedToday })}
      ${kpiTile({ label: 'Awaiting airline handover', value: d.awaitingHandover })}
      ${kpiTile({ label: 'Handed today', value: d.handedToday })}
      ${kpiTile({ label: 'Open exceptions', value: d.openExceptions })}
    </div>
    <div class="card" style="margin-block-end:var(--s6)">
      <div class="section-title">Flights closing</div>
      ${flightsClosingHtml(d.flightsClosing)}
    </div>`;
}

function flightsClosingHtml(list) {
  if (!list.length) return `<p class="fs-sm muted">No flights are currently closing.</p>`;
  return `<div class="stack gap-2">${list.map((f) => `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);padding:var(--s2) 0;border-bottom:1px solid var(--border)">
      <div><strong class="mono">${esc(f.flightCode)}</strong> <span class="fs-xs muted">&middot; ${f.bagCount} bag${f.bagCount === 1 ? '' : 's'}</span></div>
      ${statusChip(f.batchStatus)}
    </div>`).join('')}</div>`;
}

function arrivalSectionHtml(a) {
  return `
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Flights today', value: a.flightsToday })}
      ${kpiTile({ label: 'Bags expected', value: a.bagsExpected })}
      ${kpiTile({ label: 'Received', value: a.received })}
      ${kpiTile({ label: 'Security checked', value: a.securityChecked })}
      ${kpiTile({ label: 'Loaded', value: a.loaded })}
      ${kpiTile({ label: 'Missing/unidentified', value: a.missingUnidentified })}
    </div>
    <div class="card" style="margin-block-end:var(--s6)">
      <div class="section-title">Arrival flights</div>
      ${arrivalFlightsHtml(a.arrivalFlights)}
    </div>`;
}

function arrivalFlightsHtml(list) {
  if (!list.length) return `<p class="fs-sm muted">No arrival flights scheduled today.</p>`;
  return `<div class="stack gap-2">${list.map((f) => `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);padding:var(--s2) 0;border-bottom:1px solid var(--border)">
      <div><strong class="mono">${esc(f.code)}</strong> <span class="fs-xs muted">&middot; ETA ${esc(fmtDateTime(f.eta))}</span></div>
      <div class="row gap-2 wrap">
        ${statusChip(f.status)}
        <span class="fs-xs ${f.nusukSynced ? '' : 'muted'}" title="Nusuk synced">${icon(f.nusukSynced ? 'check' : 'x', 14)} Nusuk</span>
        <span class="fs-xs ${f.prepComplete ? '' : 'muted'}" title="Prep complete">${icon(f.prepComplete ? 'check' : 'x', 14)} Prep</span>
      </div>
    </div>`).join('')}</div>`;
}
