import * as api from '../api.js';
import { skeletonBlock, errorState, esc, icon, toast } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { createSignaturePad } from '../components/signature-pad.js';
import { HANDOVER_ORGS } from '../seed.js';
import { navigate } from '../router.js';

let appEl = null;
let tripId = null;
let sigPad = null;
let scanCtl = null;

export function render(params, app) {
  appEl = app;
  tripId = params.id;
  load();
  return { destroy };
}

export function destroy() { sigPad?.destroy(); sigPad = null; scanCtl?.destroy(); scanCtl = null; appEl = null; tripId = null; }

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    const trip = await api.getTrip(tripId);
    if (!appEl) return;
    if (trip.handover.receiverScanned) { renderDone(trip); return; }
    if (trip.handover.qrPayload) { renderReceipt(trip); return; }
    renderForm(trip);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function bagCount(trip) {
  return trip.direction === 'Departure' ? trip.count.loadedBagIds.length : trip.offload.unloadedBagIds.length;
}

function renderForm(trip) {
  const count = bagCount(trip);
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Handover receipt</h1></div></div>
    <div class="field">
      <label for="receiver-name">Receiver name <span class="req">*</span></label>
      <input id="receiver-name" maxlength="80" />
      <div class="error" id="err-name" hidden></div>
    </div>
    <div class="field">
      <label for="receiver-id">Receiver ID <span class="req">*</span></label>
      <input id="receiver-id" maxlength="20" />
      <div class="error" id="err-id" hidden></div>
    </div>
    <div class="field">
      <label for="receiver-org">Organisation <span class="req">*</span></label>
      <select id="receiver-org"><option value="">Select…</option>${HANDOVER_ORGS.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>
      <div class="error" id="err-org" hidden></div>
    </div>
    <div class="field">
      <label>Bags (read-only)</label>
      <div class="card" style="padding:var(--s3)">
        <div class="fs-sm fw-semibold">${count} bags</div>
        <div class="stack" style="margin-block-start:var(--s2)">
          ${trip.bags.slice(0, 20).map((b) => `<div class="fs-xs mono muted">${esc(b.tagNumber)}</div>`).join('')}
        </div>
      </div>
    </div>
    <div class="field">
      <label>Receiver signature <span class="req">*</span></label>
      <div id="sig-root"></div>
      <div class="error" id="err-sig" hidden></div>
    </div>
    <label class="checkbox-row">
      <input type="checkbox" id="driver-confirm" />
      I confirm the above is correct.
    </label>
    <div class="error" id="err-confirm" hidden style="margin-block-end:var(--s3)"></div>
    <button type="button" class="btn btn-primary btn-lg btn-block" id="generate-receipt">${icon('file-check', 20)} Generate receipt</button>`;

  sigPad = createSignaturePad(appEl.querySelector('#sig-root'));

  appEl.querySelector('#generate-receipt').addEventListener('click', async () => {
    const name = appEl.querySelector('#receiver-name').value;
    const id = appEl.querySelector('#receiver-id').value;
    const org = appEl.querySelector('#receiver-org').value;
    const confirmed = appEl.querySelector('#driver-confirm').checked;
    let valid = true;
    const setErr = (field, msg) => {
      const el = appEl.querySelector(`#err-${field}`);
      if (msg) { el.textContent = msg; el.hidden = false; valid = false; } else el.hidden = true;
    };
    setErr('name', name.trim().length < 3 || name.trim().length > 80 ? 'Receiver name must be 3–80 characters.' : '');
    setErr('id', id.trim().length < 4 || id.trim().length > 20 ? 'Receiver ID must be 4–20 characters.' : '');
    setErr('org', org ? '' : 'Organisation is required.');
    setErr('sig', sigPad.isEmpty() ? "Please capture the receiver's signature." : '');
    setErr('confirm', confirmed ? '' : 'Confirmation is required.');
    if (!valid) return;
    try {
      await api.createReceipt(tripId, { receiverName: name.trim(), receiverId: id.trim(), org, signatureDataUrl: sigPad.getDataUrl(), driverConfirmed: confirmed });
      toast('Receipt generated.', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function renderReceipt(trip) {
  appEl.innerHTML = `
    <div class="page-header"><div><h1 class="page-title">Handover receipt</h1></div></div>
    <div class="card receipt-card" style="margin-block-end:var(--s5)">
      <div class="receipt-qr" id="handover-qr"></div>
      <p class="fw-semibold">${esc(trip.handover.receiverName)}</p>
      <p class="fs-sm muted">${esc(trip.handover.org)} · ${esc(trip.handover.receiverId)}</p>
      <p class="fs-sm muted">${bagCount(trip)} bags handed over</p>
    </div>
    <div id="handover-scan-root"></div>
    <button type="button" class="btn btn-secondary btn-block" style="margin-block-start:var(--s3)" data-action="mark-scanned">${icon('user-check', 16)} Receiver scanned</button>`;

  if (window.QRCode) {
    try { new window.QRCode(appEl.querySelector('#handover-qr'), { text: trip.handover.qrPayload, width: 144, height: 144 }); } catch (e) { /* ignore */ }
  }

  scanCtl = createScanInput(appEl.querySelector('#handover-scan-root'), {
    label: 'Scan handover confirmation',
    placeholder: 'Scan the receipt QR',
    onSubmit: async (code) => {
      await api.confirmHandover(tripId, code);
      toast('Handover confirmed.', 'success');
      setTimeout(() => navigate(`#/trip/${tripId}/complete`), 700);
      return { message: 'Handover confirmed.' };
    },
  });

  appEl.querySelector('[data-action="mark-scanned"]').addEventListener('click', async () => {
    try {
      await api.confirmHandover(tripId, '');
      toast('Handover confirmed.', 'success');
      navigate(`#/trip/${tripId}/complete`);
    } catch (err) { toast(err.message, 'error'); }
  });
}

function renderDone(trip) {
  appEl.innerHTML = `
    <div class="state-block">
      ${icon('check-circle', 48)}
      <p class="fw-semibold">Handover confirmed.</p>
      <button type="button" class="btn btn-primary" data-action="continue">Continue</button>
    </div>`;
  appEl.querySelector('[data-action="continue"]').addEventListener('click', () => navigate(`#/trip/${tripId}/complete`));
}
