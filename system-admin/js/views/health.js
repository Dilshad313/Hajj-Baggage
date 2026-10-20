import * as api from '../api.js';
import { skeletonBlock, errorState, emptyState, fmtDateTime, fmtRelative, esc, icon } from '../ui.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;

/**
 * Renders the system health view at #/health.
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
    const services = await api.getHealth();
    renderData(services);
  } catch (err) {
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">System health</h1><p class="page-subtitle">Live status for integrations and core services.</p></div>
    </div>`;
}

function renderData(services) {
  if (!services.length) {
    appEl.innerHTML = pageShell() + emptyState({ message: 'No services are being monitored.' });
    return;
  }
  const unhealthy = services.filter((s) => s.status !== 'Healthy');
  appEl.innerHTML = pageShell() + issuesBanner(unhealthy) + `
    <div class="grid grid-auto gap-4">
      ${services.map(serviceCardHtml).join('')}
    </div>`;
}

function issuesBanner(unhealthy) {
  if (!unhealthy.length) return '';
  return `
    <div class="card" style="border-color:var(--warning);background:var(--warning-soft);margin-block-end:var(--s5)">
      <div class="row gap-3" style="justify-content:space-between;flex-wrap:wrap">
        <span class="row gap-2">${icon('alert-triangle', 20)}<strong>Issues detected</strong> — ${unhealthy.length} service${unhealthy.length === 1 ? '' : 's'} reporting degraded or down status.</span>
        <a class="btn btn-primary" href="#/errors">View errors</a>
      </div>
    </div>`;
}

function dotClassFor(status) {
  if (status === 'Healthy') return 'ok';
  if (status === 'Degraded') return 'degraded';
  return 'down';
}

function serviceCardHtml(s) {
  const dotClass = dotClassFor(s.status);
  const uptimeStr = `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s.uptime)}%`;
  return `
    <div class="card service-card">
      <div class="row" style="justify-content:space-between">
        <span class="row gap-2"><span class="health-dot ${dotClass}"></span><strong>${esc(s.name)}</strong></span>
        ${statusChip(s.status)}
      </div>
      <div class="grid grid-auto fs-sm" style="gap:var(--s2)">
        <div><span class="muted">Uptime</span><br>${uptimeStr}</div>
        <div><span class="muted">Latency</span><br>${s.latencyMs} ms</div>
        <div><span class="muted">Last check</span><br><span title="${esc(fmtDateTime(s.lastCheck))}">${fmtRelative(s.lastCheck)}</span></div>
      </div>
      ${sparklineSvg(s.history, dotClass)}
    </div>`;
}

function sparklineSvg(history, dotClass) {
  if (!history || !history.length) return '';
  const w = 120;
  const h = 36;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const points = history.map((v, i) => {
    const x = history.length > 1 ? (i / (history.length - 1)) * w : w / 2;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = dotClass === 'ok' ? 'var(--success)' : dotClass === 'degraded' ? 'var(--warning)' : 'var(--danger)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;display:block" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" /></svg>`;
}
