import * as api from '../api.js';
import { icon, esc, fmtRelative, skeletonBlock, emptyState, errorState } from '../ui.js';
import { navigate } from '../router.js';
import { statusChip } from '../components/status-chip.js';

const RING_CIRC = 2 * Math.PI * 16;

let appEl = null;
let mounted = false;
let data = null;
let loading = true;
let loadError = '';

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  data = null; loading = true; loadError = '';
  renderShell();
  load();
  return { destroy, refresh: load, activeBagId: () => null };
}

export function destroy() {
  mounted = false;
  appEl = null;
}

async function load() {
  loading = true; loadError = '';
  renderShell();
  try {
    const res = await api.getHome();
    if (!mounted) return;
    data = res;
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
  if (loading) return skeletonBlock(6);
  if (loadError) return errorState({ message: loadError });
  return successHtml(data);
}

function successHtml(d) {
  const noJourney = !d.departure.hasBooking && !d.arrival.hasArrival;
  return `
    <div class="stack gap-1" style="margin-block-end:var(--s6)">
      <p class="greeting">Welcome, ${esc(d.firstName)}</p>
      <p class="muted fs-sm">${esc(d.group)} · ${esc(d.agency)}</p>
    </div>
    <div class="stack gap-6">
      ${noJourney ? noJourneyHtml() : `
        <div>
          <h2 class="section-title">Departure</h2>
          ${departureHtml(d.departure)}
        </div>
        ${d.arrival.hasArrival ? `
        <div>
          <h2 class="section-title">Arrival</h2>
          ${arrivalHtml(d.arrival)}
        </div>` : ''}
      `}
      ${notificationsHtml(d.notifications)}
    </div>`;
}

function noJourneyHtml() {
  return emptyState({
    message: 'No active journey yet. Book your city check-in to get started.',
    actionLabel: 'Book City Check-in',
    actionAttr: 'data-action="go-book"',
  });
}

function departureHtml(dep) {
  if (!dep.hasBooking) {
    return `
      <div class="card">
        <p class="fs-sm">Book your city check-in before you travel.</p>
        <button type="button" class="btn btn-primary" data-action="go-book" style="margin-block-start:var(--s4)">Book City Check-in</button>
      </div>`;
  }
  return `
    <a class="card card-tap" href="#/booking/${esc(dep.booking.id)}">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong>${esc(dep.flightCode || '—')}</strong>
          <p class="fs-sm muted" style="margin:4px 0 0">${dep.bagsTotal} bag${dep.bagsTotal === 1 ? '' : 's'}</p>
        </div>
        ${statusChip(dep.booking.status)}
      </div>
      ${dep.allOnAircraft ? `<div class="banner-alert green" style="margin:var(--s4) 0 0">${icon('check-circle', 18)} <span>All bags on board.</span></div>` : ''}
    </a>`;
}

function arrivalHtml(arr) {
  const total = arr.bagsTotal || 0;
  const delivered = arr.bagsDelivered || 0;
  const ratio = total > 0 ? delivered / total : 0;
  const offset = RING_CIRC * (1 - ratio);
  const hotel = arr.hotel;
  const hotelLine = hotel
    ? `${esc(hotel.name)}${hotel.building ? ` · Bldg ${esc(hotel.building)}` : ''}${hotel.room ? ` · Room ${esc(hotel.room)}` : ''}`
    : '';
  return `
    <a class="card card-tap" href="#/arrival">
      <div class="row gap-4" style="justify-content:space-between;align-items:center">
        <div class="grow">
          <div class="row gap-2 wrap" style="justify-content:space-between">
            <strong>${esc(arr.flightCode || '—')}</strong>
            ${arr.flightStatus ? statusChip(arr.flightStatus) : ''}
          </div>
          ${hotelLine ? `<p class="fs-sm muted" style="margin:4px 0 0">${hotelLine}</p>` : ''}
        </div>
        <div class="progress-ring">
          <svg viewBox="0 0 36 36">
            <circle class="ring-bg" cx="18" cy="18" r="16"></circle>
            <circle class="ring-fill" cx="18" cy="18" r="16" stroke-dasharray="${RING_CIRC.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
          </svg>
          <div class="ring-label">${delivered}<span>of ${total}</span></div>
        </div>
      </div>
    </a>`;
}

function notificationsHtml(list) {
  return `
    <div>
      <h2 class="section-title">Recent notifications</h2>
      ${list.length ? `
        <div class="stack gap-2">
          ${list.map((n) => `
            <a class="card card-tap" href="${esc(n.link)}">
              <div class="row" style="justify-content:space-between;align-items:flex-start;gap:var(--s3)">
                <strong class="fs-sm">${esc(n.title)}</strong>
                <span class="fs-xs muted" style="white-space:nowrap">${esc(fmtRelative(n.time))}</span>
              </div>
            </a>`).join('')}
        </div>` : `<p class="fs-sm muted">No notifications yet.</p>`}
      <a class="btn btn-ghost btn-block" href="#/notifications" style="margin-block-start:var(--s3)">See all</a>
    </div>`;
}

function wireBody() {
  appEl.querySelectorAll('[data-action="go-book"]').forEach((btn) => btn.addEventListener('click', () => navigate('#/book')));
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
}
