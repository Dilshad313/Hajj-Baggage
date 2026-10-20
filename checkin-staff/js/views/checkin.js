import * as api from '../api.js';
import {
  skeletonBlock, errorState, esc, icon, toast, confirmDialog, openModal, fmtWeight, fmtTime, announce,
} from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { stepperHtml } from '../components/stepper.js';
import { CHECKIN_STEPS, stepIndexOf, SUPERVISOR_REASONS } from '../seed.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

const FLIGHTS = ['SV 1821', 'SV 1944', 'SV 2077'];
const NOT_FOUND_REASONS = ['Not in system', 'Wrong centre entirely', 'Duplicate booking', 'Other'];

let appEl = null;
let session = null;
let startMode = 'scan';
let initialApptParam = null;
let scanCtl = null;
let bagScanCtl = null;

export function render(params, app) {
  appEl = app;
  session = null;
  startMode = params.mode === 'search' ? 'search' : params.mode === 'walkin' ? 'walkin' : 'scan';
  initialApptParam = params.appt || null;
  load();
  return { destroy, poll: pollTick, refresh: load };
}

export function destroy() {
  scanCtl?.destroy(); scanCtl = null;
  bagScanCtl?.destroy(); bagScanCtl = null;
  appEl = null; session = null;
}

async function pollTick() {
  if (!appEl || !session || session.status !== 'on-hold') return;
  try {
    const fresh = await api.getCheckinSession(session.id);
    if (!appEl) return;
    if (fresh.status === 'active') { session = fresh; renderStep(); }
  } catch (e) { /* silent */ }
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    const mine = await api.getMySession();
    if (!appEl) return;
    if (mine) { session = mine; renderStep(); return; }
    if (initialApptParam) {
      const apptId = initialApptParam;
      initialApptParam = null;
      renderStartPanel(null);
      await attemptStartSession(apptId);
      return;
    }
    renderStartPanel(null);
  } catch (err) {
    if (!appEl) return;
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

/* ===================== START PANEL (QR / Search / Walk-in) ===================== */

function pageHeader(title, subtitle) {
  return `<div class="page-header"><div><h1 class="page-title">${esc(title)}</h1>${subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : ''}</div></div>`;
}

function renderStartPanel() {
  if (!appEl) return;
  appEl.innerHTML = `
    ${pageHeader('Check-in counter')}
    <div class="tabs" role="tablist">
      <button type="button" class="tab" role="tab" aria-selected="${startMode === 'scan'}" data-mode="scan">Scan QR</button>
      <button type="button" class="tab" role="tab" aria-selected="${startMode === 'search'}" data-mode="search">Search by passport</button>
      <button type="button" class="tab" role="tab" aria-selected="${startMode === 'walkin'}" data-mode="walkin">Walk-in pilgrim</button>
    </div>
    <div id="start-body"></div>`;
  appEl.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => { startMode = btn.dataset.mode; renderStartBody(); }));
  renderStartBody();
}

function renderStartBody() {
  const root = appEl?.querySelector('#start-body');
  if (!root) return;
  scanCtl?.destroy(); scanCtl = null;
  if (startMode === 'scan') renderScanBody(root);
  else if (startMode === 'search') renderSearchBody(root);
  else renderWalkinBody(root);
}

function renderScanBody(root) {
  root.innerHTML = `<div class="card" style="max-width:480px"><div id="qr-scan-root"></div></div>`;
  scanCtl = createScanInput(root.querySelector('#qr-scan-root'), {
    label: 'Scan pilgrim booking QR',
    placeholder: 'Scan or type booking code',
    onSubmit: async (code) => {
      const res = await api.findByBookingCode(code);
      if (!appEl) return;
      await attemptStartSession(res.appointmentId);
      return { message: 'Booking found.' };
    },
  });
}

function renderSearchBody(root) {
  root.innerHTML = `
    <div class="card" style="max-width:480px">
      <div class="field">
        <label for="search-passport">Passport number <span class="req">*</span></label>
        <input id="search-passport" placeholder="e.g. RB0010001" />
        <div class="error" id="err-passport" hidden></div>
      </div>
      <div class="field">
        <label for="search-nusuk">Nusuk ID (optional)</label>
        <input id="search-nusuk" placeholder="10 digits" />
        <div class="error" id="err-nusuk" hidden></div>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="search-submit">${icon('search', 16)} Search</button>
    </div>
    <div id="search-result-root"></div>`;
  root.querySelector('#search-submit').addEventListener('click', async () => {
    const passport = root.querySelector('#search-passport').value.trim();
    const nusukId = root.querySelector('#search-nusuk').value.trim();
    try {
      const res = await api.searchPassport(passport, nusukId);
      if (!appEl) return;
      if (!res.found) { renderNotFound(root, passport); return; }
      await attemptStartSession(res.appointmentId);
    } catch (err) {
      const el = root.querySelector('#err-passport');
      el.textContent = err.message; el.hidden = false;
    }
  });
}

