import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, esc, icon } from '../ui.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let activeTab = 'today';

const TABS = [
  { id: 'today', label: 'Today' },
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
      <div><h1 class="page-title">Delivery runs</h1></div>
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${activeTab === t.id}" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
    </div>
    <div id="runs-list"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell();
  wireTabs();
  const root = appEl.querySelector('#runs-list');
  root.innerHTML = skeletonBlock(4);
  try {
    const runs = await api.getRuns({ tab: activeTab });
    renderList(root, runs);
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

function renderList(root, runs) {
  if (!runs.length) {
    root.innerHTML = emptyState({ message: activeTab === 'today' ? 'No delivery runs assigned right now.' : `No ${activeTab} runs.` });
    return;
  }
  const notified = runs.filter((r) => r.status === 'Notified');
  const sorted = [...runs].sort((a, b) => {
    const rank = (r) => (r.status === 'In Progress' ? 0 : r.status === 'Notified' ? 1 : 2);
    return rank(a) - rank(b);
  });
  root.innerHTML = `
    ${notified.length ? `
      <div class="run-banner row gap-3">
        ${icon('bell', 20)}
        <span class="fs-sm">${notified.length === 1 ? 'New delivery run ready' : `${notified.length} new delivery runs ready`} for pickup.</span>
      </div>` : ''}
    <div class="stack gap-3">${sorted.map(runCardHtml).join('')}</div>`;
  root.querySelectorAll('[data-run-id]').forEach((card) => card.addEventListener('click', () => navigate(`#/run/${card.dataset.runId}`)));
}

function runCardHtml(r) {
  return `
    <button type="button" class="card card-tap" data-run-id="${esc(r.id)}">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong class="fs-md">${esc(r.code)}</strong>
          <div class="fs-sm muted">${esc(r.hotel)} · Building ${esc(r.building)}</div>
        </div>
        ${statusChip(r.status)}
      </div>
      <div class="row gap-4 wrap fs-sm" style="margin-block-start:var(--s3)">
        <span>${icon('layers', 14)} Floor${r.floorMin === r.floorMax ? ` ${r.floorMin}` : `s ${r.floorMin}–${r.floorMax}`}</span>
        <span>${icon('door-open', 14)} ${r.stopsCount} room${r.stopsCount === 1 ? '' : 's'}</span>
        <span>${icon('package', 14)} ${r.deliveredCount}/${r.bagsCount} bags</span>
        <span>${icon('shopping-cart', 14)} ${esc(r.trolleyId)}</span>
      </div>
      ${r.oldestWaitMinutes != null ? `<div class="fs-xs muted" style="margin-block-start:var(--s2)">${icon('clock', 12)} In progress for ${r.oldestWaitMinutes} min</div>` : ''}
    </button>`;
}
