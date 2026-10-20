import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, errorState, confirmDialog,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';

let appEl = null;
let step = 'loading'; // loading | error | ready
let errorMessage = '';
let data = null;
let submitting = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  step = 'loading';
  errorMessage = '';
  data = null;
  submitting = false;
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  step = 'loading';
  renderPage();
  try {
    data = await api.getHandoverSummary();
    if (!appEl) return;
    step = 'ready';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    errorMessage = err.message;
    step = 'error';
    renderPage();
  }
}

function pageHeader() {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">Handover</h1>
        <p class="page-subtitle">End-of-shift summary and notes for the next team.</p>
      </div>
    </div>`;
}

function renderPage() {
  if (!appEl) return;
  if (step === 'loading') {
    appEl.innerHTML = `${pageHeader()}${skeletonBlock(6)}`;
    return;
  }
  if (step === 'error') {
    appEl.innerHTML = `${pageHeader()}${errorState({ message: errorMessage })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  renderReady();
}

function renderReady() {
  appEl.innerHTML = `
    ${pageHeader()}
    <div class="section-title">Shift summary</div>
    <div class="grid grid-cols-3" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Open exceptions', value: data.openExceptions })}
      ${kpiTile({ label: 'Inbound at gate', value: data.inboundAtGate })}
      ${kpiTile({ label: 'Outbound not departed', value: data.outboundNotDeparted })}
    </div>

    ${data.blockers.length ? `
      <div role="alert" style="background:var(--warning-soft);color:var(--warning);padding:var(--s4);border-radius:var(--r-lg);margin-block-end:var(--s6)">
        <div class="row gap-2 fw-medium" style="margin-block-end:var(--s2)">${icon('alert-triangle', 18)} Before you end your shift</div>
        <div class="stack gap-1">
          ${data.blockers.map((b) => `<p class="fs-sm" style="margin:0">${esc(b)}</p>`).join('')}
        </div>
      </div>` : ''}

    <div class="section-title">Handover notes</div>
    <div class="card" style="margin-block-end:var(--s6);max-width:620px">
      <div id="notes-list" class="stack gap-2" style="margin-block-end:var(--s4)"></div>
      <form id="handover-form" novalidate>
        <div class="field">
          <label for="handover-notes">Add a note for the next shift <span class="req">*</span></label>
          <textarea id="handover-notes" placeholder="10–1000 characters" required></textarea>
          <div class="error" id="err-handover-notes" hidden></div>
        </div>
        <button type="submit" class="btn btn-primary" id="handover-submit">${icon('send', 16)} Submit note</button>
      </form>
    </div>

    <div class="section-title">End shift</div>
    <div class="card" style="max-width:620px">
      <p class="fs-sm muted" style="margin-block-end:var(--s4)">Make sure you've saved a handover note before signing out.</p>
      <button type="button" class="btn btn-danger" id="end-shift-btn">${icon('log-out', 16)} End shift &amp; sign out</button>
    </div>`;

  renderNotesList();
  appEl.querySelector('#handover-form').addEventListener('submit', onSubmitNote);
  appEl.querySelector('#end-shift-btn').addEventListener('click', onEndShift);
}

function renderNotesList() {
  const root = appEl.querySelector('#notes-list');
  if (!root) return;
  if (!data.notes.length) {
    root.innerHTML = `<p class="fs-sm muted">No handover notes yet.</p>`;
    return;
  }
  root.innerHTML = data.notes.map((n) => `
    <div style="border-bottom:1px solid var(--border);padding-block-end:var(--s2)">
      <p class="fs-sm">${esc(n.notes)}</p>
      <p class="fs-xs muted">${esc(n.by)} &middot; ${esc(fmtDateTime(n.submittedAt))}</p>
    </div>`).join('');
}

async function onSubmitNote(e) {
  e.preventDefault();
  if (submitting) return;
  const form = e.currentTarget;
  const value = form.querySelector('#handover-notes').value.trim();
  const errBox = form.querySelector('#err-handover-notes');
  if (value.length < 10 || value.length > 1000) {
    errBox.textContent = 'Notes must be 10–1000 characters.';
    errBox.hidden = false;
    return;
  }
  errBox.hidden = true;
  submitting = true;
  const btn = form.querySelector('#handover-submit');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Submitting…';
  try {
    await api.submitHandover(value);
    toast('Handover note saved.', 'success');
    submitting = false;
    await load();
  } catch (err) {
    submitting = false;
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = `${icon('send', 16)} Submit note`;
    toast(err.message, 'error');
  }
}

async function onEndShift() {
  const confirmed = await confirmDialog({
    title: 'End shift',
    body: 'You will be signed out. Make sure you have saved a handover note for the next shift.',
    confirmLabel: 'End shift & sign out',
    danger: true,
  });
  if (!confirmed) return;
  api.logout();
  window.location.href = '../index.html';
}
