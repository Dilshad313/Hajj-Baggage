import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, announce } from '../ui.js';
import { PRETRIP_ITEMS } from '../seed.js';
import { navigate } from '../router.js';

const FUEL_LEVELS = ['Full', '3/4', 'Half', '1/4', 'Low'];

let appEl = null;
let tripId = null;
let rows = null;
let odometerValue = '';
let fuelValue = '';
let failState = null; // { failedItem } once a Fail has been submitted
let cancelledState = false;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  rows = PRETRIP_ITEMS.map((label) => ({ label, result: null, note: '' }));
  odometerValue = '';
  fuelValue = '';
  failState = null;
  cancelledState = false;
  load();
  return { destroy };
}

export function destroy() { appEl = null; tripId = null; rows = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    if (trip.status === 'Cancelled') { renderCancelled(trip); return; }
    if (trip.status === 'On Hold' && trip.stage === 'pretrip') {
      const failed = (trip.preTrip.rows || []).find((r) => r.result === 'Fail');
      if (failed) { failState = { failedItem: failed.label, note: failed.note }; renderFail(trip); return; }
    }
    if (trip.stage !== 'pretrip' && trip.stage !== 'vehicle') { renderAlreadyDone(trip); return; }
    renderForm(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderAlreadyDone(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Pre-trip check</h1></div></div>
    <div class="card">
      <p class="fs-sm">Pre-trip check already submitted for ${esc(trip.id)}.</p>
      <button type="button" class="btn btn-primary" style="margin-block-start:var(--s4)" data-action="continue">Continue</button>
    </div>`;
  appEl.querySelector('[data-action="continue"]').addEventListener('click', () => navigate(`#/trip/${tripId}`));
}

function renderForm(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Pre-trip check</h1><p class="page-subtitle">${esc(trip.truck.id)} — mark each item Pass or Fail.</p></div></div>
    <div class="card" style="margin-block-end:var(--s5)">
      ${rows.map((r, i) => `
        <div class="pretrip-row">
          <div class="pretrip-label">${esc(r.label)}</div>
          <div class="segmented" role="group" aria-label="${esc(r.label)} result">
            <button type="button" data-row="${i}" data-result="Pass" aria-selected="${r.result === 'Pass'}">Pass</button>
            <button type="button" data-row="${i}" data-result="Fail" aria-selected="${r.result === 'Fail'}">Fail</button>
          </div>
          ${r.result === 'Fail' ? `
            <div class="field" style="margin-block-start:var(--s3);margin-block-end:0">
              <label for="note-${i}">Note <span class="req">*</span></label>
              <textarea id="note-${i}" data-note="${i}" maxlength="300" placeholder="Describe the issue (min. 5 characters)">${esc(r.note)}</textarea>
              <div class="error" id="err-note-${i}" hidden></div>
            </div>` : ''}
        </div>`).join('')}
    </div>
    <div class="grid grid-cols-2" style="margin-block-end:var(--s5)">
      <div class="field" style="margin:0">
        <label for="odometer">Odometer (km) <span class="req">*</span></label>
        <input id="odometer" type="number" inputmode="numeric" min="0" placeholder="${trip.truck.odometer}" value="${esc(odometerValue)}" />
        <div class="error" id="err-odometer" hidden></div>
      </div>
      <div class="field" style="margin:0">
        <label for="fuel">Fuel level <span class="req">*</span></label>
        <select id="fuel"><option value="">Select…</option>${FUEL_LEVELS.map((f) => `<option value="${esc(f)}" ${fuelValue === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <div class="error" id="err-fuel" hidden></div>
      </div>
    </div>
    <div class="error" id="err-submit" hidden style="margin-block-end:var(--s3)"></div>
    <button type="button" class="btn btn-primary btn-lg btn-block" id="submit-pretrip">${icon('clipboard-check', 20)} Submit check</button>`;

  appEl.querySelectorAll('[data-row]').forEach((btn) => btn.addEventListener('click', () => {
    const i = Number(btn.dataset.row);
    rows[i].result = btn.dataset.result;
    renderForm(trip);
  }));
  appEl.querySelector('#odometer').addEventListener('input', (e) => { odometerValue = e.target.value; });
  appEl.querySelector('#fuel').addEventListener('change', (e) => { fuelValue = e.target.value; });
  appEl.querySelectorAll('[data-note]').forEach((ta) => ta.addEventListener('input', (e) => {
    rows[Number(ta.dataset.note)].note = e.target.value;
  }));

  appEl.querySelector('#submit-pretrip').addEventListener('click', async () => {
    let valid = true;
    rows.forEach((r, i) => {
      const err = appEl.querySelector(`#err-note-${i}`);
      if (r.result === 'Fail' && r.note.trim().length < 5) {
        if (err) { err.textContent = 'At least 5 characters are required.'; err.hidden = false; }
        valid = false;
      } else if (err) err.hidden = true;
      if (!r.result) valid = false;
    });
    const odoInput = appEl.querySelector('#odometer');
    const fuelInput = appEl.querySelector('#fuel');
    const errSubmit = appEl.querySelector('#err-submit');
    const errOdo = appEl.querySelector('#err-odometer');
    const errFuel = appEl.querySelector('#err-fuel');
    errSubmit.hidden = true; errOdo.hidden = true; errFuel.hidden = true;
    if (!rows.every((r) => r.result)) { errSubmit.textContent = 'Mark every item Pass or Fail.'; errSubmit.hidden = false; valid = false; }
    if (!odoInput.value) { errOdo.textContent = 'Odometer is required.'; errOdo.hidden = false; valid = false; }
    if (!fuelInput.value) { errFuel.textContent = 'Fuel level is required.'; errFuel.hidden = false; valid = false; }
    if (!valid) return;

    const btn = appEl.querySelector('#submit-pretrip');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const res = await api.submitPreTrip(tripId, { odometer: Number(odoInput.value), fuel: fuelInput.value, rows });
      if (res.passed) {
        toast('Pre-trip check passed.', 'success');
        navigate(`#/trip/${tripId}/pickup`);
      } else {
        failState = { failedItem: res.failedItem };
        announce(`Pre-trip check failed — ${res.failedItem}.`);
        renderFail(res.trip);
      }
    } catch (err) {
      errSubmit.textContent = err.message; errSubmit.hidden = false;
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });
}

function renderFail(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Pre-trip check</h1></div></div>
    <div class="state-block error-state" style="background:var(--danger-soft);border-radius:var(--r-lg);color:#7F1D1D">
      ${icon('x-circle', 48)}
      <p class="fw-semibold">${esc(failState.failedItem)} failed the pre-trip check.</p>
      <p class="fs-sm">This vehicle cannot be used for this trip. Report the issue to your supervisor to get a backup vehicle.</p>
      <button type="button" class="btn btn-danger" data-action="report">${icon('triangle-alert', 16)} Report issue to supervisor</button>
    </div>`;
  appEl.querySelector('[data-action="report"]').addEventListener('click', async () => {
    try {
      await api.cancelTrip(tripId, `${failState.failedItem} failed pre-trip check.`);
      const trip2 = await api.getTrip(tripId);
      if (!appEl) return;
      renderCancelled(trip2);
    } catch (err) { toast(err.message, 'error'); }
  });
}

function renderCancelled(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Trip cancelled</h1></div></div>
    <div class="state-block">
      ${icon('ban', 48)}
      <p class="fw-semibold">${esc(trip.id)} has been cancelled.</p>
      <p class="fs-sm">${esc(trip.cancelReason || '')}</p>
      ${trip.backupTripId
        ? `<button type="button" class="btn btn-primary" data-action="go-backup">${icon('arrow-right-circle', 16)} Continue with backup vehicle</button>`
        : `<button type="button" class="btn btn-primary" data-action="request-backup">${icon('replace', 16)} Request backup vehicle</button>`}
    </div>`;
  appEl.querySelector('[data-action="request-backup"]')?.addEventListener('click', async () => {
    try {
      const res = await api.assignBackup(tripId);
      toast('Backup vehicle assigned.', 'success');
      navigate(`#/trip/${res.tripId}/vehicle`);
    } catch (err) { toast(err.message, 'error'); }
  });
  appEl.querySelector('[data-action="go-backup"]')?.addEventListener('click', () => navigate(`#/trip/${trip.backupTripId}/vehicle`));
}
