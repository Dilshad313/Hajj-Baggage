import * as api from '../api.js';
import {
  esc, icon, fmtRelative, fmtCountdown, skeletonBlock, emptyState, errorState,
} from '../ui.js';
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
    const flights = await api.getIncoming();
    if (!appEl) return;
    renderData(flights);
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
        <h1 class="page-title">Incoming baggage</h1>
        <p class="page-subtitle">Baggage pipeline for each upcoming flight.</p>
      </div>
    </div>`;
}

function pipelineStageHtml(count, label, atRisk) {
  return `
    <div class="pipeline-stage ${atRisk ? 'has-risk' : ''}">
      <div class="pipeline-count">${esc(count)}</div>
      <div class="pipeline-label">${esc(label)}</div>
    </div>`;
}

function batchRowHtml(b) {
  return `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);padding:var(--s2) 0;border-bottom:1px solid var(--border)">
      <div>
        <strong class="fs-sm mono">${esc(b.vehicleId)}</strong>
        <span class="fs-xs muted">&middot; ${esc(b.mu)} &middot; ${esc(b.bagCount)} bags</span>
      </div>
      <div class="row gap-2" style="flex-wrap:wrap">
        ${statusChip(b.status)}
        <span class="fs-xs muted">Sent ${esc(fmtRelative(b.sentAt))}</span>
        ${b.acknowledgedAt
          ? `<span class="fs-xs" style="color:var(--success)">${icon('check', 14)} Acknowledged</span>`
          : `<span class="fs-xs muted">Not yet acknowledged</span>`}
      </div>
    </div>`;
}

function flightCardHtml(f) {
  const atRisk = f.bagsAtRisk > 0;
  return `
    <div class="card" style="margin-block-end:var(--s5)">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);margin-block-end:var(--s4)">
        <div>
          <strong class="mono">${esc(f.code)}</strong>
          <span class="muted fs-sm"> &middot; ${esc(f.destination)}</span>
        </div>
        <span class="fs-sm muted">Cut-off ${esc(fmtCountdown(f.cutoffAt))}</span>
      </div>
      ${atRisk ? `<p style="color:var(--danger)" class="fs-sm row gap-2">${icon('alert-triangle', 16)} ${esc(f.bagsAtRisk)} bag(s) at risk &mdash; cut-off in ${esc(fmtCountdown(f.cutoffAt))}.</p>` : ''}
      <div class="pipeline-bar" style="margin-block-end:var(--s4)">
        ${pipelineStageHtml(f.pipeline.inTransit, 'In transit', atRisk)}
        ${pipelineStageHtml(f.pipeline.atAirport, 'At airport (Rabel)', atRisk)}
        ${pipelineStageHtml(f.pipeline.accepted, 'Accepted')}
        ${pipelineStageHtml(f.pipeline.loaded, 'Loaded')}
      </div>
      <div class="row" style="justify-content:space-between;align-items:baseline;margin-block-end:var(--s2)">
        <div class="section-title" style="margin-block-end:0">Batches</div>
        <a class="fs-sm" href="#/inbox">${icon('inbox', 14)} Open inbox</a>
      </div>
      ${f.batches.length
        ? `<div class="stack gap-1">${f.batches.map(batchRowHtml).join('')}</div>`
        : `<p class="fs-sm muted">No batches sent for this flight yet.</p>`}
    </div>`;
}

function renderData(flights) {
  if (!flights.length) {
    appEl.innerHTML = pageShell() + emptyState({ message: 'No flights currently need attention.' });
    return;
  }
  appEl.innerHTML = `
    ${pageShell()}
    ${flights.map(flightCardHtml).join('')}`;
}
