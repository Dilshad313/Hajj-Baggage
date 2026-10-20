import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast, openModal, fmtWeight } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { SECURITY_DOCS, SECURITY_HOLD_REASONS } from '../seed.js';
import { navigate } from '../router.js';

let appEl = null;
let tripId = null;
let checked = {};
let showHoldForm = false;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  checked = {};
  showHoldForm = false;
  load();
  return { destroy, poll: pollTick };
}

export function destroy() { appEl = null; tripId = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(4);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    renderScreen(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

async function pollTick() {
  if (!appEl) return;
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    if (trip.security.outcome === 'cleared') { navigate(`#/trip/${tripId}/offload`); return; }
    if (trip.security.outcome === 'hold') renderHoldWaiting(trip);
  } catch (e) { /* silent */ }
}

function renderScreen(trip) {
  if (trip.security.outcome === 'hold') { renderHoldWaiting(trip); return; }
  if (showHoldForm) { renderHoldForm(trip); return; }

  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Security</h1><p class="page-subtitle">${esc(trip.toName)}</p></div></div>
    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Documents</h2>
      ${SECURITY_DOCS.map((label, i) => `
        <div class="doc-check-row">
          <input type="checkbox" id="doc-${i}" ${checked[i] ? 'checked' : ''} />
          <label for="doc-${i}" style="margin:0;font-size:var(--fs-base);color:var(--text)">${esc(label)}</label>
        </div>`).join('')}
      <button type="button" class="btn btn-secondary" style="margin-block-start:var(--s3)" data-action="show-manifest">${icon('file-text', 16)} Show manifest</button>
    </div>
    <div class="card" style="margin-block-end:var(--s5)">
      <h2 class="section-title">Re-scan seal at gate</h2>
      <div id="reseal-root"></div>
    </div>
    <div class="row gap-3 wrap">
      <button type="button" class="btn btn-primary btn-lg" data-action="cleared">${icon('shield-check', 20)} Security cleared</button>
      <button type="button" class="btn btn-danger btn-lg" data-action="hold">${icon('shield-alert', 20)} Security hold</button>
    </div>`;

  appEl.querySelectorAll('[id^="doc-"]').forEach((cb, i) => cb.addEventListener('change', (e) => { checked[i] = e.target.checked; }));
  appEl.querySelector('[data-action="show-manifest"]').addEventListener('click', () => openManifest(trip));
  appEl.querySelector('[data-action="cleared"]').addEventListener('click', async () => {
    try { const updated = await api.securityOutcome(tripId, { outcome: 'cleared' }); toast('Security cleared.', 'success'); navigate(`#/trip/${updated.id}/offload`); }
    catch (err) { toast(err.message, 'error'); }
  });
  appEl.querySelector('[data-action="hold"]').addEventListener('click', () => { showHoldForm = true; renderScreen(trip); });

  createScanInput(appEl.querySelector('#reseal-root'), {
    label: 'Scan the seal',
    placeholder: 'Scan or type the seal number',
    onSubmit: async (code) => { await api.confirmSeal(tripId, code); return { message: 'Seal matches — intact.' }; },
  });
}

function openManifest(trip) {
  openModal({
    title: `Trip manifest — ${trip.id}`,
    large: true,
    bodyHtml: `
      <div class="row" style="justify-content:center;margin-block-end:var(--s4)"><div class="receipt-qr" id="manifest-qr"></div></div>
      <div class="stack">
        ${trip.bags.map((b) => `<div class="manifest-row"><span class="tag fs-sm">${esc(b.tagNumber)}</span><span class="fs-xs muted">${fmtWeight(b.weightKg)}</span></div>`).join('')}
      </div>`,
    onMount: () => {
      if (window.QRCode) {
        try { new window.QRCode(document.getElementById('manifest-qr'), { text: `RABEL-MANIFEST-${trip.id}`, width: 144, height: 144 }); } catch (e) { /* ignore */ }
      }
    },
  });
}

function renderHoldForm(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Security hold</h1></div></div>
    <div class="field">
      <label for="hold-reason">Reason <span class="req">*</span></label>
      <select id="hold-reason"><option value="">Select…</option>${SECURITY_HOLD_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label for="hold-notes">Notes <span class="req">*</span></label>
      <textarea id="hold-notes" maxlength="300" placeholder="5–300 characters"></textarea>
    </div>
    <div class="error" id="err-hold" hidden style="margin-block-end:var(--s3)"></div>
    <div class="row gap-3">
      <button type="button" class="btn btn-secondary" data-action="back">Back</button>
      <button type="button" class="btn btn-danger" data-action="submit-hold">${icon('shield-alert', 18)} Confirm hold</button>
    </div>`;
  appEl.querySelector('[data-action="back"]').addEventListener('click', () => { showHoldForm = false; renderScreen(trip); });
  appEl.querySelector('[data-action="submit-hold"]').addEventListener('click', async () => {
    const reason = appEl.querySelector('#hold-reason').value;
    const notes = appEl.querySelector('#hold-notes').value;
    const err = appEl.querySelector('#err-hold');
    try {
      const updated = await api.securityOutcome(tripId, { outcome: 'hold', reason, notes });
      if (!appEl) return;
      toast('Security hold recorded.', 'info');
      renderHoldWaiting(updated);
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  });
}

function renderHoldWaiting(trip) {
  appEl.innerHTML = `
    <div class="state-block">
      ${icon('shield-alert', 48)}
      <p class="fw-semibold">On hold — waiting for release.</p>
      <p class="fs-sm">${esc(trip.security.reason || '')}${trip.security.notes ? `: ${esc(trip.security.notes)}` : ''}</p>
      <button type="button" class="btn btn-secondary" data-action="call">${icon('phone', 16)} Contact supervisor</button>
    </div>`;
  appEl.querySelector('[data-action="call"]').addEventListener('click', async () => {
    try { await api.contactSupervisor(tripId, 'Security hold — requesting release.'); toast('Supervisor contacted.', 'success'); } catch (e) { toast(e.message, 'error'); }
  });
}
