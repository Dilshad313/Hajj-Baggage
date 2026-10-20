/**
 * Mock REST API for the Check-in Staff console.
 * Every function is async, resolves after a realistic delay, and can be made
 * to reject via `?fail=1` in the URL or the one-shot demo "force fail" flag.
 * A real backend can replace this file without the UI code changing.
 */
import { getStore, saveStore, resetStore, setSession, getSession } from './store.js';

const GLOBAL_FAIL = new URLSearchParams(location.search).get('fail') === '1';

function randomDelay() { return 300 + Math.random() * 400; }

function ok(value) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const store = getStore();
      if (GLOBAL_FAIL || store.demoForceFail) {
        store.demoForceFail = false;
        saveStore();
        reject(new ApiError('Simulated failure — the server could not complete this request.'));
        return;
      }
      resolve(value);
    }, randomDelay());
  });
}

function fail(message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new ApiError(message)), randomDelay());
  });
}

export class ApiError extends Error {}

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Math.floor(Math.random() * 900000 + 100000)}`; }
function isToday(iso) { return new Date(iso).toDateString() === new Date().toDateString(); }

/* ===================== internal lookups ===================== */

function myStaff(store) {
  const session = getSession();
  if (!session) return null;
  return store.staff.find((s) => s.id === session.id) || null;
}

function findAppointment(store, id) { return store.appointments.find((a) => a.id === id); }
function findSession(store, id) { return store.checkinSessions.find((s) => s.id === id); }
function findCart(store, id) { return store.carts.find((c) => c.id === id); }
function findTruck(store, id) { return store.trucks.find((t) => t.id === id); }
function centreName(store, id) { return store.centres.find((c) => c.id === id)?.name || id; }

function myCentreId() {
  const session = getSession();
  return session?.centreId || null;
}

function activeSessionForMe(store) {
  const staff = myStaff(store);
  return store.checkinSessions.find((s) => s.staffId === staff?.id && s.status === 'active');
}

function logEvent(session, text, opts = {}) {
  session.events = session.events || [];
  session.events.push({ at: nowIso(), text, failed: !!opts.failed, manual: !!opts.manual });
}

function raiseException(store, opts) {
  const exc = {
    id: newId('EXC'), time: nowIso(), type: opts.type, severity: opts.severity || 'Medium',
    status: opts.status || 'Open', centreId: opts.centreId || myCentreId(),
    sessionId: opts.sessionId || null, appointmentId: opts.appointmentId || null,
    pilgrimName: opts.pilgrimName || null, notes: opts.notes || null,
    assignee: null, resolvedAt: opts.status === 'Resolved' ? nowIso() : null, resolutionNotes: null,
  };
  store.exceptions.unshift(exc);
  return exc;
}

/* ===================== AUTH ===================== */

/**
 * @param {string} employeeId @param {string} pin @param {string} centreId @param {number} counterNo @param {boolean} covering
 */
export async function staffLogin(employeeId, pin, centreId, counterNo, covering) {
  const store = getStore();
  const staff = store.staff.find((s) => s.employeeId.toLowerCase() === String(employeeId).toLowerCase());
  if (!staff || staff.pin !== pin) return fail('Invalid employee ID or PIN.');
  if (!centreId) return fail('Select a check-in centre.');
  const counter = Number(counterNo);
  if (!Number.isInteger(counter) || counter < 1 || counter > 10) return fail('Select a counter (1–10).');

  const inUse = store.shifts.find((sh) => !sh.endedAt && sh.centreId === centreId && sh.counterNo === counter && sh.staffId !== staff.id);
  if (inUse) {
    const otherStaff = store.staff.find((s) => s.id === inUse.staffId);
    return fail(`Counter ${counter} is in use by ${otherStaff?.name || 'another staff member'}.`);
  }

  if (centreId !== staff.homeCentre && !covering) {
    return fail(`You are assigned to ${centreName(store, staff.homeCentre)}. Check "covering another centre" to continue.`);
  }

  let shift = store.shifts.find((sh) => !sh.endedAt && sh.staffId === staff.id && sh.centreId === centreId && sh.counterNo === counter);
  if (!shift) {
    shift = { id: newId('SHIFT'), staffId: staff.id, centreId, counterNo: counter, startedAt: nowIso(), endedAt: null, coveringAnotherCentre: !!covering };
    store.shifts.push(shift);
  }
  const session = {
    id: staff.id, name: staff.name, employeeId: staff.employeeId, role: staff.role,
    centreId, centreName: centreName(store, centreId), counterNo: counter, shiftStartedAt: shift.startedAt,
  };
  setSession(session);
  saveStore();
  return ok(session);
}

export function logout() { setSession(null); }

/* ===================== DASHBOARD ===================== */

export async function getDashboard() {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  const centreId = myCentreId();
  const todays = store.appointments.filter((a) => a.centreId === centreId && isToday(a.slotAt));
  const bagsHere = store.bags.filter((b) => b.centreId === centreId);
  const checkedInToday = todays.filter((a) => a.status === 'Checked-in').length;
  const waiting = todays.filter((a) => a.status === 'Booked' || a.status === 'In Progress').length;
  const noShow = todays.filter((a) => a.status === 'No-show').length;
  const onHold = store.checkinSessions.filter((s) => s.centreId === centreId && s.status === 'on-hold').length;
  const tagged = bagsHere.filter((b) => b.status !== 'Declared');
  const totalKg = tagged.reduce((sum, b) => sum + (b.weightKg || 0), 0);
  const awaitingTruck = bagsHere.filter((b) => b.status === 'Tagged').length;
  const nextUp = todays
    .filter((a) => a.status === 'Booked')
    .sort((a, b) => new Date(a.slotAt) - new Date(b.slotAt))
    .slice(0, 5);
  const pendingHandover = store.handovers?.find((h) => h.centreId === centreId && !h.acknowledged && h.fromStaffId !== staff.id) || null;
  return ok({
    kpis: {
      appointments: todays.length, checkedIn: checkedInToday, waiting, noShow, onHold,
      bagsTagged: tagged.length, totalKg, bagsAwaitingTruck: awaitingTruck,
    },
    nextUp: clone(nextUp),
    pendingHandover: pendingHandover ? clone(pendingHandover) : null,
  });
}

export async function acknowledgeHandover(id) {
  const store = getStore();
  const h = (store.handovers || []).find((x) => x.id === id);
  if (!h) return fail('Handover note not found.');
  h.acknowledged = true;
  saveStore();
  return ok({ acknowledged: true });
}

/* ===================== APPOINTMENTS ===================== */

function appointmentRow(store, a) {
  const graceMs = store.config.noShowGraceMin * 60000;
  const overdue = a.status === 'Booked' && Date.now() - new Date(a.slotAt).getTime() > graceMs;
  return { ...clone(a), overdue, centreNameText: centreName(store, a.centreId) };
}

/** @param {{date?:'today'|'tomorrow'|'all', search?:string, status?:string}} filters */
export async function getAppointments(filters = {}) {
  const store = getStore();
  if (!myStaff(store)) return fail('Not authenticated.');
  const centreId = myCentreId();
  let rows = store.appointments.filter((a) => a.centreId === centreId);
  const date = filters.date || 'today';
  if (date === 'today') rows = rows.filter((a) => isToday(a.slotAt));
  else if (date === 'tomorrow') {
    const t = new Date(); t.setDate(t.getDate() + 1);
    rows = rows.filter((a) => new Date(a.slotAt).toDateString() === t.toDateString());
  }
  if (filters.status && filters.status !== 'All') rows = rows.filter((a) => a.status === filters.status);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter((a) => [a.pilgrimName, a.nusukId, a.passportNo, a.bookingCode].some((v) => String(v).toLowerCase().includes(q)));
  }
  rows.sort((a, b) => new Date(a.slotAt) - new Date(b.slotAt));
  return ok(rows.map((a) => appointmentRow(store, a)));
}

export async function markNoShow(id) {
  const store = getStore();
  const a = findAppointment(store, id);
  if (!a) return fail('Appointment not found.');
  if (a.status !== 'Booked') return fail('Only booked appointments can be marked no-show.');
  const graceMs = store.config.noShowGraceMin * 60000;
  if (Date.now() - new Date(a.slotAt).getTime() < graceMs) return fail(`Wait until ${store.config.noShowGraceMin} minutes after the slot time.`);
  a.status = 'No-show';
  saveStore();
  return ok(clone(a));
}

export async function reinstate(id) {
  const store = getStore();
  const a = findAppointment(store, id);
  if (!a) return fail('Appointment not found.');
  if (a.status !== 'No-show' && a.status !== 'Cancelled') return fail('Only a no-show or cancelled booking can be reinstated.');
  a.status = 'Booked';
  saveStore();
  return ok(clone(a));
}

/* ===================== QR / SEARCH / WALK-IN ===================== */

export async function findByBookingCode(code) {
  const store = getStore();
  const q = String(code || '').trim().toLowerCase();
  if (!q) return fail('Scan or type a booking code.');
  const appt = store.appointments.find((a) => a.bookingCode.toLowerCase() === q);
  if (!appt) return fail("QR not valid — try again or search by passport.");
  return ok({ appointmentId: appt.id });
}

export async function searchPassport(passport, nusukId) {
  const store = getStore();
  const p = String(passport || '').trim();
  if (!/^[A-Za-z0-9]{6,12}$/.test(p)) return fail('Passport must be 6–12 letters/digits.');
  if (nusukId && !/^\d{10}$/.test(String(nusukId).trim())) return fail('Nusuk ID must be 10 digits.');
  const appt = store.appointments.find((a) => a.passportNo.toLowerCase() === p.toLowerCase() && (!nusukId || a.nusukId === String(nusukId).trim()));
  if (!appt) return ok({ found: false });
  return ok({ found: true, appointmentId: appt.id });
}

export async function reportPilgrimNotFound({ passportNo, statedName, flightCode, note }) {
  const store = getStore();
  if (!statedName || !statedName.trim()) return fail("The pilgrim's stated name is required.");
  if (!note || note.trim().length < 5 || note.trim().length > 300) return fail('Notes must be 5–300 characters.');
  raiseException(store, {
    type: 'Pilgrim Not Found', severity: 'Medium', pilgrimName: statedName.trim(),
    notes: `Passport ${passportNo || '—'}, flight ${flightCode || '—'}: ${note.trim()}`,
  });
  saveStore();
  return ok({ reported: true });
}

export async function createWalkIn(data) {
  const store = getStore();
  const name = String(data.name || '').trim();
  const passportNo = String(data.passportNo || '').trim();
  const nationality = String(data.nationality || '').trim();
  const flightCode = data.flightCode;
  const declaredBags = Number(data.declaredBags);
  if (name.length < 3) return fail("The pilgrim's name is required.");
  if (!/^[A-Za-z0-9]{6,12}$/.test(passportNo)) return fail('Passport must be 6–12 letters/digits.');
  if (!nationality) return fail('Nationality is required.');
  if (!store.flights.some((f) => f.code === flightCode)) return fail('Select a flight.');
  if (!Number.isInteger(declaredBags) || declaredBags < 1 || declaredBags > store.config.maxBags) return fail(`Declared bags must be 1–${store.config.maxBags}.`);
  const nusukId = String(data.nusukId || '').trim() || `WI${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  const id = newId('APT');
  const bookingCode = `WALKIN${Math.floor(1000 + Math.random() * 8999)}`;
  store.appointments.push({
    id, pilgrimName: name, nationality, nusukId, passportNo, phone: data.phone || '', flightCode,
    declaredBags, slotAt: nowIso(), centreId: myCentreId(), status: 'Booked', bookingCode,
  });
  store.nusukRecords.push({ nusukId, name, passportNo, nationality, flightCode, visaStatus: 'valid' });
  saveStore();
  return ok({ appointmentId: id });
}

