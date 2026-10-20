import * as api from '../api.js';
import {
  esc, icon, toast, fmtWeight, skeletonBlock, emptyState, errorState, openModal, confirmDialog,
} from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let flights = null;
let flightCode = null;
let tab = 'build'; // build | load
let loadError = '';
let scanInstance = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  flights = null;
  flightCode = null;
  tab = 'build';
  loadError = '';
  init();
  return { destroy, refresh: () => renderTabContent(), activeFlightCode: () => flightCode };
}

export function destroy() {
  scanInstance?.destroy();
  scanInstance = null;
  appEl = null;
}

async function init() {
  if (!appEl) return;
  renderShellSkeleton();
  try {
    flights = await api.getFlights();
    if (!appEl) return;
    flightCode = flights[0]?.code || null;
    loadError = '';
    renderShell();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderShell();
  }
}

function renderShellSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">ULD build &amp; load</h1></div>${skeletonBlock(6)}`;
}

function renderShell() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">ULD build &amp; load</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', init);
    return;
  }
  if (!flights.length) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">ULD build &amp; load</h1></div>${emptyState({ message: 'No flights to build or load for.' })}`;
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">ULD build &amp; load</h1>
        <p class="page-subtitle">Build containers from accepted baggage, then load them into the hold.</p>
      </div>
      <div class="field" style="margin-block-end:0;min-width:240px">
        <label for="flight-select">Flight</label>
        <select id="flight-select">
          ${flights.map((f) => `<option value="${esc(f.code)}" ${f.code === flightCode ? 'selected' : ''}>${esc(f.code)} → ${esc(f.destination)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" aria-selected="${tab === 'build'}" data-tab="build">Build</button>
      <button type="button" class="tab" role="tab" aria-selected="${tab === 'load'}" data-tab="load">Load</button>
    </div>
    <div id="tab-content"></div>`;

  appEl.querySelector('#flight-select').addEventListener('change', (e) => { flightCode = e.target.value; renderTabContent(); });
  appEl.querySelectorAll('[data-tab]').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.tab === tab) return;
    tab = btn.dataset.tab;
    appEl.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    renderTabContent();
  }));
  renderTabContent();
}

function renderTabContent() {
  const root = appEl?.querySelector('#tab-content');
  if (!root || !flightCode) return;
  if (tab === 'build') renderBuildTab(root);
  else renderLoadTab(root);
}

/* ===================== BUILD tab ===================== */