function renderNotFound(root, passport) {
  const resultRoot = root.querySelector('#search-result-root');
  resultRoot.innerHTML = `
    <div class="result-card danger">
      ${icon('user-x', 28)}
      <h2 class="section-title" style="color:inherit">Pilgrim not found</h2>
      <p class="fs-sm">No booking matches this passport. Contact your supervisor to investigate.</p>
      <div class="field" style="margin-block-start:var(--s4)">
        <label for="nf-name">Pilgrim's stated name <span class="req">*</span></label>
        <input id="nf-name" />
      </div>
      <div class="field">
        <label for="nf-flight">Flight</label>
        <select id="nf-flight"><option value="">Unknown</option>${FLIGHTS.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label for="nf-note">Note <span class="req">*</span></label>
        <textarea id="nf-note" maxlength="300" placeholder="What did the pilgrim say?"></textarea>
        <div class="error" id="err-nf" hidden></div>
      </div>
      <button type="button" class="btn btn-danger" data-act="contact-supervisor">${icon('phone', 16)} Contact supervisor</button>
    </div>`;
  resultRoot.querySelector('[data-act="contact-supervisor"]').addEventListener('click', async () => {
    const statedName = resultRoot.querySelector('#nf-name').value;
    const flightCode = resultRoot.querySelector('#nf-flight').value;
    const note = resultRoot.querySelector('#nf-note').value;
    const err = resultRoot.querySelector('#err-nf');
    try {
      await api.reportPilgrimNotFound({ passportNo: passport, statedName, flightCode, note });
      toast('Reported to your supervisor.', 'success');
      resultRoot.innerHTML = `<div class="result-card info">${icon('check-circle', 28)}<p class="fs-sm">Supervisor notified. You can search for another pilgrim or scan a QR.</p></div>`;
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  });
}

function renderWalkinBody(root) {
  root.innerHTML = `
    <div class="card" style="max-width:560px">
      <div class="grid grid-cols-2">
        <div class="field"><label for="wi-name">Pilgrim name <span class="req">*</span></label><input id="wi-name" /></div>
        <div class="field"><label for="wi-nationality">Nationality <span class="req">*</span></label><input id="wi-nationality" /></div>
        <div class="field"><label for="wi-passport">Passport no. <span class="req">*</span></label><input id="wi-passport" placeholder="6–12 letters/digits" /></div>
        <div class="field"><label for="wi-nusuk">Nusuk ID</label><input id="wi-nusuk" placeholder="10 digits (optional)" /></div>
        <div class="field"><label for="wi-flight">Flight <span class="req">*</span></label><select id="wi-flight"><option value="">Select…</option>${FLIGHTS.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select></div>
        <div class="field"><label for="wi-bags">Declared bags <span class="req">*</span></label><select id="wi-bags"><option value="1">1</option><option value="2">2</option></select></div>
      </div>
      <div class="error" id="err-walkin" hidden style="margin-block-end:var(--s3)"></div>
      <button type="button" class="btn btn-primary btn-block" id="walkin-submit">${icon('user-plus', 16)} Create walk-in &amp; start check-in</button>
    </div>`;
  root.querySelector('#walkin-submit').addEventListener('click', async () => {
    const data = {
      name: root.querySelector('#wi-name').value, nationality: root.querySelector('#wi-nationality').value,
      passportNo: root.querySelector('#wi-passport').value, nusukId: root.querySelector('#wi-nusuk').value,
      flightCode: root.querySelector('#wi-flight').value, declaredBags: root.querySelector('#wi-bags').value,
    };
    const err = root.querySelector('#err-walkin');
    try {
      const res = await api.createWalkIn(data);
      if (!appEl) return;
      await attemptStartSession(res.appointmentId);
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  });
}

/* ===================== START SESSION RESULT HANDLING ===================== */

async function attemptStartSession(appointmentId, opts = {}) {
  try {
    const res = await api.startSession(appointmentId, opts);
    if (!appEl) return;
    handleStartResult(appointmentId, res);
  } catch (err) {
    if (!appEl) return;
    toast(err.message, 'error');
  }
}

function handleStartResult(appointmentId, res) {
  if (res.status === 'created') { session = res.session; renderStep(); return; }
  const target = appEl.querySelector('#start-body');
  if (!target) return;
  if (res.status === 'blocked' && res.reason === 'cancelled') {
    target.innerHTML = `<div class="result-card danger">${icon('ban', 28)}<p class="fw-semibold">This booking has been cancelled.</p><p class="fs-sm">${esc(res.appointment.pilgrimName)} — ${esc(res.appointment.bookingCode)}</p></div>`;
  } else if (res.status === 'blocked' && res.reason === 'flight-closed') {
    target.innerHTML = `<div class="result-card danger">${icon('plane', 28)}<p class="fw-semibold">Flight ${esc(res.appointment.flightCode)} is closed for check-in.</p><p class="fs-sm">This booking cannot be processed.</p></div>`;
  } else if (res.status === 'already-checked-in') {
    target.innerHTML = `<div class="result-card info">${icon('check-circle', 28)}<p class="fw-semibold">${esc(res.appointment.pilgrimName)} is already checked in.</p><button type="button" class="btn btn-secondary" style="margin-block-start:var(--s3)" data-act="view-receipt">${icon('file-text', 16)} View receipt</button></div>`;
    target.querySelector('[data-act="view-receipt"]').addEventListener('click', () => navigate('#/history'));
  } else if (res.status === 'no-show') {
    target.innerHTML = `<div class="result-card danger">${icon('user-x', 28)}<p class="fw-semibold">${esc(res.appointment.pilgrimName)} was marked a no-show.</p><button type="button" class="btn btn-primary" style="margin-block-start:var(--s3)" data-act="reinstate">${icon('rotate-ccw', 16)} Reinstate</button></div>`;
    target.querySelector('[data-act="reinstate"]').addEventListener('click', async () => {
      try { await api.reinstate(appointmentId); toast('Reinstated.', 'success'); attemptStartSession(appointmentId); } catch (e) { toast(e.message, 'error'); }
    });
  } else if (res.status === 'needs-centre-override') {
    target.innerHTML = `
      <div class="result-card warning">
        ${icon('map-pin', 28)}
        <p class="fw-semibold">${esc(res.appointment.pilgrimName)} is booked at a different centre.</p>
        <div class="field" style="margin-block-start:var(--s3)">
          <label for="centre-pin">Supervisor PIN <span class="req">*</span></label>
          <input id="centre-pin" type="password" inputmode="numeric" maxlength="4" />
          <div class="error" id="err-centre-pin" hidden></div>
        </div>
        <button type="button" class="btn btn-primary" data-act="override-centre">Enter PIN to proceed anyway</button>
      </div>`;
    target.querySelector('[data-act="override-centre"]').addEventListener('click', () => {
      const pin = target.querySelector('#centre-pin').value;
      attemptStartSession(appointmentId, { supervisorPin: pin });
    });
  } else if (res.status === 'needs-date-override') {
    target.innerHTML = `
      <div class="result-card warning">
        ${icon('calendar', 28)}
        <p class="fw-semibold">${esc(res.appointment.pilgrimName)}'s booking is for a different date.</p>
        <p class="fs-sm">Slot: ${fmtTime(res.appointment.slotAt)} on ${new Date(res.appointment.slotAt).toLocaleDateString()}</p>
        <button type="button" class="btn btn-primary" data-act="override-date">Allow anyway</button>
      </div>`;
    target.querySelector('[data-act="override-date"]').addEventListener('click', () => attemptStartSession(appointmentId, { overrideDate: true }));
  }
}

/* ===================== STEP ROUTER ===================== */

function renderStep() {
  if (!appEl || !session) return;
  scanCtl?.destroy(); scanCtl = null;
  const appt = session.appointment;
  const idx = stepIndexOf(session.step);
  appEl.innerHTML = `
    ${pageHeader('Check-in counter', appt.pilgrimName)}
    ${stepperHtml(CHECKIN_STEPS, idx)}
    ${session.status === 'on-hold' ? `<div class="result-card warning">${icon('clock', 20)} On hold pending supervisor review. <a href="#/exceptions">View in Exceptions</a></div>` : ''}
    <div class="counter-shell">
      <div class="counter-side">
        <div class="card">
          <div class="pilgrim-summary-photo">${icon('user', 48)}</div>
          <strong class="fs-md">${esc(appt.pilgrimName)}</strong>
          <div class="fs-sm muted">${esc(appt.nationality)} · ${esc(appt.nusukId)}</div>
          <div class="fs-sm muted mono" style="margin-block-start:4px">${esc(appt.passportNo)}</div>
          <div class="row gap-2 wrap" style="margin-block-start:var(--s3)">${statusChip(appt.status)}<span class="chip chip-blue">${esc(appt.flightCode)}</span></div>
        </div>
        ${session.step === 'bags' || session.step === 'receipt' || session.step === 'complete' ? bagSideListHtml() : ''}
      </div>
      <div id="step-main"></div>
    </div>`;
  renderStepMain();
}

function bagSideListHtml() {
  return `
    <div class="card">
      <h2 class="section-title fs-sm">Bags</h2>
      ${session.bags.map((b, i) => `
        <div class="bag-side-row ${i === session.currentBagIndex && !b.logged && b.status !== 'not-presented' ? 'current' : ''}">
          <span class="fs-sm">Bag ${b.seq}${b.extra ? ' (extra)' : ''}</span>
          ${b.status === 'not-presented' ? statusChip('Skipped', { color: 'grey' }) : b.logged ? statusChip('Logged', { color: 'green' }) : statusChip(b.status)}
        </div>`).join('')}
    </div>`;
}

function renderStepMain() {
  const main = appEl?.querySelector('#step-main');
  if (!main) return;
  if (session.step !== 'bags') { bagScanCtl?.destroy(); bagScanCtl = null; }
  if (session.step === 'identity') renderIdentityStep(main);
  else if (session.step === 'nusuk') renderNusukStep(main);
  else if (session.step === 'bags') renderBagsStep(main);
  else if (session.step === 'receipt') renderReceiptStep(main);
  else if (session.step === 'complete') renderCompleteStep(main);
}

/* ===== Identity ===== */

function renderIdentityStep(main) {
  main.innerHTML = `
    <div class="card">
      <h2 class="section-title">Verify identity</h2>
      <label class="checkbox-row"><input type="checkbox" id="tick-photo" /> Photo matches the pilgrim</label>
      <label class="checkbox-row"><input type="checkbox" id="tick-document" /> Travel document checked</label>
      <label class="checkbox-row"><input type="checkbox" id="tick-name" /> Name confirmed verbally</label>
      <div class="row gap-3 wrap" style="margin-block-start:var(--s5)">
        <button type="button" class="btn btn-primary" id="identity-continue" disabled>${icon('check', 16)} Identity verified — continue</button>
        <button type="button" class="btn btn-danger" id="identity-mismatch">${icon('user-x', 16)} Identity does not match</button>
        <button type="button" class="btn btn-ghost" id="identity-cancel">Cancel check-in</button>
      </div>
    </div>`;
  const ticks = main.querySelectorAll('[id^="tick-"]');
  const continueBtn = main.querySelector('#identity-continue');
  ticks.forEach((cb) => cb.addEventListener('change', () => {
    continueBtn.disabled = !Array.from(ticks).every((c) => c.checked);
  }));
  continueBtn.addEventListener('click', async () => {
    try {
      const res = await api.verifyIdentity(session.id, { photo: main.querySelector('#tick-photo').checked, document: main.querySelector('#tick-document').checked, name: main.querySelector('#tick-name').checked });
      if (!appEl) return;
      session = res; renderStep();
    } catch (e) { toast(e.message, 'error'); }
  });
  main.querySelector('#identity-mismatch').addEventListener('click', () => openIdentityMismatchDialog());
  main.querySelector('#identity-cancel').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Cancel check-in', body: 'Cancel this check-in and return the booking to Booked?', confirmLabel: 'Cancel check-in', danger: true });
    if (!ok) return;
    try { await api.cancelSession(session.id, 'Cancelled at identity step.'); session = null; navigate('#/checkin'); load(); } catch (e) { toast(e.message, 'error'); }
  });
}

