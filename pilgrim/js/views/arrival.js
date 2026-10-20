import * as api from '../api.js';
import { toast, icon, esc, fmtWeight, skeletonBlock, emptyState, errorState, confirmDialog } from '../ui.js';
import { navigate } from '../router.js';
import { statusChip } from '../components/status-chip.js';
import { stageRailHtml } from '../components/bag-timeline.js';
import { ARRIVAL_STAGES } from '../seed.js';

let appEl = null;
let mounted = false;
let home = null;
let bags = [];
let loading = true;
let loadError = '';
let confirming = false;

/** @param {object} params @param {HTMLElement} app */
export function render(params, app) {
  appEl = app;
  mounted = true;
  home = null; bags = []; loading = true; loadError = ''; confirming = false;
  renderShell();
  load();
  return { destroy, poll, refresh: load, activeBagId };
}

export function destroy() {
  mounted = false;
  appEl = null;
}

function activeBagId() {
  return bags[0]?.id || null;
}

async function load() {
  loading = true; loadError = '';
  renderShell();
  try {
    const [homeRes, bagsRes] = await Promise.all([api.getHome(), api.getBags('arrival')]);
    if (!mounted) return;
    home = homeRes;
    bags = bagsRes;
    loading = false;
    renderShell();
  } catch (err) {
    if (!mounted) return;
    loading = false;
    loadError = err.message;
    renderShell();
  }
}

async function poll() {
  if (!mounted || loading) return;
  try {
    const bagsRes = await api.getBags('arrival');
    if (!mounted) return;
    bags = bagsRes;
    renderShell();
  } catch (e) { /* silent poll failure */ }
}

function renderShell() {
  appEl.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Arrival</h1>
    </div>
    <div id="arrival-body">${bodyHtml()}</div>`;
  wireBody();
}

function bodyHtml() {
  if (loading) return skeletonBlock(5);
  if (loadError) return errorState({ message: loadError });
  if (!home || !home.arrival.hasArrival) return emptyState({ message: 'No arrival information yet.' });

  const delivered = bags.filter((b) => ['Delivered', 'Confirmed by Pilgrim'].includes(b.status)).length;
  const total = bags.length;

  return `
    <div class="stack gap-4">
      ${summaryCardHtml(delivered, total)}
      ${exceptionBannerHtml()}
      ${total ? `<div class="stack gap-3">${bags.map(bagCardHtml).join('')}</div>` : emptyState({ message: 'No bags recorded for your arrival yet.' })}
    </div>`;
}

function summaryCardHtml(delivered, total) {
  const arr = home.arrival;
  const hotel = arr.hotel;
  const pct = total > 0 ? delivered / total : 0;
  const circumference = 100.5;
  const offset = circumference * (1 - pct);
  return `
    <div class="card">
      <div class="row gap-4" style="justify-content:space-between;align-items:center">
        <div class="stack gap-2" style="flex:1">
          <div class="row gap-2 wrap">
            <strong class="mono">${esc(arr.flightCode || '—')}</strong>
            ${arr.flightStatus ? statusChip(arr.flightStatus) : ''}
          </div>
          ${hotel ? `
            <p class="fs-sm" style="margin:0">${esc(hotel.name)}</p>
            <p class="fs-xs muted" style="margin:0">${hotel.building ? `Building ${esc(hotel.building)}` : ''}${hotel.building && hotel.room ? ' · ' : ''}${hotel.room ? `Room ${esc(hotel.room)}` : ''}</p>
          ` : '<p class="fs-sm muted" style="margin:0">Accommodation details not available yet.</p>'}
        </div>
        <div class="progress-ring">
          <svg viewBox="0 0 36 36">
            <circle class="ring-bg" cx="18" cy="18" r="16"/>
            <circle class="ring-fill" cx="18" cy="18" r="16" stroke-dasharray="100.5" stroke-dashoffset="${offset}"/>
          </svg>
          <div class="ring-label">${delivered}<span>of ${total}</span></div>
        </div>
      </div>
    </div>`;
}

function exceptionBannerHtml() {
  const hasException = bags.some((b) => b.exception);
  if (hasException) {
    return `
      <div class="banner-alert amber">
        ${icon('alert-triangle', 20)}
        <div class="stack gap-2" style="flex:1">
          <span>There's an issue with one of your bags. We're on it — check the resolution status for updates.</span>
          <div class="row gap-2 wrap">
            <a class="btn btn-secondary" href="#/arrival/resolution">View resolution status</a>
            <a class="btn btn-ghost" href="#/arrival/report-missing">Report a missing bag</a>
          </div>
        </div>
      </div>`;
  }
  return `
    <div class="row" style="justify-content:flex-end">
      <a class="btn btn-ghost" href="#/arrival/report-missing">${icon('flag', 16)} Report a missing bag</a>
    </div>`;
}

function bagCardHtml(bag) {
  const canConfirm = bag.status === 'Delivered';
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong class="mono">${esc(bag.tagNumber)}</strong>
          <p class="fs-sm muted" style="margin:2px 0 0">${fmtWeight(bag.weightKg)}</p>
        </div>
        ${statusChip(bag.status)}
      </div>
      ${stageRailHtml({ stages: ARRIVAL_STAGES, status: bag.status, hasException: !!bag.exception })}
      ${bag.exception ? `<p class="fs-xs" style="color:var(--danger)">${icon('alert-triangle', 14)} ${esc(bag.exception.type)} — we're looking into it.</p>` : ''}
      ${canConfirm ? `<button type="button" class="btn btn-primary btn-block" data-action="confirm-receipt" data-bag="${esc(bag.id)}" ${confirming ? 'disabled' : ''} style="margin-block-start:var(--s3)">Confirm receipt</button>` : ''}
    </div>`;
}

function wireBody() {
  appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  appEl.querySelectorAll('[data-action="confirm-receipt"]').forEach((btn) => {
    btn.addEventListener('click', () => confirmReceiptAction(btn.dataset.bag));
  });
}

async function confirmReceiptAction(bagId) {
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