async function renderBuildTab(root) {
  root.innerHTML = skeletonBlock(6);
  let readyToLoad; let flightUlds;
  try {
    [readyToLoad, flightUlds] = await Promise.all([api.getReadyToLoad(flightCode), api.getFlightUlds(flightCode)]);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => renderBuildTab(root));
    return;
  }
  if (!appEl) return;
  const buildingUld = flightUlds.find((u) => u.status === 'Building');

  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div class="card">
        <div class="section-title">Ready to load</div>
        ${readyToLoad.length ? `
          <div class="stack gap-2">
            ${readyToLoad.map((b) => `
              <div class="row" style="justify-content:space-between;padding:var(--s2) 0;border-bottom:1px solid var(--border)">
                <span class="fs-sm mono">${esc(b.tagNumber)}</span>
                <span class="fs-xs muted">${esc(b.pilgrimName)} · ${fmtWeight(b.weightKg)}</span>
              </div>`).join('')}
          </div>` : emptyState({ message: 'No accepted bags are waiting to be loaded for this flight.' })}
      </div>
      <div class="card" id="uld-build-card"></div>
    </div>
    <div class="section-title" style="margin-block-start:var(--s6)">ULDs for this flight</div>
    <div id="flight-ulds-root"></div>`;

  renderUldsOverview(root.querySelector('#flight-ulds-root'), flightUlds);
  if (buildingUld) renderActiveUldCard(root.querySelector('#uld-build-card'), buildingUld);
  else renderStartUldCard(root.querySelector('#uld-build-card'));
}

function renderUldsOverview(root, ulds) {
  if (!ulds.length) { root.innerHTML = emptyState({ message: 'No ULDs started for this flight yet.' }); return; }
  root.innerHTML = `
    <div class="grid grid-auto">
      ${ulds.map((u) => `
        <div class="uld-card ${u.status === 'Loaded' ? 'full' : ''}">
          <div class="row" style="justify-content:space-between">
            <strong class="mono">${esc(u.code)}</strong>
            ${statusChip(u.status)}
          </div>
          <div class="fs-sm muted" style="margin-block:var(--s2)">${u.bagIds.length} bag${u.bagIds.length === 1 ? '' : 's'}${u.position ? ` · Position ${esc(u.position)}` : ''}</div>
        </div>`).join('')}
    </div>`;
}

function renderStartUldCard(root) {
  root.innerHTML = `
    <div class="section-title">Start a ULD</div>
    <p class="fs-sm muted" style="margin-block-end:var(--s4)">Pick an empty container to start building for this flight.</p>
    <button type="button" class="btn btn-primary" data-action="start-uld">${icon('plus', 16)} Start ULD</button>`;
  root.querySelector('[data-action="start-uld"]').addEventListener('click', openStartUldModal);
}

async function openStartUldModal() {
  let pool;
  try {
    pool = await api.getUldPool();
  } catch (err) { toast(err.message, 'error'); return; }
  if (!pool.length) { toast('No empty ULDs available.', 'error'); return; }
  const close = openModal({
    title: 'Start a ULD',
    bodyHtml: `<div class="stack gap-2">${pool.map((u) => `<button type="button" class="btn btn-secondary btn-block" data-uld="${esc(u.id)}">${esc(u.code)} (${esc(u.type)})</button>`).join('')}</div>`,
  });
  document.querySelectorAll('[data-uld]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await api.startUld(flightCode, btn.dataset.uld);
      close();
      toast(`${btn.textContent.trim()} started.`, 'success');
      renderTabContent();
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function renderActiveUldCard(root, uld) {
  scanInstance?.destroy();
  const capacity = 40;
  root.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div class="section-title" style="margin-block-end:0">${esc(uld.code)}</div>
      <strong class="fs-sm">${uld.bagIds.length} / ${capacity}</strong>
    </div>
    <div class="capacity-bar" style="margin-block:var(--s3)"><div class="capacity-bar-fill ${uld.bagIds.length >= capacity ? 'full' : ''}" style="width:${Math.min(100, Math.round((uld.bagIds.length / capacity) * 100))}%"></div></div>
    <div id="uld-scan-root"></div>
    <div id="uld-bag-list" style="margin-block:var(--s4)"></div>
    <button type="button" class="btn btn-primary btn-block" data-action="close-uld" ${uld.bagIds.length ? '' : 'disabled'}>${icon('lock', 16)} Close ULD</button>`;

  scanInstance = createScanInput(root.querySelector('#uld-scan-root'), {
    label: 'Scan bag tag to load into this ULD',
    placeholder: 'e.g. RBL-D-000401',
    onSubmit: async (code) => {
      const result = await api.uldScan(uld.id, code);
      await renderUldDetail(root, uld.id);
      return result;
    },
  });
  renderUldDetail(root, uld.id);

  root.querySelector('[data-action="close-uld"]').addEventListener('click', () => onCloseUld(uld.id));
}

async function renderUldDetail(root, uldId) {
  let detail;
  try {
    detail = await api.getUldDetail(uldId);
  } catch (err) { toast(err.message, 'error'); return; }
  if (!appEl) return;
  const capacity = 40;
  const header = root.querySelector('.row strong');
  if (header) header.textContent = `${detail.bagIds.length} / ${capacity}`;
  const fill = root.querySelector('.capacity-bar-fill');
  if (fill) {
    fill.style.width = `${Math.min(100, Math.round((detail.bagIds.length / capacity) * 100))}%`;
    fill.classList.toggle('full', detail.bagIds.length >= capacity);
  }
  const list = root.querySelector('#uld-bag-list');
  if (list) {
    list.innerHTML = detail.bags.length ? `
      <div class="stack gap-1">
        ${detail.bags.map((b) => `
          <div class="row" style="justify-content:space-between;padding:4px 0">
            <span class="fs-sm mono">${esc(b.tagNumber)}</span>
            <button type="button" class="btn btn-ghost" style="height:28px;padding-inline:8px;font-size:12px" data-action="remove-from-uld" data-id="${esc(b.id)}">${icon('x', 14)} Remove</button>
          </div>`).join('')}
      </div>` : `<p class="fs-sm muted">No bags in this ULD yet.</p>`;
    list.querySelectorAll('[data-action="remove-from-uld"]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api.removeFromUld(uldId, btn.dataset.id);
        await renderUldDetail(root, uldId);
      } catch (err) { toast(err.message, 'error'); }
    }));
  }
  const closeBtn = root.querySelector('[data-action="close-uld"]');
  if (closeBtn) closeBtn.disabled = !detail.bagIds.length;
}