function openIdentityMismatchDialog() {
  const bodyHtml = `
    <div class="field"><label for="im-reason">Reason <span class="req">*</span></label>
      <select id="im-reason"><option value="">Select…</option>${SUPERVISOR_REASONS.map((r) => `<option>${esc(r)}</option>`).join('')}</select></div>
    <div class="field"><label for="im-notes">Notes <span class="req">*</span></label><textarea id="im-notes" maxlength="300"></textarea></div>
    <div class="field"><label for="im-pin">Supervisor PIN <span class="req">*</span></label><input id="im-pin" type="password" inputmode="numeric" maxlength="4" /></div>
    <div class="error" id="err-im" hidden></div>
    <div class="modal-actions"><button type="button" class="btn btn-danger" id="im-submit">Confirm — put on hold</button></div>`;
  const close = openModal({
    title: 'Identity does not match', bodyHtml,
    onMount: (overlay) => {
      overlay.querySelector('#im-submit').addEventListener('click', async () => {
        const reason = overlay.querySelector('#im-reason').value;
        const notes = overlay.querySelector('#im-notes').value;
        const pin = overlay.querySelector('#im-pin').value;
        const err = overlay.querySelector('#err-im');
        try {
          await api.reportIdentityMismatch(session.id, { pin, reason, notes });
          toast('On hold — supervisor notified.', 'info');
          close();
          session = null; navigate('#/checkin'); load();
        } catch (e) { err.textContent = e.message; err.hidden = false; }
      });
    },
  });
}

