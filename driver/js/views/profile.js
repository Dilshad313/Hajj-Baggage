import * as api from '../api.js';
import { getSession } from '../store.js';
import { skeletonBlock, errorState, emptyState, esc, icon, toast, fmtDateTime, fmtDistance } from '../ui.js';
import { statusChip, directionChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, refresh: load };
}

export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(5);
  try {
    const history = await api.getHistory();
    if (!appEl) return;
    renderData(history);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function report(history) {
  const completed = history.filter((t) => t.status === 'Completed' || t.status === 'Completed with exceptions');
  const cancelled = history.filter((t) => t.status === 'Cancelled');
  const bags = completed.reduce((sum, t) => sum + (t.completion?.bagsHandedOrDelivered || 0), 0);
  const missing = completed.reduce((sum, t) => sum + (t.completion?.bagsMissing || 0), 0);
  const distance = completed.reduce((sum, t) => sum + (t.completion?.distanceKm || 0), 0);
  return { completedCount: completed.length, cancelledCount: cancelled.length, bags, missing, distance };
}

function renderData(history) {
  const session = getSession();
  const rep = report(history);
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Profile</h1></div></div>

    <div class="card" style="margin-block-end:var(--s5)">
      <div class="row gap-4">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;color:var(--accent);flex:none">${icon('user', 28)}</div>
        <div>
          <strong class="fs-md">${esc(session?.name || '')}</strong>
          <div class="fs-sm muted mono">${esc(session?.employeeId || '')}</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Driver report</h2>
      <div class="stat-grid">
        <div class="kpi-tile"><div class="kpi-label">Trips completed</div><div class="kpi-value fs-lg">${rep.completedCount}</div></div>
        <div class="kpi-tile"><div class="kpi-label">Trips cancelled</div><div class="kpi-value fs-lg">${rep.cancelledCount}</div></div>
        <div class="kpi-tile"><div class="kpi-label">Bags handled</div><div class="kpi-value fs-lg">${rep.bags}</div></div>
        <div class="kpi-tile"><div class="kpi-label">Distance driven</div><div class="kpi-value fs-lg">${fmtDistance(rep.distance)}</div></div>
      </div>
      ${rep.missing ? `<p class="fs-sm" style="color:var(--danger);margin-block-start:var(--s2)">${icon('triangle-alert', 14)} ${rep.missing} bag(s) reported missing across all trips.</p>` : ''}
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Trip history</h2>
      ${history.length ? `<div class="stack gap-3">${history.map(historyRowHtml).join('')}</div>` : emptyState({ message: 'No trip history yet.' })}
    </div>

    <button type="button" class="btn btn-secondary btn-block" style="margin-block-end:var(--s3)" data-action="end-shift">${icon('log-out', 18)} End shift</button>
    <button type="button" class="btn btn-ghost btn-block" data-action="logout" style="color:var(--danger)">${icon('log-out', 18)} Log out</button>`;

  appEl.querySelectorAll('[data-trip-id]').forEach((row) => row.addEventListener('click', () => navigate(`#/trip/${row.dataset.tripId}`)));
  appEl.querySelector('[data-action="end-shift"]').addEventListener('click', async () => {
    try {
      await api.endShift();
      toast('Shift ended. See you next trip.', 'success');
      api.logout();
      navigate('#/login');
    } catch (err) { toast(err.message, 'error'); }
  });
  appEl.querySelector('[data-action="logout"]').addEventListener('click', () => {
    api.logout();
    navigate('#/login');
  });
}

function historyRowHtml(t) {
  return `
    <button type="button" class="card card-tap" data-trip-id="${esc(t.id)}" style="padding:var(--s4)">
      <div class="row" style="justify-content:space-between">
        <div class="row gap-2">${directionChip(t.direction)}${statusChip(t.status)}</div>
        <span class="fs-xs muted">${t.completion ? fmtDateTime(t.completion.endedAt) : ''}</span>
      </div>
      <strong class="fs-sm" style="display:block;margin-block-start:var(--s2)">${esc(t.id)} — ${esc(t.fromName)} &rarr; ${esc(t.toName)}</strong>
    </button>`;
}