async function onCloseUld(uldId) {
  const proceed = await confirmDialog({ title: 'Close ULD', body: 'No more bags can be added once this ULD is closed.', confirmLabel: 'Close ULD' });
  if (!proceed) return;
  try {
    const uld = await api.closeUld(uldId);
    toast(`${uld.code} closed.`, 'success');
    showUldTag(uld);
    renderTabContent();
  } catch (err) { toast(err.message, 'error'); }
}

function showUldTag(uld) {
  openModal({
    title: 'ULD tag',
    bodyHtml: `
      <div class="uld-tag">
        <h2 class="fs-xl mono">${esc(uld.code)}</h2>
        <p class="fs-sm muted">${esc(uld.type)} · ${esc(uld.flightCode)}</p>
        <p class="fs-sm">${uld.bagIds.length} bags</p>
        <p class="fs-xs muted">Closed ${new Date(uld.closedAt).toLocaleString()}</p>
      </div>
      <button type="button" class="btn btn-secondary btn-block" style="margin-block-start:var(--s4)" id="print-tag-btn">${icon('printer', 16)} Print tag</button>`,
  });
  document.getElementById('print-tag-btn')?.addEventListener('click', () => window.print());
}

/* ===================== LOAD tab ===================== */

let selectedUldId = null;

async function renderLoadTab(root) {
  selectedUldId = null;
  root.innerHTML = skeletonBlock(6);
  let data;
  try {
    data = await api.getHoldDiagram(flightCode);
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => renderLoadTab(root));
    return;
  }
  if (!appEl) return;
  renderLoadContent(root, data);
}

