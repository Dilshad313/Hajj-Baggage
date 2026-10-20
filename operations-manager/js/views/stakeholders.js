import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, toast, fmtDateTime, esc, icon } from '../ui.js';

let appEl = null;
let logState = { status: 'idle', entries: [], error: null };
let sending = false;

const AUDIENCES = ['Rabel management', 'Airlines', 'Hotels', 'Nusuk liaison'];

/**
 * Renders the stakeholder notifications view.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy: Function}}
 */
export function render(params, app) {
  appEl = app;
  sending = false;
  logState = { status: 'loading', entries: [], error: null };
  renderPage();
  loadLog();
  return { destroy };
}

/** Destroys the stakeholders view. */
export function destroy() {
  appEl = null;
}

function renderPage() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Stakeholder notifications</h1><p class="page-subtitle">Notify Rabel management, airlines, hotels and the Nusuk liaison about operational updates.</p></div>
    </div>
    <div class="card" style="margin-block-end:var(--s6)">
      <h2 class="section-title">Compose notification</h2>
      <form id="stakeholder-form" novalidate>
        <fieldset class="field" style="border:none;padding:0">
          <legend class="fs-sm" style="font-weight:var(--fw-medium);color:var(--text-2);padding:0">Audiences <span class="req">*</span></legend>
          <div class="row gap-2 wrap" style="margin-block-start:var(--s2)">
            ${AUDIENCES.map((a, i) => `
              <label class="audience-chip">
                <input type="checkbox" name="audience" value="${esc(a)}" id="aud-${i}" />
                ${esc(a)}
              </label>`).join('')}
          </div>
          <div class="error" id="err-audiences" hidden></div>
        </fieldset>
        <div class="field">
          <label for="stk-subject">Subject <span class="req">*</span></label>
          <input id="stk-subject" type="text" maxlength="120" placeholder="3–120 characters" />
          <div class="error" id="err-subject" hidden></div>
        </div>
        <div class="field">
          <label for="stk-message">Message <span class="req">*</span></label>
          <textarea id="stk-message" maxlength="2000" placeholder="10–2000 characters"></textarea>
          <div class="error" id="err-message" hidden></div>
        </div>
        <div class="field">
          <label for="stk-report-link">Attach report link</label>
          <input id="stk-report-link" type="text" placeholder="Optional — e.g. #/reports or a short description" />
          <div class="hint">Optional. Free text — a link or a short description of the report being referenced.</div>
        </div>
        <button type="submit" class="btn btn-primary" id="stk-send-btn">${icon('send', 16)} Send</button>
      </form>
    </div>
    <h2 class="section-title">Sent log</h2>
    <div id="stakeholder-log-root"></div>`;
  appEl.querySelector('#stakeholder-form').addEventListener('submit', onSubmit);
  renderLog();
}

function setErr(id, msg) {
  const el = appEl?.querySelector(`#err-${id}`);
  if (!el) return;
  if (msg) { el.textContent = msg; el.hidden = false; } else el.hidden = true;
}

function setInvalid(fieldEl, invalid) {
  if (!fieldEl) return;
  if (invalid) fieldEl.setAttribute('aria-invalid', 'true');
  else fieldEl.removeAttribute('aria-invalid');
}

function onSubmit(e) {
  e.preventDefault();
  if (sending) return;
  const form = e.currentTarget;
  const audiences = Array.from(form.querySelectorAll('input[name="audience"]:checked')).map((cb) => cb.value);
  const subjectEl = form.querySelector('#stk-subject');
  const messageEl = form.querySelector('#stk-message');
  const reportLinkEl = form.querySelector('#stk-report-link');
  const subject = subjectEl.value.trim();
  const message = messageEl.value.trim();
  const reportLink = reportLinkEl.value.trim();

  let valid = true;
  if (audiences.length === 0) { setErr('audiences', 'Select at least one audience.'); valid = false; } else setErr('audiences', '');
  if (subject.length < 3 || subject.length > 120) { setErr('subject', 'Subject must be 3–120 characters.'); setInvalid(subjectEl, true); valid = false; } else { setErr('subject', ''); setInvalid(subjectEl, false); }
  if (message.length < 10 || message.length > 2000) { setErr('message', 'Message must be 10–2000 characters.'); setInvalid(messageEl, true); valid = false; } else { setErr('message', ''); setInvalid(messageEl, false); }
  if (!valid) return;

  sending = true;
  const btn = form.querySelector('#stk-send-btn');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  api.notifyStakeholders({ audiences, subject, message, reportLink }).then((entry) => {
    toast('Notification sent to stakeholders.', 'success');
    form.reset();
    form.querySelectorAll('.error').forEach((el) => { el.hidden = true; });
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    logState = { status: 'success', entries: [entry, ...(logState.status === 'success' ? logState.entries : [])], error: null };
    renderLog();
  }).catch((err) => {
    toast(err.message, 'error');
  }).finally(() => {
    sending = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  });
}

function renderLog() {
  if (!appEl) return;
  const root = appEl.querySelector('#stakeholder-log-root');
  if (!root) return;
  if (logState.status === 'loading') { root.innerHTML = skeletonBlock(4); return; }
  if (logState.status === 'error') {
    root.innerHTML = errorState({ message: logState.error, retryAttr: 'data-action="retry-log"' });
    root.querySelector('[data-action="retry-log"]')?.addEventListener('click', loadLog);
    return;
  }
  if (!logState.entries.length) {
    root.innerHTML = emptyState({ message: 'No stakeholder notifications sent yet.' });
    return;
  }
  root.innerHTML = `<div class="stack gap-3">${logState.entries.map(logEntryHtml).join('')}</div>`;
}

function previewText(text, max = 180) {
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function logEntryHtml(entry) {
  return `
    <div class="card">
      <div class="row gap-2 wrap" style="margin-block-end:var(--s2)">
        ${entry.audiences.map((a) => `<span class="chip chip-blue">${esc(a)}</span>`).join('')}
      </div>
      <strong>${esc(entry.subject)}</strong>
      <p class="fs-sm text-2" style="margin-block:var(--s2)">${esc(previewText(entry.message))}</p>
      ${entry.reportLink ? `<p class="fs-xs muted">${icon('link', 14)} ${esc(entry.reportLink)}</p>` : ''}
      <div class="fs-xs muted">${esc(fmtDateTime(entry.sentAt))}</div>
    </div>`;
}

function loadLog() {
  logState = { status: 'loading', entries: [], error: null };
  renderLog();
  api.getStakeholderLog().then((entries) => {
    logState = { status: 'success', entries, error: null };
    renderLog();
  }).catch((err) => {
    logState = { status: 'error', entries: [], error: err.message };
    renderLog();
  });
}
