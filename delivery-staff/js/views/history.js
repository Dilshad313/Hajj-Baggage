import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, esc, icon } from '../ui.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;

/**
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, refresh: load };
}

/** Releases this view's reference to its mount point. */
export function destroy() { appEl = null; }

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Delivery history</h1></div>
    </div>
    <div id="history-list"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell();
  const root = appEl.querySelector('#history-list');
  root.innerHTML = skeletonBlock(4);
  try {
    const runs = await api.getHistory();
    renderList(root, runs);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderList(root, runs) {
  if (!runs.length) {
    root.innerHTML = emptyState({ message: 'No completed runs yet.' });
    return;
  }
  root.innerHTML = `<div class="stack gap-3">${runs.map(runCardHtml).join('')}</div>`;
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
    </button>`;
}
