import * as api from '../api.js';
import { toast, icon, esc, fmtDateTime, fmtWeight, skeletonBlock, errorState } from '../ui.js';
import { navigate } from '../router.js';
import { stepperHtml } from '../components/stepper.js';

const STEP_LABELS = ['Service', 'Flight', 'Bags', 'QR', 'Centre', 'Slot', 'Review'];

let appEl = null;
let mounted = false;
let step = 1;
let limits = null;
let flights = [];
let centres = [];
let loadError = '';
let slotsCache = null;
let slotsLoading = false;
let submitError = '';
let submitting = false;

let draft = emptyDraft();

function emptyDraft() {
  return {
    serviceType: null, flightCode: null, bagCount: 1, bagWeights: [0], prohibitedConfirmed: false,
    draftCode: null, centreId: null, slotDate: null, slotTime: null,
  };
}

function totalWeight() {
  return draft.bagWeights.reduce((sum, w) => sum + (Number(w) || 0), 0);
}

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  step = 1;
  draft = emptyDraft();
  limits = null; flights = []; centres = []; loadError = ''; slotsCache = null; submitError = '';
  appEl.innerHTML = `<div class="page-header"><h1 class="page-title">New booking</h1></div>${skeletonBlock(6)}`;
  init();
  return { destroy };
}

export function destroy() {
  mounted = false;
  appEl = null;
}

async function init() {
  try {
    const home = await api.getHome();
    if (!mounted) return;
    if (home.departure.hasBooking) {
      toast('You already have a booking for this flight.', 'info');
      navigate(`#/booking/${home.departure.booking.id}`);
      return;
    }
    const [limitsRes, flightsRes, centresRes] = await Promise.all([api.getBookingLimits(), api.getFlights(), api.getCentres()]);
    if (!mounted) return;
    limits = limitsRes;
    flights = flightsRes;
    centres = centresRes;
    draft.draftCode = `APT-${Math.floor(100000 + Math.random() * 900000)}`;
    renderStep();
  } catch (err) {
    if (!mounted) return;
    loadError = err.message;
    appEl.innerHTML = `<div class="page-header"><h1 class="page-title">New booking</h1></div>${errorState({ message: loadError })}`;
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      appEl.innerHTML = `<div class="page-header"><h1 class="page-title">New booking</h1></div>${skeletonBlock(6)}`;
      init();
    });
  }
}

/* ===================== step dispatch ===================== */

function canContinue() {
  switch (step) {
    case 1: return draft.serviceType === 'City Check-in';
    case 2: return !!draft.flightCode;
    case 3: return draft.bagCount >= 1 && draft.bagWeights.every((w) => w > 0 && w <= limits.maxBagKg) && draft.prohibitedConfirmed;
    case 4: return true;
    case 5: return !!draft.centreId;
    case 6: return !!draft.slotDate && !!draft.slotTime;
    default: return true;
  }
}

function stepHtml() {
  switch (step) {
    case 1: return step1Html();
    case 2: return step2Html();
    case 3: return step3Html();
    case 4: return step4Html();
    case 5: return step5Html();
    case 6: return step6Html();
    case 7: return step7Html();
    default: return '';
  }
}

function wireStep() {
  switch (step) {
    case 1: return wireStep1();
    case 2: return wireStep2();
    case 3: return wireStep3();
    case 4: return wireStep4();
    case 5: return wireStep5();
    case 6: return wireStep6();
    case 7: return wireStep7();
    default: return undefined;
  }
}

function refreshContinueButton() {
  const btn = document.getElementById('btn-continue');
  if (btn) btn.disabled = !canContinue();
}

