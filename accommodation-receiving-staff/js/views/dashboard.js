import * as api from '../api.js';
import {
  esc, icon, fmtDateTime, skeletonBlock, emptyState, errorState,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: pollTick };
}

export function destroy() {
  appEl = null;
}

function pollTick() {
  load(true);
}

async function load(quiet) {
  if (!appEl) return;
  if (!quiet) appEl.innerHTML = pageShell() + skeletonBlock(8);
  try {
    const data = await api.getDashboard();
    if (!appEl) return;
    renderData(data);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', () => load());
  }
}

function pageShell() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Receiving overview for your hotel.</p>
      </div>
      <div class="row gap-2 wrap">
        <a class="btn btn-secondary" href="#/arrival">${icon('scan-line', 16)} Scan arriving truck</a>
        <a class="btn btn-secondary" href="#/sorting">${icon('layout-grid', 16)} Sorting board</a>
        <a class="btn btn-secondary" href="#/planning">${icon('calendar-check', 16)} Delivery planning</a>
      </div>
    </div>`;
}

function fmtMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderData(data) {
  appEl.innerHTML = `
    ${pageShell()}
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Trucks en route', value: data.trucksEnRoute })}
      ${kpiTile({ label: 'Trucks at bay', value: data.trucksAtBay })}
      ${kpiTile({ label: 'Awaiting verification', value: data.awaitingVerification })}
      ${kpiTile({ label: 'Received today', value: data.receivedToday })}
      ${kpiTile({ label: 'Sorted', value: data.sorted })}
      ${kpiTile({ label: 'Out for delivery', value: data.outForDelivery })}
      ${kpiTile({ label: 'Open exceptions', value: data.openExceptions })}
    </div>

    <div class="grid grid-cols-2" style="align-items:start;margin-block-end:var(--s6)">
      <div class="card">
        <h2 class="section-title">Pilgrims waiting</h2>
        ${data.pilgrimsWaiting.count > 0 ? `
          <p class="fs-sm">${data.pilgrimsWaiting.count} bag${data.pilgrimsWaiting.count === 1 ? '' : 's'} waiting to be sorted.</p>
          ${data.pilgrimsWaiting.oldestWaitMin != null ? `<p class="fs-sm muted">Oldest waiting ${esc(fmtMinutes(data.pilgrimsWaiting.oldestWaitMin))}.</p>` : ''}
        ` : `<p class="fs-sm muted">${icon('check-circle', 16)} Nothing waiting.</p>`}
      </div>
      <div class="card">
        <h2 class="section-title">Sorting progress by building</h2>
        ${Object.keys(data.sortingByBuilding).length ? `
          <div class="stack gap-3">
            ${Object.keys(data.sortingByBuilding).sort().map((key) => {
              const b = data.sortingByBuilding[key];
              const pct = b.total ? Math.round((b.sorted / b.total) * 100) : 0;
              return `
                <div>
                  <div class="row fs-sm" style="justify-content:space-between">
                    <span>Building ${esc(key)}</span>
                    <span class="muted">${b.sorted}/${b.total} sorted</span>
                  </div>
                  <div class="capacity-bar" style="margin-block-start:var(--s1)"><div class="capacity-bar-fill" style="width:${pct}%"></div></div>
                </div>`;
            }).join('')}
          </div>
        ` : `<p class="fs-sm muted">No buildings configured.</p>`}
      </div>
    </div>

    <div class="card">
      <h2 class="section-title">Arrivals today</h2>
      ${data.arrivalsToday.length ? `
        <div class="stack gap-3">
          ${data.arrivalsToday.map((t) => `
            <div class="row" style="justify-content:space-between;border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
              <span class="fs-sm"><strong class="mono">${esc(t.code)}</strong> &middot; ${esc(t.truckPlate)} &middot; ${esc(t.flightCode)}</span>
              <span class="row gap-2">${statusChip(t.status)}<span class="fs-xs muted">${esc(fmtDateTime(t.arrivedAt || t.eta))}</span></span>
            </div>`).join('')}
        </div>
      ` : emptyState({ message: 'No trucks have arrived yet today.' })}
    </div>`;
}
