import * as api from '../api.js';
import { skeletonBlock, errorState, toast, openModal, esc, icon } from '../ui.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let runId = null;

export function render(params, app) {
  appEl = app;
  runId = params.id;
  load();
  return { destroy, poll: load, refresh: load };
}

export function destroy() { appEl = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(8);
  try {
    const run = await api.getRun(runId);
    renderRun(run);
  } catch (err) {
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function nextDestination(run) {
  if (!run.trolleyPickedUp) return `#/run/${run.id}/trolley`;
  const anyOnTrolley = run.stops.some((s) => s.bags.some((b) => b.status === 'On trolley' || b.status === 'In hold (missing)'));
  if (anyOnTrolley) return `#/run/${run.id}/out`;
  const nextStop = run.stops.find((s) => s.status === 'Pending');
  if (nextStop) return `#/run/${run.id}/stop/${nextStop.id}`;
  return `#/run/${run.id}/reconcile`;
}

function floorChips(run) {
  const floors = Array.from(new Set(run.stops.map((s) => s.floor))).sort((a, b) => a - b);
  return floors.map((f) => `<span class="chip chip-grey">Floor ${f}</span>`).join('');
}

function renderRun(run) {
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${esc(run.code)}</h1>
        <p class="page-subtitle">${esc(run.hotel)} · Building ${esc(run.building)} · ${esc(run.trolleyId)}</p>
      </div>
      ${statusChip(run.status)}
    </div>

    <div class="card" style="margin-block-end:var(--s5)">
      <div class="row gap-4 wrap">
        <div><div class="fs-2xl fw-bold">${run.deliveredCount}/${run.bagsCount}</div><div class="fs-xs muted">bags delivered</div></div>
        <div><div class="fs-2xl fw-bold">${run.stops.length}</div><div class="fs-xs muted">rooms</div></div>
      </div>
      <div class="row gap-2 wrap" style="margin-block-start:var(--s3)">${floorChips(run)}</div>
    </div>

    <div class="row gap-2 wrap" style="margin-block-end:var(--s5)">
      <button type="button" class="btn btn-primary btn-lg btn-block" data-action="start-continue">
        ${icon(run.status === 'Notified' ? 'play' : 'arrow-right', 18)} ${run.status === 'Notified' ? 'Start delivery run' : run.status === 'In Progress' ? 'Continue' : 'View run'}
      </button>
      <button type="button" class="btn btn-secondary" data-action="manifest">${icon('clipboard-list', 16)} View delivery manifest</button>
    </div>

    <h2 class="section-title">Stops</h2>
    <div class="stack gap-2">${run.stops.map(stopRowHtml).join('')}</div>`;

  appEl.querySelector('[data-action="start-continue"]').addEventListener('click', () => onStartContinue(run));
  appEl.querySelector('[data-action="manifest"]').addEventListener('click', () => openManifest(run));
  appEl.querySelectorAll('[data-stop-id]').forEach((row) => row.addEventListener('click', () => navigate(`#/run/${run.id}/stop/${row.dataset.stopId}`)));
}

function stopRowHtml(s) {
  const pilgrimNames = s.pilgrims.map((p) => p.name).join(', ');
  return `
    <button type="button" class="card card-tap" data-stop-id="${esc(s.id)}">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <strong>${esc(s.room)}</strong>
          <div class="fs-sm muted">${esc(pilgrimNames)} · ${s.bags.length} bag${s.bags.length === 1 ? '' : 's'}</div>
        </div>
        ${statusChip(s.status)}
      </div>
    </button>`;
}

async function onStartContinue(run) {
  if (run.status === 'Completed' || run.status === 'Completed with exceptions' || run.status === 'Cancelled') {
    navigate(`#/run/${run.id}/reconcile`);
    return;
  }
  const btn = appEl.querySelector('[data-action="start-continue"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    if (run.status === 'Notified') await api.startRun(run.id);
    navigate(nextDestination(run));
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

function openManifest(run) {
  openModal({
    title: `Manifest — ${run.code}`,
    large: true,
    bodyHtml: `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th scope="col">Room</th><th scope="col">Pilgrim</th><th scope="col">Bag tag</th><th scope="col">Status</th></tr></thead>
          <tbody>
            ${run.stops.flatMap((s) => s.bags.map((b) => `
              <tr>
                <td data-label="Room">${esc(s.room)}</td>
                <td data-label="Pilgrim">${esc(s.pilgrims.find((p) => p.id === b.pilgrimId)?.name || '')}</td>
                <td data-label="Bag tag"><span class="mono">${esc(b.tagNumber)}</span>${b.damaged ? ' <span class="chip chip-amber">Damaged</span>' : ''}</td>
                <td data-label="Status">${statusChip(b.status)}</td>
              </tr>`)).join('')}
          </tbody>
        </table>
      </div>
      <button type="button" class="btn btn-secondary" style="margin-block-start:var(--s4)" data-act="print">${icon('printer', 16)} Print</button>`,
    onMount: (overlay) => {
      overlay.querySelector('[data-act="print"]').addEventListener('click', () => window.print());
    },
  });
}
