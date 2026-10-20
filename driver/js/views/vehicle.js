import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { navigate } from '../router.js';

let appEl = null;
let tripId = null;
let scanCtl = null;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  load();
  return { destroy };
}

export function destroy() {
  scanCtl?.destroy();
  scanCtl = null;
  appEl = null;
  tripId = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(4);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    renderScreen(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderScreen(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Scan vehicle</h1><p class="page-subtitle">${esc(trip.id)} uses <strong class="mono">${esc(trip.truck.id)}</strong> (${esc(trip.truck.type)}).</p></div></div>
    <div id="vehicle-scan-root"></div>
    <div id="vehicle-extra-actions" style="margin-block-start:var(--s4)"></div>`;

  scanCtl = createScanInput(appEl.querySelector('#vehicle-scan-root'), {
    label: 'Scan the vehicle QR code',
    placeholder: 'Scan or type vehicle ID',
    onSubmit: async (code) => {
      try {
        await api.scanVehicle(tripId, code);
        toast('Vehicle confirmed.', 'success');
        setTimeout(() => navigate(`#/trip/${tripId}/pretrip`), 700);
        return { message: 'Vehicle confirmed — OK.' };
      } catch (err) {
        renderExtraActions(err.message);
        throw err;
      }
    },
  });
}

function renderExtraActions(message) {
  const root = appEl?.querySelector('#vehicle-extra-actions');
  if (!root) return;
  if (/out of service/i.test(message)) {
    root.innerHTML = `<button type="button" class="btn btn-secondary btn-block" data-action="request-backup">${icon('replace', 16)} Request backup vehicle</button>`;
    root.querySelector('[data-action="request-backup"]').addEventListener('click', requestBackup);
  } else {
    root.innerHTML = '';
  }
}

async function requestBackup() {
  try {
    const res = await api.assignBackup(tripId);
    toast('Backup vehicle assigned.', 'success');
    navigate(`#/trip/${res.tripId}/vehicle`);
  } catch (err) {
    toast(err.message, 'error');
  }
}
