import * as api from '../api.js';
import { getDirection } from '../store.js';
import { skeletonBlock, errorState, fmtRelative, fmtDateTime, fmtPercent, fmtCountdown, esc, icon } from '../ui.js';
import { kpiTile } from '../components/kpi-tile.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let chartInstance = null;
let paused = false;
let lastUpdated = null;

export function render(params, app) {
  appEl = app;
  paused = false;
  load();
  return { destroy, poll: pollTick, refresh: load };
}

export function destroy() {
  chartInstance?.destroy();
  chartInstance = null;
  appEl = null;
}

function pollTick() {
  if (paused) return;
  load(true);
}

async function load(quiet) {
  if (!appEl) return;
  const direction = getDirection();
  if (!quiet) appEl.innerHTML = pageShell(direction) + skeletonBlock(8);
  try {
    const data = await api.getDashboard(direction);
    lastUpdated = data.lastUpdated;
    renderData(direction, data);
  } catch (err) {
    appEl.innerHTML = pageShell(direction) + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', () => load());
  }
}

function pageShell(direction) {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Real-time dashboard</h1><p class="page-subtitle">${direction === 'departure' ? 'Departure' : 'Arrival'} operations at a glance.</p></div>
      <div class="last-updated">
        <span id="last-updated-text">${lastUpdated ? `Updated ${fmtRelative(lastUpdated)}` : ''}</span>
        <button type="button" class="btn btn-secondary" data-action="toggle-pause">${icon(paused ? 'play' : 'pause', 16)} ${paused ? 'Resume' : 'Pause'} auto-refresh</button>
      </div>
    </div>`;
}

function renderData(direction, data) {
  appEl.innerHTML = `
    ${pageShell(direction)}
    <div class="grid grid-auto" style="margin-block-end:var(--s6)">
      ${kpiTile({ label: 'Bags in system', value: data.bagsInSystem })}
      ${kpiTile({ label: 'On-time %', value: fmtPercent(data.onTimePct) })}
      ${kpiTile({ label: 'Open exceptions', value: data.openExceptionsTotal, delta: `${data.openExceptionsBySeverity.Critical} critical · ${data.openExceptionsBySeverity.High} high`, trend: data.openExceptionsBySeverity.Critical > 0 ? 'down' : 'up' })}
      ${kpiTile({ label: 'Trucks in transit', value: data.trucksInTransit })}
      ${kpiTile({ label: 'Flights at risk', value: data.flightsAtRisk, trend: data.flightsAtRisk > 0 ? 'down' : 'up' })}
      ${kpiTile({ label: 'Avg handling time', value: `${data.avgHandlingMin} min` })}
    </div>

    <div class="grid grid-cols-2" style="align-items:start">
      <div class="card">
        <h2 class="section-title">Bags by stage</h2>
        <canvas id="stage-chart" role="img" aria-label="Bags by lifecycle stage" height="320"></canvas>
      </div>
      <div class="card">
        <h2 class="section-title">Live activity</h2>
        <div class="activity-feed" id="activity-feed">${activityHtml(data.activity)}</div>
      </div>
    </div>

    <h2 class="section-title" style="margin-block-start:var(--s6)">Flights</h2>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th scope="col">Flight</th><th scope="col">Route</th><th scope="col">${direction === 'departure' ? 'Cut-off' : 'Landed'}</th>
          <th scope="col">${esc(data.flights[0]?.checkpointLabels?.[0] || '—')}</th>
          <th scope="col">${esc(data.flights[0]?.checkpointLabels?.[1] || '—')}</th>
          <th scope="col">${esc(data.flights[0]?.checkpointLabels?.[2] || '—')}</th>
          <th scope="col">Risk</th>
        </tr></thead>
        <tbody>
          ${data.flights.map((f) => `
            <tr data-flight-id="${esc(f.id)}" tabindex="0" role="button">
              <td data-label="Flight"><strong>${esc(f.code)}</strong>${f.priority ? ' ' + icon('star', 14) : ''}</td>
              <td data-label="Route">${esc(f.route)}</td>
              <td data-label="${direction === 'departure' ? 'Cut-off' : 'Landed'}">
                <span title="${esc(fmtDateTime(direction === 'departure' ? f.cutoffAt : f.landedAt))}">
                  ${direction === 'departure' ? fmtCountdown(f.cutoffAt) : fmtRelative(f.landedAt)}
                </span>
              </td>
              <td data-label="${esc(f.checkpointLabels[0])}">${f.checkpoints.a} / ${f.totalBags}</td>
              <td data-label="${esc(f.checkpointLabels[1])}">${f.checkpoints.b} / ${f.totalBags}</td>
              <td data-label="${esc(f.checkpointLabels[2])}">${f.checkpoints.c} / ${f.totalBags}</td>
              <td data-label="Risk">${statusChip(f.risk)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  function onTogglePause() {
    paused = !paused;
    const btn = appEl.querySelector('[data-action="toggle-pause"]');
    btn.innerHTML = `${icon(paused ? 'play' : 'pause', 16)} ${paused ? 'Resume' : 'Pause'} auto-refresh`;
  }
  appEl.querySelector('[data-action="toggle-pause"]').addEventListener('click', onTogglePause);
  appEl.querySelectorAll('[data-flight-id]').forEach((tr) => {
    const go = () => navigate(`#/reconciliation/${tr.dataset.flightId}`);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });

  drawChart(data.bagsByStage);
}

function activityHtml(activity) {
  if (!activity.length) return `<p class="muted fs-sm">No activity yet.</p>`;
  return activity.map((a) => `
    <div class="activity-item">
      <span class="activity-dot ${a.kind === 'exception' ? 'exception' : ''}"></span>
      <span class="fs-sm">${esc(a.text)}<div class="fs-xs muted">${fmtRelative(a.time)}</div></span>
    </div>`).join('');
}

function drawChart(bagsByStage) {
  chartInstance?.destroy();
  chartInstance = null;
  const canvas = appEl.querySelector('#stage-chart');
  if (!canvas || !window.Chart) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0D9488';
  chartInstance = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: bagsByStage.map((s) => s.stage),
      datasets: [{ label: 'Bags', data: bagsByStage.map((s) => s.count), backgroundColor: accent }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      plugins: { legend: { display: false }, title: { display: false } },
      scales: { x: { beginAtZero: true, title: { display: true, text: 'Bags' } } },
    },
  });
}
