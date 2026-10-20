import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, fmtWeight, skeletonBlock, emptyState, errorState, openModal,
} from '../ui.js';

let appEl = null;
let flights = null;
let flightCode = null;
let bsms = null;
let loadError = '';
let listError = '';
let syncing = false;
let openRowId = null;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  flights = null;
  flightCode = null;
  bsms = null;
  loadError = '';
  listError = '';
  syncing = false;
  openRowId = null;
  init();
  return { destroy, refresh: () => loadBsms(), activeFlightCode: () => flightCode };
}

export function destroy() {
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

function pageHeader(extra = '') {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">BSM monitor</h1>
        <p class="page-subtitle">Browse bag messages received from the airline DCS for a flight.</p>
      </div>
      ${extra}
    </div>`;
}

function renderShellSkeleton() {
  appEl.innerHTML = pageHeader() + skeletonBlock(6);
}

function renderShell() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = pageHeader() + errorState({ message: loadError });
    appEl.querySelector('[data-action="retry"]').addEventListener('click', init);
    return;
  }
  if (!flights.length) {
    appEl.innerHTML = pageHeader() + emptyState({ message: 'No flights to monitor BSMs for.' });
    return;
  }
  appEl.innerHTML = `
    ${pageHeader(`
      <div class="field" style="margin-block-end:0;min-width:240px">
        <label for="flight-select">Flight</label>
        <select id="flight-select">
          ${flights.map((f) => `<option value="${esc(f.code)}" ${f.code === flightCode ? 'selected' : ''}>${esc(f.code)} &rarr; ${esc(f.destination)}</option>`).join('')}
        </select>
      </div>
    `)}
    <div class="row" style="justify-content:flex-end;margin-block-end:var(--s4)">
      <button type="button" class="btn btn-secondary" data-action="sync" ${syncing ? 'disabled aria-busy="true"' : ''}>
        ${syncing ? '<span class="spinner"></span> Receiving…' : `${icon('refresh-cw', 16)} Receive BSMs from DCS`}
      </button>
    </div>
    <div id="bsm-list-root"></div>`;

  appEl.querySelector('#flight-select').addEventListener('change', (e) => { flightCode = e.target.value; openRowId = null; loadBsms(); });
  appEl.querySelector('[data-action="sync"]').addEventListener('click', onSync);
  loadBsms();
}

async function onSync() {
  if (syncing || !flightCode) return;
  syncing = true;
  const btn = appEl?.querySelector('[data-action="sync"]');
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Receiving…'; }
  try {
    const result = await api.syncBsm(flightCode);
    toast(result.message, 'info');
    await loadBsms();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    syncing = false;
    const freshBtn = appEl?.querySelector('[data-action="sync"]');
    if (freshBtn) { freshBtn.disabled = false; freshBtn.removeAttribute('aria-busy'); freshBtn.innerHTML = `${icon('refresh-cw', 16)} Receive BSMs from DCS`; }
  }
}

async function loadBsms() {
  const root = appEl?.querySelector('#bsm-list-root');
  if (!root || !flightCode) return;
  root.innerHTML = skeletonBlock(4);
  try {
    bsms = await api.getBsms(flightCode);
    listError = '';
  } catch (err) {
    listError = err.message;
    renderList(root);
    return;
  }
  if (!appEl) return;
  renderList(root);
}

function renderList(root) {
  if (listError) {
    root.innerHTML = errorState({ message: listError });
    root.querySelector('[data-action="retry"]').addEventListener('click', loadBsms);
    return;
  }
  if (!bsms.length) {
    root.innerHTML = emptyState({ message: 'No BSMs received for this flight yet.' });
    return;
  }
  root.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Airline tag</th>
            <th>Passenger</th>
            <th>PNR</th>
            <th>Weight</th>
            <th>Received</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${bsms.map(bsmRowHtml).join('')}
        </tbody>
      </table>
    </div>`;

  root.querySelectorAll('[data-action="toggle-telex"]').forEach((btn) => btn.addEventListener('click', () => toggleTelex(root, btn.dataset.id)));
  root.querySelectorAll('[data-action="mark-deleted"]').forEach((btn) => btn.addEventListener('click', () => onMarkDeletedPrompt(btn.dataset.id)));
}

function bsmRowHtml(m) {
  const struck = m.active ? '' : 'style="text-decoration:line-through"';
  return `
    <tr data-bsm-row="${esc(m.id)}">
      <td data-label="Airline tag"><span class="mono" ${struck}>${esc(m.airlineTag)}</span></td>
      <td data-label="Passenger"><span ${struck}>${esc(m.passengerName)}</span></td>
      <td data-label="PNR"><span class="mono" ${struck}>${esc(m.pnr)}</span></td>
      <td data-label="Weight"><span ${struck}>${esc(fmtWeight(m.weightKg))}</span></td>
      <td data-label="Received">${esc(fmtDateTime(m.receivedAt))}</td>
      <td data-label="Status">
        ${m.active
          ? '<span class="chip chip-green">Active</span>'
          : `<span class="chip chip-red">Deleted</span>${m.deletedReason ? `<div class="fs-xs muted">${esc(m.deletedReason)}</div>` : ''}`}
      </td>
    </tr>
    <tr class="telex-sub-row">
      <td colspan="6" style="padding-block:0">
        <div class="row gap-2 wrap" style="padding-block:var(--s2)">
          <button type="button" class="btn btn-ghost" style="height:28px;padding-inline:8px;font-size:12px" data-action="toggle-telex" data-id="${esc(m.id)}">
            ${icon(openRowId === m.id ? 'chevron-up' : 'chevron-down', 14)} ${openRowId === m.id ? 'Hide' : 'View'} raw BSM
          </button>
          ${m.active ? `<button type="button" class="btn btn-ghost" style="height:28px;padding-inline:8px;font-size:12px;color:var(--danger)" data-action="mark-deleted" data-id="${esc(m.id)}">${icon('file-x', 14)} Mark deleted</button>` : ''}
        </div>
        <div id="telex-${esc(m.id)}" style="display:${openRowId === m.id ? 'block' : 'none'};padding-block-end:var(--s3)">${openRowId === m.id ? telexHtml(m) : ''}</div>
      </td>
    </tr>`;
}

function telexHtml(m) {
  const dateStr = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(m.std)).toUpperCase().replace(' ', '');
  return `<div class="telex-box">.V/1L${esc(m.destination)}
.F/${esc(m.flightCode.replace(' ', ''))}/${dateStr}/${esc(m.destination)}/${esc(m.classOfService)}
.N/${esc(m.airlineTag)}
.P/${esc(m.passengerName)}
.L/${esc(m.pnr)}
.W/K/1/${m.weightKg.toFixed(1)}</div>`;
}

