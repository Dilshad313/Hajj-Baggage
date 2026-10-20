import * as api from '../api.js';
import { skeletonBlock, errorState, toast, fmtDateTime, esc } from '../ui.js';

let appEl = null;
let notes = [];

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  notes = [];
  load();
  return { destroy, poll: load, refresh: load };
}

/** Tears down the view. */
export function destroy() { appEl = null; }

function pageHeader() {
  return `<div class="page-header"><div><h1 class="page-title">Admin handover</h1><p class="page-subtitle">Shift summary and handover notes for the next admin on duty.</p></div></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageHeader() + skeletonBlock(6);
  try {
    const data = await api.getHandoverSummary();
    notes = data.notes;
    renderData(data);
  } catch (err) {
    appEl.innerHTML = pageHeader() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderData(data) {
  appEl.innerHTML = `
    ${pageHeader()}
    <dl class="handover-summary grid grid-auto" style="margin-block-end:var(--s6)">
      <div><dt>Open incidents</dt><dd>${esc(data.openIncidents)}</dd></div>
      <div><dt>Vendor tickets</dt><dd>${esc(data.vendorTickets)}</dd></div>
      <div><dt>Config changes today</dt><dd>${esc(data.configChangesToday)}</dd></div>
      <div><dt>Disabled accounts</dt><dd>${esc(data.disabledAccounts)}</dd></div>
    </dl>
    <div class="card" style="max-width:640px;margin-block-end:var(--s6)">
      <h2 class="section-title">Submit handover notes</h2>
      <form id="handover-form" novalidate>
        <div class="field">
          <label for="handover-notes">Notes for the next admin <span class="req">*</span></label>
          <textarea id="handover-notes" required minlength="10" placeholder="Summarize open items, pending escalations, anything the next admin should know…"></textarea>
          <div class="hint">At least 10 characters.</div>
          <div class="error" id="err-handover-notes" hidden></div>
        </div>
        <button type="submit" class="btn btn-primary" id="handover-submit"><span class="label">Submit handover</span></button>
      </form>
    </div>
    <h2 class="section-title">Previous handovers</h2>
    <div id="handover-list" class="stack gap-3">${notesListHtml(notes)}</div>`;
  wireForm();
}

function notesListHtml(list) {
  if (!list.length) return `<p class="muted fs-sm">No handover notes recorded yet.</p>`;
  return list.map((n) => `
    <div class="card">
      <div class="row gap-2" style="justify-content:space-between">
        <strong class="fs-sm">${esc(n.by)}</strong>
        <span class="fs-xs muted">${fmtDateTime(n.submittedAt)}</span>
      </div>
      <p class="fs-sm" style="margin-block-start:var(--s2);white-space:pre-wrap">${esc(n.notes)}</p>
    </div>`).join('');
}

function wireForm() {
  const form = appEl.querySelector('#handover-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const textarea = form.querySelector('#handover-notes');
    const errEl = form.querySelector('#err-handover-notes');
    const value = textarea.value.trim();
    if (value.length < 10) {
      errEl.textContent = 'Enter at least 10 characters.';
      errEl.hidden = false;
      textarea.setAttribute('aria-invalid', 'true');
      return;
    }
    errEl.hidden = true;
    textarea.removeAttribute('aria-invalid');
    const btn = form.querySelector('#handover-submit');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span> Submitting…`;
    try {
      const entry = await api.submitHandover(value);
      notes = [entry, ...notes];
      toast('Handover submitted.', 'success');
      textarea.value = '';
      appEl.querySelector('#handover-list').innerHTML = notesListHtml(notes);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = `<span class="label">Submit handover</span>`;
    }
  });
}
