import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, emptyState, errorState, openModal, openDrawer,
} from '../ui.js';
import { createDataTable } from '../components/data-table.js';
import { statusChip } from '../components/status-chip.js';
import { OFF_ZONE_REASONS } from '../seed.js';

const SEARCH_DEBOUNCE_MS = 300;

let appEl = null;

/* ---- Zones state ---- */
let zonesState = 'loading'; // loading | error | ready
let zones = [];
let zonesError = '';

/* ---- Search state ---- */
let searchQuery = '';
let searchResults = [];
let searchState = 'loading'; // loading | error | ready
let searchError = '';
let searchDebounceTimer = null;
let table = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  zonesState = 'loading'; zones = []; zonesError = '';
  searchQuery = ''; searchResults = []; searchState = 'loading'; searchError = '';
  table = null;
  renderShell();
  loadZones();
  runSearch('');
  return { destroy, refresh };
}

export function destroy() {
  table?.destroy(); table = null;
  clearTimeout(searchDebounceTimer); searchDebounceTimer = null;
  appEl = null;
}

function refresh() {
  loadZones();
  runSearch(searchQuery);
}

function renderShell() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Inventory</h1>
        <p class="page-subtitle">Browse zones and locations, search stored bags, and manage quarantine.</p>
      </div>
    </div>
    <div id="zones-root" style="margin-block-end:var(--s6)"></div>
    <div class="section-title">Search inventory</div>
    <div id="search-root"></div>`;
  renderZonesRoot();
  renderSearchRoot();
}

/* ===================== Zones ===================== */

async function loadZones() {
  if (!appEl) return;
  zonesState = 'loading';
  renderZonesRoot();
  try {
    zones = await api.getZones();
    if (!appEl) return;
    zonesState = 'ready';
  } catch (err) {
    if (!appEl) return;
    zonesError = err.message;
    zonesState = 'error';
  }
  renderZonesRoot();
}

function renderZonesRoot() {
  const root = appEl?.querySelector('#zones-root');
  if (!root) return;
  if (zonesState === 'loading') { root.innerHTML = skeletonBlock(4); return; }
  if (zonesState === 'error') {
    root.innerHTML = errorState({ message: zonesError });
    root.querySelector('[data-action="retry"]').addEventListener('click', loadZones);
    return;
  }
  if (!zones.length) { root.innerHTML = emptyState({ message: 'No zones configured.' }); return; }
  root.innerHTML = `<div class="grid grid-auto">${zones.map(zoneCardHtml).join('')}</div>`;
  root.querySelectorAll('[data-action="view-locations"]').forEach((btn) => btn.addEventListener('click', () => openZoneDrawer(btn.dataset.code)));
  root.querySelectorAll('[data-action="toggle-zone-status"]').forEach((btn) => btn.addEventListener('click', () => onToggleZoneStatus(btn.dataset.code, btn.dataset.status)));
}

function zoneCardHtml(z) {
  const pct = z.capacity ? Math.round((z.occupied / z.capacity) * 100) : 0;
  const isQuarantine = z.code === 'Z-Q';
  return `
    <div class="zone-card ${z.status === 'Closed' ? 'closed' : ''} ${isQuarantine ? 'quarantine' : ''}">
      <div class="row" style="justify-content:space-between">
        <strong class="mono">${esc(z.code)}</strong>
        ${statusChip(z.status)}
      </div>
      <div class="fs-sm muted" style="margin-block:var(--s2)">${esc(z.destination)}${z.flightCode ? ` &middot; ${esc(z.flightCode)}` : ''}</div>
      <div class="capacity-bar" style="margin-block-end:var(--s2)">
        <div class="capacity-bar-fill ${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="fs-xs muted" style="margin-block-end:var(--s4)">${z.occupied} / ${z.capacity} occupied &middot; ${z.locationCount} location${z.locationCount === 1 ? '' : 's'}</div>
      <div class="row gap-2 wrap">
        <button type="button" class="btn btn-secondary" data-action="view-locations" data-code="${esc(z.code)}">${icon('eye', 16)} View locations</button>
        <button type="button" class="btn btn-ghost" data-action="toggle-zone-status" data-code="${esc(z.code)}" data-status="${esc(z.status)}">${z.status === 'Open' ? 'Close zone' : 'Re-open zone'}</button>
      </div>
    </div>`;
}

async function onToggleZoneStatus(code, currentStatus) {
  const newStatus = currentStatus === 'Open' ? 'Closed' : 'Open';
  try {
    await api.setZoneStatus(code, newStatus);
    toast(`${code} ${newStatus === 'Closed' ? 'closed' : 're-opened'}.`, 'success');
    await loadZones();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openZoneDrawer(code) {
  const drawer = openDrawer({
    title: `Zone ${code}`,
    bodyHtml: `<div id="zone-drawer-body">${skeletonBlock(5)}</div>`,
    footerHtml: `<button type="button" class="btn btn-secondary" data-action="print-zone">${icon('printer', 16)} Print zone list</button>`,
  });
  let detail = null;
  const body = drawer.el.querySelector('#zone-drawer-body');
  drawer.el.querySelector('[data-action="print-zone"]').addEventListener('click', () => window.print());

  async function load() {
    body.innerHTML = skeletonBlock(5);
    try {
      detail = await api.getZoneDetail(code);
      if (!body.isConnected) return;
      renderDetail();
    } catch (err) {
      body.innerHTML = errorState({ message: err.message });
      body.querySelector('[data-action="retry"]')?.addEventListener('click', load);
    }
  }

  function renderDetail() {
    if (!detail.locations.length) { body.innerHTML = emptyState({ message: 'No locations in this zone.' }); return; }
    body.innerHTML = `
      <div class="stack gap-3">
        ${detail.locations.map((l) => `
          <div class="card">
            <div class="row" style="justify-content:space-between">
              <strong class="mono">${esc(l.code)}</strong>
              <span class="fs-xs muted">${l.bags.length} / ${l.capacity}</span>
            </div>
            ${l.bags.length ? `
              <div class="stack gap-1" style="margin-block-start:var(--s2)">
                ${l.bags.map((b) => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)"><span class="fs-sm mono">${esc(b.tagNumber)}</span><span class="fs-xs muted">${esc(b.pilgrimName)}</span></div>`).join('')}
              </div>` : `<p class="fs-xs muted" style="margin-block-start:var(--s2)">Empty.</p>`}
          </div>`).join('')}
      </div>`;
  }

  load();
}

/* ===================== Search ===================== */

function renderSearchRoot() {
  const root = appEl?.querySelector('#search-root');
  if (!root) return;
  root.innerHTML = `
    <div class="field" style="max-width:360px">
      <label for="inv-search-input">Tag, pilgrim, or zone</label>
      <input id="inv-search-input" type="search" autocomplete="off" placeholder="e.g. RBL-A-0031" value="${esc(searchQuery)}" />
    </div>
    <div id="search-results-root"></div>`;
  root.querySelector('#inv-search-input').addEventListener('input', (e) => {
    const value = e.target.value;
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
  });
  renderSearchResults();
}

async function runSearch(query) {
  searchQuery = query;
  if (!appEl) return;
  searchState = 'loading';
  renderSearchResults();
  try {
    searchResults = await api.searchInventory(query);
    if (!appEl) return;
    searchState = 'ready';
  } catch (err) {
    if (!appEl) return;
    searchError = err.message;
    searchState = 'error';
  }
  renderSearchResults();
}

function renderSearchResults() {
  const root = appEl?.querySelector('#search-results-root');
  if (!root) return;
  if (searchState === 'loading' && !table) { root.innerHTML = skeletonBlock(4); return; }
  if (searchState === 'error') {
    table?.destroy(); table = null;
    root.innerHTML = errorState({ message: searchError });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => runSearch(searchQuery));
    return;
  }
  if (!searchResults.length) {
    table?.destroy(); table = null;
    root.innerHTML = emptyState({ message: 'No bags found.' });
    return;
  }
  if (table) { table.setRows(searchResults); return; }
  table = createDataTable(root, {
    rows: searchResults,
    getRowId: (b) => b.id,
    csvFilename: 'inventory',
    emptyMessage: 'No bags found.',
    onRowClick: (b) => openBagDrawer(b),
    columns: [
      { key: 'tagNumber', label: 'Tag', sortable: true, render: (b) => `<span class="mono">${esc(b.tagNumber)}</span>` },
      { key: 'pilgrimName', label: 'Pilgrim', sortable: true, render: (b) => esc(b.pilgrimName) },
      { key: 'zoneCode', label: 'Zone', sortable: true, render: (b) => esc(b.zoneCode || '—') },
      { key: 'locationCode', label: 'Location', sortable: true, render: (b) => esc(b.locationCode || '—') },
      { key: 'status', label: 'Status', sortable: true, render: (b) => statusChip(b.status), csvValue: (b) => b.status },
    ],
  });
}

/* ===================== Bag detail drawer ===================== */

function bagDetailHtml(b) {
  const inQuarantine = b.zoneCode === 'Z-Q';
  return `
    <div class="stack gap-2" style="margin-block-end:var(--s5)">
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Tag</span><strong class="mono">${esc(b.tagNumber)}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Pilgrim</span><strong>${esc(b.pilgrimName)}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Flight</span><strong>${esc(b.flightCode)} &middot; ${esc(b.destination)}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Zone</span><strong>${esc(b.zoneCode || '—')}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Location</span><strong class="mono">${esc(b.locationCode || '—')}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Status</span>${statusChip(b.status)}</div>
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Scanned</span><strong>${esc(fmtDateTime(b.scannedAt))}</strong></div>
    </div>
    <div class="row gap-2 wrap">
      <button type="button" class="btn btn-secondary" data-action="move-location">${icon('move', 16)} Move location</button>
      ${!inQuarantine ? `<button type="button" class="btn btn-secondary" data-action="move-quarantine">${icon('shield-alert', 16)} Move to quarantine</button>` : ''}
      ${inQuarantine ? `<button type="button" class="btn btn-secondary" data-action="release-quarantine">${icon('shield-check', 16)} Release from quarantine</button>` : ''}
    </div>`;
}

function openBagDrawer(bag) {
  const drawer = openDrawer({
    title: bag.tagNumber,
    bodyHtml: bagDetailHtml(bag),
  });
  drawer.el.querySelector('[data-action="move-location"]')?.addEventListener('click', () => openMoveLocationModal(bag, drawer));
  drawer.el.querySelector('[data-action="move-quarantine"]')?.addEventListener('click', () => openQuarantineModal(bag, drawer));
  drawer.el.querySelector('[data-action="release-quarantine"]')?.addEventListener('click', () => openReleaseModal(bag, drawer));
}

function openMoveLocationModal(bag, drawer) {
  let submitting = false;
  let needsReason = false;
  const close = openModal({
    title: `Move location — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="move-loc-form" novalidate>
        <div class="field">
          <label for="move-loc-code">New location code <span class="req">*</span></label>
          <input id="move-loc-code" placeholder="e.g. LOC-Z-A1-03" autocomplete="off" required />
          <div class="error" id="err-move-loc-code" hidden></div>
        </div>
        <div class="field" id="move-loc-reason-field" hidden>
          <label for="move-loc-reason">Reason (off-zone) <span class="req">*</span></label>
          <select id="move-loc-reason">
            <option value="">Select…</option>
            ${OFF_ZONE_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="move-loc-submit">Move</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('move-loc-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const code = form.querySelector('#move-loc-code').value.trim();
    const errBox = form.querySelector('#err-move-loc-code');
    if (!code) { errBox.textContent = 'Location code is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    const reasonSelect = form.querySelector('#move-loc-reason');
    if (needsReason && !reasonSelect.value) { toast('Reason is required.', 'error'); return; }
    submitting = true;
    const btn = form.querySelector('#move-loc-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Moving…';
    try {
      await api.moveLocation(bag.id, code, needsReason ? reasonSelect.value : undefined);
      close();
      toast(`${bag.tagNumber} moved to ${code}.`, 'success');
      drawer.close();
      await runSearch(searchQuery);
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Move';
      if (err.code === 'wrong-zone' && !needsReason) {
        needsReason = true;
        form.querySelector('#move-loc-reason-field').hidden = false;
        toast(err.message, 'info');
        return;
      }
      errBox.textContent = err.message; errBox.hidden = false;
    }
  });
}

function openQuarantineModal(bag, drawer) {
  let submitting = false;
  const close = openModal({
    title: `Move to quarantine — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="quarantine-form" novalidate>
        <div class="field">
          <label for="quarantine-reason">Reason <span class="req">*</span></label>
          <select id="quarantine-reason" required>
            <option value="">Select…</option>
            ${OFF_ZONE_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}
          </select>
          <div class="error" id="err-quarantine-reason" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="quarantine-submit">Move to quarantine</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('quarantine-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reason = form.querySelector('#quarantine-reason').value;
    const errBox = form.querySelector('#err-quarantine-reason');
    if (!reason) { errBox.textContent = 'Reason is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#quarantine-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Moving…';
    try {
      await api.moveToQuarantine(bag.id, reason);
      close();
      toast(`${bag.tagNumber} moved to quarantine.`, 'success');
      drawer.close();
      await runSearch(searchQuery);
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Move to quarantine';
      errBox.textContent = err.message; errBox.hidden = false;
    }
  });
}

function openReleaseModal(bag, drawer) {
  let submitting = false;
  const close = openModal({
    title: `Release from quarantine — ${bag.tagNumber}`,
    bodyHtml: `
      <form id="release-form" novalidate>
        <div class="field">
          <label for="release-code">New location code <span class="req">*</span></label>
          <input id="release-code" placeholder="e.g. LOC-Z-A1-03" autocomplete="off" required />
          <div class="error" id="err-release-code" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="release-submit">Release</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('release-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const code = form.querySelector('#release-code').value.trim();
    const errBox = form.querySelector('#err-release-code');
    if (!code) { errBox.textContent = 'Location code is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#release-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Releasing…';
    try {
      await api.releaseFromQuarantine(bag.id, code);
      close();
      toast(`${bag.tagNumber} released to ${code}.`, 'success');
      drawer.close();
      await runSearch(searchQuery);
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Release';
      errBox.textContent = err.message; errBox.hidden = false;
    }
  });
}
