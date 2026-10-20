import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, fmtWeight, fmtTime } from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
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
  appEl.innerHTML = skeletonBlock(6);
  try {
    const data = await api.getDashboard();
    if (!appEl) return;
    renderData(data);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderData(data) {
  const k = data.kpis;
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Dashboard</h1><p class="page-subtitle">Today at your counter</p></div></div>

    ${data.pendingHandover ? `
      <div class="card result-card info" style="margin-block-end:var(--s6)">
        <h2 class="section-title">Acknowledge handover</h2>
        <p class="fs-sm">Handed over to you: "${esc(data.pendingHandover.notes)}"</p>
        <button type="button" class="btn btn-primary" style="margin-block-start:var(--s3)" data-action="ack-handover">${icon('check', 16)} Acknowledge</button>
      </div>` : ''}

    <div class="kpi-grid">
      ${kpiTile({ label: 'Appointments', value: k.appointments })}
      ${kpiTile({ label: 'Checked in', value: k.checkedIn })}
      ${kpiTile({ label: 'Waiting', value: k.waiting })}
      ${kpiTile({ label: 'No-show', value: k.noShow })}
      ${kpiTile({ label: 'On hold', value: k.onHold })}
      ${kpiTile({ label: 'Bags tagged', value: k.bagsTagged })}
      ${kpiTile({ label: 'Total kg', value: fmtWeight(k.totalKg) })}
      ${kpiTile({ label: 'Bags awaiting truck', value: k.bagsAwaitingTruck })}
    </div>

    <div class="grid" style="grid-template-columns:2fr 1fr" id="dash-main-grid">
      <div class="card">
        <h2 class="section-title">Next up</h2>
        ${data.nextUp.length ? `<div class="stack gap-3">${data.nextUp.map(nextUpRow).join('')}</div>` : `<p class="fs-sm muted">No upcoming appointments.</p>`}
      </div>
      <div class="card">
        <h2 class="section-title">Quick actions</h2>
        <div class="quick-action-grid">
          <button type="button" class="btn btn-secondary quick-action" data-action="scan">${icon('scan-line', 28)}<span class="fs-sm">Scan QR</span></button>
          <button type="button" class="btn btn-secondary quick-action" data-action="search">${icon('search', 28)}<span class="fs-sm">Search passport</span></button>
          <button type="button" class="btn btn-secondary quick-action" data-action="walkin">${icon('user-plus', 28)}<span class="fs-sm">Walk-in</span></button>
          <button type="button" class="btn btn-secondary quick-action" data-action="load-cart">${icon('shopping-cart', 28)}<span class="fs-sm">Load cart</span></button>
        </div>
      </div>
    </div>`;

  appEl.querySelector('[data-action="ack-handover"]')?.addEventListener('click', async () => {
    try { await api.acknowledgeHandover(data.pendingHandover.id); toast('Handover acknowledged.', 'success'); load(); } catch (err) { toast(err.message, 'error'); }
  });
  appEl.querySelectorAll('[data-appt-id]').forEach((row) => row.addEventListener('click', () => navigate(`#/checkin?appt=${row.dataset.apptId}`)));
  appEl.querySelectorAll('[data-start-appt]').forEach((btn) => btn.addEventListener('click', (e) => { e.stopPropagation(); navigate(`#/checkin?appt=${btn.dataset.startAppt}`); }));
  appEl.querySelector('[data-action="scan"]')?.addEventListener('click', () => navigate('#/checkin'));
  appEl.querySelector('[data-action="search"]')?.addEventListener('click', () => navigate('#/checkin?mode=search'));
  appEl.querySelector('[data-action="walkin"]')?.addEventListener('click', () => navigate('#/checkin?mode=walkin'));
  appEl.querySelector('[data-action="load-cart"]')?.addEventListener('click', () => navigate('#/loading'));

  const grid = appEl.querySelector('#dash-main-grid');
  if (grid) grid.style.gridTemplateColumns = window.innerWidth < 1024 ? '1fr' : '2fr 1fr';
}

function nextUpRow(a) {
  return `
    <div class="card" data-appt-id="${esc(a.id)}" style="padding:var(--s4)">
      <div class="row" style="justify-content:space-between">
        <strong class="fs-sm">${esc(a.pilgrimName)}</strong>
        <span class="fs-sm mono">${fmtTime(a.slotAt)}</span>
      </div>
      <div class="fs-xs muted" style="margin-block-start:4px">${esc(a.flightCode)} · ${a.declaredBags} bag${a.declaredBags === 1 ? '' : 's'}</div>
      <button type="button" class="btn btn-primary" style="margin-block-start:var(--s3);height:32px;font-size:var(--fs-sm)" data-start-appt="${esc(a.id)}">Start check-in</button>
    </div>`;
}
