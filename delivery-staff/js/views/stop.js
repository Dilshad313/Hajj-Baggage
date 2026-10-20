import * as api from '../api.js';
import {
  skeletonBlock, errorState, toast, confirmDialog, openModal, esc, icon, fmtDateTime,
} from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { createSignaturePad } from '../components/signature-pad.js';
import { statusChip } from '../components/status-chip.js';
import { NOT_FOUND_REASONS, RESOLUTION_OPTIONS, PROXY_RELATIONS } from '../seed.js';
import { navigate } from '../router.js';

let appEl = null;
let runId = null;
let stopId = null;
let stopData = null; // hydrated stop from api.getStop
let step = 'arrive'; // arrive | identity | notfound | handover | signature | receipt
let selectedPilgrimId = null;
let deliveryContext = null; // { recipientType, recipientName }
let scannedTagsForHandover = new Set();
let damageAcks = {};
let scanInputInstance = null;
let sigPadInstance = null;

export function render(params, app) {
  appEl = app;
  runId = params.id;
  stopId = params.stopId;
  step = 'arrive';
  selectedPilgrimId = null;
  deliveryContext = null;
  scannedTagsForHandover = new Set();
  damageAcks = {};
  load();
  return { destroy };
}

export function destroy() {
  scanInputInstance?.destroy();
  sigPadInstance?.destroy();
  scanInputInstance = null;
  sigPadInstance = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(8);
  try {
    stopData = await api.getStop(stopId);
    if (stopData.pilgrims.length === 1) selectedPilgrimId = stopData.pilgrims[0].id;
    renderStep();
  } catch (err) {
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderStep() {
  // Guards deferred `setTimeout(renderStep, ...)` calls below (used to let a
  // scan-input's own success banner play out before transitioning) firing
  // after the user already navigated away and destroy() nulled appEl —
  // without this it throws setting innerHTML on null.
  if (!appEl) return;
  scanInputInstance?.destroy(); scanInputInstance = null;
  sigPadInstance?.destroy(); sigPadInstance = null;
  if (step === 'arrive') renderArrive();
  else if (step === 'identity') renderIdentity();
  else if (step === 'notfound') renderNotFound();
  else if (step === 'handover') renderHandover();
  else if (step === 'signature') renderSignature();
}

/* ===================== Arrive ===================== */

function renderArrive() {
  const s = stopData;
  const primaryPilgrim = s.pilgrims[0];
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <div class="card" style="margin-block:var(--s4);text-align:center">
      <div class="room-hero">${esc(s.room)}</div>
      <p class="fs-sm muted">Building ${esc(s.building)} · Floor ${s.floor}</p>
    </div>
    <div class="card" style="margin-block-end:var(--s4)">
      <h2 class="section-title">${esc(s.pilgrims.map((p) => p.name).join(', '))}</h2>
      <div class="row gap-2 wrap" style="margin-block-end:var(--s3)">
        ${s.bags.map((b) => `<span class="chip ${b.damaged ? 'chip-amber' : 'chip-grey'} mono">${esc(b.tagNumber)}${b.damaged ? ' · Damaged' : ''}</span>`).join('')}
      </div>
      <div class="row gap-2 wrap">
        ${primaryPilgrim?.phone ? `<a class="btn btn-secondary" href="tel:${esc(primaryPilgrim.phone)}">${icon('phone', 16)} Call pilgrim</a>` : ''}
        ${primaryPilgrim?.groupLeaderPhone ? `<a class="btn btn-secondary" href="tel:${esc(primaryPilgrim.groupLeaderPhone)}">${icon('users', 16)} Call group leader</a>` : ''}
      </div>
    </div>
    <div id="door-scan-root"></div>
    <div class="row gap-2 wrap" style="margin-block-start:var(--s4)">
      <button type="button" class="btn btn-secondary" data-action="skip-room">${icon('skip-forward', 16)} Skip this room for now</button>
    </div>`;

  renderDoorScan();
  appEl.querySelector('[data-action="skip-room"]').addEventListener('click', skipRoomFlow);
}

function renderDoorScan() {
  const root = appEl.querySelector('#door-scan-root');
  root.innerHTML = `
    <button type="button" class="btn btn-primary btn-lg btn-block" data-action="at-room">${icon('door-open', 18)} I'm at the room</button>`;
  root.querySelector('[data-action="at-room"]').addEventListener('click', () => {
    root.innerHTML = `
      <div id="door-scan-input"></div>
      <button type="button" class="btn btn-ghost btn-block" style="margin-block-start:var(--s2)" data-action="no-qr">${icon('x', 16)} No QR on door</button>`;
    scanInputInstance = createScanInput(root.querySelector('#door-scan-input'), {
      label: 'Scan room door QR',
      placeholder: `e.g. ${stopData.room}`,
      onSubmit: async (code) => {
        await api.arriveRoom(stopId, code);
        step = 'identity';
        setTimeout(renderStep, 500);
        return { message: 'Room confirmed.' };
      },
    });
    root.querySelector('[data-action="no-qr"]').addEventListener('click', async () => {
      await api.arriveRoom(stopId, null);
      step = 'identity';
      renderStep();
    });
  });
}

async function skipRoomFlow() {
  const close = openModal({
    title: 'Skip this room for now',
    bodyHtml: `
      <div class="field">
        <label for="skip-reason">Reason <span class="req">*</span></label>
        <textarea id="skip-reason" placeholder="Why are you skipping this room?"></textarea>
        <div class="error" id="err-skip-reason" hidden></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-act="confirm">Skip room</button>
      </div>`,
    onMount: (overlay) => {
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
      overlay.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
        const reason = overlay.querySelector('#skip-reason').value.trim();
        const errEl = overlay.querySelector('#err-skip-reason');
        if (!reason) { errEl.textContent = 'A reason is required.'; errEl.hidden = false; return; }
        try {
          await api.skipRoom(stopId, reason);
          close();
          toast(`${stopData.room} rescheduled.`, 'info');
          navigate(`#/run/${runId}`);
        } catch (err) { toast(err.message, 'error'); }
      });
    },
  });
}