/* ===================== SESSION ===================== */

function buildBags(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: newId('BAG'), seq: i + 1, extra: false, status: 'pending-weigh',
    weight: null, weighAccepted: false, overweightRepackCount: 0,
    tagNumber: null, printed: false, attached: false, verifyAttempts: 0, manualEntries: 0, logged: false,
    events: [],
  }));
}

function hydrateSession(store, session) {
  const appt = findAppointment(store, session.appointmentId);
  return { ...clone(session), appointment: appt ? clone(appt) : null };
}

/** @param {string} appointmentId @param {{supervisorPin?:string, overrideDate?:boolean}} [opts] */
export async function startSession(appointmentId, opts = {}) {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  const appt = findAppointment(store, appointmentId);
  if (!appt) return fail('Appointment not found.');

  const existing = store.checkinSessions.find((s) => s.appointmentId === appointmentId && (s.status === 'active' || s.status === 'on-hold'));
  if (existing) {
    if (existing.status === 'on-hold') return fail('This check-in is on hold pending supervisor review.');
    return ok({ status: 'created', session: hydrateSession(store, existing) });
  }

  const myActive = activeSessionForMe(store);
  if (myActive && myActive.appointmentId !== appointmentId) {
    const other = findAppointment(store, myActive.appointmentId);
    return fail(`Finish ${other?.pilgrimName || 'the current pilgrim'}'s check-in first.`);
  }

  if (appt.status === 'Cancelled') return ok({ status: 'blocked', reason: 'cancelled', appointment: clone(appt) });
  if (appt.status === 'Checked-in') {
    const s = store.checkinSessions.find((x) => x.appointmentId === appointmentId && x.status === 'completed');
    return ok({ status: 'already-checked-in', appointment: clone(appt), sessionId: s?.id || null });
  }
  if (appt.status === 'No-show') return ok({ status: 'no-show', appointment: clone(appt) });

  const flight = store.flights.find((f) => f.code === appt.flightCode);
  if (flight?.closed) return ok({ status: 'blocked', reason: 'flight-closed', appointment: clone(appt) });

  const wrongCentre = appt.centreId !== myCentreId();
  if (wrongCentre && !opts.supervisorPin) return ok({ status: 'needs-centre-override', appointment: clone(appt) });
  if (wrongCentre && opts.supervisorPin && opts.supervisorPin !== store.config.supervisorPin) return fail('Incorrect supervisor PIN.');

  const otherDate = !isToday(appt.slotAt);
  if (otherDate && !opts.overrideDate) return ok({ status: 'needs-date-override', appointment: clone(appt) });

  appt.status = 'In Progress';
  const session = {
    id: newId('SESS'), appointmentId, status: 'active', step: 'identity',
    staffId: staff.id, centreId: myCentreId(),
    identity: { ticks: { photo: false, document: false, name: false }, verifiedAt: null, mismatchReason: null },
    nusuk: { checked: false, result: null, mismatchFields: [], checkedAt: null },
    bags: buildBags(appt.declaredBags), currentBagIndex: 0,
    receipt: { receiptNo: null, printed: false, handed: false, digital: false, generatedAt: null },
    exceptionIds: [], createdAt: nowIso(), completedAt: null, cancelledAt: null, cancelReason: null,
    events: [{ at: nowIso(), text: 'Pilgrim QR scanned.' }],
  };
  if (wrongCentre) {
    raiseException(store, {
      type: 'Wrong Centre', severity: 'Medium', status: 'Resolved', sessionId: session.id, appointmentId: appt.id,
      pilgrimName: appt.pilgrimName, notes: `Supervisor override at ${centreName(store, myCentreId())} (booked at ${centreName(store, appt.centreId)}).`,
    });
  }
  store.checkinSessions.push(session);
  saveStore();
  return ok({ status: 'created', session: hydrateSession(store, session) });
}

