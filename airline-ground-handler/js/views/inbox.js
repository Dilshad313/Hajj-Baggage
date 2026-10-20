import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, fmtRelative, skeletonBlock, emptyState, errorState,
} from '../ui.js';
import { navigate } from '../router.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let batches = null;
let loadError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  batches = null;
  loadError = '';
  load();
  return { destroy, poll };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  if (!batches) renderSkeleton();
  try {
    const result = await api.getInbox();
    if (!appEl) return;
    batches = result;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

/** Re-fetches quietly so demo-injected batches show up without a visible skeleton flash. */
async function poll() {
  if (!appEl) return;
  try {
    const result = await api.getInbox();
    if (!appEl) return;
    batches = result;
    loadError = '';
    renderPage();
  } catch (e) { /* poll failures stay silent — the next poll or manual retry will recover */ }
}

function renderSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Handover inbox</h1></div>${skeletonBlock(4)}`;
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Handover inbox</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  const pendingCount = batches.filter((b) => !b.acknowledgedAt).length;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Handover inbox</h1>
        <p class="page-subtitle">Acknowledge incoming batches, then open each one to begin acceptance.</p>
      </div>
    </div>
    ${pendingCount ? `
      <div class="card" role="status" style="margin-block-end:var(--s4);border-color:var(--warning);background:var(--warning-soft)">
        <strong>${pendingCount}</strong> handover${pendingCount === 1 ? '' : 's'} waiting
      </div>` : ''}
    ${batches.length ? '<div class="stack gap-3" id="inbox-list"></div>' : emptyState({ message: 'No handovers waiting.' })}`;
  if (batches.length) renderList();
}

function renderList() {
  const root = appEl.querySelector('#inbox-list');
  if (!root) return;
  root.innerHTML = batches.map((b) => `
    <div class="card" data-batch-row="${esc(b.id)}">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s3)">
        <div>
          <strong class="mono">${esc(b.id)}</strong>
          <span class="fs-sm muted">· ${esc(b.flightCode)} · ${b.bagIds.length} bag${b.bagIds.length === 1 ? '' : 's'} · ${esc(b.vehicleId)} · ${esc(b.mu)}</span>
          <div class="fs-xs muted" title="${esc(fmtDateTime(b.sentAt))}">Sent ${esc(fmtRelative(b.sentAt))}</div>
        </div>
        ${statusChip(b.status)}
      </div>
      <div class="row gap-2 wrap" style="margin-block-start:var(--s3)">
        ${!b.acknowledgedAt ? `<button type="button" class="btn btn-secondary" data-action="ack" data-id="${esc(b.id)}">${icon('check', 16)} Acknowledge</button>` : ''}
        <button type="button" class="btn btn-primary" data-action="open" data-id="${esc(b.id)}">Open batch ${icon('arrow-right', 16)}</button>
      </div>
    </div>`).join('');
  root.querySelectorAll('[data-action="ack"]').forEach((btn) => btn.addEventListener('click', () => onAck(btn)));
  root.querySelectorAll('[data-action="open"]').forEach((btn) => btn.addEventListener('click', () => navigate(`#/acceptance/${btn.dataset.id}`)));
}

async function onAck(btn) {
  const id = btn.dataset.id;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<span class="spinner"></span> Acknowledging…';
  try {
    await api.ackBatch(id);
    toast('Batch acknowledged.', 'success');
    await load();
  } catch (err) {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.innerHTML = `${icon('check', 16)} Acknowledge`;
    toast(err.message, 'error');
  }
}
