import * as api from '../api.js';
import {
  esc, icon, toast, fmtDateTime, skeletonBlock, errorState, confirmDialog,
} from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { navigate } from '../router.js';

let appEl = null;
let data = null; // { openExceptions, batchesMidVerification, flightsNearCutoffUnconfirmed, notes }
let loadError = '';
let submitting = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  data = null;
  loadError = '';
  submitting = false;
  load();
  return { destroy, refresh: load };
}

export function destroy() {
  appEl = null;
}

async function load() {
  if (!appEl) return;
  if (!data) renderSkeleton();
  try {
    const result = await api.getHandoverSummary();
    if (!appEl) return;
    data = result;
    loadError = '';
    renderPage();
  } catch (err) {
    if (!appEl) return;
    loadError = err.message;
    renderPage();
  }
}

function renderSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Handover</h1></div>${skeletonBlock(6)}`;
}

function noteRowHtml(n) {
  return `
    <div style="border-bottom:1px solid var(--border);padding-block-end:var(--s3)">
      <p class="fs-sm">${esc(n.notes)}</p>
      <p class="fs-xs muted">${esc(n.by)} · ${esc(fmtDateTime(n.submittedAt))}</p>
    </div>`;
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Handover</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }
  const { openExceptions, batchesMidVerification, flightsNearCutoffUnconfirmed, notes } = data;
  const blocked = batchesMidVerification > 0 || flightsNearCutoffUnconfirmed > 0;

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Handover</h1>
        <p class="page-subtitle">Review the shift summary and leave a note for the next shift before signing out.</p>
      </div>
    </div>

    ${blocked ? `
      <div class="card" role="status" style="margin-block-end:var(--s4);border-color:var(--warning);background:var(--warning-soft)">
        ${icon('alert-triangle', 16)} Handover is blocked while a batch is mid-verification or a flight within 60 minutes of departure isn't confirmed loaded.
      </div>` : ''}

    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Shift summary</h2>
      <div class="grid grid-auto">
        ${kpiTile({ label: 'Open exceptions', value: openExceptions })}
        ${kpiTile({ label: 'Batches mid-verification', value: batchesMidVerification })}
        ${kpiTile({ label: 'Flights near cut-off, unconfirmed', value: flightsNearCutoffUnconfirmed })}
      </div>
    </div>

    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Handover notes</h2>
      <div class="stack gap-3" id="handover-notes-list" style="margin-block-end:var(--s4)">
        ${notes.length ? notes.map(noteRowHtml).join('') : '<p class="fs-sm muted">No handover notes yet.</p>'}
      </div>
      <form id="handover-note-form" novalidate>
        <div class="field">
          <label for="handover-note-input">New note <span class="req">*</span></label>
          <textarea id="handover-note-input" placeholder="What does the next shift need to know? (10–1000 characters)" required></textarea>
          <div class="error" id="err-handover-note" hidden></div>
        </div>
        <button type="submit" class="btn btn-primary" id="handover-note-submit" ${submitting ? 'disabled aria-busy="true"' : ''}>
          ${submitting ? '<span class="spinner"></span> Saving…' : 'Save handover note'}
        </button>
      </form>
    </div>

    <div class="card">
      <h2 class="section-title">End shift &amp; sign out</h2>
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">You'll be signed out and returned to the login screen.</p>
      <button type="button" class="btn btn-danger" data-action="end-shift">${icon('log-out', 16)} End shift &amp; sign out</button>
    </div>`;

  appEl.querySelector('#handover-note-form').addEventListener('submit', onSubmitNote);
  appEl.querySelector('[data-action="end-shift"]').addEventListener('click', onEndShift);
}

async function onSubmitNote(e) {
  e.preventDefault();
  if (submitting) return;
  const form = e.target;
  const textarea = form.querySelector('#handover-note-input');
  const text = textarea.value.trim();
  const errBox = form.querySelector('#err-handover-note');
  if (text.length < 10 || text.length > 1000) {
    errBox.textContent = 'Handover notes must be 10–1000 characters.';
    errBox.hidden = false;
    return;
  }
  errBox.hidden = true;
  submitting = true;
  const btn = form.querySelector('#handover-note-submit');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Saving…';
  try {
    await api.submitHandover(text);
    if (!appEl) return;
    submitting = false;
    toast('Handover note saved.', 'success');
    await load();
  } catch (err) {
    submitting = false;
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Save handover note';
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
  navigate('#/login');
}