export async function getCheckinSession(sessionId) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  return ok(hydrateSession(store, session));
}

/** @returns {object|null} this staff's open (active or on-hold) session, if any */
/**
 * The session that should automatically reclaim the counter screen. Only
 * 'active' sessions qualify — an 'on-hold' one releases the counter back to
 * the QR scan screen ("Contact supervisor → On hold → back to QR") and only
 * reappears once a supervisor resumes it (which flips it back to 'active').
 */
export async function getMySession() {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  const session = activeSessionForMe(store);
  return ok(session ? hydrateSession(store, session) : null);
}

export async function cancelSession(sessionId, reason) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const appt = findAppointment(store, session.appointmentId);
  session.status = 'cancelled';
  session.cancelledAt = nowIso();
  session.cancelReason = reason || null;
  if (appt) appt.status = 'Booked';
  saveStore();
  return ok({ cancelled: true });
}

/* ===== Identity ===== */

export async function verifyIdentity(sessionId, ticks) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  if (!ticks.photo || !ticks.document || !ticks.name) return fail('All three identity checks are required.');
  session.identity = { ticks: clone(ticks), verifiedAt: nowIso(), mismatchReason: null };
  session.step = 'nusuk';
  logEvent(session, 'Identity verified.');
  saveStore();
  return ok(hydrateSession(store, session));
}