function toggleTelex(root, id) {
  openRowId = openRowId === id ? null : id;
  renderList(root);
}

function onMarkDeletedPrompt(bsmId) {
  let submitting = false;
  const close = openModal({
    title: 'Mark BSM deleted',
    bodyHtml: `
      <form id="delete-bsm-form" novalidate>
        <p class="fs-sm muted" style="margin-block-end:var(--s3)">This models an airline passenger no-show. The bag's acceptance may be reset if it is not yet loaded.</p>
        <div class="field">
          <label for="delete-bsm-reason">Reason <span class="req">*</span></label>
          <textarea id="delete-bsm-reason" placeholder="Why is this BSM being deleted?" required></textarea>
          <div class="error" id="err-delete-bsm-reason" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="submit" class="btn btn-danger" id="delete-bsm-submit">Mark deleted</button>
        </div>
      </form>`,
  });
  const form = document.getElementById('delete-bsm-form');
  form.querySelector('[data-act="cancel"]').addEventListener('click', close);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting) return;
    const reason = form.querySelector('#delete-bsm-reason').value.trim();
    const errBox = form.querySelector('#err-delete-bsm-reason');
    if (!reason) { errBox.textContent = 'A reason is required.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    submitting = true;
    const btn = form.querySelector('#delete-bsm-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
    try {
      await api.markBsmDeleted(bsmId, reason);
      close();
      toast('BSM marked deleted.', 'success');
      await loadBsms();
    } catch (err) {
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Mark deleted';
      toast(err.message, 'error');
    }
  });
}
