import * as api from '../api.js';
import { icon, esc, fmtWeight, skeletonBlock, emptyState, errorState } from '../ui.js';
import { statusChip } from '../components/status-chip.js';
import { bagTimelineHtml } from '../components/bag-timeline.js';
import { DEPARTURE_STAGES, ARRIVAL_STAGES } from '../seed.js';

let appEl = null;
let mounted = false;
let bagId = null;
let bag = null;
let loading = true;
let loadError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  bagId = params.id;
  bag = null; loading = true; loadError = '';
  renderShell();
  load();
  return { destroy, poll, refresh: load, activeBagId };
}

export function destroy() {
  mounted = false;
  appEl = null;
}

function activeBagId() {
  return bag?.id || bagId || null;
}

async function load() {
  loading = true; loadError = '';
  renderShell();
  try {
    const res = await api.getBag(bagId);
    if (!mounted) return;
    bag = res;
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

/** Silent background refresh — bag status can change via the demo menu while this screen is open. */
async function poll() {
  if (!mounted || loading) return;
  try {
    const res = await api.getBag(bagId);
    if (!mounted) return;
    bag = res;
    renderShell();
  } catch (e) { /* silent poll failure */ }
}

function renderShell() {
  appEl.innerHTML = `
    <a href="#/track" class="row gap-1 fs-sm muted" style="margin-block-end:var(--s4)">${icon('arrow-left', 16)}<span>Back to tracking</span></a>
    <div class="page-header">
      <h1 class="page-title">${bag ? esc(bag.tagNumber) : 'Bag details'}</h1>
    </div>
    <div id="bag-body">${bodyHtml()}</div>
  `;
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(6);
  if (loadError) return errorState({ message: loadError });
  if (!bag) return emptyState({ message: 'Bag not found.' });
  const stages = bag.direction === 'departure' ? DEPARTURE_STAGES : ARRIVAL_STAGES;
  return `
    <div class="stack gap-4">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <strong class="mono fs-lg">${esc(bag.tagNumber)}</strong>
        ${statusChip(bag.status)}
      </div>
      <div class="card">
        <div class="row gap-6 wrap">
          <div>
            <div class="fs-xs muted">Flight</div>
            <div class="fs-sm fw-medium">${esc(bag.flightCode)}</div>
          </div>
          <div>
            <div class="fs-xs muted">Route</div>
            <div class="fs-sm fw-medium">${esc(bag.flightOrigin || '—')} → ${esc(bag.flightDestination || '—')}</div>
          </div>
          <div>
            <div class="fs-xs muted">Weight</div>
            <div class="fs-sm fw-medium">${fmtWeight(bag.weightKg)}</div>
          </div>
        </div>
      </div>
      ${bag.exception ? exceptionBannerHtml(bag.exception) : ''}
      <div>
        <h2 class="section-title">Timeline</h2>
        ${bagTimelineHtml({ stages, timeline: bag.timeline })}
      </div>
    </div>`;
}

function exceptionBannerHtml(exc) {
  return `
    <div class="banner-alert amber">
      ${icon('alert-triangle', 20)}
      <div class="stack gap-2" style="flex:1">
        <span>${esc(exc.type)} — ${esc(exc.note || 'We are looking into this.')}</span>
        <a class="btn btn-secondary" href="#/support/new" style="align-self:flex-start">Contact support</a>
      </div>
    </div>`;
}

function wireBody() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
}
