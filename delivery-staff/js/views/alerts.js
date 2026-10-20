import * as api from '../api.js';
import {
  skeletonBlock, errorState, emptyState, esc, icon, fmtDateTime, fmtRelative, toast,
} from '../ui.js';
import { statusChip, severityChip } from '../components/status-chip.js';

let appEl = null;

const SUPERVISOR_PHONE = '+966500000999';

/**
 * Renders the Alerts view: the staff member's notifications and the
 * exceptions raised on their own delivery runs.
 * @param {object} params route params (unused)
 * @param {HTMLElement} app mount point
 * @returns {{destroy:Function, poll:Function, refresh:Function}}
 */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: load, refresh: load };
}

/** Tears down the Alerts view. */
export function destroy() {
  appEl = null;
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Alerts</h1></div>
      <button type="button" class="btn btn-secondary" data-action="mark-all-read">${icon('check-check', 16)} Mark all read</button>
    </div>

    <h2 class="section-title">Notifications</h2>
    <div id="notifications-root"></div>

    <h2 class="section-title" style="margin-block-start:var(--s6)">My delivery exceptions</h2>
    <div class="row gap-2 wrap" style="margin-block-end:var(--s4)">
      <a class="btn btn-secondary" href="tel:${esc(SUPERVISOR_PHONE)}">${icon('phone', 16)} Contact supervisor</a>
    </div>
    <div id="exceptions-root"></div>`;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell();
  appEl.querySelector('[data-action="mark-all-read"]').addEventListener('click', markAllRead);
  const notifRoot = appEl.querySelector('#notifications-root');
  const excRoot = appEl.querySelector('#exceptions-root');
  notifRoot.innerHTML = skeletonBlock(3);
  excRoot.innerHTML = skeletonBlock(2);
  try {
    const { notifications, exceptions } = await api.getAlerts();
    if (!appEl) return;
    renderNotifications(notifRoot, notifications);
    renderExceptions(excRoot, exceptions);
  } catch (err) {
    if (!appEl) return;
    notifRoot.innerHTML = errorState({ message: err.message });
    excRoot.innerHTML = '';
    notifRoot.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function markAllRead() {
  const btn = appEl.querySelector('[data-action="mark-all-read"]');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await api.markRead('all');
    toast('All notifications marked as read.', 'success');
    load();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

function renderNotifications(root, notifications) {
  if (!notifications.length) {
    root.innerHTML = emptyState({ message: 'No notifications yet.' });
    return;
  }
  root.innerHTML = `<div class="stack gap-2">${notifications.map(notificationHtml).join('')}</div>`;
  root.querySelectorAll('[data-action="open-notification"]').forEach((a) => {
    a.addEventListener('click', () => {
      api.markRead(a.dataset.id).catch(() => { /* best-effort — navigation still proceeds */ });
    });
  });
}

function notificationHtml(n) {
  return `
    <a class="card card-tap" href="${esc(n.link)}" data-action="open-notification" data-id="${esc(n.id)}" title="${esc(fmtDateTime(n.time))}">
      <div class="row gap-3" style="align-items:flex-start">
        ${n.unread ? `<span class="chip chip-blue">New</span>` : ''}
        <div class="grow">
          <strong class="fs-sm ${n.unread ? 'fw-bold' : ''}">${esc(n.title)}</strong>
          <div class="fs-sm text-2" style="margin-block-start:2px">${esc(n.body)}</div>
          <div class="fs-xs muted" style="margin-block-start:var(--s2)">${esc(fmtRelative(n.time))}</div>
        </div>
      </div>
    </a>`;
}

function renderExceptions(root, exceptions) {
  if (!exceptions.length) {
    root.innerHTML = emptyState({ message: 'No delivery exceptions on your runs.' });
    return;
  }
  root.innerHTML = `<div class="stack gap-3">${exceptions.map(exceptionHtml).join('')}</div>`;
}

function exceptionHtml(e) {
  const lastIndex = e.attempts.length - 1;
  return `
    <div class="card">
      <div class="row gap-2 wrap" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong class="fs-md">${esc(e.type)}</strong>
          <div class="fs-sm muted">${e.room ? esc(e.room) : ''}${e.room && e.pilgrimName ? ' · ' : ''}${e.pilgrimName ? esc(e.pilgrimName) : ''}</div>
        </div>
        <div class="row gap-2 wrap">${severityChip(e.severity)}${statusChip(e.status)}</div>
      </div>
      ${e.attempts.length ? `
        <div style="margin-block-start:var(--s4)">
          ${e.attempts.map((a, i) => attemptRowHtml(a, i === lastIndex && e.escalated)).join('')}
        </div>` : ''}
      ${e.resolutionOutcome ? `
        <p class="fs-sm" style="margin-block-start:var(--s3)">${icon('check', 14)} ${esc(e.resolutionOutcome)}
          <span class="muted">· ${esc(fmtRelative(e.resolvedAt))}</span></p>` : ''}
    </div>`;
}

function attemptRowHtml(attempt, escalated) {
  return `
    <div class="exception-attempt-row${escalated ? ' escalated' : ''}">
      <div class="fs-sm">${esc(attempt.reason)}${escalated ? ' <span class="chip chip-amber">Escalated</span>' : ''}</div>
      <div class="fs-sm text-2">${esc(attempt.notes)}</div>
      <div class="fs-xs muted" title="${esc(fmtDateTime(attempt.at))}">${esc(fmtRelative(attempt.at))}</div>
    </div>`;
}
