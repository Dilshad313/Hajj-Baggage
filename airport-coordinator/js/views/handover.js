import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, errorState, confirmDialog,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';

let appEl = null;
let summary = null;
let loadError = '';
let submittingNote = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  summary = null; loadError = ''; submittingNote = false;
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Shift handover</h1></div>${skeletonBlock(6)}`;
  try {
    const result = await api.getHandoverSummary();
    if (!appEl) return;
    summary = result;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Shift handover</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Shift handover</h1>
        <p class="page-subtitle">Review the shift summary and leave notes for the next shift before signing out.</p>
      </div>
    </div>

    <div class="section-title">Shift summary</div>
    <div class="grid grid-cols-2" style="margin-block-end:var(--s4)">
      <div>
        <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Departure</div>
        <div class="grid grid-auto">
          ${kpiTile({ label: 'Trucks at gate', value: summary.departure.trucksAtGate })}
          ${kpiTile({ label: 'Open batches', value: summary.departure.openBatches })}
        </div>
      </div>
      <div>
        <div class="fs-sm fw-medium muted" style="margin-block-end:var(--s2)">Arrival</div>
        <div class="grid grid-auto">
          ${kpiTile({ label: 'Flights receiving', value: summary.arrival.flightsReceiving })}
          ${kpiTile({ label: 'Trips not dispatched', value: summary.arrival.tripsNotDispatched })}
        </div>
      </div>
    </div>
    <div class="grid grid-auto" style="margin-block-end:var(--s6);max-width:260px">
      ${kpiTile({ label: 'Open exceptions', value: summary.openExceptions })}
    </div>

    <div class="card" style="margin-block-end:var(--s6)">
      <div class="section-title">Handover notes</div>
      <form id="note-form" novalidate style="margin-block-end:var(--s5)">
        <div class="field">
          <label for="note-text">Note for the next shift <span class="req">*</span></label>
          <textarea id="note-text" placeholder="10–1000 characters" required></textarea>
          <div class="error" id="err-note" hidden></div>
        </div>
        <button type="submit" class="btn btn-primary" id="note-submit">${icon('plus', 16)} Add note</button>
      </form>
      <div id="notes-list"></div>
    </div>

    <div class="card">
      <div class="section-title">End shift &amp; sign out</div>
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Make sure you have saved a handover note before signing out.</p>
      <button type="button" class="btn btn-danger" id="end-shift-btn">${icon('log-out', 16)} End shift &amp; sign out</button>
    </div>`;

  renderNotesList();
  appEl.querySelector('#note-form').addEventListener('submit', onAddNote);
  appEl.querySelector('#end-shift-btn').addEventListener('click', onEndShift);
}

function renderNotesList() {
  const root = appEl.querySelector('#notes-list');
  if (!root) return;
  if (!summary.notes.length) { root.innerHTML = `<p class="fs-sm muted">No handover notes yet.</p>`; return; }
  root.innerHTML = `<div class="stack gap-2">${summary.notes.map((n) => `
    <div style="padding:var(--s2) 0;border-bottom:1px solid var(--border)">
      <p class="fs-sm">${esc(n.notes)}</p>
      <p class="fs-xs muted">${esc(n.by)} &middot; ${esc(fmtDateTime(n.submittedAt))}</p>
    </div>`).join('')}</div>`;
}

async function onAddNote(e) {
  e.preventDefault();
  if (submittingNote) return;
  const form = e.currentTarget;
  const text = form.querySelector('#note-text').value.trim();
  const errBox = form.querySelector('#err-note');
  if (text.length < 10 || text.length > 1000) {
    errBox.textContent = 'Handover notes must be 10–1000 characters.';
    errBox.hidden = false;
    return;
  }
  errBox.hidden = true;
  submittingNote = true;
  const btn = form.querySelector('#note-submit');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
  try {
    await api.submitHandover(text);
    toast('Handover note added.', 'success');
    submittingNote = false;
    await load();
  } catch (err) {
    submittingNote = false;
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Add note';
    toast(err.message, 'error');
  }
}

async function onEndShift() {
  const proceed = await confirmDialog({
    title: 'End shift',
    body: 'You will be signed out. Make sure you have saved a handover note for the next shift.',
    confirmLabel: 'End shift & sign out',
    danger: true,
  });
  if (!proceed) return;
  api.logout();
  window.location.href = '../index.html';
}
