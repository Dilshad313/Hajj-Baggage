import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, toast, fmtDateTime, fmtRelative, esc, icon } from '../ui.js';

let appEl = null;
let notifications = [];

/**
 * Renders the full notifications list at #/notifications.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy:Function, poll:Function, refresh:Function}}
 */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: load, refresh: load };
}

/** Tears down the view. */
export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = pageShell() + skeletonBlock(6);
  try {
    notifications = await api.getNotifications();
    renderList();
  } catch (err) {
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Notifications</h1><p class="page-subtitle">System alerts and updates across the platform.</p></div>
      <button type="button" class="btn btn-secondary" data-action="mark-all">${icon('check', 16)} Mark all read</button>
    </div>`;
}

function renderList() {
  appEl.innerHTML = pageShell() + (notifications.length
    ? `<div class="card" style="padding:0;overflow:hidden" id="notif-list">${notifications.map(itemHtml).join('')}</div>`
    : emptyState({ message: 'No notifications.' }));

  appEl.querySelector('[data-action="mark-all"]').addEventListener('click', markAll);
  appEl.querySelector('#notif-list')?.addEventListener('click', onItemClick);
}

function itemHtml(n) {
  return `
    <a class="bell-item ${n.unread ? 'unread' : ''}" href="${esc(n.link)}" data-notif-id="${esc(n.id)}">
      <span style="flex:1">
        <div class="row" style="justify-content:space-between;gap:var(--s2)">
          <strong class="fs-sm">${esc(n.title)}</strong>
          ${n.unread ? '<span class="chip chip-blue">New</span>' : ''}
        </div>
        <div class="fs-sm text-2" style="margin-block-start:2px">${esc(n.body)}</div>
        <div class="fs-xs muted" title="${esc(fmtDateTime(n.time))}" style="margin-block-start:4px">${fmtRelative(n.time)}</div>
      </span>
    </a>`;
}

function onItemClick(e) {
  const a = e.target.closest('[data-notif-id]');
  if (!a) return;
  const id = a.dataset.notifId;
  api.markRead(id).catch(() => {});
  a.classList.remove('unread');
  const n = notifications.find((x) => x.id === id);
  if (n) n.unread = false;
}

async function markAll() {
  const btn = appEl.querySelector('[data-action="mark-all"]');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    notifications = await api.markRead('all');
    renderList();
    toast('All notifications marked as read.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}
