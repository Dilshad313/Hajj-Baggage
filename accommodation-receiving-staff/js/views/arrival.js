import * as api from '../api.js';
import { esc, icon, toast, skeletonBlock, errorState } from '../ui.js';
import { navigate } from '../router.js';
import { createScanInput } from '../components/scan-input.js';
import { stepperHtml } from '../components/stepper.js';

let appEl = null;
let step = 'scan-truck'; // scan-truck | unknown-truck | bay | seal | starting
let trip = null;
let hotel = null;
let scanInstance = null;
let starting = false;

const STEP_LABELS = ['Scan truck', 'Assign bay', 'Verify seal', 'Start unloading'];

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  step = 'scan-truck';
  trip = null;
  hotel = null;
  starting = false;
  load();
  return { destroy };
}

export function destroy() {
  scanInstance?.destroy();
  scanInstance = null;
  appEl = null;
}

async function load() {
  appEl.innerHTML = skeletonBlock(5);
  try {
    hotel = await api.getMyHotel();
    if (!appEl) return;
    renderPage();
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]').addEventListener('click', load);
  }
}

function currentStepIndex() {
  if (step === 'scan-truck' || step === 'unknown-truck') return 1;
  if (step === 'bay') return 2;
  if (step === 'seal') return 3;
  return 4;
}

function renderPage() {
  if (!appEl) return;
  appEl.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Truck arrival</h1>
        <p class="page-subtitle">${esc(hotel.name)}</p>
      </div>
    </div>
    ${stepperHtml(STEP_LABELS, currentStepIndex())}
    <div id="arrival-step-root"></div>`;
  const root = appEl.querySelector('#arrival-step-root');
  if (step === 'scan-truck') renderScanTruck(root);
  else if (step === 'unknown-truck') renderUnknownTruck(root);
  else if (step === 'bay') renderBayStep(root);
  else if (step === 'seal') renderSealStep(root);
}

/* ===================== STEP 1: scan truck ===================== */

function renderScanTruck(root) {
  scanInstance?.destroy();
  root.innerHTML = `<div id="truck-scan-root" style="max-width:520px"></div>`;
  scanInstance = createScanInput(root.querySelector('#truck-scan-root'), {
    label: 'Scan the truck plate or trip code',
    placeholder: 'e.g. TRK-52',
    onSubmit: async (code) => {
      try {
        trip = await api.truckScan(code);
        step = trip.bay ? 'seal' : 'bay';
        renderPage();
        return { message: `${trip.code} identified — ${trip.truckPlate}.` };
      } catch (err) {
        if (err.code === 'unknown') {
          lastScannedPlate = code;
          scanInstance?.destroy();
          scanInstance = null;
          step = 'unknown-truck';
          renderPage();
          return;
        }
        throw err;
      }
    },
  });
}

let lastScannedPlate = '';

function renderUnknownTruck(root) {
  root.innerHTML = `
    <div class="state-block" style="padding-block:var(--s4)">
      ${icon('alert-triangle', 40)}
      <p>"${esc(lastScannedPlate)}" isn't on today's schedule for ${esc(hotel.name)}.</p>
    </div>
    <div class="grid grid-cols-2">
      <div class="card">
        <div class="section-title">1. Contact transport coordinator</div>
        <form id="tc-form" novalidate>
          <div class="field"><label for="tc-plate">Plate <span class="req">*</span></label><input id="tc-plate" value="${esc(lastScannedPlate)}" required /></div>
          <div class="field"><label for="tc-driver">Driver name <span class="req">*</span></label><input id="tc-driver" required /></div>
          <div class="field"><label for="tc-phone">Driver phone</label><input id="tc-phone" placeholder="+9665XXXXXXXX" /></div>
          <button type="submit" class="btn btn-secondary btn-block" id="tc-submit">${icon('phone', 16)} Log contact</button>
        </form>
        <div id="tc-result"></div>
      </div>
      <div class="card">
        <div class="section-title">2. Log arrival manually</div>
        <div id="manual-log-root"></div>
      </div>
    </div>
    <button type="button" class="btn btn-ghost" style="margin-block-start:var(--s4)" data-action="rescan">${icon('arrow-left', 16)} Back to scanning</button>`;

  root.querySelector('[data-action="rescan"]').addEventListener('click', () => { step = 'scan-truck'; renderPage(); });

  const tcForm = root.querySelector('#tc-form');
  tcForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const plate = tcForm.querySelector('#tc-plate').value.trim();
    const driverName = tcForm.querySelector('#tc-driver').value.trim();
    const phone = tcForm.querySelector('#tc-phone').value.trim();
    const btn = tcForm.querySelector('#tc-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      await api.contactTc({ plate, driverName, phone: phone || null });
      root.querySelector('#tc-result').innerHTML = `<p class="fs-sm" style="color:var(--success);margin-block-start:var(--s3)">${icon('check', 14)} Logged — note the TC reference you're given and log the arrival manually once confirmed.</p>`;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
  });

  renderManualLog(root.querySelector('#manual-log-root'));
}

