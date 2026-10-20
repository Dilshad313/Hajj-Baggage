import * as api from '../api.js';
import { esc, icon, toast, fmtDateTime, skeletonBlock, errorState, confirmDialog } from '../ui.js';
import { navigate } from '../router.js';
import { kpiTile } from '../components/kpi-tile.js';

let appEl = null;
let summary = null;
let loadError = '';
let submitting = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  summary = null;
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
  renderSkeleton();
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

function renderSkeleton() {
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Handover</h1></div>${skeletonBlock(6)}`;
}

function renderPage() {
  if (!appEl) return;
  if (loadError) {
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">Handover</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
    return;
  }

  const notesHtml = summary.notes.length
    ? summary.notes.map((n) => `
      <div class="stack gap-1" style="padding:var(--s3) 0;border-bottom:1px solid var(--border)">
        <div class="row" style="justify-content:space-between">
          <strong class="fs-sm">${esc(n.by)}</strong>
          <span class="fs-xs muted">${esc(fmtDateTime(n.submittedAt))}</span>
        </div>
        <p class="fs-sm">${esc(n.notes)}</p>
      </div>`).join('')
    : `<p class="fs-sm muted">No handover notes yet.</p>`;

  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Handover</h1>
    </div>

    <div class="section-title">Shift summary</div>
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Open exceptions', value: summary.openExceptions })}
      ${kpiTile({ label: 'Trucks pending verification', value: summary.trucksPendingVerification })}
      ${kpiTile({ label: 'Bags awaiting sort', value: summary.bagsAwaitingSort })}
      ${kpiTile({ label: 'Runs not yet assigned', value: summary.runsNotYetAssigned })}
    </div>

    <div class="section-title">Handover notes</div>
    <form id="handover-form" novalidate style="margin-block-end:var(--s4)">
      <div class="field">
        <label for="handover-notes">New note <span class="req">*</span></label>
        <textarea id="handover-notes" placeholder="What does the next shift need to know? (10–1000 characters)" required></textarea>
        <div class="error" id="err-handover-notes" hidden></div>
      </div>
      <button type="submit" class="btn btn-primary" id="handover-submit">${icon('save', 16)} Save handover note</button>
    </form>
    <div id="notes-list">${notesHtml}</div>

    <div class="section-title" style="margin-block-start:var(--s6)">End shift &amp; sign out</div>
    <p class="fs-sm muted" style="margin-block-end:var(--s3)">You will be signed out. Make sure you have saved a handover note for the next shift.</p>
    <button type="button" class="btn btn-danger" data-action="end-shift">${icon('log-out', 16)} End shift &amp; sign out</button>`;

  appEl.querySelector('#handover-form').addEventListener('submit', onSubmitNote);
  appEl.querySelector('[data-action="end-shift"]').addEventListener('click', onEndShift);
}

async function onSubmitNote(e) {
  e.preventDefault();
  if (submitting) return;
  const form = e.currentTarget;
  const textarea = form.querySelector('#handover-notes');
  const notes = textarea.value.trim();
  const errBox = form.querySelector('#err-handover-notes');
  if (notes.length < 10 || notes.length > 1000) {
    errBox.textContent = 'Notes must be 10–1000 characters.';
    errBox.hidden = false;
    textarea.setAttribute('aria-invalid', 'true');
    return;
  }
  errBox.hidden = true;
  textarea.removeAttribute('aria-invalid');
  submitting = true;
  const btn = form.querySelector('#handover-submit');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Saving…';
  try {
    await api.submitHandover(notes);
    toast('Handover note saved.', 'success');
    submitting = false;
    await load();
  } catch (err) {
    submitting = false;
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = `${icon('save', 16)} Save handover note`;
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
