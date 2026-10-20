import * as api from '../api.js';
import { toast, icon, esc, fmtWeight, skeletonBlock, emptyState, errorState, confirmDialog } from '../ui.js';
import { navigate } from '../router.js';
import { statusChip } from '../components/status-chip.js';
import { stageRailHtml } from '../components/bag-timeline.js';
import { DEPARTURE_STAGES, ARRIVAL_STAGES } from '../seed.js';

let appEl = null;
let mounted = false;
let direction = 'departure';
let bags = [];
let receipt = null;
let loading = true;
let loadError = '';
let confirming = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  direction = 'departure';
  bags = []; receipt = null; loading = true; loadError = '';
  renderShell();
  pickDefaultDirection().then(() => { if (mounted) load(); });
  return { destroy, poll, refresh: load, activeBagId };
}

export function destroy() {
  mounted = false;
  appEl = null;
}

function activeBagId() {
  return bags[0]?.id || null;
}

async function pickDefaultDirection() {
  try {
    const home = await api.getHome();
    if (!mounted) return;
    direction = home.arrival.hasArrival && !home.departure.hasBooking ? 'arrival' : 'departure';
  } catch (e) { /* keep default */ }
}

async function load() {
  loading = true; loadError = '';
  renderShell();
  try {
    const [bagList, receiptRes] = await Promise.all([
      api.getBags(direction),
      direction === 'departure' ? loadReceipt() : Promise.resolve(null),
    ]);
    if (!mounted) return;
    bags = bagList;
    receipt = receiptRes;
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

async function loadReceipt() {
  const home = await api.getHome();
  if (!home.departure.booking) return null;
  return api.getReceiptForBooking(home.departure.booking.id);
}

async function poll() {
  if (!mounted || loading) return;
  try {
    const [bagList, receiptRes] = await Promise.all([
      api.getBags(direction),
      direction === 'departure' ? loadReceipt() : Promise.resolve(null),
    ]);
    if (!mounted) return;
    bags = bagList;
    receipt = receiptRes;
    renderShell();
  } catch (e) { /* silent poll failure */ }
}

function switchDirection(next) {
  if (direction === next) return;
  direction = next;
  load();
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Track my bags</h1>
    </div>
    <div class="segmented" role="tablist" aria-label="Direction" style="margin-block-end:var(--s5)">
      <button type="button" role="tab" data-dir="departure" aria-selected="${direction === 'departure'}">Departure</button>
      <button type="button" role="tab" data-dir="arrival" aria-selected="${direction === 'arrival'}">Arrival</button>
    </div>
    <div id="track-body">${bodyHtml()}</div>
  `;
  appEl.querySelectorAll('[data-dir]').forEach((btn) => btn.addEventListener('click', () => switchDirection(btn.dataset.dir)));
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(5);
  if (loadError) return errorState({ message: loadError });
  if (!bags.length) {
    return direction === 'departure'
      ? emptyState({ message: "You don't have a departure booking yet.", actionLabel: 'Book City Check-in', actionAttr: 'data-action="go-book"' })
      : emptyState({ message: 'No arrival information yet. This appears once your flight lands.' });
  }
  return `
    <div class="stack gap-4">
      ${bannerHtml()}
      ${receipt ? receiptCardHtml() : ''}
      <div class="stack gap-3">${bags.map((b) => bagCardHtml(b)).join('')}</div>
    </div>`;
}

function bannerHtml() {
  const hasException = bags.some((b) => b.exception);
  if (hasException) {
    return `<div class="banner-alert amber">${icon('alert-triangle', 20)} <span>There's an issue with one of your bags. We're on it — check the details below or contact support.</span></div>`;
  }
  const allDone = direction === 'departure'
    ? bags.every((b) => b.status === 'Loaded on Aircraft')
    : bags.every((b) => ['Delivered', 'Confirmed by Pilgrim'].includes(b.status));
  if (allDone) {
    return direction === 'departure'
      ? `<div class="banner-alert green">${icon('check-circle', 20)} <span>All your bags are on board. Proceed to the airport without them.</span></div>`
      : `<div class="banner-alert green">${icon('check-circle', 20)} <span>All your bags have been delivered.</span></div>`;
  }
  return direction === 'departure'
    ? `<div class="banner-alert blue">${icon('info', 20)} <span>Your bags are declared and being processed. We'll update you at each step.</span></div>`
    : `<div class="banner-alert blue">${icon('info', 20)} <span>Your bags are on their way to your accommodation.</span></div>`;
}

function receiptCardHtml() {
  return `
    <a class="card card-tap" href="#/receipt/${esc(receipt.id)}">
      <div class="row" style="justify-content:space-between">
        <div>
          <strong>Check-in receipt</strong>
          <p class="fs-sm muted" style="margin:4px 0 0">${esc(receipt.receiptNo)} · ${esc(receipt.centreName)}</p>
        </div>
        ${icon('chevron-right', 20)}
      </div>
    </a>`;
}

function bagCardHtml(bag) {
  const stages = direction === 'departure' ? DEPARTURE_STAGES : ARRIVAL_STAGES;
  const canConfirm = direction === 'arrival' && bag.status === 'Delivered';
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong class="mono">${esc(bag.tagNumber)}</strong>
          <p class="fs-sm muted" style="margin:2px 0 0">${fmtWeight(bag.weightKg)}</p>
        </div>
        ${statusChip(bag.status)}
      </div>
      ${stageRailHtml({ stages, status: bag.status, hasException: !!bag.exception })}
      ${bag.exception ? `<p class="fs-xs" style="color:var(--danger)">${icon('alert-triangle', 14)} ${esc(bag.exception.type)} — we're looking into it.</p>` : ''}
      <div class="row gap-2" style="margin-block-start:var(--s3)">
        <a class="btn btn-secondary" href="#/bag/${esc(bag.id)}" style="flex:1">Details</a>
        ${canConfirm ? `<button type="button" class="btn btn-primary" data-action="confirm-receipt" data-bag="${esc(bag.id)}" style="flex:1" ${confirming ? 'disabled' : ''}>Confirm receipt</button>` : ''}
      </div>
    </div>`;
}

function wireBody() {
  appEl.querySelector('[data-action="go-book"]')?.addEventListener('click', () => navigate('#/book'));
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  appEl.querySelectorAll('[data-action="confirm-receipt"]').forEach((btn) => {
    btn.addEventListener('click', () => confirmReceipt(btn.dataset.bag));
  });
}

async function confirmReceipt(bagId) {
  const bag = bags.find((b) => b.id === bagId);
  const ok = await confirmDialog({
    title: 'Confirm receipt',
    body: `Confirm that you received bag ${bag ? bag.tagNumber : ''} at your accommodation?`,
    confirmLabel: 'Confirm received',
  });
  if (!ok || confirming) return;
  confirming = true;
  try {
    const res = await api.confirmReceipt(bagId);
    if (!mounted) return;
    toast('Receipt confirmed. Thank you.', 'success');
    if (res.allConfirmed) {
      navigate('#/arrival/rate');
      return;
    }
    confirming = false;
    load();
  } catch (err) {
    if (!mounted) return;
    confirming = false;
    toast(err.message, 'error');
  }
}
