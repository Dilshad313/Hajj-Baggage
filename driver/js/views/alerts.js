import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, esc, icon, toast, fmtRelative, openModal, confirmDialog } from '../ui.js';
import { statusChip, severityChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: load, refresh: load };
}

export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(5);
  try {
    const { notifications, exceptions } = await api.getAlerts();
    if (!appEl) return;
    renderData(notifications, exceptions);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderData(notifications, exceptions) {
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Alerts</h1></div>
      <div class="row gap-2">
        <button type="button" class="btn btn-secondary" data-action="contact">${icon('phone', 16)} Contact supervisor</button>
        <button type="button" class="btn btn-danger" data-action="emergency">${icon('siren', 16)} Emergency call</button>
      </div>
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Notifications</h2>
      ${notifications.length ? `<div class="stack gap-3">${notifications.map(notifHtml).join('')}</div>` : emptyState({ message: 'No notifications.' })}
    </div>

    <div class="card">
      <h2 class="section-title">My trip exceptions</h2>
      ${exceptions.length ? `<div class="stack gap-3">${exceptions.map(excHtml).join('')}</div>` : emptyState({ message: 'No open exceptions on your trips.' })}
    </div>`;

  appEl.querySelectorAll('[data-notif-id]').forEach((row) => row.addEventListener('click', async () => {
    const id = row.dataset.notifId;
    const link = row.dataset.link;
    try { await api.markRead(id); } catch (e) { /* ignore */ }
    if (link) navigate(link);
    else load();
  }));
  appEl.querySelector('[data-action="contact"]').addEventListener('click', openContactModal);
  appEl.querySelector('[data-action="emergency"]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Emergency call', body: 'Place an emergency call to Rabel operations?', confirmLabel: 'Call now', danger: true });
    if (!ok) return;
    try { await api.contactSupervisor(null, 'Emergency call.'); toast('Emergency call placed.', 'success'); } catch (err) { toast(err.message, 'error'); }
  });
}

function notifHtml(n) {
  return `
    <button type="button" class="card card-tap ${n.unread ? '' : 'muted'}" data-notif-id="${esc(n.id)}" data-link="${esc(n.link || '')}" style="padding:var(--s4)">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <strong class="fs-sm">${esc(n.title)}</strong>
        ${n.unread ? '<span class="chip chip-blue">New</span>' : ''}
      </div>
      <p class="fs-sm" style="margin-block-start:4px">${esc(n.body)}</p>
      <div class="fs-xs muted" style="margin-block-start:4px">${fmtRelative(n.time)}</div>
    </button>`;
}

function excHtml(e) {
  return `
    <div class="card" style="padding:var(--s4)">
      <div class="row gap-2" style="justify-content:space-between">
        <div class="row gap-2">${severityChip(e.severity)}${statusChip(e.status)}</div>
        <span class="fs-xs muted">${fmtRelative(e.time)}</span>
      </div>
      <strong class="fs-sm" style="display:block;margin-block-start:var(--s2)">${esc(e.type)} — ${esc(e.tripId)}</strong>
      ${e.notes ? `<p class="fs-sm muted" style="margin-block-start:4px">${esc(e.notes)}</p>` : ''}
    </div>`;
}

function openContactModal() {
  const close = openModal({
    title: 'Contact supervisor',
    bodyHtml: `
      <div class="field">
        <label for="contact-note">Note</label>
        <textarea id="contact-note" maxlength="300" placeholder="What do you need help with?"></textarea>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-primary" data-act="send">Send</button></div>`,
  });
  document.querySelector('[data-act="send"]').addEventListener('click', async () => {
    const note = document.querySelector('#contact-note').value.trim();
    try {
      await api.contactSupervisor(null, note || null);
      toast('Supervisor contacted.', 'success');
      close();
    } catch (err) { toast(err.message, 'error'); }
  });
}
