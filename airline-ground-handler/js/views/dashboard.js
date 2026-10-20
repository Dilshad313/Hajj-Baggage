import * as api from '../api.js';
import {
  esc, icon, fmtDateTime, fmtCountdown, skeletonBlock, errorState,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';

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
        <p class="page-subtitle">Today's flights and what needs your attention.</p>
      </div>
    </div>`;
}

function flightRowHtml(f) {
  return `
    <div style="border-bottom:1px solid var(--border);padding-block-end:var(--s3)">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
        <div class="row gap-2" style="flex-wrap:wrap">
          <strong class="mono">${esc(f.code)}</strong>
          <span class="muted fs-sm">${esc(f.destination)}</span>
          ${f.closed ? '<span class="chip chip-green">Closed &#10003;</span>' : ''}
        </div>
        <div class="fs-sm muted">STD ${esc(fmtDateTime(f.std))} &middot; Cut-off ${esc(fmtCountdown(f.cutoffAt))}</div>
      </div>
      <div class="row fs-sm muted" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);margin-block-start:var(--s1)">
        <span>${esc(f.aircraft)} &middot; Stand ${esc(f.stand)}</span>
        <span>Expected ${esc(f.expected)} &middot; Accepted ${esc(f.accepted)} &middot; Loaded ${esc(f.loaded)}</span>
      </div>
      <div class="capacity-bar" style="margin-block-start:var(--s2)"><div class="capacity-bar-fill" style="width:${f.progress}%"></div></div>
    </div>`;
}

function renderData(data) {
  appEl.innerHTML = `
    ${pageShell()}
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Flights today', value: data.flightsToday })}
      ${kpiTile({ label: 'Batches pending acceptance', value: data.batchesPendingAcceptance })}
      ${kpiTile({ label: 'Bags at make-up awaiting verification', value: data.bagsAtMakeup })}
      ${kpiTile({ label: 'Accepted', value: data.accepted })}
      ${kpiTile({ label: 'In ULDs', value: data.inUlds })}
      ${kpiTile({ label: 'Loaded', value: data.loaded })}
      ${kpiTile({ label: 'Open exceptions', value: data.openExceptions })}
    </div>

    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Flights</h2>
      ${data.flightsTable.length
        ? `<div class="stack gap-3">${data.flightsTable.map(flightRowHtml).join('')}</div>`
        : `<p class="fs-sm muted">No flights to show.</p>`}
    </div>

    <div class="card">
      <h2 class="section-title">Next actions</h2>
      ${data.nextActions.length
        ? `<ul class="stack gap-2 fs-sm" style="list-style:disc;padding-inline-start:var(--s5)">${data.nextActions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
        : `<p class="fs-sm muted">${icon('check-circle', 16)} Nothing needs attention right now.</p>`}
    </div>`;
}
