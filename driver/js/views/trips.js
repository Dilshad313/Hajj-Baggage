import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, esc, icon, fmtCountdown } from '../ui.js';
import { statusChip, directionChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let activeTab = 'today';

const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: load, refresh: load };
}

export function destroy() { appEl = null; }

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">My trips</h1></div>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${activeTab === t.id}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="trips-list"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell();
  wireTabs();
  const root = appEl.querySelector('#trips-list');
  root.innerHTML = skeletonBlock(4);
  try {
    const trips = await api.getTrips({ tab: activeTab });
    renderList(root, trips);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function wireTabs() {
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    if (activeTab === btn.dataset.tab) return;
    activeTab = btn.dataset.tab;
    load();
  }));
}

const EMPTY_MESSAGES = {
  today: 'No trips in progress right now.',
  upcoming: 'No upcoming trips assigned.',
  completed: 'No completed trips yet.',
  cancelled: 'No cancelled trips.',
};

function renderList(root, trips) {
  if (!trips.length) {
    root.innerHTML = emptyState({ message: EMPTY_MESSAGES[activeTab] });
    return;
  }
  const inProgress = trips.filter((t) => t.status === 'In Progress');
  root.innerHTML = `
    ${inProgress.length ? `
      <div class="trip-notify-banner row gap-3">
        ${icon('navigation', 20)}
        <span class="fs-sm">${inProgress.length === 1 ? 'A trip is in progress — continue it below.' : `${inProgress.length} trips are in progress.`}</span>
      </div>` : ''}
    <div class="stack gap-3">${trips.map(tripCardHtml).join('')}</div>`;
  root.querySelectorAll('[data-trip-id]').forEach((card) => card.addEventListener('click', () => navigate(`#/trip/${card.dataset.tripId}`)));
}

function tripCardHtml(t) {
  const cutoff = t.direction === 'Departure' && t.cutoffAt && t.status !== 'Completed' && t.status !== 'Completed with exceptions' && t.status !== 'Cancelled';
  return `
    <button type="button" class="card card-tap" data-trip-id="${esc(t.id)}">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div class="row gap-2" style="margin-block-end:4px">${directionChip(t.direction)}${statusChip(t.status)}</div>
          <strong class="fs-md">${esc(t.id)}</strong>
          <div class="fs-sm muted">${esc(t.fromName)} &rarr; ${esc(t.toName)}</div>
        </div>
      </div>
      <div class="row gap-4 wrap fs-sm" style="margin-block-start:var(--s3)">
        <span>${icon('truck', 14)} ${esc(t.truck.id)}</span>
        <span>${icon('package', 14)} ${t.count.expected} bags</span>
        <span>${icon('plane', 14)} ${esc(t.flightNumber || '—')}</span>
      </div>
      ${cutoff ? `<div class="fs-xs muted" style="margin-block-start:var(--s2)">${icon('alarm-clock', 12)} Cut-off in ${fmtCountdown(t.cutoffAt)}</div>` : ''}
    </button>`;
}
