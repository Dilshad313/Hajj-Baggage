import * as api from '../api.js';
import {
  skeletonBlock, errorState, toast, openDrawer, closeDrawer, fmtWeight, esc, icon,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { bagTimelineHtml } from '../components/bag-timeline.js';
import { statusChip, severityChip } from '../components/status-chip.js';

let appEl = null;
let table = null;
let allBags = [];
let activePreset = 'all';

const PRESETS = [
  { id: 'all', label: 'All bags', preset: null },
  { id: 'stuck', label: 'Stuck > 2 h at one stage', preset: 'stuck' },
  { id: 'exception-open', label: 'Exception open', preset: 'exception-open' },
  { id: 'damaged', label: 'Damaged', preset: 'damaged' },
];

/**
 * Renders the bags search/tracking view.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:Function, poll:Function, refresh:Function}}
 */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: refreshQuiet, refresh: load };
}

/** Tears down the view's in-memory state. */
export function destroy() {
  appEl = null;
  table = null;
}

function presetFilter() {
  const p = PRESETS.find((x) => x.id === activePreset)?.preset;
  return p ? { preset: p } : {};
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell() + skeletonBlock(8);
  try {
    allBags = await api.searchBags(presetFilter());
    renderTable();
  } catch (err) {
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    wirePresetTabs();
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || !table) return;
  try {
    allBags = await api.searchBags(presetFilter());
    table.setRows(allBags);
  } catch (e) { /* silent background refresh */ }
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Bags</h1><p class="page-subtitle">Search and track individual bags across the chain of custody.</p></div>
    </div>
    <div class="tabs" role="tablist" aria-label="Saved filters">
      ${PRESETS.map((p) => `<button type="button" class="tab" role="tab" aria-selected="${activePreset === p.id}" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}
    </div>
    <div id="bags-table-root"></div>`;
}

function wirePresetTabs() {
  appEl.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
    if (activePreset === btn.dataset.preset) return;
    activePreset = btn.dataset.preset;
    load();
  }));
}

function renderTable() {
  appEl.innerHTML = pageShell();
  wirePresetTabs();
  const root = appEl.querySelector('#bags-table-root');

  table = createDataTable(root, {
    rows: allBags,
    searchKeys: ['tagNumber', 'airlineTagNumber', 'pilgrimName', 'passport', 'nusukId', 'flightCode'],
    getRowId: (b) => b.id,
    csvFilename: 'bags',
    emptyMessage: 'No bags match this filter.',
    onRowClick: (row) => openBagDrawer(row.id),
    columns: [
      { key: 'tagNumber', label: 'Tag number', sortable: true, render: (b) => `<span class="mono">${esc(b.tagNumber)}</span>` },
      { key: 'pilgrimName', label: 'Pilgrim', sortable: true },
      { key: 'flightCode', label: 'Flight', sortable: true },
      { key: 'currentStage', label: 'Stage', sortable: true },
      {
        key: 'currentHolder', label: 'Current holder',
        render: (b) => (b.currentHolder ? `${esc(b.currentHolder.role)} — ${esc(b.currentHolder.name)}` : '—'),
        csvValue: (b) => (b.currentHolder ? `${b.currentHolder.role} — ${b.currentHolder.name}` : ''),
      },
      { key: 'weightKg', label: 'Weight', sortable: true, render: (b) => fmtWeight(b.weightKg), csvValue: (b) => b.weightKg },
      {
        key: 'hasException', label: 'Exception',
        render: (b) => (b.hasException ? '<span class="chip chip-red">Exception</span>' : ''),
        csvValue: (b) => (b.hasException ? 'Yes' : 'No'),
      },
    ],
  });
}

/* ===================== Bag detail drawer ===================== */

async function openBagDrawer(id) {
  let bag;
  try {
    bag = await api.getBag(id);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }

  const drawer = openDrawer({
    title: `${bag.tagNumber} — ${bag.pilgrimName}`,
    bodyHtml: bagDetailHtml(bag),
    large: true,
  });

  drawer.el.querySelectorAll('[data-act="view-exception"]').forEach((a) => a.addEventListener('click', () => closeDrawer()));
}

function bagDetailHtml(bag) {
  return `
    <div class="grid grid-cols-2 fs-sm" style="margin-block-end:var(--s4)">
      <div><span class="muted">Tag number</span><br><strong class="mono">${esc(bag.tagNumber)}</strong></div>
      <div><span class="muted">Airline tag</span><br><strong class="mono">${esc(bag.airlineTagNumber)}</strong></div>
      <div><span class="muted">Pilgrim</span><br><strong>${esc(bag.pilgrimName)}</strong></div>
      <div><span class="muted">Nusuk ID</span><br><strong class="mono">${esc(bag.nusukId)}</strong></div>
      <div><span class="muted">Passport</span><br><strong class="mono">${esc(bag.passport)}</strong></div>
      <div><span class="muted">Flight</span><br><strong>${esc(bag.flightCode)}</strong></div>
      <div><span class="muted">Weight</span><br><strong>${fmtWeight(bag.weightKg)}</strong></div>
      <div><span class="muted">Current holder</span><br><strong>${bag.currentHolder ? `${esc(bag.currentHolder.role)} — ${esc(bag.currentHolder.name)}` : '—'}</strong></div>
    </div>

    <h2 class="section-title">Chain of custody</h2>
    <div class="card" style="margin-block-end:var(--s4)">${bagTimelineHtml({ stages: bag.stages, timeline: bag.timeline })}</div>

    <h2 class="section-title">Linked exceptions</h2>
    ${bag.exceptions.length ? `
      <div class="stack gap-3">
        ${bag.exceptions.map((e) => `
          <div class="card" style="padding:var(--s3)">
            <div class="row gap-2 wrap" style="justify-content:space-between;align-items:center">
              <div class="row gap-2 wrap">
                <strong class="fs-sm">${esc(e.type)}</strong>
                ${severityChip(e.severity)}${statusChip(e.status)}
              </div>
              <a class="btn btn-secondary" href="#/exceptions/${esc(e.id)}" data-act="view-exception">${icon('arrow-right', 16)} View</a>
            </div>
          </div>`).join('')}
      </div>` : `<p class="muted fs-sm">No linked exceptions.</p>`}
  `;
}
