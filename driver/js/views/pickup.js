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

export function destroy() { scanCtl?.destroy(); scanCtl = null; appEl = null; tripId = null; }

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

function mapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function renderScreen(trip) {
  if (trip.pickup.arrivedAt) { renderDone(trip); return; }

  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Pickup</h1></div></div>
    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">${esc(trip.fromName)}</h2>
      <p class="fs-sm muted">Collect ${trip.count.expected} bags, truck ${esc(trip.truck.id)}.</p>
      <a class="btn btn-secondary" style="margin-block-start:var(--s4)" href="${mapsUrl(trip.fromPosition[0], trip.fromPosition[1])}" target="_blank" rel="noopener">${icon('map', 16)} Open in Maps</a>
    </div>
    ${!trip.pickup.departedAt ? `
      <button type="button" class="btn btn-primary btn-lg btn-block" data-action="depart">${icon('navigation', 20)} Depart for pickup</button>
    ` : `
      <div class="card" style="margin-block-end:var(--s5)">
        <p class="fs-sm">${icon('check', 14)} Departed for pickup.</p>
      </div>
      <button type="button" class="btn btn-primary btn-lg btn-block" data-action="arrived" style="margin-block-end:var(--s5)">${icon('map-pin', 20)} I have arrived</button>
      <div id="pickup-scan-root" hidden></div>
    `}`;

  appEl.querySelector('[data-action="depart"]')?.addEventListener('click', async () => {
    try { await api.departPickup(tripId); toast('Departed for pickup.', 'info'); load(); } catch (err) { toast(err.message, 'error'); }
  });
  appEl.querySelector('[data-action="arrived"]')?.addEventListener('click', (e) => {
    e.currentTarget.hidden = true;
    const root = appEl.querySelector('#pickup-scan-root');
    root.hidden = false;
    scanCtl = createScanInput(root, {
      label: `Scan the pickup point QR`,
      placeholder: 'Scan or type the pickup QR',
      onSubmit: async (code) => {
        const updated = await api.arrivePickup(tripId, code);
        toast('Arrived at pickup.', 'success');
        setTimeout(() => navigate(`#/trip/${tripId}/count`), 700);
        return { message: `At ${updated.fromName} — pickup confirmed.` };
      },
    });
  });
}

function renderDone(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Pickup</h1></div></div>
    <div class="state-block">
      ${icon('check-circle', 48)}
      <p class="fw-semibold">At ${esc(trip.fromName)}</p>
      <button type="button" class="btn btn-primary" data-action="continue">Continue to loading &amp; count</button>
    </div>`;
  appEl.querySelector('[data-action="continue"]').addEventListener('click', () => navigate(`#/trip/${tripId}/count`));
}
