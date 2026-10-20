import * as api from '../api.js';
import { skeletonBlock, errorState, fmtRelative, fmtDateTime, esc } from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;

export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: load, refresh: load };
}

export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Admin dashboard</h1><p class="page-subtitle">Platform-wide status at a glance.</p></div>
    </div>
    ${skeletonBlock(6)}`;
  try {
    const data = await api.dashboard();
    renderData(data);
  } catch (err) {
    appEl.innerHTML = `<div class="page-header"><div><h1 class="page-title">Admin dashboard</h1></div></div>` + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
  }
}

function renderData(data) {
  const roleTiles = Object.entries(data.activeByRole).map(([label, count]) => kpiTile({ label: `Active ${label}`, value: count })).join('');
  appEl.innerHTML = `
    <div class="page-header">
      <div><h1 class="page-title">Admin dashboard</h1><p class="page-subtitle">Platform-wide status at a glance.</p></div>
      <div class="row gap-2 wrap">
        <a class="btn btn-secondary" href="#/users">Add user</a>
        <a class="btn btn-secondary" href="#/config">Test integrations</a>
        <a class="btn btn-secondary" href="#/errors">View errors</a>
        <a class="btn btn-primary" href="#/export">Export data</a>
      </div>
    </div>

    <h2 class="section-title">Users</h2>
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Users online now', value: data.usersOnline })}
      ${kpiTile({ label: 'Disabled users', value: data.disabledUsers })}
      ${kpiTile({ label: 'Integrations OK', value: `${data.integrationsOk} / ${data.integrationsTotal}` })}
      ${kpiTile({ label: 'Open system issues', value: data.openIssues, trend: data.openIssues > 0 ? 'down' : 'up', delta: data.openIssues > 0 ? 'needs attention' : 'all clear' })}
      ${kpiTile({ label: 'Last backup', value: fmtRelative(data.lastBackup) })}
    </div>

    <h2 class="section-title">Active users by role</h2>
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">${roleTiles}</div>

    <div class="grid grid-cols-2">
      <div class="card">
        <h2 class="section-title">System health</h2>
        <div class="stack gap-3">
          ${data.services.map((s) => `
            <div class="row gap-2" style="justify-content:space-between">
              <span class="row gap-2"><span class="health-dot ${s.status === 'Healthy' ? 'ok' : s.status === 'Degraded' ? 'degraded' : 'down'}"></span>${esc(s.name)}</span>
              ${statusChip(s.status)}
            </div>`).join('')}
        </div>
        <a href="#/health" class="btn btn-secondary" style="margin-block-start:var(--s4)">View system health</a>
      </div>
      <div class="card">
        <h2 class="section-title">Recent audit events</h2>
        <div class="stack gap-3">
          ${data.recentAudit.map((a) => `
            <div>
              <div class="fs-sm"><strong>${esc(a.userName)}</strong> ${esc(a.action.toLowerCase())} <span class="mono">${esc(a.entityId)}</span></div>
              <div class="fs-xs muted" title="${esc(fmtDateTime(a.time))}">${fmtRelative(a.time)}</div>
            </div>`).join('')}
        </div>
        <a href="#/audit" class="btn btn-secondary" style="margin-block-start:var(--s4)">View audit logs</a>
      </div>
    </div>`;
}
