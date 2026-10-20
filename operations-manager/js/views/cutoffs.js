import * as api from '../api.js';
import {
  toast, skeletonBlock, errorState, emptyState, fmtCountdown, fmtDateTime, esc, icon, openModal,
} from '../ui.js';

let appEl = null;

const BREAKDOWN_ROWS = ['Checked-in only', 'At warehouse', 'At airport, not loaded'];

/**
 * Renders the cut-off monitoring screen for departure flights.
 * @param {object} params
 * @param {HTMLElement} app
 * @returns {{destroy: Function, poll: Function, refresh: Function}}
 */
export function render(params, app) {
  appEl = app;
  load();
  return { destroy, poll: pollTick, refresh: load };
}

/** Tears down the view's module state. */
export function destroy() {
  appEl = null;
}

function pollTick() {
  load(true);
}

async function load(quiet) {
  if (!appEl) return;
  if (!quiet) appEl.innerHTML = pageShell() + skeletonBlock(6);
  try {
    const flights = await api.getCutoffs();
    renderData(flights);
  } catch (err) {
    appEl.innerHTML = pageShell() + errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', () => load());
  }
}

function pageShell() {
  return `
    <div class="page-header">
      <div><h1 class="page-title">Cut-off monitoring</h1><p class="page-subtitle">Departure flights approaching their baggage cut-off.</p></div>
    </div>`;
}

function urgentBannerHtml(flights) {
  const atRisk = flights.filter((f) => f.atRisk).sort((a, b) => a.minsToCutoff - b.minsToCutoff);
  if (!atRisk.length) return '';
  const f = atRisk[0];
  const bagWord = f.notAtAirport === 1 ? 'bag' : 'bags';
  return `
    <div class="card critical-banner" role="alert">
      <strong>${esc(f.code)}</strong> — cut-off in ${fmtCountdown(f.cutoffAt)} — ${f.notAtAirport} ${bagWord} not at airport.
    </div>`;
}

function breakdownHtml(breakdown) {
  return `
    <table class="fs-sm" style="width:100%;margin-block-start:var(--s3)">
      <tbody>
        ${BREAKDOWN_ROWS.map((label) => `
          <tr>
            <td class="muted">${esc(label)}</td>
            <td style="text-align:end;font-weight:var(--fw-semibold)">${breakdown[label]}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function flightCardHtml(f) {
  return `
    <div class="card" data-flight-id="${esc(f.id)}">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <strong>${esc(f.code)}</strong>
          <div class="fs-sm muted">${esc(f.route)}</div>
        </div>
        ${f.priority ? `<span class="chip chip-amber">${icon('star', 12)} Priority</span>` : ''}
      </div>

      <div class="countdown-tile ${f.atRisk ? 'risk' : ''}" style="margin-block:var(--s4)">
        <div class="countdown-value" title="${esc(fmtDateTime(f.cutoffAt))}">${fmtCountdown(f.cutoffAt)}</div>
        <div class="fs-xs muted">to cut-off</div>
      </div>

      <div class="fs-sm"><strong>${f.notAtAirport}</strong> of ${f.totalBags} bags not at airport</div>
      ${breakdownHtml(f.breakdown)}

      <div class="row gap-2 wrap" style="margin-block-start:var(--s4)">
        <button type="button" class="btn btn-secondary" data-action="prioritise" data-flight-id="${esc(f.id)}" ${f.priority ? 'disabled' : ''}>
          ${icon('star', 16)} ${f.priority ? 'Prioritised' : 'Prioritise loading'}
        </button>
        <button type="button" class="btn btn-secondary" data-action="notify" data-flight-id="${esc(f.id)}">
          ${icon('send', 16)} Notify warehouse team
        </button>
      </div>
    </div>`;
}

function renderData(flights) {
  if (!flights.length) {
    appEl.innerHTML = pageShell() + emptyState({ message: 'No departure flights approaching cut-off.' });
    return;
  }
  appEl.innerHTML = `
    ${pageShell()}
    ${urgentBannerHtml(flights)}
    <div class="grid grid-auto">
      ${flights.map(flightCardHtml).join('')}
    </div>`;
  wireActions();
}

function wireActions() {
  appEl.querySelectorAll('[data-action="prioritise"]').forEach((btn) => {
    btn.addEventListener('click', () => onPrioritise(btn.dataset.flightId, btn));
  });
  appEl.querySelectorAll('[data-action="notify"]').forEach((btn) => {
    btn.addEventListener('click', () => openNotifyModal(btn.dataset.flightId));
  });
}

async function onPrioritise(flightId, btn) {
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await api.prioritise(flightId);
    toast('Flight prioritised for loading.', 'success');
    load();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

function notifyModalBody() {
  return `
    <div class="field">
      <label for="notify-message">Message <span class="req">*</span></label>
      <textarea id="notify-message" maxlength="2000" placeholder="Message for the warehouse team"></textarea>
      <div class="error" id="err-notify-message" hidden></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-act="send">Send</button>
    </div>`;
}

function openNotifyModal(flightId) {
  const close = openModal({
    title: 'Notify warehouse team',
    bodyHtml: notifyModalBody(),
    onMount: (overlay) => {
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
      overlay.querySelector('[data-act="send"]').addEventListener('click', () => submitNotify(overlay, flightId, close));
    },
  });
}

async function submitNotify(overlay, flightId, close) {
  const textarea = overlay.querySelector('#notify-message');
  const errEl = overlay.querySelector('#err-notify-message');
  const message = textarea.value.trim();
  if (!message) { errEl.textContent = 'A message is required.'; errEl.hidden = false; return; }
  if (message.length > 2000) { errEl.textContent = 'Message must be 2000 characters or fewer.'; errEl.hidden = false; return; }
  errEl.hidden = true;
  const btn = overlay.querySelector('[data-act="send"]');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await api.notifyWarehouse(flightId, message);
    toast('Warehouse team notified.', 'success');
    close();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}