/* ===== Nusuk ===== */

function renderNusukStep(main) {
  if (session.nusuk.checked) { renderNusukResult(main); return; }
  main.innerHTML = `<div class="card"><div class="state-block"><div class="spinner" style="width:32px;height:32px;border-width:3px;color:var(--accent)"></div><p class="fs-sm muted">Checking with Nusuk…</p></div></div>`;
  setTimeout(runNusukCheck, 1500);
}

async function runNusukCheck() {
  if (!appEl || !session) return;
  try {
    const res = await api.checkNusuk(session.id);
    if (!appEl) return;
    const fresh = await api.getCheckinSession(session.id);
    if (!appEl) return;
    session = fresh;
    renderStep();
    announce(res.result === 'match' ? 'Nusuk verified.' : `Data mismatch: ${res.mismatchFields.join(', ')}`);
  } catch (e) { toast(e.message, 'error'); }
}

function renderNusukResult(main) {
  const n = session.nusuk;
  const appt = session.appointment;
  const nusukRow = (label, field) => {
    const f = n.mismatchFields.includes(field);
    return `<tr><th>${esc(label)}</th><td class="${f ? 'mismatch' : 'match'}">${icon(f ? 'x' : 'check', 14)} Rabel vs Nusuk</td></tr>`;
  };
  main.innerHTML = `
    <div class="card">
      <h2 class="section-title">Nusuk verification</h2>
      <table class="compare-table">
        <thead><tr><th>Field</th><th>Rabel record</th><th>Nusuk record</th></tr></thead>
        <tbody>
          <tr><td>Name</td><td>${esc(appt.pilgrimName)}</td><td class="${n.mismatchFields.includes('name') ? 'mismatch' : 'match'}">${esc(appt.pilgrimName)}</td></tr>
          <tr><td>Passport</td><td class="mono">${esc(appt.passportNo)}</td><td class="mono ${n.mismatchFields.includes('passport') ? 'mismatch' : 'match'}">${n.mismatchFields.includes('passport') ? 'different number on file' : esc(appt.passportNo)}</td></tr>
          <tr><td>Nationality</td><td>${esc(appt.nationality)}</td><td class="${n.mismatchFields.includes('nationality') ? 'mismatch' : 'match'}">${esc(appt.nationality)}</td></tr>
          <tr><td>Flight</td><td>${esc(appt.flightCode)}</td><td class="${n.mismatchFields.includes('flight') ? 'mismatch' : 'match'}">${esc(appt.flightCode)}</td></tr>
          <tr><td>Visa</td><td colspan="2">${n.mismatchFields.includes('visa') ? statusChip('Expired', { color: 'red' }) : statusChip('Valid', { color: 'green' })}</td></tr>
        </tbody>
      </table>
      ${n.result === 'match' ? `
        <div class="result-card success">${icon('check-circle', 24)} Verified — all fields match.</div>
        <button type="button" class="btn btn-primary" data-act="continue">Continue</button>
      ` : `
        <div class="result-card danger">${icon('alert-triangle', 24)} ${n.mismatchFields.includes('visa') && n.mismatchFields.length === 1 ? 'Visa expired' : `Data mismatch: ${n.mismatchFields.join(', ')}`} — supervisor notified, check-in on hold.</div>
        <button type="button" class="btn btn-secondary" data-act="ack">Back to counter</button>
      `}
      <button type="button" class="btn btn-ghost" data-act="recheck" style="margin-inline-start:var(--s2)">${icon('rotate-ccw', 16)} Re-check</button>
    </div>`;
  main.querySelector('[data-act="continue"]')?.addEventListener('click', async () => {
    try { session = await api.confirmNusukContinue(session.id); renderStep(); } catch (e) { toast(e.message, 'error'); }
  });
  main.querySelector('[data-act="ack"]')?.addEventListener('click', () => { toast('Supervisor notified.', 'info'); session = null; navigate('#/checkin'); load(); });
  main.querySelector('[data-act="recheck"]')?.addEventListener('click', () => { session.nusuk.checked = false; renderStep(); });
}

