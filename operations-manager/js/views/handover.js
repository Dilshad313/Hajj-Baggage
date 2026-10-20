import * as api from '../api.js';
import { skeletonBlock, errorState, toast, fmtDateTime, esc } from '../ui.js';

let appEl = null;
let notesList = [];

/**
 * Renders the shift handover screen.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy: Function, refresh: Function}}
 */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, refresh: load };
}

/** Tears down the view's module state. */
export function destroy() {
  appEl = null;
  notesList = [];
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(8);
  try {
    const summary = await api.getHandoverSummary();
    notesList = summary.notes;
    renderPage(summary);
  } catch (err) {
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function summaryHtml(summary) {
  return `
    <div class="card">
      <h2 class="section-title">Shift summary</h2>
      <dl class="handover-summary">
        <dt>Open critical/high exceptions</dt><dd>${summary.openCriticalHigh}</dd>
        <dt>Flights pending closure</dt><dd>${summary.flightsPendingClosure}</dd>
        <dt>Trucks delayed</dt><dd>${summary.trucksDelayed}</dd>
      </dl>
    </div>`;
}

function formHtml() {
  return `
    <div class="card" style="margin-block:var(--s6)">
      <h2 class="section-title">Submit handover</h2>
      <div class="field">
        <label for="ho-notes">Notes <span class="req">*</span></label>
        <textarea id="ho-notes" minlength="10" maxlength="1000" placeholder="10–1000 characters"></textarea>
        <div class="error" id="err-ho-notes" hidden></div>
      </div>
      <div class="field">
        <label for="ho-to">Hand over to</label>
        <input id="ho-to" placeholder="Optional — next admin/manager's name" maxlength="120" />
      </div>
      <button type="button" class="btn btn-primary" data-action="submit-handover">Submit handover</button>
    </div>`;
}

function noteItemHtml(n) {
  return `
    <div class="card" style="margin-block-end:var(--s3)">
      <div class="row fs-sm muted" style="justify-content:space-between;flex-wrap:wrap">
        <span>${fmtDateTime(n.submittedAt)} · ${esc(n.by)}</span>
        ${n.handoverTo ? `<span>To: ${esc(n.handoverTo)}</span>` : ''}
      </div>
      <p class="fs-sm" style="margin-block-start:var(--s2)">${esc(n.notes)}</p>
    </div>`;
}

function notesListHtml() {
  return `
    <h2 class="section-title">Previous handovers</h2>
    <div id="handover-notes-list">
      ${notesList.length ? notesList.map(noteItemHtml).join('') : '<p class="muted fs-sm">No previous handovers recorded.</p>'}
    </div>`;
}

function renderPage(summary) {
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Shift handover</h1><p class="page-subtitle">Summarise the shift and hand over open items to the next admin.</p></div>
    </div>
    ${summaryHtml(summary)}
    ${formHtml()}
    ${notesListHtml()}`;
  wireForm();
}

function setErr(id, msg) {
  const el = appEl.querySelector(`#err-${id}`);
  if (!el) return;
  if (msg) { el.textContent = msg; el.hidden = false; } else el.hidden = true;
}

function wireForm() {
  appEl.querySelector('[data-action="submit-handover"]')?.addEventListener('click', submitHandover);
}

async function submitHandover() {
  const notesInput = appEl.querySelector('#ho-notes');
  const toInput = appEl.querySelector('#ho-to');
  const notes = notesInput.value.trim();
  const handoverTo = toInput.value.trim();
  if (notes.length < 10 || notes.length > 1000) {
    setErr('ho-notes', 'Notes must be 10–1000 characters.');
    return;
  }
  setErr('ho-notes', '');
  const btn = appEl.querySelector('[data-action="submit-handover"]');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    const entry = await api.submitHandover({ notes, handoverTo });
    notesList = [entry, ...notesList];
    toast('Handover submitted.', 'success');
    notesInput.value = '';
    toInput.value = '';
    const listEl = appEl.querySelector('#handover-notes-list');
    if (listEl) listEl.innerHTML = notesList.map(noteItemHtml).join('');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}
