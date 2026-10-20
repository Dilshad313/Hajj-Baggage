import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, fmtRelative, fmtCountdown, skeletonBlock, emptyState, errorState,
} from '../ui.js';
import { navigate } from '../router.js';
import { statusChip } from '../components/status-chip.js';

const GATES = ['JED-GATE-1', 'JED-GATE-2', 'JED-GATE-3'];
const CAROUSELS = ['Carousel 3', 'Carousel 4', 'Carousel 5'];

let appEl = null;
let flightCode = null; // null => board mode

/* board state */
let flights = null;
let boardError = '';

/* detail state */
let flight = null;
let detailError = '';
let syncing = false;

/** @param {{id?:string}} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  flightCode = params.id || null;
  flights = null; boardError = '';
  flight = null; detailError = ''; syncing = false;
  if (flightCode) loadDetail(); else loadBoard();
  return { destroy, refresh: () => (flightCode ? loadDetail() : loadBoard()), activeFlightCode: () => flightCode };
}

export function destroy() {
  appEl = null;
}

/* ===================== BOARD ===================== */

async function loadBoard() {
  if (!appEl) return;
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Arrival flights</h1></div>${skeletonBlock(4)}`;
  try {
    const result = await api.getArrFlights();
    if (!appEl) return;
    flights = result;
    boardError = '';
    renderBoard();
  } catch (err) {
    if (!appEl) return;
    boardError = err.message;
    renderBoard();
  }
}

function renderBoard() {
  if (!appEl) return;
  if (boardError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Arrival flights</h1></div>${errorState({ message: boardError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadBoard);
    return;
  }
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Arrival flights</h1>
        <p class="page-subtitle">Prepare for arriving flights, sync passengers and hand off to receiving.</p>
      </div>
    </div>
    <div id="flights-root"></div>`;
  const root = appEl.querySelector('#flights-root');
  if (!flights.length) {
    root.innerHTML = emptyState({ message: 'No arrival flights scheduled.' })
      + `<p class="fs-sm muted" style="text-align:center;margin-block-start:var(--s2)">Use the profile menu's demo actions to create a flight landing soon.</p>`;
    return;
  }
  root.innerHTML = `<div class="grid grid-auto">${flights.map((f) => `
    <div class="card">
      <div class="row" style="justify-content:space-between;gap:var(--s2)">
        <strong class="mono">${esc(f.code)}</strong>
        ${statusChip(f.status)}
      </div>
      <div class="fs-sm muted" style="margin-block:var(--s2)">${esc(f.origin)} → ${esc(f.destination)}</div>
      <div class="fs-sm">ETA ${esc(fmtDateTime(f.eta))}</div>
      <div class="fs-xs muted" style="margin-block-end:var(--s3)">${esc(fmtCountdown(f.eta))}</div>
      <div class="row gap-3" style="margin-block-end:var(--s4)">
        <span class="fs-xs row gap-1">${f.nusukSyncedAt ? icon('check', 14) : icon('x', 14)} Nusuk synced</span>
        <span class="fs-xs row gap-1">${f.prepCompletedAt ? icon('check', 14) : icon('x', 14)} Prep complete</span>
      </div>
      <button type="button" class="btn btn-secondary btn-block" data-action="open" data-code="${esc(f.code)}">Open</button>
    </div>`).join('')}</div>`;
  root.querySelectorAll('[data-action="open"]').forEach((btn) => btn.addEventListener('click', () => {
    navigate(`#/arr/flights/${encodeURIComponent(btn.dataset.code)}`);
  }));
}

/* ===================== DETAIL ===================== */