/* ===== Bags ===== */

function currentBag() {
  return session.bags[session.currentBagIndex];
}

function renderBagsStep(main) {
  bagScanCtl?.destroy(); bagScanCtl = null;
  const bag = currentBag();
  if (!bag) { main.innerHTML = `<div class="card"><p class="fs-sm muted">No more bags to process.</p></div>`; return; }
  const title = `<h2 class="section-title">Bag ${bag.seq} of ${session.bags.length}${bag.extra ? ' (extra)' : ''}</h2>`;
  if (bag.status === 'pending-weigh') renderWeighPhase(main, bag, title);
  else if (bag.status === 'overweight') renderOverweightPhase(main, bag, title);
  else if (!bag.tagNumber || !bag.printed || !bag.attached) renderTagPhase(main, bag, title);
  else renderVerifyPhase(main, bag, title);
}

function renderWeighPhase(main, bag, title) {
  main.innerHTML = `
    <div class="card">
      ${title}
      <div class="scale-readout">
        <div class="weight-big" id="weight-display">${bag.weight != null ? bag.weight.toFixed(1) : '—'} kg</div>
      </div>
      <div class="grid grid-cols-2">
        <div class="field"><label for="weight-input">Weight (kg) <span class="req">*</span></label><input id="weight-input" type="number" step="0.1" value="${bag.weight ?? ''}" /></div>
        <div class="field" style="align-self:flex-end"><button type="button" class="btn btn-secondary btn-block" id="read-scale">${icon('scale', 16)} Read scale</button></div>
      </div>
      <div class="error" id="err-weight" hidden style="margin-block-end:var(--s3)"></div>
      <div class="row gap-3 wrap">
        <button type="button" class="btn btn-primary" id="accept-weight">${icon('check', 16)} Accept weight</button>
        <button type="button" class="btn btn-secondary" id="not-presented">Bag not presented</button>
        <button type="button" class="btn btn-ghost" id="add-extra">${icon('plus', 16)} Add extra bag</button>
      </div>
    </div>`;
  main.querySelector('#read-scale').addEventListener('click', async () => {
    const res = await api.simulateScaleReading(session.id, session.currentBagIndex);
    main.querySelector('#weight-input').value = res.weight;
    main.querySelector('#weight-display').textContent = `${res.weight.toFixed(1)} kg`;
  });
  main.querySelector('#weight-input').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    main.querySelector('#weight-display').textContent = Number.isFinite(v) ? `${v.toFixed(1)} kg` : '— kg';
  });
  main.querySelector('#accept-weight').addEventListener('click', async () => {
    const val = main.querySelector('#weight-input').value;
    const err = main.querySelector('#err-weight');
    try {
      const res = await api.acceptWeight(session.id, session.currentBagIndex, val);
      if (!appEl) return;
      session = await api.getCheckinSession(session.id);
      if (!appEl) return;
      if (res.overweight) toast(`Overweight by ${(res.weight - 23).toFixed(1)} kg — ask the pilgrim to repack.`, 'error');
      else toast(`Bag ${bag.seq} weighed — ${res.weight.toFixed(1)} kg.`, 'success');
      renderStep();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  });
  main.querySelector('#not-presented').addEventListener('click', async () => {
    try { session = await api.bagNotPresented(session.id, session.currentBagIndex); renderStep(); } catch (e) { toast(e.message, 'error'); }
  });
  main.querySelector('#add-extra').addEventListener('click', async () => {
    try { session = await api.addExtraBag(session.id); toast('Extra bag added.', 'info'); } catch (e) { toast(e.message, 'error'); }
  });
}