export async function reportIdentityMismatch(sessionId, { pin, reason, notes }) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const appt = findAppointment(store, session.appointmentId);
  if (pin !== store.config.supervisorPin) return fail('Incorrect supervisor PIN.');
  if (!reason) return fail('A reason is required.');
  if (!notes || notes.trim().length < 5 || notes.trim().length > 300) return fail('Notes must be 5–300 characters.');
  session.status = 'on-hold';
  session.identity.mismatchReason = reason;
  if (appt) appt.status = 'On Hold';
  const exc = raiseException(store, {
    type: 'Data Mismatch', severity: 'High', sessionId, appointmentId: session.appointmentId,
    pilgrimName: appt?.pilgrimName, notes: `Identity does not match — ${reason}: ${notes.trim()}`,
  });
  session.exceptionIds.push(exc.id);
  logEvent(session, 'Identity mismatch reported — on hold.', { failed: true });
  saveStore();
  return ok({ onHold: true });
}

/** Back is allowed only before the Bags step. @param {string} sessionId */
export async function goBackToIdentity(sessionId) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  if (session.step !== 'nusuk') return fail('Cannot go back from this step.');
  session.step = 'identity';
  saveStore();
  return ok(hydrateSession(store, session));
}

/* ===== Nusuk ===== */

function compareRows(appt, nusuk) {
  const rows = [
    { field: 'name', label: 'Name', rabel: appt.pilgrimName, nusuk: nusuk.name },
    { field: 'passport', label: 'Passport no.', rabel: appt.passportNo, nusuk: nusuk.passportNo },
    { field: 'nationality', label: 'Nationality', rabel: appt.nationality, nusuk: nusuk.nationality },
    { field: 'flight', label: 'Flight', rabel: appt.flightCode, nusuk: nusuk.flightCode },
  ];
  return rows.map((r) => ({ ...r, match: r.rabel === r.nusuk }));
}

export async function checkNusuk(sessionId) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const appt = findAppointment(store, session.appointmentId);
  const nusuk = store.nusukRecords.find((n) => n.nusukId === appt.nusukId);
  const compare = compareRows(appt, nusuk);
  const mismatchFields = compare.filter((r) => !r.match).map((r) => r.field);
  if (nusuk.visaStatus === 'expired') mismatchFields.push('visa');
  session.nusuk = { checked: true, result: mismatchFields.length ? 'mismatch' : 'match', mismatchFields, checkedAt: nowIso() };

  if (mismatchFields.length) {
    session.status = 'on-hold';
    appt.status = 'On Hold';
    const severity = mismatchFields.includes('visa') ? 'Critical' : 'High';
    const label = mismatchFields.includes('visa') ? 'Visa expired' : `Data mismatch: ${mismatchFields.join(', ')}`;
    const exc = raiseException(store, {
      type: 'Data Mismatch', severity, sessionId, appointmentId: appt.id, pilgrimName: appt.pilgrimName,
      notes: label,
    });
    session.exceptionIds.push(exc.id);
    logEvent(session, `Nusuk check failed — ${label}.`, { failed: true });
    saveStore();
    return ok({ result: 'mismatch', mismatchFields, compare, visaExpired: nusuk.visaStatus === 'expired' });
  }
  logEvent(session, 'Nusuk check passed.');
  saveStore();
  return ok({ result: 'match', mismatchFields: [], compare, visaExpired: false });
}

/** Advances to the Bags step once the staff has acknowledged a Nusuk match. */
export async function confirmNusukContinue(sessionId) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  if (session.nusuk.result !== 'match') return fail('Nusuk verification has not passed yet.');
  session.step = 'bags';
  saveStore();
  return ok(hydrateSession(store, session));
}

/* ===== Bags: weigh ===== */

export async function simulateScaleReading(sessionId, bagIndex) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  let reading;
  if (store.demoForceOverweight) {
    reading = 24 + Math.round(Math.random() * 30) / 10;
    store.demoForceOverweight = false;
  } else {
    reading = Math.round((14 + Math.random() * 10) * 10) / 10;
  }
  saveStore();
  return ok({ weight: reading });
}

export async function acceptWeight(sessionId, bagIndex, weight) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  const w = Number(weight);
  if (!Number.isFinite(w) || w < store.config.scaleMin || w > store.config.scaleMax) return fail('Check the scale reading.');
  bag.weight = w;
  if (w > store.config.maxBagKg) {
    bag.status = 'overweight';
    logEvent(session, `Bag ${bag.seq} overweight at ${w.toFixed(1)} kg.`, { failed: true });
    saveStore();
    return ok({ accepted: false, overweight: true, weight: w });
  }
  bag.weighAccepted = true;
  bag.status = 'weighed';
  logEvent(session, `Bag ${bag.seq} weighed — ${w.toFixed(1)} kg.`);
  saveStore();
  return ok({ accepted: true, overweight: false, weight: w });
}

export async function repackBag(sessionId, bagIndex) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  bag.overweightRepackCount += 1;
  bag.status = 'pending-weigh';
  bag.weight = null;
  bag.weighAccepted = false;
  saveStore();
  return ok({ repackCount: bag.overweightRepackCount });
}