function renderStep() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">New booking</h1>
    </div>
    ${stepperHtml(STEP_LABELS, step)}
    <div id="step-content">${stepHtml()}</div>
    <div class="footer-bar">
      <button type="button" class="btn btn-secondary" data-action="back">${step === 1 ? 'Cancel' : 'Back'}</button>
      ${step === 7
    ? `<button type="button" class="btn btn-primary" id="btn-continue" data-action="confirm" ${submitting ? 'disabled aria-busy="true"' : ''}>${submitting ? 'Confirming…' : 'Confirm booking'}</button>`
    : `<button type="button" class="btn btn-primary" id="btn-continue" data-action="continue" ${canContinue() ? '' : 'disabled'}>Continue</button>`}
    </div>
  `;
  appEl.querySelector('[data-action="back"]').addEventListener('click', () => {
    if (step === 1) { navigate('#/'); return; }
    step -= 1;
    renderStep();
  });
  appEl.querySelector('[data-action="continue"]')?.addEventListener('click', () => {
    if (!canContinue()) return;
    step += 1;
    renderStep();
  });
  appEl.querySelector('[data-action="confirm"]')?.addEventListener('click', submitBooking);
  wireStep();
}

/* ===================== step 1 — service ===================== */

function step1Html() {
  const selected = draft.serviceType === 'City Check-in';
  return `
    <div class="stack gap-3">
      <button type="button" class="card card-tap" data-service="City Check-in" aria-pressed="${selected}" style="${selected ? 'border-color:var(--accent)' : ''}">
        <div class="row gap-3" style="align-items:flex-start">
          <span style="color:var(--accent)">${icon('map-pin', 24)}</span>
          <div class="grow">
            <strong>City Check-in</strong>
            <p class="fs-sm muted" style="margin:4px 0 0">Check in your bags at a city centre before you travel to the airport.</p>
          </div>
          ${selected ? icon('check-circle', 20) : ''}
        </div>
      </button>
      <div class="card" style="opacity:.55">
        <div class="row gap-3" style="align-items:flex-start">
          <span>${icon('plane', 24)}</span>
          <div class="grow">
            <strong>Airport Check-in</strong>
            <p class="fs-sm muted" style="margin:4px 0 0">Not available for your flight yet. Use City Check-in instead.</p>
          </div>
        </div>
      </div>
    </div>`;
}

function wireStep1() {
  document.getElementById('step-content').querySelector('[data-service]')?.addEventListener('click', (e) => {
    draft.serviceType = e.currentTarget.dataset.service;
    renderStep();
  });
}

/* ===================== step 2 — flight ===================== */

function step2Html() {
  return `
    <div class="stack gap-3">
      ${flights.map((f) => {
    const hoursLeft = (new Date(f.std).getTime() - Date.now()) / 3600000;
    const closed = f.status !== 'Open' || hoursLeft < limits.closeHoursBeforeCutoff;
    const selected = draft.flightCode === f.code;
    return `
        <button type="button" class="card card-tap" data-flight="${esc(f.code)}" aria-pressed="${selected}" ${closed ? 'disabled aria-disabled="true"' : ''} style="${selected ? 'border-color:var(--accent)' : ''}">
          <div class="row" style="justify-content:space-between;align-items:flex-start">
            <div>
              <strong>${esc(f.code)}</strong>
              <p class="fs-sm muted" style="margin:4px 0 0">${esc(f.origin)} → ${esc(f.destination)} · ${fmtDateTime(f.std)}</p>
            </div>
            ${selected ? icon('check-circle', 20) : ''}
          </div>
          ${closed ? `<p class="fs-xs" style="color:var(--danger);margin-block-start:var(--s2)">${f.status !== 'Open' ? 'Booking is closed for this flight.' : `Booking closes ${limits.closeHoursBeforeCutoff}h before departure.`}</p>` : ''}
        </button>`;
  }).join('')}
    </div>`;
}

function wireStep2() {
  document.getElementById('step-content').querySelectorAll('[data-flight]').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.flightCode = btn.dataset.flight;
      renderStep();
    });
  });
}

/* ===================== step 3 — bags ===================== */

function step3Html() {
  return `
    <div class="stack gap-4">
      <div class="field" style="margin-block-end:0">
        <label>Number of bags</label>
        <div class="row gap-3">
          <button type="button" class="btn btn-secondary btn-icon" data-action="bag-minus" ${draft.bagCount <= 1 ? 'disabled' : ''} aria-label="Fewer bags">−</button>
          <strong class="fs-lg" style="min-width:2ch;text-align:center">${draft.bagCount}</strong>
          <button type="button" class="btn btn-secondary btn-icon" data-action="bag-plus" ${draft.bagCount >= limits.maxBags ? 'disabled' : ''} aria-label="More bags">+</button>
          <span class="fs-sm muted">max ${limits.maxBags}</span>
        </div>
      </div>
      ${draft.bagWeights.map((w, i) => `
        <div class="field">
          <label for="weight-${i}">Bag ${i + 1} weight (kg) <span class="req">*</span></label>
          <input id="weight-${i}" data-weight-index="${i}" type="number" min="0.1" max="${limits.maxBagKg}" step="0.1" value="${w || ''}" placeholder="e.g. 20.0" inputmode="decimal" />
          <div class="error" data-weight-err="${i}" hidden></div>
        </div>`).join('')}
      <p class="fs-sm"><strong>Total:</strong> <span id="total-weight">${fmtWeight(totalWeight())}</span></p>
      <div class="info-note">${icon('info', 16)} <span>Each bag must be ${limits.maxBagKg} kg or less. Overweight bags must be repacked at the centre.</span></div>
      <div class="warn-note">${icon('alert-triangle', 16)} <span>Do not pack prohibited items: sharp objects, flammable liquids, power banks over 100Wh, or liquids over 100ml.</span></div>
      <label class="checkbox-row">
        <input type="checkbox" id="prohibited-ok" ${draft.prohibitedConfirmed ? 'checked' : ''} />
        <span>I confirm my bags do not contain prohibited items.</span>
      </label>
    </div>`;
}

function wireStep3() {
  const content = document.getElementById('step-content');
  content.querySelector('[data-action="bag-minus"]')?.addEventListener('click', () => {
    if (draft.bagCount <= 1) return;
    draft.bagCount -= 1;
    draft.bagWeights.pop();
    renderStep();
  });
  content.querySelector('[data-action="bag-plus"]')?.addEventListener('click', () => {
    if (draft.bagCount >= limits.maxBags) return;
    draft.bagCount += 1;
    draft.bagWeights.push(0);
    renderStep();
  });
  content.querySelectorAll('[data-weight-index]').forEach((input) => {
    input.addEventListener('input', () => {
      const i = Number(input.dataset.weightIndex);
      draft.bagWeights[i] = input.value === '' ? 0 : Number(input.value);
      const totalEl = document.getElementById('total-weight');
      if (totalEl) totalEl.textContent = fmtWeight(totalWeight());
      refreshContinueButton();
    });
    input.addEventListener('blur', () => {
      const i = Number(input.dataset.weightIndex);
      const errEl = content.querySelector(`[data-weight-err="${i}"]`);
      const w = draft.bagWeights[i];
      if (!w || w <= 0) { errEl.textContent = 'Enter the bag weight.'; errEl.hidden = false; input.setAttribute('aria-invalid', 'true'); }
      else if (w > limits.maxBagKg) { errEl.textContent = `Repack required — bag exceeds ${limits.maxBagKg} kg.`; errEl.hidden = false; input.setAttribute('aria-invalid', 'true'); }
      else { errEl.hidden = true; input.removeAttribute('aria-invalid'); }
    });
  });
  content.querySelector('#prohibited-ok')?.addEventListener('change', (e) => {
    draft.prohibitedConfirmed = e.target.checked;
    refreshContinueButton();
  });
}

/* ===================== step 4 — QR ===================== */

function step4Html() {
  return `
    <div class="stack gap-4" style="align-items:center;text-align:center">
      <p class="muted fs-sm">Show this code at the check-in centre. It stays the same even if you go back and change earlier steps.</p>
      <div class="qr-box">
        <div id="qr-canvas"></div>
        <strong class="mono fs-lg">${esc(draft.draftCode)}</strong>
      </div>
      <button type="button" class="btn btn-secondary" data-action="copy-code">${icon('copy', 16)} Copy code</button>
    </div>`;
}

function wireStep4() {
  const canvas = document.getElementById('qr-canvas');
  if (canvas && window.QRCode) {
    canvas.innerHTML = '';
    // eslint-disable-next-line no-new
    new window.QRCode(canvas, { text: draft.draftCode, width: 160, height: 160, correctLevel: window.QRCode.CorrectLevel.M });
  }
  document.getElementById('step-content').querySelector('[data-action="copy-code"]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(draft.draftCode);
      toast('Code copied.', 'success');
    } catch (e) {
      toast('Could not copy — write the code down manually.', 'error');
    }
  });
}

/* ===================== step 5 — centre ===================== */

function step5Html() {
  const byCity = new Map();
  centres.forEach((c) => {
    if (!byCity.has(c.city)) byCity.set(c.city, []);
    byCity.get(c.city).push(c);
  });
  return `
    <div class="stack gap-5">
      ${[...byCity.entries()].map(([city, list]) => `
        <div>
          <h2 class="section-title">${esc(city)}</h2>
          <div class="stack gap-3">
            ${list.map((c) => {
    const selected = draft.centreId === c.id;
    return `
              <button type="button" class="card card-tap" data-centre="${esc(c.id)}" aria-pressed="${selected}" style="${selected ? 'border-color:var(--accent)' : ''}">
                <div class="row" style="justify-content:space-between;align-items:flex-start">
                  <div>
                    <strong>${esc(c.name)}</strong>
                    <p class="fs-sm muted" style="margin:4px 0 0">${esc(c.address)}</p>
                    <p class="fs-xs muted" style="margin:2px 0 0">Hours: ${esc(c.hours)}</p>
                  </div>
                  ${selected ? icon('check-circle', 20) : ''}
                </div>
              </button>`;
  }).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function wireStep5() {
  document.getElementById('step-content').querySelectorAll('[data-centre]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (draft.centreId !== btn.dataset.centre) {
        draft.centreId = btn.dataset.centre;
        draft.slotDate = null;
        draft.slotTime = null;
        slotsCache = null;
      }
      renderStep();
    });
  });
}

/* ===================== step 6 — slot ===================== */

function dateOptions() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(Date.now() + i * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(d);
    out.push({ iso, label });
  }
  return out;
}

function step6Html() {
  if (!draft.slotDate) draft.slotDate = dateOptions()[0].iso;
  return `
    <div class="stack gap-4">
      <div class="date-chip-row" role="list">
        ${dateOptions().map((d) => `<button type="button" class="date-chip" data-date="${d.iso}" aria-selected="${draft.slotDate === d.iso}">${esc(d.label)}</button>`).join('')}
      </div>
      <div id="slot-grid">${slotGridHtml()}</div>
    </div>`;
}

function slotGridHtml() {
  if (slotsLoading) return skeletonBlock(3);
  if (!slotsCache) return `<p class="fs-sm muted">Choose a date to see available times.</p>`;
  return `
    <div class="grid grid-cols-3" style="gap:var(--s2)">
      ${slotsCache.slots.map((s) => `
        <button type="button" class="slot-chip" data-time="${s.time}" aria-selected="${draft.slotTime === s.time}" ${(s.past || s.full) ? 'disabled' : ''}>
          ${s.time}${s.full ? ' · Full' : ''}
        </button>`).join('')}
    </div>`;
}

function wireStep6() {
  const content = document.getElementById('step-content');
  content.querySelectorAll('[data-date]').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.slotDate = btn.dataset.date;
      draft.slotTime = null;
      loadSlots();
    });
  });
  wireSlotGrid();
  if (!slotsCache || slotsCache.date !== draft.slotDate) loadSlots();
}

function wireSlotGrid() {
  document.getElementById('slot-grid')?.querySelectorAll('[data-time]').forEach((btn) => {
    btn.addEventListener('click', () => {
      draft.slotTime = btn.dataset.time;
      renderStep();
    });
  });
}

async function loadSlots() {
  slotsLoading = true;
  const grid = document.getElementById('slot-grid');
  if (grid) grid.innerHTML = slotGridHtml();
  try {
    const res = await api.getSlots(draft.centreId, draft.slotDate);
    if (!mounted || step !== 6) return;
    slotsCache = res;
    slotsLoading = false;
    refreshContinueButton();
    const g = document.getElementById('slot-grid');
    if (g) { g.innerHTML = slotGridHtml(); wireSlotGrid(); }
  } catch (err) {
    if (!mounted || step !== 6) return;
    slotsLoading = false;
    toast(err.message, 'error');
    const g = document.getElementById('slot-grid');
    if (g) g.innerHTML = `<p class="fs-sm" style="color:var(--danger)">Could not load times. Pick a date again to retry.</p>`;
  }
}

/* ===================== step 7 — review ===================== */

function step7Html() {
  const flight = flights.find((f) => f.code === draft.flightCode);
  const centre = centres.find((c) => c.id === draft.centreId);
  return `
    <div class="stack gap-4">
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <strong>Flight</strong>
          <button type="button" class="btn btn-ghost" data-edit-step="2" style="height:32px;padding-inline:var(--s3)">Edit</button>
        </div>
        <p class="fs-sm" style="margin:4px 0 0">${flight ? `${esc(flight.code)} · ${esc(flight.origin)} → ${esc(flight.destination)} · ${fmtDateTime(flight.std)}` : '—'}</p>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <strong>Bags</strong>
          <button type="button" class="btn btn-ghost" data-edit-step="3" style="height:32px;padding-inline:var(--s3)">Edit</button>
        </div>
        <p class="fs-sm" style="margin:4px 0 0">${draft.bagCount} bag${draft.bagCount > 1 ? 's' : ''} · ${draft.bagWeights.map((w) => fmtWeight(w)).join(', ')} · total ${fmtWeight(totalWeight())}</p>
      </div>
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <strong>Centre &amp; time</strong>
          <button type="button" class="btn btn-ghost" data-edit-step="5" style="height:32px;padding-inline:var(--s3)">Edit</button>
        </div>
        <p class="fs-sm" style="margin:4px 0 0">${centre ? esc(centre.name) : '—'}</p>
        <p class="fs-sm muted" style="margin:2px 0 0">${draft.slotDate ? fmtDate(draft.slotDate) : '—'} at ${esc(draft.slotTime || '—')}</p>
      </div>
      ${submitError ? `<div class="field error" style="background:var(--danger-soft);padding:var(--s3);border-radius:var(--r-sm)">${esc(submitError)}</div>` : ''}
    </div>`;
}

function fmtDate(iso) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(`${iso}T00:00:00`));
}

function wireStep7() {
  document.getElementById('step-content').querySelectorAll('[data-edit-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      step = Number(btn.dataset.editStep);
      renderStep();
    });
  });
}

async function submitBooking() {
  if (submitting) return;
  submitting = true;
  submitError = '';
  renderStep();
  try {
    const booking = await api.createBooking({
      flightCode: draft.flightCode, bagCount: draft.bagCount, bagWeights: draft.bagWeights,
      centreId: draft.centreId, slot: { date: draft.slotDate, time: draft.slotTime }, id: draft.draftCode,
    });
    if (!mounted) return;
    toast('Booking confirmed.', 'success');
    navigate(`#/booking/${booking.id}`);
  } catch (err) {
    if (!mounted) return;
    submitting = false;
    if (err.code === 'existing-booking') {
      toast('You already have a booking for this flight.', 'info');
      navigate(`#/booking/${err.bookingId}`);
      return;
    }
    if (err.code === 'slot-full') {
      step = 6;
      slotsCache = null;
      draft.slotTime = null;
      toast(err.message, 'error');
      renderStep();
      return;
    }
    submitError = err.message;
    renderStep();
  }
}