function renderOverweightPhase(main, bag, title) {
  main.innerHTML = `
    <div class="card">
      ${title}
      <div class="result-card danger">
        ${icon('alert-triangle', 28)}
        <p class="fw-semibold">Overweight by ${(bag.weight - 23).toFixed(1)} kg — ask the pilgrim to repack.</p>
        <button type="button" class="btn btn-primary" style="margin-block-start:var(--s3)" disabled>Accept weight</button>
      </div>
      <div id="repack-wait" hidden class="result-card warning">${icon('clock', 20)} Waiting for pilgrim to repack…</div>
      <div class="row gap-3">
        <button type="button" class="btn btn-secondary" id="repack-btn">Repack required</button>
        <button type="button" class="btn btn-primary" id="reweigh-btn" hidden>${icon('rotate-ccw', 16)} Re-weigh</button>
      </div>
    </div>`;
  main.querySelector('#repack-btn').addEventListener('click', () => {
    main.querySelector('#repack-wait').hidden = false;
    main.querySelector('#repack-btn').hidden = true;
    main.querySelector('#reweigh-btn').hidden = false;
  });
  main.querySelector('#reweigh-btn').addEventListener('click', async () => {
    try {
      await api.repackBag(session.id, session.currentBagIndex);
      session = await api.getCheckinSession(session.id);
      renderStep();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function tagPreviewHtml(bag, appt) {
  return `
    <div class="tag-preview">
      <div class="tag-no">${esc(bag.tagNumber)}</div>
      <div class="tag-barcode"><svg id="tag-barcode-svg"></svg></div>
      <div class="tag-qr" id="tag-qr"></div>
      <div class="tag-meta">
        Flight: ${esc(appt.flightCode)}<br>Destination: JED<br>Weight: ${bag.weight != null ? fmtWeight(bag.weight) : '—'}<br>Bag ${bag.seq} of ${session.bags.length}
      </div>
    </div>`;
}

function renderTagPhase(main, bag, title) {
  const appt = session.appointment;
  main.innerHTML = `
    <div class="card">
      ${title}
      ${!bag.tagNumber ? `
        <button type="button" class="btn btn-primary" id="generate-tag">${icon('tag', 16)} Generate baggage tag</button>
      ` : `
        <div class="print-area">${tagPreviewHtml(bag, appt)}</div>
        <div class="row gap-3 wrap" style="margin-block-start:var(--s4)">
          <button type="button" class="btn btn-secondary" id="print-tag">${icon('printer', 16)} ${bag.printed ? 'Reprint' : 'Print tag'}</button>
          <label class="checkbox-row" style="margin:0"><input type="checkbox" id="attach-tick" ${bag.attached ? 'checked' : ''} /> Tag attached to bag</label>
        </div>
        ${!bag.printed ? `<p class="fs-xs muted" style="margin-block-start:var(--s3)">Print the tag and confirm it's attached to move on to verification.</p>` : ''}
      `}
    </div>`;
  main.querySelector('#generate-tag')?.addEventListener('click', async () => {
    try { await api.generateTag(session.id, session.currentBagIndex); session = await api.getCheckinSession(session.id); renderStep(); } catch (e) { toast(e.message, 'error'); }
  });
  if (bag.tagNumber && window.JsBarcode) {
    try { window.JsBarcode('#tag-barcode-svg', bag.tagNumber, { format: 'CODE128', width: 1.5, height: 40, displayValue: false }); } catch (e) { /* ignore */ }
  }
  if (bag.tagNumber && window.QRCode) {
    try { new window.QRCode(main.querySelector('#tag-qr'), { text: bag.tagNumber, width: 96, height: 96 }); } catch (e) { /* ignore */ }
  }
  main.querySelector('#print-tag')?.addEventListener('click', async () => {
    try { await api.markPrinted(session.id, session.currentBagIndex); session = await api.getCheckinSession(session.id); window.print(); renderStep(); } catch (e) { toast(e.message, 'error'); }
  });
  main.querySelector('#attach-tick')?.addEventListener('change', async (e) => {
    if (!e.target.checked) return;
    try { await api.markAttached(session.id, session.currentBagIndex); session = await api.getCheckinSession(session.id); renderStep(); } catch (err) { toast(err.message, 'error'); }
  });
}

function renderVerifyPhase(main, bag, title) {
  main.innerHTML = `
    <div class="card">
      ${title}
      <p class="fs-sm muted" style="margin-block-end:var(--s3)">Tag ${bag.tagNumber} — ${bag.manualEntries >= 3 ? 'too many failed attempts.' : 'scan it on the bag to confirm.'}</p>
      ${bag.manualEntries >= 3 ? `<button type="button" class="btn btn-primary" id="reprint-tag">${icon('printer', 16)} Reprint tag</button>` : `<div id="verify-scan-root"></div>`}
    </div>`;
  if (bag.manualEntries >= 3) {
    main.querySelector('#reprint-tag').addEventListener('click', async () => {
      try {
        session = await api.reprintTag(session.id, session.currentBagIndex);
        toast('Tag reprinted.', 'info');
        renderStep();
      } catch (e) { toast(e.message, 'error'); }
    });
    return;
  }
  bagScanCtl = createScanInput(main.querySelector('#verify-scan-root'), {
    label: 'Scan the tag on the bag',
    placeholder: 'Scan or type the tag number',
    onSubmit: async (code, { manual }) => {
      await api.verifyTag(session.id, session.currentBagIndex, code, { manual });
      const logRes = await api.logBag(session.id, session.currentBagIndex);
      if (!appEl) return;
      session = logRes.session;
      toast(`Bag ${bag.seq} logged.`, 'success');
      setTimeout(() => { if (appEl) renderStep(); }, 700);
      return { message: `${bag.tagNumber} verified and logged.` };
    },
  });
}

/* ===== Receipt ===== */

function renderReceiptStep(main) {
  main.innerHTML = skeletonBlock(4);
  api.getReceipt(session.id).then((r) => {
    if (!appEl) return;
    renderReceiptBody(main, r);
  }).catch((e) => { if (main) main.innerHTML = errorState({ message: e.message }); });
}

function renderReceiptBody(main, r) {
  main.innerHTML = `
    <div class="card">
      <div class="print-area">
        <div class="receipt-preview">
          <div class="receipt-head">
            <strong class="fs-lg">Rabel Baggage Receipt</strong>
            <div class="fs-sm muted">${esc(r.receiptNo)}</div>
          </div>
          <div class="fs-sm"><strong>${esc(r.centreName)}</strong> · Counter ${esc(r.counterNo)} · ${esc(r.staffName)}</div>
          <div class="fs-sm">Pilgrim: ${esc(r.pilgrimName)} (${esc(r.passportMasked)})</div>
          <table>
            <thead><tr><th>Tag</th><th>Weight</th></tr></thead>
            <tbody>${r.bags.map((b) => `<tr><td class="mono">${esc(b.tagNumber)}</td><td>${fmtWeight(b.weight)}</td></tr>`).join('')}</tbody>
          </table>
          <div class="receipt-total"><span>Total</span><span>${r.bags.length} bags · ${fmtWeight(r.totalKg)}</span></div>
        </div>
      </div>
      <div class="row gap-3 wrap" style="margin-block-start:var(--s5)">
        <button type="button" class="btn btn-secondary" id="print-receipt">${icon('printer', 16)} Print receipt</button>
      </div>
      <div class="row gap-4 wrap" style="margin-block-start:var(--s4)">
        <label class="checkbox-row" style="margin:0"><input type="checkbox" id="handed-tick" ${r.handed ? 'checked' : ''} /> Receipt handed to pilgrim</label>
        <label class="checkbox-row" style="margin:0"><input type="checkbox" id="digital-tick" ${r.digital ? 'checked' : ''} /> Pilgrim will use the digital receipt</label>
      </div>
      <button type="button" class="btn btn-primary btn-lg" id="confirm-complete" style="margin-block-start:var(--s4)" ${r.printed && (r.handed || r.digital) ? '' : 'disabled'}>${icon('check-check', 18)} Confirm check-in complete</button>
    </div>`;
  main.querySelector('#print-receipt').addEventListener('click', async () => {
    await api.markReceiptPrinted(session.id);
    window.print();
    renderReceiptStep(main);
  });
  main.querySelector('#handed-tick').addEventListener('change', async (e) => {
    if (e.target.checked) await api.markReceiptHanded(session.id, false);
    renderReceiptStep(main);
  });
  main.querySelector('#digital-tick').addEventListener('change', async (e) => {
    if (e.target.checked) await api.markReceiptHanded(session.id, true);
    renderReceiptStep(main);
  });
  main.querySelector('#confirm-complete').addEventListener('click', async () => {
    try {
      const res = await api.completeCheckIn(session.id);
      if (!appEl) return;
      session = await api.getCheckinSession(session.id);
      toast(`Check-in complete for ${res.pilgrimName} — ${res.bagsCount} bags, ${fmtWeight(res.totalKg)}.`, 'success');
      renderStep();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* ===== Complete ===== */

function renderCompleteStep(main) {
  const appt = session.appointment;
  main.innerHTML = `
    <div class="state-block">
      ${icon('party-popper', 56)}
      <p class="fw-semibold">Check-in complete for ${esc(appt.pilgrimName)}</p>
      <div class="row gap-3 wrap" style="justify-content:center">
        <button type="button" class="btn btn-primary" id="next-pilgrim">${icon('arrow-right-circle', 18)} Next pilgrim</button>
        <button type="button" class="btn btn-secondary" id="load-cart">${icon('shopping-cart', 18)} Load bags to cart</button>
      </div>
    </div>`;
  main.querySelector('#next-pilgrim').addEventListener('click', () => { session = null; navigate('#/checkin'); load(); });
  main.querySelector('#load-cart').addEventListener('click', () => navigate('#/loading'));
}