export async function bagNotPresented(sessionId, bagIndex) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  bag.status = 'not-presented';
  logEvent(session, `Bag ${bag.seq} not presented.`);
  saveStore();
  return ok(hydrateSession(store, session));
}

export async function addExtraBag(sessionId) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const appt = findAppointment(store, session.appointmentId);
  const bag = { id: newId('BAG'), seq: session.bags.length + 1, extra: true, status: 'pending-weigh', weight: null, weighAccepted: false, overweightRepackCount: 0, tagNumber: null, printed: false, attached: false, verifyAttempts: 0, manualEntries: 0, logged: false, events: [] };
  session.bags.push(bag);
  const exc = raiseException(store, {
    type: 'Extra Bag', severity: 'Low', status: 'Resolved', sessionId, appointmentId: appt.id,
    pilgrimName: appt.pilgrimName, notes: `Extra bag added beyond the ${appt.declaredBags} declared.`,
  });
  session.exceptionIds.push(exc.id);
  logEvent(session, `Extra bag added (bag ${bag.seq}).`);
  saveStore();
  return ok(hydrateSession(store, session));
}

/* ===== Bags: tag / verify / log ===== */

export async function generateTag(sessionId, bagIndex) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  if (!bag.tagNumber) bag.tagNumber = `RBTAG-${session.appointmentId}-${bag.seq}`;
  bag.status = 'tagged';
  logEvent(session, `Bag ${bag.seq} tag generated — ${bag.tagNumber}.`);
  saveStore();
  return ok({ tagNumber: bag.tagNumber });
}

export async function markPrinted(sessionId, bagIndex) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  bag.printed = true;
  bag.status = 'printed';
  logEvent(session, `Bag ${bag.seq} tag printed.`);
  saveStore();
  return ok({ printed: true });
}

export async function markAttached(sessionId, bagIndex) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  bag.attached = true;
  saveStore();
  return ok({ attached: true });
}

export async function verifyTag(sessionId, bagIndex, scannedCode, opts = {}) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  const code = String(scannedCode || '').trim();
  if (code.toUpperCase() !== bag.tagNumber.toUpperCase()) {
    bag.verifyAttempts += 1;
    if (opts.manual) bag.manualEntries += 1;
    logEvent(session, `Bag ${bag.seq} tag verify failed.`, { failed: true, manual: !!opts.manual });
    saveStore();
    return fail('Tag number does not match.');
  }
  bag.verifyAttempts += 1;
  bag.status = 'verified';
  logEvent(session, `Bag ${bag.seq} tag verified.`, { manual: !!opts.manual });
  saveStore();
  return ok({ verified: true });
}

export async function reprintTag(sessionId, bagIndex) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  bag.manualEntries = 0;
  bag.printed = false;
  bag.status = 'tagged';
  logEvent(session, `Bag ${bag.seq} tag reprinted after failed verification attempts.`);
  saveStore();
  return ok(hydrateSession(store, session));
}

export async function logBag(sessionId, bagIndex) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  const bag = session.bags[bagIndex];
  if (!bag) return fail('Bag not found.');
  if (bag.status !== 'verified') return fail('Scan the tag before logging this bag.');
  bag.logged = true;
  bag.status = 'logged';
  logEvent(session, `Bag ${bag.seq} logged in system.`);
  const relevant = session.bags.filter((b) => b.status !== 'not-presented');
  const nextIndex = session.bags.findIndex((b, i) => i > bagIndex && b.status !== 'not-presented' && b.status !== 'logged');
  const allLogged = relevant.length > 0 && relevant.every((b) => b.logged);
  if (allLogged) session.step = 'receipt';
  session.currentBagIndex = nextIndex >= 0 ? nextIndex : session.currentBagIndex;
  saveStore();
  return ok({ allLogged, nextBagIndex: session.currentBagIndex, session: hydrateSession(store, session) });
}

/* ===== Receipt ===== */

export async function getReceipt(sessionId) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  if (!session.receipt.receiptNo) {
    session.receipt.receiptNo = `RCPT-${session.appointmentId}`;
    session.receipt.generatedAt = nowIso();
    saveStore();
  }
  const appt = findAppointment(store, session.appointmentId);
  const bags = session.bags.filter((b) => b.status === 'logged');
  return ok({
    receiptNo: session.receipt.receiptNo, printed: session.receipt.printed, handed: session.receipt.handed, digital: session.receipt.digital,
    centreName: centreName(store, session.centreId), counterNo: getSession()?.counterNo, staffName: getSession()?.name,
    pilgrimName: appt.pilgrimName, passportMasked: `••••${appt.passportNo.slice(-4)}`,
    bags: clone(bags), totalKg: bags.reduce((sum, b) => sum + (b.weight || 0), 0),
  });
}

export async function markReceiptPrinted(sessionId) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  session.receipt.printed = true;
  saveStore();
  return ok({ printed: true });
}

export async function markReceiptHanded(sessionId, digital) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  if (digital) session.receipt.digital = true;
  else session.receipt.handed = true;
  saveStore();
  return ok({ handed: session.receipt.handed, digital: session.receipt.digital });
}

