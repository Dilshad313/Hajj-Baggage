import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, confirmDialog } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { PLACES } from '../seed.js';
import { navigate } from '../router.js';

let appEl = null;
let tripId = null;
let scanCtl = null;
let searchTimer = null;
let searchSecondsLeft = 0;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  load();
  return { destroy };
}

export function destroy() {
  scanCtl?.destroy(); scanCtl = null;
  if (searchTimer) { clearInterval(searchTimer); searchTimer = null; }
  appEl = null; tripId = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(4);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    renderScreen(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderScreen(trip) {
  if (!trip.offload.bay) { renderBaySelect(trip); return; }
  if (!trip.offload.sealBroken) { renderBreakSeal(trip); return; }
  renderUnload(trip);
}

function renderBaySelect(trip) {
  const bays = PLACES[trip.toKey]?.bays || [];
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Offload</h1><p class="page-subtitle">${esc(trip.toName)}</p></div></div>
    <div class="card" style="margin-block-end:var(--s5)">
      <div class="field">
        <label for="bay-select">Bay</label>
        <select id="bay-select">
          ${bays.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('')}
          <option value="">Bay assigned by coordinator</option>
        </select>
      </div>
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" data-action="at-bay">${icon('map-pin', 20)} At offload bay</button>`;
  appEl.querySelector('[data-action="at-bay"]').addEventListener('click', async () => {
    const bay = appEl.querySelector('#bay-select').value;
    try { await api.offloadStart(tripId, { bay: bay || undefined }); load(); } catch (err) { toast(err.message, 'error'); }
  });
}

function renderBreakSeal(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Offload — ${esc(trip.offload.bay)}</h1></div></div>
    <div class="seal-display">${icon('lock', 28)}<span class="seal-number">${esc(trip.seal.number)}</span></div>
    <div id="offload-seal-scan-root"></div>
    <div id="break-seal-root" style="margin-block-start:var(--s4)"></div>`;
  scanCtl = createScanInput(appEl.querySelector('#offload-seal-scan-root'), {
    label: 'Scan the seal',
    placeholder: 'Scan or type the seal number',
    onSubmit: async (code) => {
      await api.confirmSeal(tripId, code);
      renderBreakButton();
      return { message: 'Seal matches.' };
    },
  });
}

function renderBreakButton() {
  const root = appEl?.querySelector('#break-seal-root');
  if (!root) return;
  root.innerHTML = `<button type="button" class="btn btn-danger btn-block" data-action="break-seal">${icon('unlock', 18)} Break seal</button>`;
  root.querySelector('[data-action="break-seal"]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Break seal', body: 'Break the seal to begin unloading?', confirmLabel: 'Break seal', danger: true });
    if (!ok) return;
    try { await api.breakSeal(tripId); toast('Seal broken.', 'info'); load(); } catch (err) { toast(err.message, 'error'); }
  });
}

function renderUnload(trip) {
  const unloaded = trip.offload.unloadedBagIds;
  const inSearch = !!trip.offload.searchStartedAt;
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Unload</h1><p class="page-subtitle">${esc(trip.offload.bay)}</p></div></div>
    ${inSearch ? `
      <div class="search-mode-banner" id="search-banner">
        <div>${icon('search', 18)} Searching the truck — <span id="search-countdown">2:00</span> remaining.</div>
        <div class="row gap-2 wrap" style="justify-content:center;margin-block-start:var(--s3)">
          <span class="fs-xs muted">Check under seats, behind partitions and the rear corners.</span>
        </div>
        <button type="button" class="btn btn-secondary" style="margin-block-start:var(--s3)" data-action="report-now">${icon('flag', 16)} Report missing now</button>
      </div>` : ''}
    <div class="offload-counter card">
      <div class="fs-sm muted">Unloaded</div>
      <div class="count-big">${unloaded.length} / ${trip.count.expected}</div>
    </div>
    <div id="unload-scan-root" style="margin-block:var(--s5)"></div>
    <div class="grid grid-cols-2">
      <div class="card">
        <h2 class="section-title fs-sm">Still in truck</h2>
        <div class="stack">${trip.bags.filter((b) => !unloaded.includes(b.id)).map((b) => `<div class="manifest-row"><span class="tag fs-sm">${esc(b.tagNumber)}</span></div>`).join('') || '<p class="fs-xs muted">None.</p>'}</div>
      </div>
      <div class="card">
        <h2 class="section-title fs-sm">Unloaded</h2>
        <div class="stack">${trip.bags.filter((b) => unloaded.includes(b.id)).map((b) => `<div class="manifest-row"><span class="tag fs-sm">${esc(b.tagNumber)}</span>${icon('check', 14)}</div>`).join('') || '<p class="fs-xs muted">None yet.</p>'}</div>
      </div>
    </div>
    <div class="row gap-3 wrap" style="margin-block-start:var(--s5)">
      ${unloaded.length === trip.count.expected
        ? `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="finish-all">${icon('check-check', 20)} Finish offload</button>`
        : `<button type="button" class="btn btn-secondary btn-lg btn-block" data-action="finish-missing">${icon('triangle-alert', 20)} Finish — some bags missing</button>`}
    </div>`;

  scanCtl = createScanInput(appEl.querySelector('#unload-scan-root'), {
    label: 'Scan a bag to unload',
    placeholder: 'Scan or type bag tag',
    onSubmit: async (code) => {
      const res = await api.unloadScan(tripId, code);
      load();
      return { message: `${res.bag.tagNumber} unloaded (${res.unloaded}/${res.expected}).` };
    },
  });

  appEl.querySelector('[data-action="finish-all"]')?.addEventListener('click', async () => {
    try { await api.finishOffloadAllFound(tripId); toast('Offload finished.', 'success'); navigate(`#/trip/${tripId}/handover`); } catch (err) { toast(err.message, 'error'); }
  });
  appEl.querySelector('[data-action="finish-missing"]')?.addEventListener('click', startSearch);
  appEl.querySelector('[data-action="report-now"]')?.addEventListener('click', () => {
    if (searchTimer) { clearInterval(searchTimer); searchTimer = null; }
    finishSearchReport();
  });

  if (inSearch) startSearchCountdown(trip.offload.searchStartedAt);
}

async function startSearch() {
  try {
    await api.startSearch(tripId);
    load();
  } catch (err) { toast(err.message, 'error'); }
}

function startSearchCountdown(startedAtIso) {
  if (searchTimer) clearInterval(searchTimer);
  const endAt = new Date(startedAtIso).getTime() + 120000;
  function tick() {
    searchSecondsLeft = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    const el = appEl?.querySelector('#search-countdown');
    if (el) el.textContent = `${Math.floor(searchSecondsLeft / 60)}:${String(searchSecondsLeft % 60).padStart(2, '0')}`;
    if (searchSecondsLeft <= 0) {
      clearInterval(searchTimer); searchTimer = null;
      finishSearchReport();
    }
  }
  tick();
  searchTimer = setInterval(tick, 1000);
}

async function finishSearchReport() {
  try {
    const res = await api.reportMissing(tripId);
    if (res.missing.length) {
      toast(`${res.missing.length} bag(s) reported missing.${res.notifiedOpsManager ? ' Operations manager notified.' : ''}`, 'error');
    } else {
      toast('All bags accounted for.', 'success');
    }
    navigate(`#/trip/${tripId}/handover`);
  } catch (err) { toast(err.message, 'error'); }
}
