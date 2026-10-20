import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, fmtDistance } from '../ui.js';
import { navigate } from '../router.js';

const FUEL_LEVELS = ['Full', '3/4', 'Half', '1/4', 'Low'];
const CONDITIONS = ['Good', 'Minor damage', 'Major damage', 'Needs cleaning'];

let appEl = null;
let tripId = null;
let returnFormOpen = false;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  returnFormOpen = false;
  load();
  return { destroy };
}

export function destroy() { appEl = null; tripId = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    if (trip.stage !== 'complete') { renderPending(trip); return; }
    if (returnFormOpen) { renderReturnForm(trip); return; }
    renderSummary(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderPending(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Complete trip</h1></div></div>
    <div class="field">
      <label for="complete-notes">Notes (optional)</label>
      <textarea id="complete-notes" maxlength="300" placeholder="Anything worth noting about this trip?"></textarea>
    </div>
    <div class="error" id="err-complete" hidden></div>
    <button type="button" class="btn btn-primary btn-lg btn-block" data-action="complete">${icon('check-check', 20)} Complete trip</button>`;
  appEl.querySelector('[data-action="complete"]').addEventListener('click', async () => {
    const notes = appEl.querySelector('#complete-notes').value;
    try {
      await api.completeTrip(tripId, notes);
      toast('Trip completed.', 'success');
      load();
    } catch (err) {
      const el = appEl.querySelector('#err-complete');
      el.textContent = err.message; el.hidden = false;
    }
  });
}

function renderSummary(trip) {
  const c = trip.completion;
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Trip complete</h1><p class="page-subtitle">${esc(trip.id)} — ${esc(c.receiptNo)}</p></div></div>
    <div class="state-block" style="padding-block:var(--s6)">
      ${icon('party-popper', 56)}
      <p class="fw-semibold">${esc(trip.status)}</p>
    </div>
    <div class="stat-grid">
      <div class="kpi-tile"><div class="kpi-label">Duration</div><div class="kpi-value fs-lg">${c.durationMin} min</div></div>
      <div class="kpi-tile"><div class="kpi-label">Distance</div><div class="kpi-value fs-lg">${fmtDistance(c.distanceKm)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Delays</div><div class="kpi-value fs-lg">${c.delaysCount}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Bags ${trip.direction === 'Departure' ? 'loaded' : 'delivered'}</div><div class="kpi-value fs-lg">${c.bagsHandedOrDelivered}</div></div>
    </div>
    ${c.bagsMissing ? `<div class="late-banner">${icon('triangle-alert', 18)} ${c.bagsMissing} bag(s) missing — logged as an exception.</div>` : ''}
    <div class="row gap-3 wrap" style="margin-block-start:var(--s5)">
      <button type="button" class="btn btn-primary btn-lg" data-action="next">${icon('arrow-right-circle', 18)} Start next trip</button>
      <button type="button" class="btn btn-secondary btn-lg" data-action="return-vehicle">${icon('truck', 18)} Return vehicle</button>
    </div>`;
  appEl.querySelector('[data-action="next"]').addEventListener('click', () => navigate('#/'));
  appEl.querySelector('[data-action="return-vehicle"]').addEventListener('click', () => { returnFormOpen = true; renderReturnForm(trip); });
}

function renderReturnForm(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Return vehicle</h1><p class="page-subtitle">${esc(trip.truck.id)}</p></div></div>
    <div class="field">
      <label for="odo-end">Odometer end (km) <span class="req">*</span></label>
      <input id="odo-end" type="number" inputmode="numeric" placeholder="${trip.truck.odometer}" />
      <div class="error" id="err-odo" hidden></div>
    </div>
    <div class="field">
      <label for="ret-fuel">Fuel level <span class="req">*</span></label>
      <select id="ret-fuel"><option value="">Select…</option>${FUEL_LEVELS.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
      <div class="error" id="err-fuel" hidden></div>
    </div>
    <div class="field">
      <label for="ret-condition">Condition <span class="req">*</span></label>
      <select id="ret-condition"><option value="">Select…</option>${CONDITIONS.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      <div class="error" id="err-condition" hidden></div>
    </div>
    <div class="field" id="damage-field" hidden>
      <label for="ret-damage">Damage notes <span class="req">*</span></label>
      <textarea id="ret-damage" maxlength="300" placeholder="Describe the damage"></textarea>
      <div class="error" id="err-damage" hidden></div>
    </div>
    <div class="field">
      <label for="ret-parking">Parking location <span class="req">*</span></label>
      <input id="ret-parking" placeholder="e.g. Yard B, Slot 12" />
      <div class="error" id="err-parking" hidden></div>
    </div>
    <label class="checkbox-row">
      <input type="checkbox" id="ret-keys" />
      Keys returned
    </label>
    <div class="error" id="err-keys" hidden style="margin-block-end:var(--s3)"></div>
    <div class="row gap-3">
      <button type="button" class="btn btn-secondary" data-action="back">Back</button>
      <button type="button" class="btn btn-primary" data-action="submit-return">${icon('check', 16)} Submit return</button>
    </div>`;

  appEl.querySelector('#ret-condition').addEventListener('change', (e) => {
    appEl.querySelector('#damage-field').hidden = e.target.value === 'Good' || !e.target.value;
  });
  appEl.querySelector('[data-action="back"]').addEventListener('click', () => { returnFormOpen = false; load(); });
  appEl.querySelector('[data-action="submit-return"]').addEventListener('click', async () => {
    const odo = appEl.querySelector('#odo-end').value;
    const fuel = appEl.querySelector('#ret-fuel').value;
    const condition = appEl.querySelector('#ret-condition').value;
    const damageNotes = appEl.querySelector('#ret-damage').value;
    const parking = appEl.querySelector('#ret-parking').value;
    const keys = appEl.querySelector('#ret-keys').checked;
    let valid = true;
    const setErr = (field, msg) => {
      const el = appEl.querySelector(`#err-${field}`);
      if (msg) { el.textContent = msg; el.hidden = false; valid = false; } else if (el) el.hidden = true;
    };
    setErr('odo', !odo || Number(odo) < trip.truck.odometer ? `Odometer can't be lower than ${trip.truck.odometer.toLocaleString('en-US')} km.` : '');
    setErr('fuel', fuel ? '' : 'Fuel level is required.');
    setErr('condition', condition ? '' : 'Vehicle condition is required.');
    setErr('damage', condition && condition !== 'Good' && !damageNotes.trim() ? 'Damage notes are required.' : '');
    setErr('parking', parking.trim() ? '' : 'Parking location is required.');
    setErr('keys', keys ? '' : 'Confirm the keys have been returned.');
    if (!valid) return;
    try {
      await api.returnVehicle(trip.truck.id, { odometerEnd: Number(odo), fuel, condition, damageNotes, parkingLocation: parking, keysReturned: keys });
      if (!appEl) return;
      toast('Vehicle returned.', 'success');
      renderEndShift();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function renderEndShift() {
  appEl.innerHTML = `
    <div class="state-block">
      ${icon('check-circle', 48)}
      <p class="fw-semibold">Vehicle returned.</p>
      <div class="row gap-3 wrap" style="justify-content:center">
        <button type="button" class="btn btn-secondary" data-action="next">Start next trip</button>
        <button type="button" class="btn btn-primary" data-action="end-shift">${icon('log-out', 18)} End shift</button>
      </div>
    </div>`;
  appEl.querySelector('[data-action="next"]').addEventListener('click', () => navigate('#/'));
  appEl.querySelector('[data-action="end-shift"]').addEventListener('click', async () => {
    try {
      await api.endShift();
      toast('Shift ended. See you next trip.', 'success');
      api.logout();
      navigate('#/login');
    } catch (err) { toast(err.message, 'error'); }
  });
}