export async function completeCheckIn(sessionId) {
  const store = getStore();
  const session = findSession(store, sessionId);
  if (!session) return fail('Check-in session not found.');
  if (!session.receipt.printed || !(session.receipt.handed || session.receipt.digital)) {
    return fail('Print the receipt and hand it to the pilgrim (or mark it digital) first.');
  }
  const appt = findAppointment(store, session.appointmentId);
  appt.status = 'Checked-in';
  session.status = 'completed';
  session.step = 'complete';
  session.completedAt = nowIso();
  logEvent(session, `Check-in complete — ${session.bags.filter((b) => b.logged).length} bags.`);

  const loggedBags = session.bags.filter((b) => b.logged);
  for (const bag of loggedBags) {
    store.bags.push({
      id: bag.id, appointmentId: appt.id, sessionId: session.id, centreId: session.centreId, flightCode: appt.flightCode,
      pilgrimName: appt.pilgrimName, tagNumber: bag.tagNumber, weightKg: bag.weight, status: 'Tagged', cartId: null, truckId: null,
      timeline: clone(bag.events),
    });
  }
  const totalKg = loggedBags.reduce((sum, b) => sum + (b.weight || 0), 0);
  store.checkinHistory.unshift({
    sessionId: session.id, appointmentId: appt.id, pilgrimName: appt.pilgrimName, passportNo: appt.passportNo,
    bookingCode: appt.bookingCode, completedAt: session.completedAt, bagsCount: loggedBags.length, totalKg,
    receiptNo: session.receipt.receiptNo, centreId: session.centreId, tagNumbers: loggedBags.map((b) => b.tagNumber),
  });
  saveStore();
  return ok({ pilgrimName: appt.pilgrimName, bagsCount: loggedBags.length, totalKg, receiptNo: session.receipt.receiptNo });
}

/* ===================== EXCEPTIONS / SUPERVISOR ===================== */

export async function getExceptions(filters = {}) {
  const store = getStore();
  const centreId = myCentreId();
  let rows = store.exceptions.filter((e) => e.centreId === centreId);
  if (filters.status && filters.status !== 'All') rows = rows.filter((e) => e.status === filters.status);
  return ok(clone(rows));
}

export async function getException(id) {
  const store = getStore();
  const exc = store.exceptions.find((e) => e.id === id);
  if (!exc) return fail('Exception not found.');
  const session = exc.sessionId ? findSession(store, exc.sessionId) : null;
  return ok({ ...clone(exc), session: session ? hydrateSession(store, session) : null });
}

export async function assignToMe(id) {
  const store = getStore();
  const staff = myStaff(store);
  const exc = store.exceptions.find((e) => e.id === id);
  if (!exc) return fail('Exception not found.');
  exc.assignee = staff.id;
  if (exc.status === 'Open') exc.status = 'Assigned';
  saveStore();
  return ok(clone(exc));
}

export async function resolveException(id, notes) {
  const store = getStore();
  const exc = store.exceptions.find((e) => e.id === id);
  if (!exc) return fail('Exception not found.');
  if (!notes || notes.trim().length < 5 || notes.trim().length > 300) return fail('Resolution notes must be 5–300 characters.');
  exc.status = 'Resolved';
  exc.resolvedAt = nowIso();
  exc.resolutionNotes = notes.trim();
  saveStore();
  return ok(clone(exc));
}

/** Supervisor PIN-gated resolution that also resumes a linked on-hold session. */
export async function supervisorApprove(id, { pin, notes }) {
  const store = getStore();
  const exc = store.exceptions.find((e) => e.id === id);
  if (!exc) return fail('Exception not found.');
  if (pin !== store.config.supervisorPin) return fail('Incorrect supervisor PIN.');
  if (!notes || notes.trim().length < 5 || notes.trim().length > 300) return fail('Resolution notes must be 5–300 characters.');
  exc.status = 'Resolved';
  exc.resolvedAt = nowIso();
  exc.resolutionNotes = notes.trim();

  let resumedSessionId = null;
  if (exc.sessionId) {
    const session = findSession(store, exc.sessionId);
    if (session && session.status === 'on-hold') {
      session.status = 'active';
      const appt = findAppointment(store, session.appointmentId);
      if (appt) appt.status = 'In Progress';
      if (exc.type === 'Data Mismatch' && session.identity.mismatchReason) session.step = 'identity';
      else if (exc.type === 'Data Mismatch') { session.nusuk.result = 'override'; session.step = 'bags'; }
      logEvent(session, `Supervisor override — ${exc.type} resolved.`);
      resumedSessionId = session.id;
    }
  }
  saveStore();
  return ok({ resolved: true, resumedSessionId });
}

/* ===================== LOADING: CARTS ===================== */

function hydrateCart(store, cart) {
  const bags = store.bags.filter((b) => cart.bagIds.includes(b.id));
  return { ...clone(cart), bags: clone(bags), weightKg: bags.reduce((sum, b) => sum + (b.weightKg || 0), 0) };
}

export async function getCarts() {
  const store = getStore();
  const centreId = myCentreId();
  return ok(store.carts.filter((c) => c.centreId === centreId).map((c) => hydrateCart(store, c)));
}

export async function getBagsAwaitingCart(flightCode) {
  const store = getStore();
  const centreId = myCentreId();
  let rows = store.bags.filter((b) => b.centreId === centreId && b.status === 'Tagged' && !b.cartId);
  if (flightCode) rows = rows.filter((b) => b.flightCode === flightCode);
  return ok(clone(rows));
}

export async function confirmCartScan(cartId, scannedCode) {
  const store = getStore();
  const cart = findCart(store, cartId);
  if (!cart) return fail('Cart not found.');
  if (String(scannedCode || '').trim().toUpperCase() !== cart.id.toUpperCase()) return fail(`That QR doesn't match ${cart.id}.`);
  return ok(hydrateCart(store, cart));
}

