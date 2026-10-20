import * as api from '../api.js';
import { toast, icon, esc, fmtRelative, skeletonBlock, emptyState, errorState, announce } from '../ui.js';
import { navigate } from '../router.js';
import { statusChip } from '../components/status-chip.js';
import { SUPPORT_SUBJECTS } from '../seed.js';

const BAG_REQUIRED_SUBJECTS = ['Missing bag', 'Damaged bag'];

let appEl = null;
let mounted = false;
let subview = 'list'; // 'list' | 'new' | 'thread'

// --- list state ---
let tickets = [];
let listLoading = true;
let listError = '';
let supportPhone = '';

// --- new-ticket form state ---
let bagsForForm = [];
let bagsLoading = true;
let bagsError = '';
let submitting = false;

// --- thread state ---
let ticketId = null;
let ticket = null;
let threadLoading = true;
let threadError = '';
let sending = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  const path = location.hash.replace(/^#/, '').split('?')[0];

  if (params.id) {
    subview = 'thread';
    ticketId = params.id;
    ticket = null; threadLoading = true; threadError = ''; sending = false;
    renderThreadShell();
    loadThread();
  } else if (path === '/support/new') {
    subview = 'new';
    bagsForForm = []; bagsLoading = true; bagsError = ''; submitting = false;
    renderNewShell();
    loadNewFormData();
  } else {
    subview = 'list';
    tickets = []; listLoading = true; listError = ''; supportPhone = '';
    renderListShell();
    loadList();
  }

  return { destroy, poll, activeTicketId };
}

export function destroy() {
  mounted = false;
  appEl = null;
  tickets = []; listLoading = true; listError = ''; supportPhone = '';
  bagsForForm = []; bagsLoading = true; bagsError = ''; submitting = false;
  ticketId = null; ticket = null; threadLoading = true; threadError = ''; sending = false;
}

function activeTicketId() {
  return subview === 'thread' ? ticketId : null;
}

async function poll() {
  if (!mounted || subview !== 'thread' || !ticket || threadLoading) return;
  const input = appEl.querySelector('#reply-input');
  if (input && document.activeElement === input) return; // don't disrupt an in-progress reply
  try {
    const updated = await api.getTicket(ticketId);
    if (!mounted || subview !== 'thread') return;
    const changed = updated.messages.length !== ticket.messages.length;
    ticket = updated;
    if (changed) {
      renderThreadShell();
      scrollThreadToBottom();
    }
  } catch (e) { /* silent poll failure */ }
}

/* ===================== list view (#/support) ===================== */

async function loadList() {
  listLoading = true; listError = '';
  renderListShell();
  try {
    const [tix, limits] = await Promise.all([api.getTickets(), api.getBookingLimits()]);
    if (!mounted || subview !== 'list') return;
    tickets = tix;
    supportPhone = limits.supportPhone || '';
    listLoading = false;
    renderListShell();
  } catch (err) {
    if (!mounted || subview !== 'list') return;
    listLoading = false;
    listError = err.message;
    renderListShell();
  }
}

function renderListShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Support</h1>
    </div>
    <div class="stack gap-4">
      <a class="btn btn-primary btn-block" href="#/support/new">${icon('plus', 18)} New ticket</a>
      <div id="support-list-body">${listBodyHtml()}</div>
      ${supportPhone ? `<p class="info-note">${icon('phone', 16)} <span>Need urgent help? Call <a href="tel:${esc(supportPhone.replace(/\s+/g, ''))}">${esc(supportPhone)}</a></span></p>` : ''}
    </div>`;
  wireList();
}

function listBodyHtml() {
  if (listLoading) return skeletonBlock(4);
  if (listError) return errorState({ message: listError });
  if (!tickets.length) return emptyState({ message: 'No support tickets yet.' });
  return `<div class="stack gap-3">${tickets.map(ticketCardHtml).join('')}</div>`;
}

function ticketCardHtml(t) {
  const last = t.messages[t.messages.length - 1];
  const preview = last ? truncate(last.text, 80) : '';
  return `
    <a class="card card-tap" href="#/ticket/${esc(t.id)}">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="grow">
          <strong>${esc(t.subject)}</strong>
          <p class="fs-sm muted" style="margin:4px 0 0">${esc(preview)}</p>
          <p class="fs-xs muted" style="margin:4px 0 0">${fmtRelative(t.createdAt)}</p>
        </div>
        ${statusChip(t.status)}
      </div>
    </a>`;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function wireList() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', loadList);
}

/* ===================== new-ticket form (#/support/new) ===================== */

async function loadNewFormData() {
  bagsLoading = true; bagsError = '';
  renderNewShell();
  try {
    const bags = await api.getBags();
    if (!mounted || subview !== 'new') return;
    bagsForForm = bags;
    bagsLoading = false;
    renderNewShell();
  } catch (err) {
    if (!mounted || subview !== 'new') return;
    bagsLoading = false;
    bagsError = err.message;
    renderNewShell();
  }
}

function renderNewShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">New support ticket</h1>
    </div>
    <div id="new-ticket-body">${newBodyHtml()}</div>`;
  wireNewForm();
}

