import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { navigate } from '../router.js';

let appEl = null;
let tripId = null;
let pollTimer = null;
let mode = 'loading'; // 'loading' | 'verify' | 'scan-each'
let scanCtl = null;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  mode = 'loading';
  load();
  return { destroy, poll: refreshQuiet };
}

export function destroy() {
  scanCtl?.destroy(); scanCtl = null;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  appEl = null; tripId = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(4);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    if (trip.count.verified) { renderDone(trip); return; }
    renderScreen(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function refreshQuiet() {
  if (!appEl || mode !== 'loading') return;
  try {
    const { loaded, expected } = await api.getLoadCount(tripId);
    if (!appEl) return;
    const bar = appEl.querySelector('#count-progress-bar');
    const big = appEl.querySelector('#count-big');
    if (bar) bar.style.width = `${Math.min(100, (loaded / expected) * 100)}%`;
    if (big) big.textContent = `${loaded} / ${expected}`;
  } catch (e) { /* silent */ }
}

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refreshQuiet, 2500);
}

function renderScreen(trip) {
  if (mode === 'loading') renderLoading(trip);
  else if (mode === 'verify') renderVerify(trip);
  else renderScanEach(trip);
}

function renderLoading(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Loading &amp; count</h1><p class="page-subtitle">${esc(trip.fromName)}</p></div></div>
    <div class="card count-live">
      <div class="fs-sm muted">Loaded</div>
      <div class="count-big" id="count-big">${trip.count.loadedBagIds.length} / ${trip.count.expected}</div>
      <div class="count-progress"><div class="count-progress-bar" id="count-progress-bar" style="width:${(trip.count.loadedBagIds.length / trip.count.expected) * 100}%"></div></div>
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" style="margin-block-start:var(--s5)" data-action="finish">${icon('clipboard-check', 20)} Loading finished — verify count</button>`;
  appEl.querySelector('[data-action="finish"]').addEventListener('click', () => { mode = 'verify'; render2(); });
  ensurePolling();
  refreshQuiet();
}

async function render2() {
  const trip = await api.getTrip(tripId);
  if (!appEl) return;
  renderScreen(trip);
}

function renderVerify(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Verify count</h1></div></div>
    <div class="card" style="margin-block-end:var(--s5)">
      <p class="fs-sm">System expects <strong>${trip.count.expected}</strong> bags.</p>
      <div class="field" style="margin-block-start:var(--s4)">
        <label for="physical-count">Physical count <span class="req">*</span></label>
        <input id="physical-count" type="number" inputmode="numeric" min="0" max="999" />
        <div class="error" id="err-count" hidden></div>
      </div>
      <button type="button" class="btn btn-primary btn-block" data-action="verify">Count verified</button>
    </div>
    <div id="mismatch-root"></div>`;

  appEl.querySelector('[data-action="verify"]').addEventListener('click', async () => {
    const val = appEl.querySelector('#physical-count').value;
    const err = appEl.querySelector('#err-count');
    try {
      const res = await api.verifyCount(tripId, val);
      if (res.verified) {
        toast('Count verified.', 'success');
        navigate(`#/trip/${tripId}/seal`);
      } else {
        err.hidden = true;
        renderMismatch(res.message);
      }
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
    }
  });
}

function renderMismatch(message) {
  const root = appEl.querySelector('#mismatch-root');
  root.innerHTML = `
    <div class="state-block error-state" style="background:var(--danger-soft);border-radius:var(--r-lg);color:#7F1D1D">
      ${icon('triangle-alert', 36)}
      <p class="fw-semibold">${esc(message)}</p>
      <div class="row gap-3 wrap" style="justify-content:center">
        <button type="button" class="btn btn-secondary" data-action="recount">${icon('rotate-ccw', 16)} Recount</button>
        <button type="button" class="btn btn-primary" data-action="scan-each">${icon('scan-line', 16)} Scan each bag</button>
      </div>
    </div>`;
  root.querySelector('[data-action="recount"]').addEventListener('click', () => render2());
  root.querySelector('[data-action="scan-each"]').addEventListener('click', () => { mode = 'scan-each'; render2(); });
}

function renderScanEach(trip) {
  const scanned = trip.count.loadedBagIds.length;
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Scan each bag</h1><p class="page-subtitle">${scanned} / ${trip.count.expected} scanned</p></div></div>
    <div id="scan-each-root"></div>
    <div class="card" style="margin-block-start:var(--s5)">
      <h2 class="section-title">Bags</h2>
      <div class="stack">
        ${trip.bags.map((b) => `
          <div class="manifest-row">
            <span class="tag fs-sm">${esc(b.tagNumber)}</span>
            <span class="fs-xs ${trip.count.loadedBagIds.includes(b.id) ? '' : 'muted'}">${trip.count.loadedBagIds.includes(b.id) ? icon('check', 14) + ' Scanned' : 'Not yet scanned'}</span>
          </div>`).join('')}
      </div>
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" style="margin-block-start:var(--s5)" id="finish-scan-each" ${scanned === trip.count.expected ? '' : 'disabled'}>${icon('check-check', 20)} Finish — all scanned</button>`;

  scanCtl = createScanInput(appEl.querySelector('#scan-each-root'), {
    label: 'Scan a bag tag',
    placeholder: 'Scan or type bag tag',
    onSubmit: async (code) => {
      const res = await api.scanCountBag(tripId, code);
      if (res.scanned === res.expected) render2(); else refreshScanEachCounts();
      return { message: `${res.bag.tagNumber} scanned (${res.scanned}/${res.expected}).` };
    },
  });

  appEl.querySelector('#finish-scan-each').addEventListener('click', async () => {
    try {
      await api.finalizeScanCount(tripId);
      toast('Count verified by scan.', 'success');
      navigate(`#/trip/${tripId}/seal`);
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function refreshScanEachCounts() {
  const trip = await api.getTrip(tripId);
  if (!appEl) return;
  const header = appEl.querySelector('.page-subtitle');
  if (header) header.textContent = `${trip.count.loadedBagIds.length} / ${trip.count.expected} scanned`;
  appEl.querySelectorAll('.manifest-row').forEach((row, i) => {
    const b = trip.bags[i];
    const statusSpan = row.querySelector('span:last-child');
    if (statusSpan && b) {
      const done = trip.count.loadedBagIds.includes(b.id);
      statusSpan.className = `fs-xs ${done ? '' : 'muted'}`;
      statusSpan.innerHTML = done ? `${icon('check', 14)} Scanned` : 'Not yet scanned';
    }
  });
  const finishBtn = appEl.querySelector('#finish-scan-each');
  if (finishBtn) finishBtn.disabled = trip.count.loadedBagIds.length !== trip.count.expected;
}

function renderDone(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Loading &amp; count</h1></div></div>
    <div class="state-block">
      ${icon('check-circle', 48)}
      <p class="fw-semibold">Count verified — ${trip.count.verifiedCount} bags.</p>
      <button type="button" class="btn btn-primary" data-action="continue">Continue to seal</button>
    </div>`;
  appEl.querySelector('[data-action="continue"]').addEventListener('click', () => navigate(`#/trip/${tripId}/seal`));
}