/* ===================== Identity ===================== */

function renderIdentity() {
  const s = stopData;
  const pilgrim = s.pilgrims.find((p) => p.id === selectedPilgrimId) || s.pilgrims[0];
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <h1 class="page-title" style="margin-block:var(--s3)">${esc(s.room)} — Verify identity</h1>

    ${s.pilgrims.length > 1 ? `
      <div class="field">
        <label for="pilgrim-select">Pilgrim</label>
        <select id="pilgrim-select">${s.pilgrims.map((p) => `<option value="${esc(p.id)}" ${p.id === pilgrim.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </div>` : ''}

    <div class="card" style="margin-block-end:var(--s4)">
      <div class="row gap-3">
        <div class="pilgrim-avatar">${icon('user', 28)}</div>
        <div>
          <strong class="fs-md">${esc(pilgrim.name)}</strong>
          <div class="fs-sm muted">${esc(pilgrim.nationality)} · ${esc(pilgrim.groupName)}</div>
          <div class="fs-xs muted mono">Nusuk ••${esc(pilgrim.nusukId.slice(-4))}</div>
        </div>
      </div>
    </div>

    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" aria-selected="true" data-method="nusuk-qr">Scan Nusuk QR</button>
      <button type="button" class="tab" role="tab" aria-selected="false" data-method="passport">Passport check</button>
    </div>
    <div id="identity-method-root"></div>

    <div class="row gap-2 wrap" style="margin-block-start:var(--s5)">
      <button type="button" class="btn btn-secondary" data-action="nobody">${icon('user-x', 16)} Nobody at the room</button>
    </div>`;

  appEl.querySelector('#pilgrim-select')?.addEventListener('change', (e) => { selectedPilgrimId = e.target.value; renderIdentity(); });
  appEl.querySelectorAll('[data-method]').forEach((tab) => tab.addEventListener('click', () => {
    appEl.querySelectorAll('[data-method]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    renderIdentityMethod(tab.dataset.method, pilgrim);
  }));
  appEl.querySelector('[data-action="nobody"]').addEventListener('click', () => { step = 'notfound'; renderStep(); });

  renderIdentityMethod('nusuk-qr', pilgrim);
}

function renderIdentityMethod(method, pilgrim) {
  const root = appEl.querySelector('#identity-method-root');
  if (method === 'nusuk-qr') {
    root.innerHTML = `<div id="identity-scan-root" style="margin-block-start:var(--s4)"></div>`;
    scanInputInstance = createScanInput(root.querySelector('#identity-scan-root'), {
      label: 'Scan Nusuk QR',
      placeholder: 'Scan the pilgrim’s Nusuk QR code',
      onSubmit: async (code) => onIdentitySubmit('nusuk-qr', { code }),
    });
    return;
  }
  root.innerHTML = `
    <div class="card" style="margin-block-start:var(--s4)">
      <div class="field">
        <label for="passport-last4">Passport — last 4 characters <span class="req">*</span></label>
        <input id="passport-last4" maxlength="4" class="mono" placeholder="XXXX" />
        <div class="error" id="err-passport-last4" hidden></div>
      </div>
      <label class="checkbox-row" style="margin-block-end:var(--s3)">
        <input type="checkbox" id="photo-match" /> Photo matches
      </label>
      <div class="error" id="err-photo-match" hidden></div>
      <button type="button" class="btn btn-primary btn-block" data-action="submit-passport">${icon('check', 16)} Verify</button>
    </div>
    <div id="passport-result-root"></div>`;
  root.querySelector('[data-action="submit-passport"]').addEventListener('click', async () => {
    const last4 = root.querySelector('#passport-last4').value.trim();
    const photoMatch = root.querySelector('#photo-match').checked;
    const err4 = root.querySelector('#err-passport-last4');
    const errPhoto = root.querySelector('#err-photo-match');
    let valid = true;
    if (last4.length !== 4) { err4.textContent = 'Enter exactly 4 characters.'; err4.hidden = false; valid = false; } else err4.hidden = true;
    if (!photoMatch) { errPhoto.textContent = 'Confirm the photo matches.'; errPhoto.hidden = false; valid = false; } else errPhoto.hidden = true;
    if (!valid) return;
    try {
      const result = await onIdentitySubmit('passport', { last4, photoMatch });
      root.querySelector('#passport-result-root').innerHTML = `<div class="scan-result-banner ok" role="status">${icon('check-circle', 20)}<span class="fs-sm">${esc(result.message)}</span></div>`;
    } catch (e) {
      root.querySelector('#passport-result-root').innerHTML = `
        <div class="scan-result-banner fail" role="status">${icon('x-circle', 20)}<span class="fs-sm">${esc(e.message)}</span></div>
        <div class="row gap-2 wrap" style="margin-block-start:var(--s3)">
          <button type="button" class="btn btn-secondary" data-action="try-again">${icon('rotate-ccw', 16)} Try again</button>
          <button type="button" class="btn btn-secondary" data-action="not-found-from-passport">${icon('user-x', 16)} Passenger not found</button>
        </div>`;
      root.querySelector('[data-action="try-again"]').addEventListener('click', () => renderIdentityMethod('passport', pilgrim));
      root.querySelector('[data-action="not-found-from-passport"]').addEventListener('click', () => { step = 'notfound'; renderStep(); });
    }
  });
}

async function onIdentitySubmit(method, data) {
  try {
    const result = await api.verifyIdentity(stopId, selectedPilgrimId, method, data);
    deliveryContext = { recipientType: 'pilgrim', recipientName: result.pilgrim.name };
    toast(`Identity verified — hand over ${stopData.bags.length} bag${stopData.bags.length === 1 ? '' : 's'}.`, 'success');
    step = 'handover';
    setTimeout(renderStep, 400);
    return { message: 'Identity verified.' };
  } catch (err) {
    throw err;
  }
}

/* ===================== Not found ===================== */

function renderNotFound() {
  const s = stopData;
  const attemptCount = s.attempts.length;
  const maxAttempts = 3;
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <h1 class="page-title" style="margin-block:var(--s3)">${esc(s.room)} — Not found</h1>
    ${attemptCount > 0 ? `<p class="fs-sm ${attemptCount >= maxAttempts ? 'exception-attempt-row escalated' : 'exception-attempt-row'}">Attempt ${attemptCount} of ${maxAttempts}${attemptCount >= maxAttempts ? ' — Escalated to operations.' : ''}</p>` : ''}

    <div class="card" style="margin-block-end:var(--s4)">
      <h2 class="section-title">Record attempt</h2>
      <div class="field">
        <label for="nf-reason">Reason <span class="req">*</span></label>
        <select id="nf-reason"><option value="">Select…</option>${NOT_FOUND_REASONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>
        <div class="error" id="err-nf-reason" hidden></div>
      </div>
      <div class="field">
        <label for="nf-notes">Notes <span class="req">*</span></label>
        <textarea id="nf-notes" minlength="5" maxlength="300" placeholder="5–300 characters"></textarea>
        <div class="error" id="err-nf-notes" hidden></div>
      </div>
      <button type="button" class="btn btn-primary btn-block" data-action="record-attempt">${icon('clipboard', 16)} Record attempt</button>
    </div>

    <div class="card" style="margin-block-end:var(--s4)">
      <h2 class="section-title">Contact supervisor</h2>
      <div class="row gap-2 wrap">
        <a class="btn btn-secondary" href="tel:+966500000999">${icon('phone', 16)} Call supervisor</a>
        <button type="button" class="btn btn-secondary" data-action="notify-supervisor">${icon('send', 16)} Notify supervisor</button>
      </div>
    </div>

    <h2 class="section-title">Resolve</h2>
    <div class="stack gap-2">
      ${RESOLUTION_OPTIONS.map((o) => `<button type="button" class="card card-tap" data-resolve="${esc(o.id)}">${esc(o.label)}</button>`).join('')}
    </div>`;

  appEl.querySelector('[data-action="record-attempt"]').addEventListener('click', recordAttemptFlow);
  appEl.querySelector('[data-action="notify-supervisor"]').addEventListener('click', async () => {
    await api.contactSupervisor(stopId, `Supervisor notified about ${s.room}.`);
    toast('Supervisor notified.', 'success');
  });
  appEl.querySelectorAll('[data-resolve]').forEach((btn) => btn.addEventListener('click', () => openResolveForm(btn.dataset.resolve)));
}

async function recordAttemptFlow() {
  const reason = appEl.querySelector('#nf-reason').value;
  const notes = appEl.querySelector('#nf-notes').value.trim();
  const reasonErr = appEl.querySelector('#err-nf-reason');
  const notesErr = appEl.querySelector('#err-nf-notes');
  let valid = true;
  if (!reason) { reasonErr.textContent = 'Select a reason.'; reasonErr.hidden = false; valid = false; } else reasonErr.hidden = true;
  if (notes.length < 5 || notes.length > 300) { notesErr.textContent = 'Notes must be 5–300 characters.'; notesErr.hidden = false; valid = false; } else notesErr.hidden = true;
  if (!valid) return;
  const btn = appEl.querySelector('[data-action="record-attempt"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    const result = await api.recordAttempt(stopId, { reason, notes });
    toast(`No answer — attempt ${result.attemptNumber} of ${result.maxAttempts} recorded.`, result.escalated ? 'error' : 'info');
    stopData = await api.getStop(stopId);
    renderNotFound();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

function openResolveForm(option) {
  if (option === 'located') return confirmResolve(option, {});
  if (option === 'reattempt' || option === 'refused') return confirmResolve(option, {});
  if (option === 'room-changed') return openRoomChangedModal();
  if (option === 'proxy') return openProxyModal();
}

async function confirmResolve(option, data) {
  const labels = { reattempt: 'Reattempt later?', refused: 'Record that the pilgrim refuses the bag?', located: 'Mark the pilgrim as located?' };
  const ok = await confirmDialog({ title: labels[option] || 'Confirm', body: 'This updates the room status.', confirmLabel: 'Confirm' });
  if (!ok) return;
  try {
    await api.resolveNotFound(stopId, option, data);
    if (option === 'located') { step = 'identity'; renderStep(); return; }
    toast('Resolution recorded.', 'success');
    navigate(`#/run/${runId}`);
  } catch (err) { toast(err.message, 'error'); }
}

function openRoomChangedModal() {
  const close = openModal({
    title: 'Room changed',
    bodyHtml: `
      <div class="field">
        <label for="rc-room">New room <span class="req">*</span></label>
        <input id="rc-room" placeholder="e.g. A-310" class="mono" />
        <div class="error" id="err-rc-room" hidden></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-act="confirm">Save</button>
      </div>`,
    onMount: (overlay) => {
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
      overlay.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
        const room = overlay.querySelector('#rc-room').value.trim();
        try {
          await api.resolveNotFound(stopId, 'room-changed', { room });
          close();
          toast(`Room updated to ${room.toUpperCase()}.`, 'success');
          navigate(`#/run/${runId}/stop/${stopId}`);
        } catch (err) {
          const el = overlay.querySelector('#err-rc-room');
          el.textContent = err.message; el.hidden = false;
        }
      });
    },
  });
}

function openProxyModal() {
  const close = openModal({
    title: 'Deliver to authorised proxy',
    bodyHtml: `
      <div class="field"><label for="px-name">Proxy name <span class="req">*</span></label><input id="px-name" /><div class="error" id="err-px-name" hidden></div></div>
      <div class="field"><label for="px-relation">Relation <span class="req">*</span></label>
        <select id="px-relation"><option value="">Select…</option>${PROXY_RELATIONS.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>
        <div class="error" id="err-px-relation" hidden></div>
      </div>
      <div class="field"><label for="px-id">ID number <span class="req">*</span></label><input id="px-id" /><div class="error" id="err-px-id" hidden></div></div>
      <div class="field"><label for="px-pin">Supervisor PIN <span class="req">*</span></label><input id="px-pin" type="password" inputmode="numeric" maxlength="4" /><div class="error" id="err-px-pin" hidden></div></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-act="confirm">Verify &amp; continue</button>
      </div>`,
    onMount: (overlay) => {
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
      overlay.querySelector('[data-act="confirm"]').addEventListener('click', async () => {
        const name = overlay.querySelector('#px-name').value.trim();
        const relation = overlay.querySelector('#px-relation').value;
        const idNumber = overlay.querySelector('#px-id').value.trim();
        const pin = overlay.querySelector('#px-pin').value.trim();
        try {
          await api.resolveNotFound(stopId, 'proxy', { name, relation, idNumber, pin });
          deliveryContext = { recipientType: 'proxy', recipientName: name };
          close();
          toast(`Proxy verified — hand over bags to ${name}.`, 'success');
          step = 'handover';
          renderStep();
        } catch (err) { toast(err.message, 'error'); }
      });
    },
  });
}

/* ===================== Handover ===================== */

function renderHandover() {
  const s = stopData;
  // Re-sync from server state: if the user left mid-handover and came back,
  // the server's bag.handoverScanned flags are authoritative for what
  // `deliver()` will actually bundle, so the local set must match on entry.
  s.bags.filter((b) => b.handoverScanned).forEach((b) => scannedTagsForHandover.add(b.tagNumber));
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <h1 class="page-title" style="margin-block:var(--s3)">${esc(s.room)} — Handover scan</h1>
    <p class="fs-sm muted" style="margin-block-end:var(--s4)">Scan each bag for ${esc(deliveryContext?.recipientName || s.pilgrims[0]?.name || 'the pilgrim')}.</p>
    <div id="handover-scan-root"></div>
    <div id="handover-bag-list" style="margin-block:var(--s4)"></div>
    <div id="handover-ack-root"></div>
    <div id="handover-info-root"></div>
    <button type="button" class="btn btn-primary btn-lg btn-block" data-action="continue-signature" disabled style="margin-block-start:var(--s4)">
      ${icon('pen-line', 18)} Continue to signature
    </button>`;

  scanInputInstance = createScanInput(appEl.querySelector('#handover-scan-root'), {
    label: 'Scan bag',
    placeholder: 'Scan or type the bag tag',
    onSubmit: async (tag) => {
      const bag = await api.handoverScan(stopId, tag);
      scannedTagsForHandover.add(bag.tagNumber);
      renderBagList();
      return { message: `${bag.tagNumber} scanned.` };
    },
  });
  renderBagList();
  appEl.querySelector('[data-action="continue-signature"]').addEventListener('click', () => { step = 'signature'; renderStep(); });
}

function renderBagList() {
  const s = stopData;
  const listRoot = appEl.querySelector('#handover-bag-list');
  listRoot.innerHTML = `
    <div class="stack gap-2">
      ${s.bags.map((b) => {
        const scanned = scannedTagsForHandover.has(b.tagNumber);
        return `<div class="row gap-2" style="justify-content:space-between">
          <span class="fs-sm mono">${esc(b.tagNumber)}${b.damaged ? ` <span class="chip chip-amber">Damaged${b.damageNote ? ': ' + esc(b.damageNote) : ''}</span>` : ''}</span>
          ${scanned ? statusChip('Delivered', { color: 'green' }) : statusChip('Pending', { color: 'grey' })}
        </div>`;
      }).join('')}
    </div>`;

  const ackRoot = appEl.querySelector('#handover-ack-root');
  const damagedScanned = s.bags.filter((b) => b.damaged && scannedTagsForHandover.has(b.tagNumber));
  ackRoot.innerHTML = damagedScanned.length ? `
    <div class="card" style="margin-block-end:var(--s3)">
      <h2 class="section-title">Damage acknowledgement</h2>
      ${damagedScanned.map((b) => `
        <label class="checkbox-row">
          <input type="checkbox" data-ack="${esc(b.tagNumber)}" ${damageAcks[b.tagNumber] ? 'checked' : ''} />
          I acknowledge ${esc(b.tagNumber)} is damaged (${esc(b.damageNote || 'see note')})
        </label>`).join('')}
    </div>` : '';
  ackRoot.querySelectorAll('[data-ack]').forEach((cb) => cb.addEventListener('change', (e) => {
    damageAcks[e.target.dataset.ack] = e.target.checked;
    updateContinueState();
  }));

  const infoRoot = appEl.querySelector('#handover-info-root');
  const scannedCount = scannedTagsForHandover.size;
  infoRoot.innerHTML = (scannedCount > 0 && scannedCount < s.bags.length)
    ? `<p class="fs-sm" style="color:var(--warning)">${icon('info', 14)} ${scannedCount} of ${s.bags.length} bags scanned — fewer than expected.</p>` : '';

  updateContinueState();
}

function updateContinueState() {
  const s = stopData;
  const btn = appEl.querySelector('[data-action="continue-signature"]');
  if (!btn) return;
  const damagedScanned = s.bags.filter((b) => b.damaged && scannedTagsForHandover.has(b.tagNumber));
  const allAcked = damagedScanned.every((b) => damageAcks[b.tagNumber]);
  btn.disabled = !(scannedTagsForHandover.size > 0 && allAcked);
}

/* ===================== Signature ===================== */

function renderSignature() {
  const s = stopData;
  const recipientName = deliveryContext?.recipientName || s.pilgrims[0]?.name || 'Pilgrim';
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <h1 class="page-title" style="margin-block:var(--s3)">${esc(s.room)} — Signature</h1>
    <p class="fs-sm text-2" style="margin-block-end:var(--s4)">Recipient: <strong>${esc(recipientName)}</strong> (${deliveryContext?.recipientType === 'proxy' ? 'authorised proxy' : 'pilgrim'}) · ${scannedTagsForHandover.size} bag${scannedTagsForHandover.size === 1 ? '' : 's'}</p>

    <div class="card" id="sig-section" style="margin-block-end:var(--s4)">
      <h2 class="section-title">Signature</h2>
      <div id="sig-pad-root"></div>
      <button type="button" class="btn btn-ghost" style="margin-block-start:var(--s3)" data-action="cant-sign">${icon('circle-slash', 16)} Pilgrim unable to sign</button>
    </div>
    <div id="witness-section"></div>

    <div class="error" id="err-signature" hidden style="margin-block-end:var(--s3)"></div>
    <button type="button" class="btn btn-primary btn-lg btn-block" data-action="confirm-delivery">${icon('check', 18)} Confirm delivery</button>`;

  sigPadInstance = createSignaturePad(appEl.querySelector('#sig-pad-root'));
  appEl.querySelector('[data-action="cant-sign"]').addEventListener('click', () => {
    appEl.querySelector('#sig-section').style.display = 'none';
    appEl.querySelector('#witness-section').innerHTML = `
      <div class="card" style="margin-block-end:var(--s4)">
        <h2 class="section-title">Witness</h2>
        <div class="field">
          <label for="witness-name">Witness name <span class="req">*</span></label>
          <input id="witness-name" placeholder="3–80 characters" />
          <div class="error" id="err-witness-name" hidden></div>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="witness-verbal" /> Verbal confirmation received
        </label>
        <button type="button" class="btn btn-ghost" style="margin-block-start:var(--s3)" data-action="use-signature-instead">${icon('pen-line', 16)} Use signature instead</button>
      </div>`;
    appEl.querySelector('[data-action="use-signature-instead"]').addEventListener('click', () => {
      appEl.querySelector('#sig-section').style.display = '';
      appEl.querySelector('#witness-section').innerHTML = '';
    });
  });

  appEl.querySelector('[data-action="confirm-delivery"]').addEventListener('click', confirmDeliveryFlow);
}

async function confirmDeliveryFlow() {
  const errEl = appEl.querySelector('#err-signature');
  const usingWitness = appEl.querySelector('#sig-section').style.display === 'none';
  let signatureDataUrl = null;
  let witnessName = null;
  if (usingWitness) {
    const nameInput = appEl.querySelector('#witness-name');
    const verbal = appEl.querySelector('#witness-verbal').checked;
    const name = nameInput.value.trim();
    if (name.length < 3 || name.length > 80 || !verbal) {
      errEl.textContent = 'Enter the witness name (3–80 characters) and confirm verbal acknowledgement.';
      errEl.hidden = false;
      return;
    }
    witnessName = name;
  } else {
    if (sigPadInstance.isEmpty()) {
      errEl.textContent = 'Collect a signature, or choose "Pilgrim unable to sign".';
      errEl.hidden = false;
      return;
    }
    signatureDataUrl = sigPadInstance.getDataUrl();
  }
  errEl.hidden = true;
  const btn = appEl.querySelector('[data-action="confirm-delivery"]');
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try {
    const receipt = await api.deliver(stopId, {
      signatureDataUrl, witnessName,
      recipientType: deliveryContext?.recipientType || 'pilgrim',
      recipientName: deliveryContext?.recipientName || stopData.pilgrims[0]?.name,
    });
    toast(`Delivered to ${receipt.recipientName} — ${receipt.bagsDelivered} bag${receipt.bagsDelivered === 1 ? '' : 's'}.`, 'success');
    renderReceipt(receipt);
  } catch (err) {
    errEl.textContent = err.message; errEl.hidden = false;
    btn.disabled = false; btn.removeAttribute('aria-busy');
  }
}

/* ===================== Receipt ===================== */

async function renderReceipt(receipt) {
  const run = await api.getRun(runId).catch(() => null);
  const nextStop = run ? run.stops.find((s2) => s2.status === 'Pending') : null;
  appEl.innerHTML = `
    <div class="card receipt-card">
      ${icon('check-circle', 48)}
      <h1 class="fs-xl" style="margin-block:var(--s4) var(--s2)">Delivered</h1>
      <p class="fs-sm text-2" style="margin-block-end:var(--s4)">Delivered to ${esc(receipt.recipientName)} — ${receipt.bagsDelivered} bag${receipt.bagsDelivered === 1 ? '' : 's'}.</p>
      <div class="receipt-qr" id="receipt-qr"></div>
      <p class="fs-xs muted" style="margin-block-end:var(--s5)">${esc(fmtDateTime(receipt.deliveredAt))}</p>
      ${nextStop
        ? `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="next-stop" data-stop-id="${esc(nextStop.id)}">${icon('arrow-right', 18)} Next room — ${esc(nextStop.room)}</button>`
        : `<button type="button" class="btn btn-primary btn-lg btn-block" data-action="all-done">${icon('party-popper', 18)} All rooms done</button>`}
    </div>`;

  if (window.QRCode) {
    try { new window.QRCode(appEl.querySelector('#receipt-qr'), { text: receipt.qrPayload, width: 144, height: 144 }); } catch (e) { /* ignore */ }
  }

  appEl.querySelector('[data-action="next-stop"]')?.addEventListener('click', (e) => navigate(`#/run/${runId}/stop/${e.currentTarget.dataset.stopId}`));
  appEl.querySelector('[data-action="all-done"]')?.addEventListener('click', () => navigate(`#/run/${runId}/reconcile`));
}
