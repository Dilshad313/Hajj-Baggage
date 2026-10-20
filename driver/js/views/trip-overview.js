import * as api from '../api.js';
import {
  skeletonBlock, errorState, esc, icon, toast, confirmDialog, openModal,
  fmtDateTime, fmtCountdown, fmtWeight,
} from '../ui.js';
import { statusChip, directionChip } from '../components/status-chip.js';
import { stepperHtml } from '../components/stepper.js';
import { timelineHtml } from '../components/bag-timeline.js';
import { openDelaySheet } from '../components/delay-sheet.js';
import { navigate } from '../router.js';
import { routeForTrip } from '../trip-nav.js';

let appEl = null;
let tripId = null;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  load();
  return { destroy, poll: loadQuiet, refresh: load };
}

export function destroy() { appEl = null; tripId = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    renderTrip(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function loadQuiet() {
  if (!appEl) return;
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    renderTrip(trip);
  } catch (e) { /* silent background refresh */ }
}

function bannerFor(trip) {
  if (trip.status === 'Cancelled') return { tone: 'danger', text: `Trip cancelled — ${trip.cancelReason || 'see details below'}.` };
  if (trip.security?.outcome === 'hold') return { tone: 'danger', text: 'Security hold — waiting for release.' };
  if (trip.status === 'On Hold') return { tone: 'danger', text: 'On hold — a problem was reported.' };
  if (trip.stage === 'transit') return { tone: 'accent', text: 'In transit.' };
  if (trip.arrive.arrivedAt && trip.stage !== 'complete') return { tone: 'info', text: 'At destination.' };
  if (trip.stage === 'complete') return { tone: 'success', text: `Completed${trip.status === 'Completed with exceptions' ? ' with exceptions' : ''}.` };
  return null;
}

function cargoWeight(trip) {
  return trip.bags.reduce((sum, b) => sum + b.weightKg, 0);
}

function ctaLabel(trip) {
  if (trip.status === 'Cancelled') return null;
  if (trip.stage === 'complete') return null;
  return trip.vehicle.scannedOk ? 'Continue' : 'Start this trip';
}

function renderTrip(trip) {
  if (!appEl) return;
  const banner = bannerFor(trip);
  const cta = ctaLabel(trip);
  const lateOverdue = trip.stage === 'transit' && new Date(trip.transit.etaAt).getTime() < Date.now();

  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <div class="row gap-2" style="margin-block-end:4px">${directionChip(trip.direction)}${statusChip(trip.status)}</div>
        <h1 class="page-title">${esc(trip.id)}</h1>
        <p class="page-subtitle">${esc(trip.fromName)} &rarr; ${esc(trip.toName)}</p>
      </div>
    </div>

    ${banner ? `<div class="stage-banner ${banner.tone}">${icon('info', 20)} ${esc(banner.text)}</div>` : ''}
    ${lateOverdue ? `<div class="late-banner">${icon('alarm-clock-off', 20)} You are running late — report a delay.</div>` : ''}

    ${trip.status === 'Cancelled' ? `
      <div class="card" style="margin-block-end:var(--s5)">
        <h2 class="section-title">Cancelled trip</h2>
        <p class="fs-sm">${esc(trip.cancelReason || 'No reason recorded.')}</p>
        ${trip.backupTripId ? `<button type="button" class="btn btn-secondary" style="margin-block-start:var(--s3)" data-action="view-backup">${icon('replace', 16)} View backup trip ${esc(trip.backupTripId)}</button>` : ''}
      </div>` : stepperHtml(trip.stepLabels, trip.stepIndex)}

    <div class="stat-grid">
      <div class="kpi-tile">
        <div class="kpi-label">Vehicle</div>
        <div class="kpi-value fs-lg mono">${esc(trip.truck.id)}</div>
        <div class="fs-xs muted">${trip.vehicle.scannedOk ? 'Checked' : 'Not checked yet'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Cargo</div>
        <div class="kpi-value fs-lg">${trip.count.expected} bags</div>
        <div class="fs-xs muted">${fmtWeight(cargoWeight(trip))}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Seal</div>
        <div class="kpi-value fs-lg mono">${trip.seal.number ? esc(trip.seal.number) : '—'}</div>
        <div class="fs-xs muted">${trip.seal.number ? (trip.seal.confirmedByDriver ? 'Confirmed' : 'Not confirmed') : 'Not sealed yet'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">ETA</div>
        <div class="kpi-value fs-lg">${trip.transit.etaAt ? fmtCountdown(trip.transit.etaAt) : '—'}</div>
        <div class="fs-xs muted">${trip.direction === 'Departure' && trip.cutoffAt ? `Cut-off ${fmtDateTime(trip.cutoffAt)}` : ''}</div>
      </div>
    </div>

    ${cta ? `
      <button type="button" class="btn btn-primary btn-lg btn-block" data-action="cta" style="margin-block-end:var(--s4)">${icon('arrow-right-circle', 20)} ${cta}</button>
      <div class="row gap-3 wrap" style="margin-block-end:var(--s6)">
        <button type="button" class="btn btn-secondary" data-action="call">${icon('phone', 16)} Call coordinator</button>
        <button type="button" class="btn btn-secondary" data-action="report-problem">${icon('triangle-alert', 16)} Report a problem</button>
        ${trip.stage === 'transit' || trip.stage === 'arrive' ? `<button type="button" class="btn btn-secondary" data-action="report-delay">${icon('clock-alert', 16)} Report delay</button>` : ''}
      </div>` : ''}

    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Timeline</h2>
      ${timelineHtml(trip.log)}
    </div>

    <div class="card">
      <h2 class="section-title">Manifest (${trip.bags.length} bags)</h2>
      <div class="stack">
        ${trip.bags.map((b) => `
          <div class="manifest-row">
            <span class="tag fs-sm">${esc(b.tagNumber)}</span>
            <span class="fs-xs muted">${fmtWeight(b.weightKg)}</span>
            ${statusChip(b.status)}
          </div>`).join('')}
      </div>
    </div>`;

  appEl.querySelector('[data-action="cta"]')?.addEventListener('click', () => navigate(routeForTrip(trip)));
  appEl.querySelector('[data-action="view-backup"]')?.addEventListener('click', () => navigate(`#/trip/${trip.backupTripId}`));
  appEl.querySelector('[data-action="call"]')?.addEventListener('click', async () => {
    try { await api.contactSupervisor(trip.id, 'Called coordinator from trip overview.'); toast('Coordinator called.', 'success'); } catch (err) { toast(err.message, 'error'); }
  });
  appEl.querySelector('[data-action="report-problem"]')?.addEventListener('click', () => openReportProblem(trip.id));
  appEl.querySelector('[data-action="report-delay"]')?.addEventListener('click', () => openDelaySheet(trip.id, { onDone: load }));
}

function openReportProblem(id) {
  const close = openModal({
    title: 'Report a problem',
    bodyHtml: `
      <div class="field">
        <label for="problem-note">Describe the problem <span class="req">*</span></label>
        <textarea id="problem-note" maxlength="300" placeholder="What's wrong?"></textarea>
        <div class="error" id="err-problem" hidden></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-act="submit-problem">Send to supervisor</button>
      </div>`,
  });
  document.querySelector('[data-act="submit-problem"]').addEventListener('click', async () => {
    const note = document.querySelector('#problem-note').value.trim();
    const err = document.querySelector('#err-problem');
    if (!note) { err.textContent = 'A description is required.'; err.hidden = false; return; }
    try {
      await api.contactSupervisor(id, note);
      toast('Reported to your supervisor.', 'success');
      close();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  });
}