export async function scanBagIntoCart(cartId, scannedTag) {
  const store = getStore();
  const cart = findCart(store, cartId);
  if (!cart) return fail('Cart not found.');
  const tag = String(scannedTag || '').trim();
  const bag = store.bags.find((b) => b.tagNumber.toLowerCase() === tag.toLowerCase());
  if (!bag) return fail('This bag is not tagged yet.');
  if (bag.centreId !== cart.centreId) return fail(`${bag.tagNumber} belongs to a different centre.`);
  if (bag.cartId && bag.cartId !== cartId) return fail(`${bag.tagNumber} is already in cart ${bag.cartId}.`);
  if (bag.cartId === cartId) return fail(`${bag.tagNumber} is already in this cart.`);
  bag.cartId = cartId;
  cart.bagIds.push(bag.id);
  saveStore();
  return ok({ bag: clone(bag), cart: hydrateCart(store, cart) });
}

export async function removeBagFromCart(cartId, bagId) {
  const store = getStore();
  const cart = findCart(store, cartId);
  if (!cart) return fail('Cart not found.');
  const bag = store.bags.find((b) => b.id === bagId);
  if (bag) bag.cartId = null;
  cart.bagIds = cart.bagIds.filter((id) => id !== bagId);
  saveStore();
  return ok(hydrateCart(store, cart));
}

export async function closeCart(cartId) {
  const store = getStore();
  const cart = findCart(store, cartId);
  if (!cart) return fail('Cart not found.');
  if (!cart.bagIds.length) return fail('The cart must contain at least one bag.');
  cart.status = 'Closed';
  saveStore();
  return ok(hydrateCart(store, cart));
}

export async function reopenCart(cartId) {
  const store = getStore();
  const cart = findCart(store, cartId);
  if (!cart) return fail('Cart not found.');
  cart.status = 'Open';
  saveStore();
  return ok(hydrateCart(store, cart));
}

/* ===================== LOADING: TRUCKS ===================== */

export async function getTrucks() {
  const store = getStore();
  return ok(store.trucks.map((t) => ({ ...clone(t), bagsCount: t.bagIds.length })));
}

export async function confirmTruckScan(truckId, scannedCode) {
  const store = getStore();
  const truck = findTruck(store, truckId);
  if (!truck) return fail('Truck not found.');
  if (String(scannedCode || '').trim().toUpperCase() !== truck.id.toUpperCase()) return fail(`That QR doesn't match ${truck.id}.`);
  if (truck.status === 'Out of Service') return fail(`${truck.id} is out of service.`);
  return ok(clone(truck));
}

export async function scanIntoTruck(truckId, scannedCode) {
  const store = getStore();
  const truck = findTruck(store, truckId);
  if (!truck) return fail('Truck not found.');
  const code = String(scannedCode || '').trim();
  const cart = store.carts.find((c) => c.id.toLowerCase() === code.toLowerCase());
  if (cart) {
    if (!cart.bagIds.length) return fail(`${cart.id} has no bags to load.`);
    if (cart.truckId) return fail(`${cart.id} is already loaded onto ${cart.truckId}.`);
    for (const bagId of cart.bagIds) {
      const bag = store.bags.find((b) => b.id === bagId);
      if (bag) { bag.truckId = truckId; truck.bagIds.push(bag.id); }
    }
    cart.status = 'Loaded';
    cart.truckId = truckId;
    truck.cartIds.push(cart.id);
    saveStore();
    return ok({ type: 'cart', cartId: cart.id, bagsAdded: cart.bagIds.length });
  }
  const bag = store.bags.find((b) => b.tagNumber.toLowerCase() === code.toLowerCase());
  if (bag) {
    if (bag.truckId) return fail(`${bag.tagNumber} is already loaded onto ${bag.truckId}.`);
    bag.truckId = truckId;
    truck.bagIds.push(bag.id);
    saveStore();
    return ok({ type: 'bag', bagId: bag.id, bagsAdded: 1 });
  }
  return fail('Unrecognised cart or bag code.');
}

export async function setDriverName(truckId, name) {
  const store = getStore();
  const truck = findTruck(store, truckId);
  if (!truck) return fail('Truck not found.');
  const n = String(name || '').trim();
  if (n.length < 3 || n.length > 60) return fail('Driver name must be 3–60 characters.');
  truck.driverName = n;
  saveStore();
  return ok({ driverName: n });
}

export async function completeTruckLoad(truckId, scannedCode) {
  const store = getStore();
  const truck = findTruck(store, truckId);
  if (!truck) return fail('Truck not found.');
  if (String(scannedCode || '').trim().toUpperCase() !== truck.id.toUpperCase()) return fail(`That QR doesn't match ${truck.id}.`);
  if (!truck.driverName) return fail('Driver name is required.');
  if (!truck.bagIds.length) return fail('Load at least one bag before completing.');
  const groupsMap = {};
  for (const bagId of truck.bagIds) {
    const bag = store.bags.find((b) => b.id === bagId);
    if (!bag) continue;
    bag.status = 'Loaded to Collection Truck';
    groupsMap[bag.flightCode] = groupsMap[bag.flightCode] || [];
    groupsMap[bag.flightCode].push(bag.tagNumber);
  }
  truck.loadedAt = nowIso();
  const manifest = {
    id: newId('MAN'), truckId, driverName: truck.driverName, time: truck.loadedAt, centreId: myCentreId(),
    groups: Object.entries(groupsMap).map(([flightCode, tags]) => ({ flightCode, bagCount: tags.length, tags })),
  };
  store.manifests.push(manifest);
  truck.manifestId = manifest.id;
  saveStore();
  return ok({ manifest: clone(manifest) });
}

export async function getManifest(id) {
  const store = getStore();
  const m = store.manifests.find((x) => x.id === id);
  if (!m) return fail('Manifest not found.');
  return ok(clone(m));
}

/* ===================== HISTORY ===================== */

