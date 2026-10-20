import * as api from '../api.js';
import { esc, fmtDateTime, skeletonBlock, emptyState, errorState } from '../ui.js';
import { navigate } from '../router.js';
import { statusChip, severityChip } from '../components/status-chip.js';

let appEl = null;
let mounted = false;
let list = [];
let loading = true;
let loadError = '';
let lastJson = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  list = [];
  loading = true;
  loadError = '';
  lastJson = '';
  renderShell();
  load();
  return { destroy, poll };
}

export function destroy() {
  mounted = false;
  appEl = null;
}

async function load() {
  loading = true;
  loadError = '';
  renderShell();
  try {
    const res = await api.getResolution();
    if (!mounted) return;
    list = res;
    lastJson = JSON.stringify(res);
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

/** Silent background refresh; only re-renders when the resolution actually changed. */
async function poll() {
  if (!mounted || loading) return;
  try {
    const res = await api.getResolution();
    if (!mounted) return;
    const json = JSON.stringify(res);
    if (json !== lastJson) {
      list = res;
      lastJson = json;
      renderShell();
    }
  } catch (e) { /* silent poll failure */ }
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Missing bag status</h1>
      <p class="page-subtitle">Follow up on any bags you've reported missing.</p>
    </div>
    <div id="resolution-body">${bodyHtml()}</div>
    <a class="btn btn-secondary btn-block" href="#/arrival" style="margin-block-start:var(--s4)">Back to arrival</a>
  `;
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(4);
  if (loadError) return errorState({ message: loadError });
  if (!list.length) {
    return emptyState({
      message: 'No missing-bag reports on file.',
      actionLabel: 'Report a missing bag',
      actionAttr: 'data-action="go-report"',
    });
  }
  return `<div class="stack gap-3">${list.map((e) => cardHtml(e)).join('')}</div>`;
}

function cardHtml(e) {
  const resolved = e.status === 'Resolved';
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong class="mono">${esc(e.bagTagNumber || '—')}</strong>
          <p class="fs-sm muted" style="margin:2px 0 0">${esc(e.type)}</p>
        </div>
        <div class="row gap-2">${severityChip(e.severity)}${statusChip(e.status)}</div>
      </div>
      <p class="fs-sm" style="margin-block-start:var(--s3)">${esc(e.note)}</p>
      <p class="fs-xs muted" style="margin-block-start:var(--s2)">Last known: ${esc(e.lastKnownLocation || '—')} · ${fmtDateTime(e.lastKnownTime)}</p>
      ${resolved ? `
        <div style="background:var(--success-soft);color:#14532D;border-radius:var(--r);padding:var(--s3);margin-block-start:var(--s3)">
          <strong class="fs-sm">Resolved</strong>
          <p class="fs-sm" style="margin:4px 0 0">${esc(e.resolutionOutcome || '')}</p>
          <p class="fs-xs" style="margin:2px 0 0">${fmtDateTime(e.resolvedAt)}</p>
        </div>` : ''}
    </div>`;
}

function wireBody() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  appEl.querySelector('[data-action="go-report"]')?.addEventListener('click', () => navigate('#/arrival/report-missing'));
}
