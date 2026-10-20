import * as api from '../api.js';
import { skeletonBlock, errorState, toast, esc, icon } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let runId = null;
let run = null;
let bags = [];
let ready = 0;
let total = 0;
let scanInputInstance = null;

/**
 * Scan-out view: scan each bag off the trolley into "Out for delivery",
 * tracking a ready/total counter and two lists (still to scan vs. already
 * out), with a shortcut into the first pending room once at least one bag
 * is out. Reused whenever the staff member returns for more bags.
 * @param {{id:string}} params
 * @param {HTMLElement} app
 * @returns {{destroy:()=>void, poll:()=>void, refresh:()=>void}}
 */
export function render(params, app) {
  appEl = app;
  runId = params.id;
  load();
  return { destroy, poll, refresh: load };
}

/** Tears down the mounted scan-input instance and releases the view. */
export function destroy() {
  scanInputInstance?.destroy();
  scanInputInstance = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(8);
  try {
    await fetchData();
    renderPage();
  } catch (err) {
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function poll() {
  if (!appEl) return;
  try {
    await fetchData();
    renderCounterAndLists();
  } catch (e) { /* silent — keep showing the last good state */ }
}

async function fetchData() {
  const [runData, statusData] = await Promise.all([api.getRun(runId), api.getOutForDeliveryStatus(runId)]);
  run = runData;
  const meta = bagMetaMap();
  bags = statusData.bags.map((b) => ({ ...b, ...meta.get(b.id) }));
  ready = statusData.ready;
  total = statusData.total;
}

function bagMetaMap() {
  const map = new Map();
  run.stops.forEach((s) => {
    s.bags.forEach((b) => {
      const pilgrim = s.pilgrims.find((p) => p.id === b.pilgrimId);
      map.set(b.id, { room: s.room, pilgrimName: pilgrim?.name || '' });
    });
  });
  return map;
}

function renderPage() {
  scanInputInstance?.destroy(); scanInputInstance = null;
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <div class="page-header">
      <div>
        <h1 class="page-title">Scan bags out</h1>
        <p class="page-subtitle">${esc(run.code)} · ${esc(run.hotel)} · Building ${esc(run.building)}</p>
      </div>
    </div>
    <div id="out-scan-root" style="margin-block-end:var(--s4)"></div>
    <div class="card" style="margin-block-end:var(--s4)">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h2 class="section-title" style="margin:0">Ready for delivery</h2>
        <div id="out-counter" class="fs-lg fw-bold"></div>
      </div>
    </div>
    <div id="out-lists-root"></div>
    <button type="button" class="btn btn-primary btn-lg btn-block" data-action="go-first-room" style="margin-block-start:var(--s4)">${icon('arrow-right', 18)} Go to first room</button>`;

  scanInputInstance = createScanInput(appEl.querySelector('#out-scan-root'), {
    label: 'Scan bag to go out',
    placeholder: 'Scan or type the bag tag',
    onSubmit: async (tag) => {
      const bag = await api.outForDelivery(runId, tag);
      mergeBagUpdate(bag);
      renderCounterAndLists();
      return { message: `${bag.tagNumber} out for delivery.` };
    },
  });

  appEl.querySelector('[data-action="go-first-room"]').addEventListener('click', goToFirstRoom);

  renderCounterAndLists();
}

function mergeBagUpdate(updated) {
  bags = bags.map((b) => (b.id === updated.id ? { ...b, ...updated } : b));
  ready = bags.filter((b) => b.status !== 'On trolley' && b.status !== 'In hold (missing)').length;
  total = bags.length;
}

function renderCounterAndLists() {
  const counterEl = appEl.querySelector('#out-counter');
  if (counterEl) counterEl.textContent = `Ready ${ready} / ${total}`;

  const listsRoot = appEl.querySelector('#out-lists-root');
  if (listsRoot) {
    const toScan = bags.filter((b) => b.status !== 'Out for delivery' && b.status !== 'Delivered' && b.status !== 'Returned to hold');
    const toScanIds = new Set(toScan.map((b) => b.id));
    const outBags = bags.filter((b) => !toScanIds.has(b.id));
    listsRoot.innerHTML = `
      <h2 class="section-title">To scan (${toScan.length})</h2>
      ${toScan.length ? `<div class="stack gap-2" style="margin-block-end:var(--s4)">${toScan.map(bagRowHtml).join('')}</div>` : '<p class="fs-sm muted" style="margin-block-end:var(--s4)">Nothing left to scan.</p>'}
      <h2 class="section-title">Out for delivery (${outBags.length})</h2>
      ${outBags.length ? `<div class="stack gap-2">${outBags.map(bagRowHtml).join('')}</div>` : '<p class="fs-sm muted">No bags out yet.</p>'}`;
  }

  const goBtn = appEl.querySelector('[data-action="go-first-room"]');
  if (goBtn) goBtn.disabled = ready <= 0;
}

function bagRowHtml(b) {
  return `
    <div class="row gap-2" style="justify-content:space-between;align-items:center">
      <div>
        <span class="fs-sm mono">${esc(b.tagNumber)}</span>
        <div class="fs-xs muted">${esc(b.pilgrimName || '')}${b.room ? ` · ${esc(b.room)}` : ''}</div>
      </div>
      ${statusChip(b.status)}
    </div>`;
}

function goToFirstRoom() {
  const nextStop = run.stops.find((s) => s.status === 'Pending');
  if (!nextStop) { toast('No pending rooms right now.', 'info'); return; }
  navigate(`#/run/${runId}/stop/${nextStop.id}`);
}
