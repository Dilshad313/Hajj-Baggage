import * as api from '../api.js';
import { toast, esc, fmtDateTime, fmtRelative, skeletonBlock, emptyState, errorState } from '../ui.js';
import { navigate } from '../router.js';

let appEl = null;
let mounted = false;
let notifications = [];
let loading = true;
let loadError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  notifications = []; loading = true; loadError = '';
  renderShell();
  load();
  return { destroy };
}

/** No timers to clean up. */
export function destroy() {
  mounted = false;
  appEl = null;
}

async function load() {
  loading = true; loadError = '';
  renderShell();
  try {
    const res = await api.getNotifications();
    if (!mounted) return;
    notifications = res;
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

function renderShell() {
  const showMarkAll = !loading && !loadError && notifications.some((n) => n.unread);
  appEl.innerHTML = `
    <div class="page-header row" style="justify-content:space-between;align-items:flex-end">
      <h1 class="page-title">Notifications</h1>
      ${showMarkAll ? `<button type="button" class="btn btn-secondary" data-action="mark-all">Mark all read</button>` : ''}
    </div>
    <div id="notif-body">${bodyHtml()}</div>
  `;
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(6);
  if (loadError) return errorState({ message: loadError });
  if (!notifications.length) return emptyState({ message: "You don't have any notifications yet." });
  return `<div class="stack gap-3">${notifications.map(rowHtml).join('')}</div>`;
}

function rowHtml(n) {
  return `
    <a class="card card-tap row gap-3" href="${esc(n.link)}" data-action="open-notif" data-id="${esc(n.id)}" style="align-items:flex-start">
      <span style="width:8px;height:8px;border-radius:50%;margin-block-start:7px;flex:none;${n.unread ? 'background:var(--accent)' : ''}"></span>
      <div class="stack gap-1" style="flex:1">
        <strong class="fs-sm ${n.unread ? 'fw-bold' : ''}">${esc(n.title)}</strong>
        <p class="fs-sm muted" style="margin:0">${esc(n.body)}</p>
        <span class="fs-xs muted" title="${esc(fmtDateTime(n.time))}">${esc(fmtRelative(n.time))}</span>
      </div>
    </a>`;
}

function wireBody() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  appEl.querySelector('[data-action="mark-all"]')?.addEventListener('click', markAll);
  appEl.querySelectorAll('[data-action="open-notif"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openNotif(a.dataset.id, a.getAttribute('href'));
    });
  });
}

async function openNotif(id, link) {
  try { await api.markRead(id); } catch (e) { /* ignore — navigate regardless */ }
  navigate(link);
}

async function markAll() {
  try {
    await api.markRead('all');
    toast('All notifications marked as read.', 'success');
    load();
  } catch (err) {
    toast(err.message, 'error');
  }
}
