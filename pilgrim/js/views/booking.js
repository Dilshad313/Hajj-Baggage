import * as api from '../api.js';
import { toast, esc, fmtWeight, skeletonBlock, errorState, confirmDialog, openModal } from '../ui.js';
import { statusChip } from '../components/status-chip.js';

let appEl = null;
let mounted = false;
let bookingId = null;
let info = null;
let loading = true;
let loadError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  bookingId = params.id;
  info = null; loading = true; loadError = '';
  renderShell();
  load();
  return { destroy, refresh: load, activeBagId: () => info?.bags?.[0]?.id || null };
}

/** No timers to clean up. */
export function destroy() {
  mounted = false;
  appEl = null;
}

async function load() {
  loading = true; loadError = '';
  renderShell();
  try {
    const res = await api.getBooking(bookingId);
    if (!mounted) return;
    info = res;
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

function renderShell() {
  appEl.innerHTML = bodyHtml();
  wireBody();
}

function bodyHtml() {
  if (loading) return `<div class="page-header"><h1 class="page-title">Booking</h1></div>${skeletonBlock(6)}`;
  if (loadError) return `<div class="page-header"><h1 class="page-title">Booking</h1></div>${errorState({ message: loadError })}`;
  return successHtml(info);
}

function fmtSlotDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(`${iso}T00:00:00`));
}

function detailRow(label, value) {
  return `<div class="row" style="justify-content:space-between;gap:var(--s3)"><span class="muted fs-sm">${esc(label)}</span><span class="fs-sm" style="text-align:end">${value}</span></div>`;
}

function successHtml({ booking, flight, centre, bags }) {
  const notYetCheckedIn = booking.status === 'Booked';
  const totalWeight = (booking.bagWeights || []).reduce((sum, w) => sum + (Number(w) || 0), 0);
  return `
    <div class="page-header">
      <div class="row gap-3" style="justify-content:space-between;align-items:flex-start">
        <h1 class="page-title">Booking ${esc(booking.id)}</h1>
        ${statusChip(booking.status)}
      </div>
    </div>
    <div class="stack gap-5">
      <div class="qr-box">
        <div id="qr-canvas"></div>
        <strong class="mono fs-lg">${esc(booking.qrCode)}</strong>
      </div>
      <div class="card">
        <h2 class="section-title">Details</h2>
        <div class="stack gap-2">
          ${detailRow('Flight', flight ? `${esc(flight.code)} · ${esc(flight.origin)} → ${esc(flight.destination)}` : esc(booking.flightCode))}
          ${detailRow('Centre', centre ? esc(centre.name) : '—')}
          ${centre ? detailRow('Address', esc(centre.address)) : ''}
          ${centre ? detailRow('Hours', esc(centre.hours)) : ''}
          ${detailRow('Slot', `${fmtSlotDate(booking.slot?.date)} at ${esc(booking.slot?.time || '—')}`)}
          ${detailRow('Bags', String(booking.bagCount))}
          ${detailRow('Bag weights', (booking.bagWeights || []).map((w) => fmtWeight(w)).join(', ') || '—')}
          ${detailRow('Total weight', fmtWeight(totalWeight))}
        </div>
      </div>
      ${notYetCheckedIn ? actionsHtml() : checkedInBagsHtml(bags)}
    </div>`;
}

function actionsHtml() {
  return `
    <div class="row gap-3">
      <button type="button" class="btn btn-secondary" data-action="reschedule" style="flex:1">Reschedule</button>
      <button type="button" class="btn btn-danger" data-action="cancel" style="flex:1">Cancel booking</button>
    </div>`;
}

function checkedInBagsHtml(bags) {
  if (!bags || !bags.length) return '';
  return `
    <div>
      <h2 class="section-title">Checked-in bags</h2>
      <div class="stack gap-3">
        ${bags.map((b) => `
          <div class="card">
            <div class="row" style="justify-content:space-between;align-items:flex-start">
              <div>
                <strong class="mono">${esc(b.tagNumber)}</strong>
                <p class="fs-sm muted" style="margin:2px 0 0">${fmtWeight(b.weightKg)}</p>
              </div>
              ${statusChip(b.status)}
            </div>
            <a class="btn btn-secondary btn-block" href="#/track" style="margin-block-start:var(--s3)">Track</a>
          </div>`).join('')}
      </div>
    </div>`;
}

function wireBody() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  appEl.querySelector('[data-action="reschedule"]')?.addEventListener('click', openRescheduleModal);
  appEl.querySelector('[data-action="cancel"]')?.addEventListener('click', cancelBookingFlow);
  const canvas = appEl.querySelector('#qr-canvas');
  if (canvas && window.QRCode && info?.booking?.qrCode) {
    canvas.innerHTML = '';
    // eslint-disable-next-line no-new
    new window.QRCode(canvas, { text: info.booking.qrCode, width: 160, height: 160, correctLevel: window.QRCode.CorrectLevel.M });
  }
}