function newBodyHtml() {
  if (bagsLoading) return skeletonBlock(4);
  if (bagsError) return errorState({ message: bagsError });
  return newFormHtml();
}

function newFormHtml() {
  const defaultSubject = SUPPORT_SUBJECTS[0];
  const needsBag = BAG_REQUIRED_SUBJECTS.includes(defaultSubject);
  return `
    <form id="new-ticket-form" novalidate>
      <div class="field">
        <label for="subject">Subject <span class="req">*</span></label>
        <select id="subject" name="subject" required>
          ${SUPPORT_SUBJECTS.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
        </select>
      </div>
      <div class="field" id="bag-field" ${needsBag ? '' : 'hidden'}>
        <label for="bagId">Bag <span class="req">*</span></label>
        <select id="bagId" name="bagId" ${needsBag ? 'required' : ''}>
          <option value="">Select a bag</option>
          ${bagsForForm.map((b) => `<option value="${esc(b.id)}">${esc(b.tagNumber)}</option>`).join('')}
        </select>
        <div class="error" id="err-bag" hidden></div>
      </div>
      <div class="field">
        <label for="message">Message <span class="req">*</span></label>
        <textarea id="message" name="message" required minlength="10" maxlength="1000" placeholder="Describe your issue…"></textarea>
        <div class="hint" id="char-count">0 / 1000</div>
        <div class="error" id="err-message" hidden></div>
      </div>
      <div class="row gap-3">
        <a class="btn btn-secondary" href="#/support" style="flex:1">Cancel</a>
        <button type="submit" class="btn btn-primary" id="submit-ticket-btn" style="flex:1">
          <span class="label">Submit ticket</span>
        </button>
      </div>
    </form>`;
}

function wireNewForm() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', loadNewFormData);
  const form = appEl.querySelector('#new-ticket-form');
  if (!form) return;

  const bagNeeded = () => BAG_REQUIRED_SUBJECTS.includes(form.subject.value);

  function updateBagVisibility() {
    const bagField = appEl.querySelector('#bag-field');
    const needed = bagNeeded();
    bagField.hidden = !needed;
    if (needed) {
      form.bagId.setAttribute('required', 'true');
    } else {
      form.bagId.removeAttribute('required');
      appEl.querySelector('#err-bag').hidden = true;
      form.bagId.removeAttribute('aria-invalid');
    }
  }

  function validate() {
    let valid = true;
    const bagErr = appEl.querySelector('#err-bag');
    const msgErr = appEl.querySelector('#err-message');
    if (bagNeeded() && !form.bagId.value) {
      bagErr.textContent = 'Select a bag for this subject.'; bagErr.hidden = false;
      form.bagId.setAttribute('aria-invalid', 'true'); valid = false;
    } else {
      bagErr.hidden = true; form.bagId.removeAttribute('aria-invalid');
    }
    const text = form.message.value.trim();
    if (text.length < 10 || text.length > 1000) {
      msgErr.textContent = 'Message must be 10–1000 characters.'; msgErr.hidden = false;
      form.message.setAttribute('aria-invalid', 'true'); valid = false;
    } else {
      msgErr.hidden = true; form.message.removeAttribute('aria-invalid');
    }
    return valid;
  }

  form.subject.addEventListener('change', updateBagVisibility);
  form.bagId?.addEventListener('blur', validate);
  form.message.addEventListener('input', () => {
    const count = appEl.querySelector('#char-count');
    if (count) count.textContent = `${form.message.value.length} / 1000`;
  });
  form.message.addEventListener('blur', validate);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitting || !validate()) return;
    submitting = true;
    const btn = appEl.querySelector('#submit-ticket-btn');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    btn.querySelector('.label').textContent = 'Submitting…';
    try {
      const created = await api.createTicket({
        subject: form.subject.value,
        bagId: bagNeeded() ? form.bagId.value : null,
        message: form.message.value,
      });
      if (!mounted) return;
      toast('Ticket submitted.', 'success');
      navigate(`#/ticket/${created.id}`);
    } catch (err) {
      if (!mounted) return;
      submitting = false;
      btn.disabled = false; btn.removeAttribute('aria-busy');
      btn.querySelector('.label').textContent = 'Submit ticket';
      toast(err.message, 'error');
      announce(err.message);
    }
  });
}