export async function getHistory(filters = {}) {
  const store = getStore();
  const centreId = myCentreId();
  let rows = store.checkinHistory.filter((h) => h.centreId === centreId);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    rows = rows.filter((h) => [h.pilgrimName, h.passportNo, h.bookingCode, h.receiptNo].some((v) => String(v).toLowerCase().includes(q)));
  }
  return ok(clone(rows));
}

export async function getBagTimeline(tagNumber) {
  const store = getStore();
  const bag = store.bags.find((b) => b.tagNumber === tagNumber);
  if (!bag) return fail('Bag not found.');
  return ok({ bag: clone(bag), timeline: clone(bag.timeline || []) });
}

/* ===================== NOTIFICATIONS ===================== */

export async function getNotifications() {
  const store = getStore();
  return ok(clone(store.notifications));
}

export async function markRead(id) {
  const store = getStore();
  if (id === 'all') store.notifications.forEach((n) => { n.unread = false; });
  else { const n = store.notifications.find((x) => x.id === id); if (n) n.unread = false; }
  saveStore();
  return ok(clone(store.notifications));
}

/* ===================== HANDOVER ===================== */

export async function submitHandover({ notes, handoverTo, informedNextShift }) {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  if (!notes || notes.trim().length < 10 || notes.trim().length > 1000) return fail('Handover notes must be 10–1000 characters.');
  if (!handoverTo || !handoverTo.trim()) return fail('Select who you are handing over to.');
  const openSession = store.checkinSessions.find((s) => s.staffId === staff.id && (s.status === 'active' || s.status === 'on-hold'));
  if (openSession) return fail('Complete or escalate the open check-in before handing over.');
  const centreId = myCentreId();
  const awaitingTruck = store.bags.filter((b) => b.centreId === centreId && b.status === 'Tagged').length;
  if (awaitingTruck > 0 && !informedNextShift) {
    return fail('Confirm you have informed the next shift about bags still awaiting the truck.');
  }
  const summary = await summarizeShift(store, centreId);
  store.handovers = store.handovers || [];
  store.handovers.push({
    id: newId('HO'), fromStaffId: staff.id, centreId, counterNo: getSession()?.counterNo,
    notes: notes.trim(), handoverTo: handoverTo.trim(), submittedAt: nowIso(), acknowledged: false, summary,
  });
  const shift = store.shifts.find((sh) => !sh.endedAt && sh.staffId === staff.id && sh.centreId === centreId);
  if (shift) shift.endedAt = nowIso();
  saveStore();
  return ok({ submitted: true });
}

async function summarizeShift(store, centreId) {
  const todays = store.appointments.filter((a) => a.centreId === centreId && isToday(a.slotAt));
  const bagsHere = store.bags.filter((b) => b.centreId === centreId);
  const totalKg = bagsHere.reduce((sum, b) => sum + (b.weightKg || 0), 0);
  const overweightEvents = store.checkinSessions.filter((s) => s.centreId === centreId).reduce((sum, s) => sum + s.bags.filter((b) => b.overweightRepackCount > 0).length, 0);
  const openExceptions = store.exceptions.filter((e) => e.centreId === centreId && e.status !== 'Resolved' && e.status !== 'Closed').length;
  const trucksToday = store.trucks.filter((t) => t.loadedAt && isToday(t.loadedAt)).length;
  const awaitingTruck = bagsHere.filter((b) => b.status === 'Tagged').length;
  const openSessions = store.checkinSessions.filter((s) => s.centreId === centreId && (s.status === 'active' || s.status === 'on-hold')).length;
  return {
    pilgrims: todays.filter((a) => a.status === 'Checked-in').length, bags: bagsHere.length, totalKg,
    overweightEvents, exceptions: openExceptions, trucksLoaded: trucksToday, awaitingTruck, openSessions,
  };
}

export async function getHandoverSummary() {
  const store = getStore();
  if (!myStaff(store)) return fail('Not authenticated.');
  const centreId = myCentreId();
  const summary = await summarizeShift(store, centreId);
  const blockingSession = store.checkinSessions.find((s) => s.staffId === myStaff(store).id && (s.status === 'active' || s.status === 'on-hold'));
  return ok({ summary, blocked: !!blockingSession, blockingAppointmentId: blockingSession?.appointmentId || null });
}

/* ===================== DEMO MENU ===================== */

export async function demoForceOverweight() {
  const store = getStore();
  store.demoForceOverweight = true;
  saveStore();
  return ok({ forced: true });
}

export async function demoCreateTestBooking() {
  const store = getStore();
  const names = ['Hadi Santoso', 'Maryam Al-Sayed', 'Bakr Youssef', 'Noor Fatima'];
  const name = names[Math.floor(Math.random() * names.length)];
  const id = newId('APT');
  const bookingCode = `DEMO${Math.floor(1000 + Math.random() * 8999)}`;
  const nusukId = `${Math.floor(1000000000 + Math.random() * 8999999999)}`;
  const passportNo = `DM${Math.floor(100000 + Math.random() * 899999)}`;
  store.appointments.push({
    id, pilgrimName: name, nationality: 'Indonesian', nusukId, passportNo, phone: '+966500000000',
    flightCode: 'SV 1821', declaredBags: 1, slotAt: nowIso(), centreId: myCentreId(), status: 'Booked', bookingCode,
  });
  store.nusukRecords.push({ nusukId, name, passportNo, nationality: 'Indonesian', flightCode: 'SV 1821', visaStatus: 'valid' });
  saveStore();
  return ok({ appointmentId: id });
}

export function demoReset() { resetStore(); }
