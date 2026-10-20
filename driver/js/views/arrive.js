import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { navigate } from '../router.js';
import { routeForTrip } from '../trip-nav.js';

let appEl = null;
let tripId = null;
let scanCtl = null;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  load();
  return { destroy };
}

export function destroy() { scanCtl?.destroy(); scanCtl = null; appEl = null; tripId = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(4);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    if (trip.arrive.arrivedAt) { renderDone(trip); return; }
    renderScreen(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderScreen(trip) {
  appEl.innerHTML = `
    <div class="big-prompt">
      ${icon('map-pin', 72)}
      <h1 class="fs-xl" style="margin-block-end:var(--s2)">Arrive at ${esc(trip.toName)}</h1>
      <p class="muted fs-sm">Scan the destination QR to confirm arrival.</p>
    </div>
    <div id="arrive-scan-root"></div>`;

  scanCtl = createScanInput(appEl.querySelector('#arrive-scan-root'), {
    label: 'Scan the destination QR',
    placeholder: 'Scan or type the destination QR',
    onSubmit: async (code) => {
      const updated = await api.arriveDestination(tripId, code);
      toast(`Arrived at ${updated.toName}.`, 'success');
      setTimeout(() => navigate(routeForTrip(updated)), 700);
      return { message: `At ${updated.toName} — arrival confirmed.` };
    },
  });
}

function renderDone(trip) {
  appEl.innerHTML = `
    <div class="state-block">
      ${icon('check-circle', 48)}
      <p class="fw-semibold">At ${esc(trip.toName)}</p>
      <button type="button" class="btn btn-primary" data-action="continue">Continue</button>
    </div>`;
  appEl.querySelector('[data-action="continue"]').addEventListener('click', () => navigate(routeForTrip(trip)));
}