async function loadDetail() {
  if (!appEl) return;
  if (!flight) appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Flight</h1></div>${skeletonBlock(8)}`;
  try {
    const result = await api.getArrFlight(flightCode);
    if (!appEl) return;
    flight = result;
    detailError = '';
    renderDetail();
  } catch (err) {
    if (!appEl) return;
    detailError = err.message;
    renderDetail();
  }
}

function renderDetail() {
  if (!appEl) return;
  if (detailError) {
    appEl.innerHTML = `<div class="page-header"><a class="btn btn-ghost" href="#/arr/flights">${icon('arrow-left', 16)} Back</a></div>${errorState({ message: detailError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', loadDetail);
    return;
  }

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <a class="fs-sm muted" href="#/arr/flights">${icon('arrow-left', 14)} All flights</a>
        <h1 class="page-title">${esc(flight.code)} <span class="muted fs-sm">· ${esc(flight.origin)} → ${esc(flight.destination)}</span></h1>
        <p class="page-subtitle">ETA ${esc(fmtDateTime(flight.eta))} · ${esc(fmtCountdown(flight.eta))}</p>
      </div>
      ${statusChip(flight.status)}
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <div class="section-title">Ground handler contact</div>
      <div class="fs-sm">${esc(flight.groundHandlerContact?.name || '—')}</div>
      <div class="fs-sm muted">${esc(flight.groundHandlerContact?.phone || '—')}</div>
    </div>

    <div class="card" id="nusuk-card" style="margin-block-end:var(--s5)"></div>
    <div class="card" id="prep-card" style="margin-block-end:var(--s5)"></div>
    <div class="card" id="status-card"></div>`;

  renderNusukCard();
  renderPrepCard();
  renderStatusCard();
}

/* ----- Nusuk sync ----- */

function renderNusukCard() {
  const root = appEl.querySelector('#nusuk-card');
  if (!root) return;
  if (syncing) {
    root.innerHTML = `
      <div class="section-title">Nusuk sync</div>
      <div class="stack gap-1" id="sync-steps">
        <div class="sync-step" data-step="0">${icon('loader', 14)} Connecting…</div>
        <div class="sync-step" data-step="1">${icon('loader', 14)} Reading manifest…</div>
        <div class="sync-step" data-step="2">${icon('loader', 14)} Creating bags…</div>
      </div>`;
    return;
  }
  if (!flight.nusukSyncedAt) {
    root.innerHTML = `
      <div class="section-title">Nusuk sync</div>
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Get flight &amp; passenger details from Nusuk before prepping this flight.</p>
      <button type="button" class="btn btn-primary" data-action="sync">${icon('download', 16)} Get flight &amp; passenger details from Nusuk</button>`;
  } else {
    root.innerHTML = `
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2)">
        <div class="section-title" style="margin-block-end:0">Nusuk sync</div>
        <span class="fs-sm muted">${icon('check', 14)} Synced ${esc(fmtRelative(flight.nusukSyncedAt))}</span>
      </div>
      <button type="button" class="btn btn-secondary" style="margin-block-start:var(--s3)" data-action="sync">${icon('rotate-cw', 16)} Re-sync</button>`;
  }
  root.querySelector('[data-action="sync"]')?.addEventListener('click', onSyncNusuk);
}

async function onSyncNusuk() {
  syncing = true;
  renderNusukCard();
  const stepsEl = () => appEl?.querySelector('#sync-steps');
  const setStep = (index, cls) => {
    const el = stepsEl()?.querySelector(`[data-step="${index}"]`);
    if (el) el.classList.add(cls);
  };
  const apiPromise = api.syncNusuk(flightCode).catch((err) => err);
  setStep(0, 'active');
  await delay(400);
  setStep(0, 'done'); stepsEl()?.querySelector('[data-step="0"]')?.classList.remove('active');
  setStep(1, 'active');
  await delay(400);
  setStep(1, 'done'); stepsEl()?.querySelector('[data-step="1"]')?.classList.remove('active');
  setStep(2, 'active');
  await delay(400);
  const result = await apiPromise;
  setStep(2, 'done'); stepsEl()?.querySelector('[data-step="2"]')?.classList.remove('active');
  syncing = false;
  if (result instanceof Error) {
    if (!appEl) return;
    renderNusukCard();
    toast(result.message, 'error');
    return;
  }
  toast(result.message, 'success');
  await loadDetail();
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/* ----- Prep checklist ----- */

function renderPrepCard() {
  const root = appEl.querySelector('#prep-card');
  if (!root) return;
  if (flight.prepCompletedAt) {
    root.innerHTML = `
      <div class="section-title">Prep checklist</div>
      <div class="state-block" style="padding:var(--s5)">${icon('check-circle', 36)}<p>Prep complete — ${esc(fmtRelative(flight.prepCompletedAt))}.</p></div>`;
    return;
  }
  root.innerHTML = `
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:var(--s2);margin-block-end:var(--s3)">
      <div class="section-title" style="margin-block-end:0">Prep checklist</div>
      <button type="button" class="btn btn-secondary" data-action="notify-hotels">${icon('bell', 16)} Notify hotels</button>
    </div>
    ${flight.nusukSyncedAt ? `
      <div class="stack gap-1" id="prep-items"></div>
      <button type="button" class="btn btn-primary" style="margin-block-start:var(--s4)" data-action="prep-complete">${icon('check', 16)} Mark prep complete</button>
    ` : `<p class="fs-sm muted">Sync passengers from Nusuk first.</p>`}`;
  if (flight.nusukSyncedAt) renderPrepItems();
  root.querySelector('[data-action="notify-hotels"]').addEventListener('click', onNotifyHotels);
  root.querySelector('[data-action="prep-complete"]')?.addEventListener('click', onPrepComplete);
}

function renderPrepItems() {
  const root = appEl.querySelector('#prep-items');
  if (!root) return;
  root.innerHTML = flight.prepChecklist.map((item, i) => `
    <label class="checkbox-row">
      <input type="checkbox" data-prep-index="${i}" ${item.done ? 'checked' : ''} />
      ${esc(item.label)}
      ${item.done ? `<span class="fs-xs muted">· ${esc(fmtRelative(item.at))}</span>` : ''}
    </label>`).join('');
  root.querySelectorAll('[data-prep-index]').forEach((input) => input.addEventListener('change', onPrepToggle));
}

async function onPrepToggle(e) {
  const index = Number(e.target.dataset.prepIndex);
  const checked = e.target.checked;
  e.target.disabled = true;
  try {
    flight = await api.togglePrepItem(flightCode, index, checked);
    renderPrepCard();
  } catch (err) {
    e.target.checked = !checked;
    e.target.disabled = false;
    toast(err.message, 'error');
  }
}

async function onNotifyHotels(e) {
  const btn = e.currentTarget;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.notifyHotels(flightCode);
    toast('Hotels notified.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

async function onPrepComplete(e) {
  const btn = e.currentTarget;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    flight = await api.markPrepComplete(flightCode);
    toast('Prep complete.', 'success');
    renderPrepCard();
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

/* ----- Flight status (landed / gate / release / receiving) ----- */

function renderStatusCard() {
  const root = appEl.querySelector('#status-card');
  if (!root) return;
  root.innerHTML = `<div class="section-title">Flight status</div><div id="status-body"></div>`;
  const body = root.querySelector('#status-body');

  if (!flight.landedAt) {
    body.innerHTML = `
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Not yet landed.</p>
      <button type="button" class="btn btn-primary" data-action="mark-landed">${icon('plane-landing', 16)} Mark landed</button>`;
    body.querySelector('[data-action="mark-landed"]').addEventListener('click', onMarkLanded);
    return;
  }

  if (!flight.gateArrivedAt) {
    body.innerHTML = `
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Landed ${esc(fmtRelative(flight.landedAt))}. Record arrival at the gate.</p>
      <form id="gate-form" novalidate class="row gap-2 wrap" style="align-items:flex-end">
        <div class="field" style="margin-block-end:0;min-width:200px">
          <label for="gate-select">Gate <span class="req">*</span></label>
          <select id="gate-select" required>
            <option value="">Select…</option>
            ${GATES.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin-block-end:0;min-width:200px">
          <label for="carousel-select">Carousel <span class="req">*</span></label>
          <select id="carousel-select" required>
            <option value="">Select…</option>
            ${CAROUSELS.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn btn-primary" id="gate-submit">${icon('map-pin', 16)} Mark arrived at gate</button>
      </form>`;
    const form = body.querySelector('#gate-form');
    let submitting = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      const gate = form.querySelector('#gate-select').value;
      const carousel = form.querySelector('#carousel-select').value;
      if (!gate || !carousel) { toast('Gate and carousel are both required.', 'error'); return; }
      submitting = true;
      const btn = form.querySelector('#gate-submit');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      try {
        flight = await api.markArrivedAtGate(flightCode, { gate, carousel });
        toast(`${flightCode} marked at ${gate}.`, 'success');
        renderStatusCard();
      } catch (err) {
        submitting = false;
        btn.disabled = false; btn.removeAttribute('aria-busy');
        toast(err.message, 'error');
      }
    });
    return;
  }

  if (!flight.releaseTime) {
    body.innerHTML = `
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">At ${esc(flight.gate)} / ${esc(flight.carousel)}. Request baggage release from the ground handler.</p>
      <form id="release-form" novalidate>
        <div class="field">
          <label for="release-notes">Notes (optional)</label>
          <textarea id="release-notes" placeholder="Coordination notes for the ground handler"></textarea>
        </div>
        <button type="submit" class="btn btn-primary" id="release-submit">${icon('send', 16)} Request baggage release</button>
      </form>`;
    const form = body.querySelector('#release-form');
    let submitting = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      const notes = form.querySelector('#release-notes').value.trim();
      submitting = true;
      const btn = form.querySelector('#release-submit');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      try {
        flight = await api.requestBaggageRelease(flightCode, notes);
        toast('Baggage release requested.', 'success');
        renderStatusCard();
      } catch (err) {
        submitting = false;
        btn.disabled = false; btn.removeAttribute('aria-busy');
        toast(err.message, 'error');
      }
    });
    return;
  }

  body.innerHTML = `
    <div class="stack gap-2" style="margin-block-end:var(--s4)">
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Gate / carousel</span><strong>${esc(flight.gate)} / ${esc(flight.carousel)}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Release requested</span><strong>${esc(fmtRelative(flight.releaseTime))}</strong></div>
      <div class="row" style="justify-content:space-between"><span class="muted fs-sm">Ground handler</span><strong>${esc(flight.groundHandlerContact?.name || '—')} · ${esc(flight.groundHandlerContact?.phone || '—')}</strong></div>
      ${flight.coordinationNotes ? `<div><span class="muted fs-sm">Notes</span><p class="fs-sm">${esc(flight.coordinationNotes)}</p></div>` : ''}
    </div>
    <button type="button" class="btn btn-primary" data-action="start-receiving">${icon('package-check', 16)} Start receiving baggage</button>`;
  body.querySelector('[data-action="start-receiving"]').addEventListener('click', onStartReceiving);
}

async function onMarkLanded(e) {
  const btn = e.currentTarget;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    flight = await api.markLanded(flightCode, new Date().toISOString());
    toast(`${flightCode} marked landed.`, 'success');
    renderStatusCard();
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}

async function onStartReceiving(e) {
  const btn = e.currentTarget;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    await api.startReceivingBaggage(flightCode);
    navigate(`#/arr/receiving/${encodeURIComponent(flightCode)}`);
  } catch (err) {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    toast(err.message, 'error');
  }
}