/* ===================== ticket thread (#/ticket/:id) ===================== */

async function loadThread() {
  threadLoading = true; threadError = '';
  renderThreadShell();
  try {
    const t = await api.getTicket(ticketId);
    if (!mounted || subview !== 'thread') return;
    ticket = t;
    threadLoading = false;
    renderThreadShell();
    scrollThreadToBottom();
  } catch (err) {
    if (!mounted || subview !== 'thread') return;
    threadLoading = false;
    threadError = err.message;
    renderThreadShell();
  }
}

function renderThreadShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${ticket ? esc(ticket.subject) : 'Support ticket'}</h1>
      ${ticket ? `<div class="row gap-2" style="margin-block-start:var(--s2)">${statusChip(ticket.status)}</div>` : ''}
    </div>
    <div id="thread-body">${threadBodyHtml()}</div>
    ${ticket ? composerHtml() : ''}`;
  wireThread();
}

function threadBodyHtml() {
  if (threadLoading) return skeletonBlock(4);
  if (threadError) return errorState({ message: threadError });
  if (!ticket) return '';
  return `<div class="stack gap-3" id="message-list">${ticket.messages.map(messageHtml).join('')}</div>`;
}

function messageHtml(m) {
  const mine = m.from === 'pilgrim';
  return `
    <div class="row" style="justify-content:${mine ? 'flex-end' : 'flex-start'}">
      <div class="card" style="max-width:80%;${mine ? 'background:var(--accent-soft);border-color:var(--accent)' : ''}">
        <p class="fs-sm" style="margin:0;white-space:pre-wrap">${esc(m.text)}</p>
        <p class="fs-xs muted" style="margin:4px 0 0;text-align:${mine ? 'right' : 'left'}">${mine ? 'You' : 'Support'} · ${fmtRelative(m.at)}</p>
      </div>
    </div>`;
}

function composerHtml() {
  const closed = ticket.status === 'Resolved' || ticket.status === 'Closed';
  return `
    <div class="footer-bar">
      <input id="reply-input" type="text" placeholder="${closed ? 'This ticket is closed' : 'Type a message…'}" ${closed ? 'disabled' : ''} style="flex:1" />
      <button type="button" class="btn btn-primary btn-icon" id="reply-send" aria-label="Send message" ${closed || sending ? 'disabled' : ''}>${icon('send', 18)}</button>
    </div>`;
}

function wireThread() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', loadThread);
  const input = appEl.querySelector('#reply-input');
  const sendBtn = appEl.querySelector('#reply-send');
  if (!input || !sendBtn) return;
  const send = () => sendReply(input.value);
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
}

async function sendReply(text) {
  const value = (text || '').trim();
  if (!value || sending) return;
  sending = true;
  const input = appEl.querySelector('#reply-input');
  const sendBtn = appEl.querySelector('#reply-send');
  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
  try {
    const updated = await api.sendMessage(ticketId, value);
    if (!mounted || subview !== 'thread') return;
    ticket = updated;
    sending = false;
    renderThreadShell();
    scrollThreadToBottom();
  } catch (err) {
    if (!mounted || subview !== 'thread') return;
    sending = false;
    toast(err.message, 'error');
    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function scrollThreadToBottom() {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
}