async function renderManualLog(root) {
  root.innerHTML = skeletonBlock(3);
  let expected;
  try {
    expected = await api.getExpectedTrips();
  } catch (err) {
    root.innerHTML = errorState({ message: err.message });
    root.querySelector('[data-action="retry"]').addEventListener('click', () => renderManualLog(root));
    return;
  }
  if (!appEl) return;
  root.innerHTML = `
    <form id="manual-form" novalidate>
      <div class="field">
        <label for="manual-trip">Expected trip <span class="req">*</span></label>
        <select id="manual-trip" required>
          <option value="">Select the matching trip…</option>
          ${expected.map((t) => `<option value="${esc(t.id)}">${esc(t.code)} · ${esc(t.flightCode)} · ETA ${new Date(t.eta).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="manual-tc">TC reference <span class="req">*</span></label>
        <input id="manual-tc" placeholder="e.g. TC-2026-0417" required />
        <div class="error" id="err-manual-tc" hidden></div>
      </div>
      <button type="submit" class="btn btn-primary btn-block" id="manual-submit">${icon('check', 16)} Log arrival</button>
    </form>`;
  const form = root.querySelector('#manual-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tripId = form.querySelector('#manual-trip').value;
    const tcRef = form.querySelector('#manual-tc').value.trim();
    const errBox = form.querySelector('#err-manual-tc');
    if (!tripId) { toast('Select the matching expected trip.', 'error'); return; }
    if (tcRef.length < 3 || tcRef.length > 60) { errBox.textContent = 'TC reference must be 3–60 characters.'; errBox.hidden = false; return; }
    errBox.hidden = true;
    const btn = form.querySelector('#manual-submit');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      trip = await api.manualLog(lastScannedPlate, { tripId, tcRef });
      toast(`${trip.code} logged manually.`, 'success');
      step = trip.bay ? 'seal' : 'bay';
      renderPage();
    } catch (err) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      toast(err.message, 'error');
    }
  });
}

/* ===================== STEP 2: bay assignment ===================== */

function renderBayStep(root) {
  root.innerHTML = `
    <div class="card" style="max-width:640px">
      <div class="section-title">Assign a bay for ${esc(trip.code)} (${esc(trip.truckPlate)})</div>
      <div class="bay-grid" id="bay-grid"></div>
    </div>`;
  const grid = root.querySelector('#bay-grid');
  grid.innerHTML = hotel.bays.map((bay) => `
    <button type="button" class="bay-card" data-bay="${esc(bay)}">
      ${icon('warehouse', 24)}
      <div class="fs-sm fw-medium" style="margin-block-start:var(--s2)">${esc(bay)}</div>
    </button>`).join('');
  grid.querySelectorAll('[data-bay]').forEach((btn) => btn.addEventListener('click', async () => {
    grid.querySelectorAll('[data-bay]').forEach((b) => b.disabled = true);
    btn.classList.add('selected');
    try {
      trip = await api.assignBay(trip.id, btn.dataset.bay);
      toast(`${trip.bay} assigned.`, 'success');
      step = 'seal';
      renderPage();
    } catch (err) {
      grid.querySelectorAll('[data-bay]').forEach((b) => b.disabled = false);
      btn.classList.remove('selected');
      toast(err.message, 'error');
    }
  }));
}

/* ===================== STEP 3: seal verification ===================== */

function renderSealStep(root) {
  scanInstance?.destroy();
  root.innerHTML = `
    <div class="grid grid-cols-2">
      <div><div id="seal-scan-root"></div></div>
      <div class="card">
        <div class="section-title">Trip details</div>
        <div class="stack gap-2 fs-sm">
          <div class="row" style="justify-content:space-between"><span class="muted">Trip</span><strong class="mono">${esc(trip.code)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Driver</span><strong>${esc(trip.driverName)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Flight</span><strong>${esc(trip.flightCode)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Bay</span><strong>${esc(trip.bay)}</strong></div>
          <div class="row" style="justify-content:space-between"><span class="muted">Seal number</span><strong class="mono">${esc(trip.sealNumber)}</strong></div>
        </div>
        ${trip.sealVerifiedAt ? `
          <button type="button" class="btn btn-primary btn-block" style="margin-block-start:var(--s5)" id="start-unloading" ${starting ? 'disabled aria-busy="true"' : ''}>
            ${starting ? `<span class="spinner"></span> Starting…` : `${icon('play', 16)} Start unloading`}
          </button>` : ''}
      </div>
    </div>`;

  if (trip.sealVerifiedAt) {
    root.querySelector('#start-unloading').addEventListener('click', onStartUnloading);
    return;
  }
  scanInstance = createScanInput(root.querySelector('#seal-scan-root'), {
    label: 'Scan the truck seal number',
    placeholder: trip.sealNumber,
    onSubmit: async (code) => {
      trip = await api.verifySeal(trip.id, code);
      renderSealStep(root);
      return { message: 'Seal verified.' };
    },
  });
}

async function onStartUnloading() {
  if (starting) return;
  starting = true;
  const btn = appEl.querySelector('#start-unloading');
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spinner"></span> Starting…'; }
  try {
    await api.startReceiving(trip.id);
    navigate(`#/receiving/${trip.id}`);
  } catch (err) {
    starting = false;
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = `${icon('play', 16)} Start unloading`; }
  }
}