async function cancelBookingFlow() {
  const confirmed = await confirmDialog({
    title: 'Cancel booking',
    body: 'Are you sure you want to cancel this booking? This cannot be undone.',
    confirmLabel: 'Cancel booking',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api.cancelBooking(info.booking.id);
    if (!mounted) return;
    toast('Booking cancelled.', 'success');
    load();
  } catch (err) {
    if (!mounted) return;
    toast(err.message, 'error');
  }
}

/* ===================== reschedule modal ===================== */

async function openRescheduleModal() {
  const booking = info.booking;
  let centres = [];
  try {
    centres = await api.getCentres();
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  if (!mounted) return;

  const state = {
    centreId: booking.centreId,
    date: booking.slot?.date || '',
    time: booking.slot?.time || null,
    slots: null,
    slotsLoading: false,
    submitting: false,
    error: '',
  };

  let overlayEl = null;
  const close = openModal({
    title: 'Reschedule booking',
    bodyHtml: modalBodyHtml(),
    onMount: (el) => {
      overlayEl = el;
      wireModal();
      loadSlotsForModal();
    },
  });

  function modalBodyHtml() {
    return `
      <div class="stack gap-4">
        <div class="field">
          <label for="rs-centre">Centre</label>
          <select id="rs-centre">
            ${centres.map((c) => `<option value="${esc(c.id)}" ${c.id === state.centreId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="rs-date">Date</label>
          <input id="rs-date" type="date" value="${esc(state.date)}" />
        </div>
        <div class="field">
          <label for="rs-time">Time</label>
          <select id="rs-time" ${state.slotsLoading || !state.slots ? 'disabled' : ''}>
            ${state.slotsLoading ? '<option>Loading…</option>'
    : state.slots ? state.slots.slots.map((s) => `<option value="${esc(s.time)}" ${s.time === state.time ? 'selected' : ''} ${(s.past || s.full) ? 'disabled' : ''}>${esc(s.time)}${s.full ? ' · Full' : ''}</option>`).join('')
      : '<option>Pick a date</option>'}
          </select>
        </div>
        ${state.error ? `<div class="field error" style="background:var(--danger-soft);padding:var(--s3);border-radius:var(--r-sm)">${esc(state.error)}</div>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="rs-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-act="rs-submit" ${state.submitting ? 'disabled' : ''}>${state.submitting ? 'Saving…' : 'Save'}</button>
        </div>
      </div>`;
  }

  function rerender() {
    const body = overlayEl.querySelector('.modal-body');
    body.innerHTML = modalBodyHtml();
    wireModal();
  }

  function wireModal() {
    const body = overlayEl.querySelector('.modal-body');
    body.querySelector('#rs-centre').addEventListener('change', (e) => {
      state.centreId = e.target.value;
      state.slots = null;
      state.time = null;
      loadSlotsForModal();
    });
    body.querySelector('#rs-date').addEventListener('change', (e) => {
      state.date = e.target.value;
      state.slots = null;
      state.time = null;
      loadSlotsForModal();
    });
    body.querySelector('#rs-time').addEventListener('change', (e) => { state.time = e.target.value; });
    body.querySelector('[data-act="rs-cancel"]').addEventListener('click', () => close());
    body.querySelector('[data-act="rs-submit"]').addEventListener('click', submit);
  }

  async function loadSlotsForModal() {
    if (!state.centreId || !state.date) return;
    state.slotsLoading = true;
    rerender();
    try {
      const res = await api.getSlots(state.centreId, state.date);
      state.slotsLoading = false;
      state.slots = res;
      if (!state.time || !res.slots.some((s) => s.time === state.time && !s.past && !s.full)) {
        const firstAvailable = res.slots.find((s) => !s.past && !s.full);
        state.time = firstAvailable ? firstAvailable.time : null;
      }
      rerender();
    } catch (err) {
      state.slotsLoading = false;
      state.error = err.message;
      rerender();
    }
  }

  async function submit() {
    if (state.submitting) return;
    if (!state.centreId || !state.date || !state.time) {
      state.error = 'Pick a centre, date, and time.';
      rerender();
      return;
    }
    state.submitting = true;
    state.error = '';
    rerender();
    try {
      await api.reschedule(booking.id, state.centreId, { date: state.date, time: state.time });
      close();
      toast('Booking rescheduled.', 'success');
      if (mounted) load();
    } catch (err) {
      state.submitting = false;
      state.error = err.message;
      rerender();
    }
  }
}
