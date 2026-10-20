import * as api from '../api.js';
import {
  emptyState, errorState, esc, icon, openDrawer, fmtDateTime, fmtRelative,
} from '../ui.js';
import { statusChip } from '../components/status-chip.js';
import { bagTimelineHtml } from '../components/bag-timeline.js';

let appEl = null;
let query = '';
let debounceTimer = null;
let requestSeq = 0;

const DEBOUNCE_MS = 300;

/**
 * Renders the Scan view: a read-only bag lookup by tag, room or pilgrim name.
 * @param {object} params route params (unused)
 * @param {HTMLElement} app mount point
 * @returns {{destroy:Function}}
 */
export function render(params, app) {
  appEl = app;
  query = '';
  requestSeq = 0;
  appEl.innerHTML = pageShell();
  wireInput();
  renderIdle();
  return { destroy };
}

/** Tears down the Scan view. */
export function destroy() {
  clearTimeout(debounceTimer);
  appEl = null;
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Scan / look up a bag</h1></div>
    </div>
    <div class="field">
      <label for="scan-lookup-input">Tag, room or pilgrim name</label>
      <input id="scan-lookup-input" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="e.g. RB-A305-01, A-305, Siti" />
    </div>
    <div id="scan-results-root"></div>`;
}

function wireInput() {
  const input = appEl.querySelector('#scan-lookup-input');
  const onChange = (value) => {
    clearTimeout(debounceTimer);
    if (!String(value || '').trim()) {
      query = '';
      renderIdle();
      return;
    }
    debounceTimer = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  };
  input.addEventListener('input', () => onChange(input.value));
  input.addEventListener('search', () => onChange(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(debounceTimer);
    const value = input.value;
    if (!String(value || '').trim()) { query = ''; renderIdle(); return; }
    runSearch(value);
  });
  input.focus();
}

function renderIdle() {
  const root = appEl?.querySelector('#scan-results-root');
  if (root) root.innerHTML = emptyState({ message: 'Start typing a bag tag, room number or pilgrim name to search.' });
}

async function runSearch(value) {
  query = String(value || '').trim();
  if (!query) { renderIdle(); return; }
  const root = appEl?.querySelector('#scan-results-root');
  const input = appEl?.querySelector('#scan-lookup-input');
  if (!root) return;
  const seq = ++requestSeq;
  input.disabled = true;
  root.innerHTML = `
    <div class="row gap-2" style="padding:var(--s4) 0;align-items:center">
      <span class="spinner" style="width:16px;height:16px"></span>
      <span class="fs-sm muted">Searching…</span>
    </div>`;
  try {
    const results = await api.lookup(query);
    if (seq !== requestSeq || !appEl) return;
    renderResults(root, results);
  } catch (err) {
    if (seq !== requestSeq || !appEl) return;
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', () => runSearch(query));
  } finally {
    if (input && appEl) input.disabled = false;
  }
}

function renderResults(root, results) {
  if (!results.length) {
    root.innerHTML = emptyState({ message: `No bags matched "${query}".` });
    return;
  }
  root.innerHTML = `<div class="stack gap-2">${results.map(resultRowHtml).join('')}</div>`;
  root.querySelectorAll('[data-bag-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const bag = results.find((b) => b.id === row.dataset.bagId);
      if (bag) openBagDetail(bag);
    });
  });
}

function resultRowHtml(b) {
  return `
    <button type="button" class="card card-tap" data-bag-id="${esc(b.id)}">
      <div class="row gap-3 wrap" style="justify-content:space-between;align-items:center">
        <div>
          <strong class="fs-sm mono">${esc(b.tagNumber)}</strong>
          <div class="fs-sm muted">${esc(b.room || '—')} · ${esc(b.pilgrimName || '—')}</div>
        </div>
        <div class="row gap-2 wrap">
          ${statusChip(b.status)}
          ${b.damaged ? `<span class="chip chip-amber">Damaged</span>` : ''}
        </div>
      </div>
    </button>`;
}

function openBagDetail(bag) {
  const deliveredStage = bag.stages.find((s) => s.toLowerCase() === 'delivered');
  const timeline = (bag.status === 'Delivered' && bag.deliveredAt && deliveredStage)
    ? [{ stage: deliveredStage, time: bag.deliveredAt, result: 'ok' }]
    : [];
  const bodyHtml = `
    <div class="stack gap-3">
      <div class="row gap-2 wrap">
        ${statusChip(bag.status)}
        ${bag.damaged ? `<span class="chip chip-amber">Damaged${bag.damageNote ? `: ${esc(bag.damageNote)}` : ''}</span>` : ''}
      </div>
      <div class="row gap-4 wrap fs-sm">
        <span>${icon('door-open', 14)} ${esc(bag.room || '—')}</span>
        <span>${icon('user', 14)} ${esc(bag.pilgrimName || '—')}</span>
      </div>
      ${bag.deliveredAt ? `
        <div class="fs-xs muted" title="${esc(fmtDateTime(bag.deliveredAt))}">
          Delivered ${esc(fmtRelative(bag.deliveredAt))}${bag.deliveredTo ? ` to ${esc(bag.deliveredTo)}` : ''}
        </div>` : ''}
      <h2 class="section-title">Arrival timeline</h2>
      ${bagTimelineHtml({ stages: bag.stages, timeline })}
    </div>`;
  openDrawer({ title: bag.tagNumber, bodyHtml });
}
