import * as api from '../api.js';
import { esc, icon, toast, skeletonBlock, emptyState, errorState } from '../ui.js';
import { navigate } from '../router.js';

let appEl = null;
let runs = null;
let loadError = '';
let showCancelled = false;

const COLUMNS = ['Planned', 'Assigned', 'Notified', 'In Progress', 'Completed'];

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  runs = null;
  loadError = '';
  showCancelled = false;
  load();
  return { destroy, poll };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  renderSkeleton();
  try {
    const result = await api.getBoard();
    if (!appEl) return;
    runs = result;
    loadError = '';
    renderBoard();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderBoard();
  }
}

async function poll() {
  if (!appEl) return;
  try {
    const result = await api.getBoard();
    if (!appEl) return;
    runs = result;
    loadError = '';
    renderBoard();
  } catch (err) {
    // silent — keep showing the last good board rather than disrupting the view
  }
}

function pageHeaderHtml() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Delivery board</h1>
        <p class="page-subtitle">Live status of delivery runs at this hotel.</p>
      </div>
    </div>`;
}

function renderSkeleton() {
  appEl.innerHTML = `${pageHeaderHtml()}${skeletonBlock(6)}`;
}

function renderBoard() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `${pageHeaderHtml()}${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  if (!runs.length) {
    appEl.innerHTML = `${pageHeaderHtml()}${emptyState({
      message: 'No delivery runs yet. Plan one from Delivery planning.',
      actionLabel: 'Go to delivery planning',
      actionAttr: 'data-action="go-planning"',
    })}`;
    appEl.querySelector('[data-action="go-planning"]').addEventListener('click', () => navigate('#/planning'));
    return;
  }

  const active = runs.filter((r) => r.status !== 'Cancelled');
  const cancelled = runs.filter((r) => r.status === 'Cancelled');

  appEl.innerHTML = `
    ${pageHeaderHtml()}
    <div class="kanban-board">
      ${COLUMNS.map((status) => renderColumn(status, active.filter((r) => r.status === status))).join('')}
    </div>
    ${cancelled.length ? `
      <div style="margin-block-start:var(--s5)">
        <button type="button" class="btn btn-ghost" data-action="toggle-cancelled" aria-expanded="${showCancelled}">
          ${icon(showCancelled ? 'chevron-up' : 'chevron-down', 16)} Cancelled (${cancelled.length})
        </button>
        ${showCancelled ? `<div class="grid grid-auto" style="margin-block-start:var(--s3)">${cancelled.map((r) => renderCard(r)).join('')}</div>` : ''}
      </div>` : ''}`;

  appEl.querySelector('[data-action="toggle-cancelled"]')?.addEventListener('click', () => { showCancelled = !showCancelled; renderBoard(); });
  wireCardActions();
}

function renderColumn(status, list) {
  return `
    <div class="kanban-col">
      <div class="kanban-col-title">${esc(status)} <span class="muted">(${list.length})</span></div>
      ${list.map((r) => renderCard(r)).join('')}
    </div>`;
}

function ageInfo(run) {
  const ageMinutes = (Date.now() - new Date(run.statusChangedAt).getTime()) / 60000;
  let cls = '';
  if (ageMinutes >= 60) cls = 'age-red';
  else if (ageMinutes >= 30) cls = 'age-amber';
  return { cls, minutes: Math.round(ageMinutes) };
}

function renderCard(run) {
  const { cls, minutes } = ageInfo(run);
  return `
    <div class="kanban-card ${cls}">
      <a href="#/planning/${esc(run.id)}" class="stack gap-1" style="text-decoration:none;color:inherit">
        <strong class="mono fs-sm">${esc(run.code)}</strong>
        <span class="fs-sm">Building ${esc(run.building)}</span>
        <span class="fs-xs muted">${run.bagIds.length} bag${run.bagIds.length === 1 ? '' : 's'}</span>
        <span class="fs-xs muted">${run.team ? esc(`${run.team} · ${run.lead}`) : 'Unassigned'}</span>
        <span class="fs-xs muted">Trolley ${run.trolleyCode ? esc(run.trolleyCode) : '—'}</span>
        <span class="fs-xs muted">${minutes} min in this status</span>
      </a>
      ${run.status === 'Notified' || run.status === 'In Progress' ? `
        <div class="row gap-2" style="margin-block-start:var(--s2)">
          ${run.status === 'Notified' ? `<button type="button" class="btn btn-secondary" style="height:32px;padding-inline:var(--s3);font-size:12px" data-action="mark-in-progress" data-id="${esc(run.id)}">${icon('play', 14)} Mark in progress</button>` : ''}
          ${run.status === 'In Progress' ? `<button type="button" class="btn btn-secondary" style="height:32px;padding-inline:var(--s3);font-size:12px" data-action="mark-completed" data-id="${esc(run.id)}">${icon('check', 14)} Mark completed</button>` : ''}
        </div>` : ''}
    </div>`;
}

// The quick-action button sits in its own footer row outside the card's <a>
// wrapper — nesting a <button> inside an <a> is invalid HTML and would fire
// both the button handler and the link navigation on a single click.
function wireCardActions() {
  appEl.querySelectorAll('[data-action="mark-in-progress"]').forEach((btn) => btn.addEventListener('click', () => onMarkInProgress(btn)));
  appEl.querySelectorAll('[data-action="mark-completed"]').forEach((btn) => btn.addEventListener('click', () => onMarkCompleted(btn)));
}

async function onMarkInProgress(btn) {
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await api.simulateDeliveryStarted(btn.dataset.id);
    toast('Run marked in progress.', 'success');
    await load();
  } catch (err) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

async function onMarkCompleted(btn) {
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await api.simulateDeliveryCompleted(btn.dataset.id);
    toast('Run marked completed.', 'success');
    await load();
  } catch (err) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}
