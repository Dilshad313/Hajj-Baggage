import * as api from '../api.js';
import {
  esc, fmtCountdown, countdownClass, skeletonBlock, errorState,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { countdownChip } from '../components/status-chip.js';

let appEl = null;
let data = null;
let errorMessage = '';
let step = 'loading'; // loading | error | ready

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  data = null;
  errorMessage = '';
  step = 'loading';
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  step = 'loading';
  renderPage();
  try {
    data = await api.getDashboard();
    if (!appEl) return;
    step = 'ready';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    errorMessage = err.message;
    step = 'error';
    renderPage();
  }
}

function pageHeader() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Rabel Central Warehouse — Makkah</p>
      </div>
      <div class="row gap-2 wrap">
        <a class="btn btn-secondary" href="#/gate">Go to gate</a>
        <a class="btn btn-secondary" href="#/screening">Screening queue</a>
        <a class="btn btn-secondary" href="#/outbound">Outbound</a>
      </div>
    </div>`;
}

function renderPage() {
  if (!appEl) return;
  if (step === 'loading') {
    appEl.innerHTML = `${pageHeader()}${skeletonBlock(6)}`;
    return;
  }
  if (step === 'error') {
    appEl.innerHTML = `${pageHeader()}${errorState({ message: errorMessage })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  renderReady();
}

function flightsAtRiskHtml() {
  const flights = data.flightsAtRisk || [];
  if (!flights.length) return `<p class="muted fs-sm">No flights currently at risk.</p>`;
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th scope="col">Flight</th><th scope="col">Destination</th><th scope="col">Dispatch cut-off</th></tr></thead>
        <tbody>
          ${flights.map((f) => `
            <tr>
              <td class="mono">${esc(f.code)}</td>
              <td>${esc(f.destination)}</td>
              <td>${countdownChip(fmtCountdown(f.dispatchDeadline), countdownClass(f.dispatchDeadline))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderReady() {
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="grid grid-cols-4" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Inbound en route', value: data.inboundEnRoute })}
      ${kpiTile({ label: 'At gate / unloading', value: data.atGateUnloading })}
      ${kpiTile({ label: 'Awaiting screening', value: data.awaitingScreening })}
      ${kpiTile({ label: 'Awaiting storage', value: data.awaitingStorage })}
      ${kpiTile({ label: 'Stored', value: data.stored })}
      ${kpiTile({ label: 'Loaded outbound today', value: data.loadedOutboundToday })}
      ${kpiTile({ label: 'Open exceptions', value: data.openExceptions })}
      ${kpiTile({ label: 'Zone occupancy', value: `${data.zoneOccupancyPct}%` })}
    </div>
    <div class="grid grid-cols-2">
      <div class="card">
        <h2 class="section-title">Flights at risk</h2>
        ${flightsAtRiskHtml()}
      </div>
      <div class="card">
        <h2 class="section-title">Zone occupancy</h2>
        <p class="fs-2xl fw-bold" style="margin-block-end:var(--s2)">${data.zoneOccupancyPct}%</p>
        <div class="capacity-bar">
          <div class="capacity-bar-fill ${data.zoneOccupancyPct >= 100 ? 'full' : ''}" style="width:${data.zoneOccupancyPct}%"></div>
        </div>
      </div>
    </div>`;
}