function renderLoadContent(root, data) {
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div class="card">
        <div class="section-title">Closed ULDs</div>
        ${data.closedUlds.length ? `
          <div class="stack gap-2">
            ${data.closedUlds.map((u) => `
              <button type="button" class="pos-card ${selectedUldId === u.id ? 'selected' : ''}" style="text-align:start" data-action="select-uld" data-id="${esc(u.id)}">
                <strong class="mono">${esc(u.code)}</strong>
                <div class="fs-xs muted">${u.bagIds.length} bags</div>
              </button>`).join('')}
          </div>` : `<p class="fs-sm muted">No closed ULDs ready to load. Build and close one first.</p>`}
      </div>
      <div class="card">
        <div class="section-title">Hold positions</div>
        <p class="fs-xs muted" style="margin-block-end:var(--s3)">${selectedUldId ? 'Tap a free position to load the selected ULD.' : 'Select a closed ULD, then tap a free position.'}</p>
        <div class="pos-grid" id="hold-grid"></div>
      </div>
    </div>`;

  root.querySelectorAll('[data-action="select-uld"]').forEach((btn) => btn.addEventListener('click', () => {
    selectedUldId = selectedUldId === btn.dataset.id ? null : btn.dataset.id;
    renderLoadContent(root, data);
  }));

  const grid = root.querySelector('#hold-grid');
  grid.innerHTML = data.holdPositions.map((p) => `
    <button type="button" class="pos-card ${p.uldId ? 'occupied' : ''}" data-action="pick-position" data-code="${esc(p.code)}" ${p.uldId ? `data-uld="${esc(p.uldId)}"` : ''}
      aria-label="Position ${esc(p.code)}, ${p.uldId ? 'occupied' : 'free'}">
      <strong>${esc(p.code)}</strong>
      <div class="fs-xs muted">${p.uldId ? esc(p.uldId) : 'Free'}</div>
    </button>`).join('');
  grid.querySelectorAll('[data-action="pick-position"]').forEach((btn) => btn.addEventListener('click', () => onPickPosition(root, data, btn)));
}

async function onPickPosition(root, data, btn) {
  const code = btn.dataset.code;
  if (btn.dataset.uld) {
    await openOccupiedPositionPanel(root, data, btn.dataset.uld, code);
    return;
  }
  if (!selectedUldId) { toast('Select a closed ULD first.', 'error'); return; }
  try {
    const result = await api.loadUld(flightCode, selectedUldId, code);
    toast(`${result.uld.code} loaded into ${result.position}.`, 'success');
    selectedUldId = null;
    const fresh = await api.getHoldDiagram(flightCode);
    if (!appEl) return;
    renderLoadContent(root, fresh);
  } catch (err) { toast(err.message, 'error'); }
}

async function openOccupiedPositionPanel(root, data, uldId, positionCode) {
  let detail;
  try {
    detail = await api.getUldDetail(uldId);
  } catch (err) { toast(err.message, 'error'); return; }
  const close = openModal({
    title: `Position ${positionCode} — ${detail.code}`,
    bodyHtml: `
      <p class="fs-sm muted">${detail.bags.length} bags loaded.</p>
      <div class="stack gap-1" style="margin-block:var(--s3);max-height:220px;overflow-y:auto">
        ${detail.bags.map((b) => `
          <div class="row" style="justify-content:space-between">
            <span class="fs-sm mono">${esc(b.tagNumber)}</span>
            <button type="button" class="btn btn-ghost" style="height:28px;padding-inline:8px;font-size:12px" data-act="offload-bag" data-id="${esc(b.id)}">${icon('x', 14)} Offload</button>
          </div>`).join('')}
      </div>
      <button type="button" class="btn btn-danger btn-block" data-act="offload-uld">${icon('package-minus', 16)} Offload entire ULD</button>`,
  });
  document.querySelectorAll('[data-act="offload-bag"]').forEach((btn) => btn.addEventListener('click', async () => {
    const reason = await promptReason('Offload bag', 'Why is this bag being offloaded?');
    if (reason === null) return;
    try {
      await api.offloadBag(btn.dataset.id, reason);
      close();
      toast('Bag offloaded.', 'info');
      const fresh = await api.getHoldDiagram(flightCode);
      if (appEl) renderLoadContent(root, fresh);
    } catch (err) { toast(err.message, 'error'); }
  }));
  document.querySelector('[data-act="offload-uld"]')?.addEventListener('click', async () => {
    const reason = await promptReason('Offload ULD', `Why is ${detail.code} being offloaded?`);
    if (reason === null) return;
    try {
      await api.offloadUld(uldId, reason);
      close();
      toast(`${detail.code} offloaded.`, 'info');
      const fresh = await api.getHoldDiagram(flightCode);
      if (appEl) renderLoadContent(root, fresh);
    } catch (err) { toast(err.message, 'error'); }
  });
}

function promptReason(title, body) {
  return new Promise((resolve) => {
    let submitting = false;
    const close = openModal({
      title,
      bodyHtml: `
        <form id="reason-form" novalidate>
          <p class="fs-sm muted" style="margin-block-end:var(--s3)">${esc(body)}</p>
          <div class="field">
            <label for="reason-input">Reason <span class="req">*</span></label>
            <textarea id="reason-input" required></textarea>
            <div class="error" id="err-reason" hidden></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
            <button type="submit" class="btn btn-danger" id="reason-submit">Confirm</button>
          </div>
        </form>`,
      onDismiss: () => resolve(null),
    });
    const form = document.getElementById('reason-form');
    form.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); resolve(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submitting) return;
      const reason = form.querySelector('#reason-input').value.trim();
      const errBox = form.querySelector('#err-reason');
      if (!reason) { errBox.textContent = 'A reason is required.'; errBox.hidden = false; return; }
      submitting = true;
      close();
      resolve(reason);
    });
  });
}
