/**
 * Mock REST API for the Airline / Ground Handler console.
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

function fail(message, code) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new ApiError(message, code)), randomDelay());
  });
}

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code || null; }
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`; }

/* ===================== internal lookups ===================== */

function myStaff(store) {
  const session = getSession();
  if (!session) return null;
  return store.staff.find((s) => s.id === session.id) || null;
}

function isVisibleFlight(staff, flight) {
  return !!flight && (staff?.scope === 'all' || flight.airline === staff?.airline);
}

function findFlight(store, code) { return store.flights.find((f) => f.code === code); }
function findBatch(store, id) { return store.batches.find((b) => b.id === id); }
function findBagById(store, id) { return store.bags.find((b) => b.id === id); }
function findBagByTag(store, tag) {
  const q = String(tag).trim().toLowerCase();
  return store.bags.find((b) => b.tagNumber.toLowerCase() === q || b.airlineTagNumber.toLowerCase() === q);
}
function findPilgrim(store, id) { return store.pilgrims.find((p) => p.id === id); }
function findUld(store, id) { return store.ulds.find((u) => u.id === id || u.code === id); }
function activeBsmForBag(store, bag) {
  return store.bsms.find((m) => m.active && m.airlineTag === bag.airlineTagNumber);
}
function hydrateBag(store, b) {
  return { ...clone(b), pilgrimName: findPilgrim(store, b.pilgrimId)?.name || '', pilgrimPnr: findPilgrim(store, b.pilgrimId)?.pnr || '' };
}
function cutoffAt(store, flight) {
  return new Date(flight.std).getTime() - store.config.cutoffMinutesBeforeStd * 60000;
}

function ensureException(store, { type, severity, batchId, bagId, flightCode, note }) {
  const exc = {
    id: newId('EXC'), time: nowIso(), type, severity, status: 'Open',
    batchId: batchId || null, bagId: bagId || null, flightCode: flightCode || null,
    notes: note ? [{ at: nowIso(), text: note }] : [], escalated: false,
    resolutionOutcome: null, resolvedAt: null,
  };
  store.exceptions.unshift(exc);
  return exc;
}

function resolveBagException(store, bagId, outcome) {
  const exc = store.exceptions.find((e) => e.bagId === bagId && !['Resolved', 'Closed'].includes(e.status));
  if (exc) { exc.status = 'Resolved'; exc.resolutionOutcome = outcome; exc.resolvedAt = nowIso(); }
}

/* ===================== AUTH ===================== */

/** @param {string} employeeId @param {string} pin */
export async function login(employeeId, pin) {
  const store = getStore();
  const staff = store.staff.find((s) => s.employeeId.toLowerCase() === String(employeeId).toLowerCase());
  if (!staff || staff.pin !== pin) return fail('Invalid employee ID or PIN.');
  const session = {
    id: staff.id, name: staff.name, employeeId: staff.employeeId,
    airline: staff.airline, airlineName: staff.airlineName, scope: staff.scope, shiftStartedAt: nowIso(),
  };
  setSession(session);
  saveStore();
  return ok(session);
}

export async function getMe() {
  const session = getSession();
  if (!session) return fail('Not authenticated.');
  return ok(clone(session));
}

export function logout() { setSession(null); }

/* ===================== DASHBOARD ===================== */

function flightBagStats(store, flight) {
  const bags = store.bags.filter((b) => b.flightCode === flight.code);
  const accepted = bags.filter((b) => b.verified && !b.rejected).length;
  const loaded = bags.filter((b) => b.status === 'Loaded on Aircraft').length;
  return { expected: bags.length, accepted, loaded };
}

export async function getDashboard() {
  const store = getStore();
  const staff = myStaff(store);
  const flights = store.flights.filter((f) => isVisibleFlight(staff, f));
  const batches = store.batches.filter((b) => isVisibleFlight(staff, findFlight(store, b.flightCode)));
  const bags = store.bags.filter((b) => isVisibleFlight(staff, findFlight(store, b.flightCode)));

  const flightsTable = flights.map((f) => {
    const stats = flightBagStats(store, f);
    return {
      code: f.code, destination: f.destination, std: f.std, cutoffAt: cutoffAt(store, f),
      aircraft: f.aircraft, stand: f.stand, status: f.status,
      expected: stats.expected, accepted: stats.accepted, loaded: stats.loaded,
      closed: ['Closed', 'Departed'].includes(f.status),
      progress: stats.expected ? Math.round((stats.loaded / stats.expected) * 100) : 0,
    };
  }).sort((a, b) => new Date(a.std) - new Date(b.std));

  const nextActions = [];
  for (const b of batches) {
    if (!b.acknowledgedAt && b.status === 'Pending Airline') nextActions.push(`Acknowledge handover ${b.id} (${b.flightCode})`);
    if (b.status === 'Verifying') nextActions.push(`Finish verifying ${b.id} (${b.flightCode})`);
  }
  for (const f of flights) {
    if (!['Closed', 'Departed'].includes(f.status) && cutoffAt(store, f) - Date.now() < 60 * 60000 && cutoffAt(store, f) > Date.now()) {
      nextActions.push(`${f.code} cut-off approaching — confirm baggage loaded`);
    }
  }

  return ok({
    flightsToday: flights.length,
    batchesPendingAcceptance: batches.filter((b) => ['Pending Airline', 'Verifying'].includes(b.status)).length,
    bagsAtMakeup: bags.filter((b) => b.scannedAt && b.verified == null && !b.rejected).length,
    accepted: bags.filter((b) => b.verified && !b.rejected).length,
    inUlds: bags.filter((b) => b.uldId).length,
    loaded: bags.filter((b) => b.status === 'Loaded on Aircraft').length,
    openExceptions: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)
      && (e.flightCode ? isVisibleFlight(staff, findFlight(store, e.flightCode)) : true)).length,
    flightsTable,
    nextActions: nextActions.slice(0, 8),
  });
}

/** @returns {Promise<{code:string, destination:string, std:string, status:string}[]>} visible flights, soonest first */
export async function getFlights() {
  const store = getStore();
  const staff = myStaff(store);
  const flights = store.flights.filter((f) => isVisibleFlight(staff, f));
  return ok(flights.map((f) => ({ code: f.code, destination: f.destination, std: f.std, status: f.status }))
    .sort((a, b) => new Date(a.std) - new Date(b.std)));
}

/* ===================== INCOMING ===================== */

export async function getIncoming() {
  const store = getStore();
  const staff = myStaff(store);
  const flights = store.flights.filter((f) => isVisibleFlight(staff, f) && !['Closed', 'Departed'].includes(f.status));
  return ok(flights.map((f) => {
    const bags = store.bags.filter((b) => b.flightCode === f.code);
    const pipeline = {
      inTransit: bags.filter((b) => b.status === 'In Transit to Airport').length,
      atAirport: bags.filter((b) => b.status === 'Received at Airport' && b.verified == null).length,
      accepted: bags.filter((b) => b.verified && !b.rejected).length,
      loaded: bags.filter((b) => b.status === 'Loaded on Aircraft').length,
      total: bags.length,
    };
    const batches = store.batches.filter((b) => b.flightCode === f.code).map((b) => ({
      id: b.id, vehicleId: b.vehicleId, mu: b.mu, bagCount: b.bagIds.length, status: b.status,
      sentAt: b.sentAt, acknowledgedAt: b.acknowledgedAt,
    }));
    const risk = cutoffAt(store, f) - Date.now() < 60 * 60000;
    const bagsAtRisk = risk ? bags.filter((b) => !(b.verified && !b.rejected)).length : 0;
    return { code: f.code, destination: f.destination, std: f.std, cutoffAt: cutoffAt(store, f), pipeline, batches, bagsAtRisk };
  }));
}

/* ===================== INBOX ===================== */

export async function getInbox() {
  const store = getStore();
  const staff = myStaff(store);
  const batches = store.batches.filter((b) => isVisibleFlight(staff, findFlight(store, b.flightCode))
    && ['Pending Airline', 'Verifying'].includes(b.status));
  return ok(batches.map((b) => clone(b)));
}

export async function ackBatch(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  batch.acknowledgedAt = batch.acknowledgedAt || nowIso();
  saveStore();
  return ok(clone(batch));
}

/* ===================== ARRIVALS (vehicle scan + make-up) ===================== */

export async function scanVehicle(code) {
  const store = getStore();
  const staff = myStaff(store);
  const vehicle = store.vehicles.find((v) => v.code.toLowerCase() === String(code).trim().toLowerCase());
  if (!vehicle) return fail(`${code} is not a recognised vehicle — contact the airport coordinator.`, 'unknown');
  if (!vehicle.batchId) return fail(`No handover is expected on ${vehicle.code} right now.`, 'empty');
  const batch = findBatch(store, vehicle.batchId);
  const flight = findFlight(store, batch.flightCode);
  if (!isVisibleFlight(staff, flight)) return fail(`${vehicle.code} is carrying a batch for ${flight.airline} — not your airline.`, 'other-airline');
  return ok({ batch: clone(batch), flight: clone(flight), vehicle: clone(vehicle) });
}

export async function getMakeup() {
  const store = getStore();
  return ok(clone(store.makeupPositions));
}

export async function setMakeup(batchId, mu, reason) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  if (mu !== batch.mu && (!reason || !reason.trim())) return fail('A reason is required to change the make-up position.');
  const busy = store.makeupPositions.find((p) => p.code === mu && p.batchId && p.batchId !== batchId);
  if (busy) return fail(`${mu} is occupied by ${busy.batchId}.`);
  const old = store.makeupPositions.find((p) => p.batchId === batchId);
  if (old) old.batchId = null;
  const target = store.makeupPositions.find((p) => p.code === mu);
  if (!target) return fail('Unknown make-up position.');
  target.batchId = batchId;
  batch.mu = mu;
  batch.directedAt = nowIso();
  saveStore();
  return ok(clone(batch));
}

/* ===================== ACCEPTANCE: batch + scan ===================== */

export async function getBatch(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const flight = findFlight(store, batch.flightCode);
  const vehicle = store.vehicles.find((v) => v.id === batch.vehicleId);
  const bags = store.bags.filter((b) => batch.bagIds.includes(b.id)).map((b) => hydrateBag(store, b));
  return ok({ batch: clone(batch), flight: clone(flight), vehicle: vehicle ? clone(vehicle) : null, bags });
}

export async function batchScan(batchId, scannedCode) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const code = String(scannedCode).trim().toLowerCase();
  const bag = store.bags.find((b) => b.tagNumber.toLowerCase() === code || b.airlineTagNumber.toLowerCase() === code);
  if (!bag) return fail('Unrecognised tag.', 'not-found');
  if (bag.batchId !== batchId) return fail(`${bag.tagNumber} belongs to another batch — return it to Rabel.`, 'foreign');
  if (bag.scannedAt) return fail(`${bag.tagNumber} has already been scanned.`, 'duplicate');
  bag.status = 'Received at Airport';
  bag.scannedAt = nowIso();
  bag.timeline.push({ stage: 'Received at Airport', time: bag.scannedAt, result: 'ok' });
  if (batch.status === 'Pending Airline') batch.status = 'Verifying';
  saveStore();
  const scannedCount = store.bags.filter((b) => batch.bagIds.includes(b.id) && b.scannedAt).length;
  return ok({ bag: hydrateBag(store, bag), scannedCount, total: batch.bagIds.length, message: `${bag.tagNumber} received.` });
}

/* ===================== VERIFY ===================== */

function runVerify(store, bag) {
  const bsmRec = activeBsmForBag(store, bag);
  const pilgrim = findPilgrim(store, bag.pilgrimId);
  const mismatches = [];
  if (!bsmRec) {
    bag.verified = false;
    bag.verificationNote = 'No BSM — bag is not on the flight manifest.';
    ensureException(store, { type: 'No BSM', severity: 'High', batchId: bag.batchId, bagId: bag.id, flightCode: bag.flightCode, note: bag.verificationNote });
    return { bag: hydrateBag(store, bag), bsm: null, mismatches: ['noBsm'] };
  }
  if (bsmRec.pnr !== pilgrim?.pnr) mismatches.push('pnr');
  if (Math.abs(bsmRec.weightKg - bag.weightKg) > store.config.bsmWeightToleranceKg) mismatches.push('weight');
  if (mismatches.length) {
    bag.verified = false;
    bag.verificationNote = mismatches.includes('pnr')
      ? `PNR mismatch: BSM ${bsmRec.pnr} ≠ booking ${pilgrim?.pnr}.`
      : `Weight mismatch: BSM ${bsmRec.weightKg.toFixed(1)} kg ≠ scaled ${bag.weightKg.toFixed(1)} kg.`;
    ensureException(store, {
      type: mismatches.includes('pnr') ? 'PNR Mismatch' : 'Weight Mismatch',
      severity: mismatches.includes('pnr') ? 'Medium' : 'Low',
      batchId: bag.batchId, bagId: bag.id, flightCode: bag.flightCode, note: bag.verificationNote,
    });
  } else {
    bag.verified = true;
    bag.verificationNote = null;
  }
  return { bag: hydrateBag(store, bag), bsm: clone(bsmRec), mismatches };
}

export async function verifyBag(bagId) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (!bag.scannedAt) return fail('Scan this bag during unloading before verifying it.');
  const result = runVerify(store, bag);
  saveStore();
  return ok(result);
}

export async function verifyAll(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const bags = store.bags.filter((b) => batch.bagIds.includes(b.id) && b.scannedAt && b.verified == null);
  let verifiedCount = 0;
  for (const bag of bags) {
    const { mismatches } = runVerify(store, bag);
    if (!mismatches.length) verifiedCount += 1;
  }
  saveStore();
  const allScanned = store.bags.filter((b) => batch.bagIds.includes(b.id));
  const needsAction = allScanned.filter((b) => b.scannedAt && b.verified === false && !b.rejected).length;
  return ok({ verifiedCount, needsAction });
}

export async function lookupDcs(bagId) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const pilgrim = findPilgrim(store, bag.pilgrimId);
  return ok({ found: true, correctPnr: pilgrim?.pnr || null, passengerName: pilgrim?.name || '' });
}

export async function resolveBag(bagId, { resolution, notes }) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const text = (notes || '').trim();
  if (!resolution) return fail('Choose how this was resolved.');
  if (text.length < 5 || text.length > 300) return fail('Notes must be 5–300 characters.');
  if (resolution === 'Cannot resolve — reject') return rejectBag(bagId, text);
  if (resolution === 'BSM corrected') {
    const bsmRec = activeBsmForBag(store, bag);
    const pilgrim = findPilgrim(store, bag.pilgrimId);
    if (bsmRec && pilgrim) bsmRec.pnr = pilgrim.pnr;
  }
  bag.verified = true;
  bag.verificationNote = null;
  bag.rejected = false;
  resolveBagException(store, bagId, `${resolution} — ${text}`);
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function requestBsm(bagId) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (activeBsmForBag(store, bag)) return fail('A BSM already exists for this bag.');
  const pilgrim = findPilgrim(store, bag.pilgrimId);
  const flight = findFlight(store, bag.flightCode);
  store.bsms.push({
    id: newId('BSM'), flightCode: bag.flightCode, std: flight?.std, destination: flight?.destination,
    classOfService: 'Y', airlineTag: bag.airlineTagNumber, pnr: pilgrim?.pnr || '', passengerName: pilgrim?.name || '',
    weightKg: bag.weightKg, active: true, deletedReason: null, receivedAt: nowIso(),
  });
  saveStore();
  return ok({ created: true, message: 'BSM received — re-verify this bag.' });
}

export async function rejectBag(bagId, reason) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const text = (reason || '').trim();
  if (!text) return fail('A reason is required.');
  bag.rejected = true;
  bag.verified = false;
  bag.rejectReason = text;
  resolveBagException(store, bagId, `Rejected — ${text}`);
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function reweigh(bagId, newWeightKg) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const w = Number(newWeightKg);
  if (!Number.isFinite(w) || w < 1 || w > 40) return fail('Weight must be between 1 and 40 kg.');
  bag.weightKg = w;
  const result = runVerify(store, bag);
  saveStore();
  return ok(result);
}

export async function acceptWithNote(bagId, note) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const text = (note || '').trim();
  if (!text) return fail('A note is required.');
  bag.verified = true;
  bag.verificationNote = `Accepted with note: ${text}`;
  resolveBagException(store, bagId, `Accepted with note — ${text}`);
  saveStore();
  return ok(hydrateBag(store, bag));
}

/* ===================== ACCEPT / REJECT BATCH ===================== */

export async function getAcceptanceSummary(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const bags = store.bags.filter((b) => batch.bagIds.includes(b.id));
  return ok({
    total: bags.length,
    verifiedCount: bags.filter((b) => b.verified && !b.rejected).length,
    toRejectCount: bags.filter((b) => b.rejected).length,
    notReceivedCount: bags.filter((b) => !b.scannedAt).length,
  });
}

export async function accept(batchId, { receiverName, signatureDataUrl, notes }) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  if (!receiverName || !receiverName.trim()) return fail('Receiver is required.');
  if (!signatureDataUrl) return fail('A signature is required.');
  const bags = store.bags.filter((b) => batch.bagIds.includes(b.id));
  const verified = bags.filter((b) => b.verified && !b.rejected);
  if (!verified.length) return fail('At least one bag must be verified before accepting.');
  for (const bag of verified) {
    bag.status = 'Handed to Airline';
    bag.timeline.push({ stage: 'Handed to Airline', time: nowIso(), result: 'ok' });
  }
  const rejected = bags.filter((b) => b.rejected);
  const notReceived = bags.filter((b) => !b.scannedAt);
  for (const bag of notReceived) {
    ensureException(store, { type: 'Missing Bag', severity: 'Medium', batchId, bagId: bag.id, flightCode: bag.flightCode, note: 'Not received at acceptance.' });
  }
  batch.status = (rejected.length || notReceived.length) ? 'Partially Accepted' : 'Accepted';
  batch.acceptedAt = nowIso();
  batch.receiverName = receiverName.trim();
  batch.signatureDataUrl = signatureDataUrl;
  batch.notes = (notes || '').trim() || null;
  batch.acceptedCount = verified.length;
  batch.rejectedCount = rejected.length + notReceived.length;
  saveStore();
  return ok(clone(batch));
}

export async function rejectBatch(batchId, reason) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const text = (reason || '').trim();
  if (!text) return fail('A reason is required.');
  const bags = store.bags.filter((b) => batch.bagIds.includes(b.id));
  for (const bag of bags) { bag.rejected = true; bag.verified = false; }
  batch.status = 'Rejected';
  batch.rejectedAt = nowIso();
  batch.rejectReason = text;
  ensureException(store, { type: 'Handover Rejected', severity: 'High', batchId, flightCode: batch.flightCode, note: text });
  saveStore();
  return ok(clone(batch));
}

/* ===================== RECEIPT ===================== */

export async function getReceipt(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const bags = store.bags.filter((b) => batch.bagIds.includes(b.id)).map((b) => hydrateBag(store, b));
  return ok({
    batch: clone(batch), flight: clone(findFlight(store, batch.flightCode)),
    accepted: bags.filter((b) => b.verified && !b.rejected),
    rejected: bags.filter((b) => b.rejected),
    notReceived: bags.filter((b) => !b.scannedAt),
    generatedAt: nowIso(),
  });
}

/* ===================== DCS ===================== */

export async function sendDcs(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  if (store.dcsOffline) {
    const entry = { id: newId('DCS'), batchId, flightCode: batch.flightCode, status: 'Failed', at: nowIso() };
    store.dcsLog.unshift(entry);
    saveStore();
    return fail('DCS is offline — update failed.', 'offline');
  }
  const entry = { id: newId('DCS'), batchId, flightCode: batch.flightCode, status: 'Acknowledged', at: nowIso() };
  store.dcsLog.unshift(entry);
  saveStore();
  return ok(clone(entry));
}

export async function retryDcs(batchId) {
  return sendDcs(batchId);
}

export async function getDcsLog() {
  const store = getStore();
  const staff = myStaff(store);
  return ok(store.dcsLog.filter((e) => isVisibleFlight(staff, findFlight(store, e.flightCode))).map((e) => clone(e)));
}

/* ===================== BSM MONITOR ===================== */

export async function getBsms(flightCode) {
  const store = getStore();
  return ok(store.bsms.filter((m) => m.flightCode === flightCode).map((m) => clone(m)));
}

export async function syncBsm(flightCode) {
  const store = getStore();
  if (!findFlight(store, flightCode)) return fail('Flight not found.');
  return ok({ received: 0, message: 'BSMs are up to date.' });
}

export async function markBsmDeleted(bsmId, reason) {
  const store = getStore();
  const bsmRec = store.bsms.find((m) => m.id === bsmId);
  if (!bsmRec) return fail('BSM not found.');
  const text = (reason || '').trim();
  if (!text) return fail('A reason is required.');
  bsmRec.active = false;
  bsmRec.deletedReason = text;
  const bag = store.bags.find((b) => b.airlineTagNumber === bsmRec.airlineTag && b.flightCode === bsmRec.flightCode);
  if (bag && bag.verified && !bag.rejected && bag.status !== 'Loaded on Aircraft' && bag.status !== 'Handed to Airline') {
    bag.verified = null;
    bag.verificationNote = null;
  }
  saveStore();
  return ok(clone(bsmRec));
}

/* ===================== ULD BUILD ===================== */

export async function getReadyToLoad(flightCode) {
  const store = getStore();
  const bags = store.bags.filter((b) => b.flightCode === flightCode && b.verified && !b.rejected && !b.uldId);
  return ok(bags.map((b) => hydrateBag(store, b)));
}

export async function getUldPool() {
  const store = getStore();
  return ok(store.ulds.filter((u) => u.status === 'Empty').map((u) => clone(u)));
}

export async function getFlightUlds(flightCode) {
  const store = getStore();
  return ok(store.ulds.filter((u) => u.flightCode === flightCode).map((u) => clone(u)));
}

export async function startUld(flightCode, uldId) {
  const store = getStore();
  const uld = findUld(store, uldId);
  if (!uld) return fail('ULD not found.');
  if (uld.status !== 'Empty') return fail(`${uld.code} is not available.`);
  uld.flightCode = flightCode;
  uld.status = 'Building';
  saveStore();
  return ok(clone(uld));
}

export async function uldScan(uldId, scannedTag) {
  const store = getStore();
  const uld = findUld(store, uldId);
  if (!uld) return fail('ULD not found.');
  const bag = findBagByTag(store, scannedTag);
  if (!bag) return fail('Unrecognised tag.', 'not-found');
  if (!bag.verified || bag.rejected) return fail(`${bag.tagNumber} is not accepted yet.`, 'not-accepted');
  const bsmRec = activeBsmForBag(store, bag);
  if (!bsmRec) return fail(`${bag.tagNumber}'s BSM has been deleted.`, 'bsm-deleted');
  if (bag.flightCode !== uld.flightCode) return fail(`${bag.tagNumber} is on a different flight.`, 'wrong-flight');
  if (bag.uldId) return fail(`${bag.tagNumber} is already in ${bag.uldId}.`, 'already-in-uld');
  if (uld.bagIds.length >= store.config.uldCapacity) return fail(`${uld.code} full (${store.config.uldCapacity}/${store.config.uldCapacity}).`, 'full');
  uld.bagIds.push(bag.id);
  bag.uldId = uld.id;
  saveStore();
  return ok({ bag: hydrateBag(store, bag), uld: clone(uld), loadedCount: uld.bagIds.length, message: `${bag.tagNumber} added to ${uld.code}.` });
}

export async function getUldDetail(uldId) {
  const store = getStore();
  const uld = findUld(store, uldId);
  if (!uld) return fail('ULD not found.');
  const bags = store.bags.filter((b) => uld.bagIds.includes(b.id)).map((b) => hydrateBag(store, b));
  return ok({ ...clone(uld), bags });
}

export async function removeFromUld(uldId, bagId) {
  const store = getStore();
  const uld = findUld(store, uldId);
  if (!uld) return fail('ULD not found.');
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  uld.bagIds = uld.bagIds.filter((id) => id !== bagId);
  bag.uldId = null;
  saveStore();
  return ok(clone(uld));
}

export async function closeUld(uldId) {
  const store = getStore();
  const uld = findUld(store, uldId);
  if (!uld) return fail('ULD not found.');
  if (!uld.bagIds.length) return fail('Add at least one bag before closing.');
  uld.status = 'Closed';
  uld.closedAt = nowIso();
  saveStore();
  return ok(clone(uld));
}

/* ===================== LOAD TO AIRCRAFT ===================== */

export async function getHoldDiagram(flightCode) {
  const store = getStore();
  const flight = findFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const closedUlds = store.ulds.filter((u) => u.flightCode === flightCode && u.status === 'Closed');
  return ok({ holdPositions: clone(flight.holdPositions), closedUlds: closedUlds.map((u) => clone(u)) });
}

export async function loadUld(flightCode, uldId, positionCode) {
  const store = getStore();
  const flight = findFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const uld = findUld(store, uldId);
  if (!uld || uld.flightCode !== flightCode || uld.status !== 'Closed') return fail('ULD must be closed and for this flight.');
  const position = flight.holdPositions.find((p) => p.code === positionCode);
  if (!position) return fail('Unknown position.');
  if (position.uldId) return fail(`Position ${positionCode} occupied.`);
  position.uldId = uld.id;
  uld.position = positionCode;
  uld.status = 'Loaded';
  uld.loadedAt = nowIso();
  const bags = store.bags.filter((b) => uld.bagIds.includes(b.id));
  for (const bag of bags) {
    bag.status = 'Loaded on Aircraft';
    bag.timeline.push({ stage: 'Loaded on Aircraft', time: nowIso(), result: 'ok' });
  }
  saveStore();
  return ok({ uld: clone(uld), position: positionCode });
}

export async function offloadUld(uldId, reason) {
  const store = getStore();
  const uld = findUld(store, uldId);
  if (!uld) return fail('ULD not found.');
  const text = (reason || '').trim();
  if (!text) return fail('A reason is required.');
  const position = store.flights.flatMap((f) => f.holdPositions).find((p) => p.uldId === uld.id);
  if (position) position.uldId = null;
  const bags = store.bags.filter((b) => uld.bagIds.includes(b.id));
  for (const bag of bags) { bag.status = 'Handed to Airline'; bag.uldId = null; }
  uld.bagIds = [];
  uld.status = 'Offloaded';
  uld.position = null;
  ensureException(store, { type: 'Offloaded Bag', severity: 'Medium', flightCode: uld.flightCode, note: `${uld.code}: ${text}` });
  saveStore();
  return ok(clone(uld));
}

export async function offloadBag(bagId, reason) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const text = (reason || '').trim();
  if (!text) return fail('A reason is required.');
  const uld = store.ulds.find((u) => u.id === bag.uldId);
  if (uld) uld.bagIds = uld.bagIds.filter((id) => id !== bagId);
  bag.uldId = null;
  bag.status = 'Handed to Airline';
  ensureException(store, { type: 'Offloaded Bag', severity: 'Low', batchId: bag.batchId, bagId: bag.id, flightCode: bag.flightCode, note: text });
  saveStore();
  return ok({ bagId, offloaded: true });
}

/* ===================== MANIFEST ===================== */

export async function generateManifest(flightCode) {
  const store = getStore();
  const flight = findFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const loadedUlds = store.ulds.filter((u) => u.flightCode === flightCode && u.status === 'Loaded');
  const uldRows = loadedUlds.map((u) => {
    const bags = store.bags.filter((b) => u.bagIds.includes(b.id));
    return { uldCode: u.code, position: u.position, bagCount: bags.length, weightKg: bags.reduce((sum, b) => sum + b.weightKg, 0) };
  });
  const totals = { totalBags: uldRows.reduce((s, r) => s + r.bagCount, 0), totalWeight: uldRows.reduce((s, r) => s + r.weightKg, 0) };
  const offloaded = store.ulds.filter((u) => u.flightCode === flightCode && u.status === 'Offloaded').map((u) => clone(u));
  const accepted = store.bags.filter((b) => b.flightCode === flightCode && b.verified && !b.rejected);
  const notLoaded = accepted.filter((b) => b.status !== 'Loaded on Aircraft').map((b) => hydrateBag(store, b));
  const bsmNotLoaded = store.bsms.filter((m) => m.flightCode === flightCode && m.active).filter((m) => {
    const bag = store.bags.find((b) => b.airlineTagNumber === m.airlineTag);
    return !bag || bag.status !== 'Loaded on Aircraft';
  }).map((m) => clone(m));
  return ok({
    generatedAt: nowIso(), flightCode, uldRows, totals, offloaded, notLoaded, bsmNotLoaded,
    complete: notLoaded.length === 0 && uldRows.length > 0,
  });
}

export async function confirmLoaded(flightCode) {
  const store = getStore();
  const flight = findFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const closedNotLoaded = store.ulds.filter((u) => u.flightCode === flightCode && u.status === 'Closed');
  if (closedNotLoaded.length) return fail(`${closedNotLoaded.length} closed ULD(s) still need a hold position.`);
  const accepted = store.bags.filter((b) => b.flightCode === flightCode && b.verified && !b.rejected);
  const unaccounted = accepted.filter((b) => b.status !== 'Loaded on Aircraft');
  if (unaccounted.length) return fail(`${unaccounted.length} accepted bag(s) are not yet loaded.`);
  const loadedCount = accepted.length;
  if (!loadedCount) return fail('No bags have been loaded for this flight yet.');
  flight.confirmedLoadedAt = nowIso();
  saveStore();
  return ok({ loadedCount, flightCode, message: `Baggage loaded — ${loadedCount} bags on ${flightCode}.` });
}

export async function closeBaggage(flightCode) {
  const store = getStore();
  const flight = findFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (!flight.confirmedLoadedAt) return fail('Confirm baggage loaded before closing.');
  flight.status = 'Closed';
  flight.closedAt = nowIso();
  saveStore();
  return ok(clone(flight));
}

export async function markDeparted(flightCode) {
  const store = getStore();
  const flight = findFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (flight.status !== 'Closed') return fail('Close baggage for this flight before marking it departed.');
  flight.status = 'Departed';
  flight.departedAt = nowIso();
  saveStore();
  return ok(clone(flight));
}

/* ===================== EXCEPTIONS ===================== */

export async function getExceptions(filters = {}) {
  const store = getStore();
  const staff = myStaff(store);
  let list = store.exceptions.filter((e) => (e.flightCode ? isVisibleFlight(staff, findFlight(store, e.flightCode)) : true));
  if (filters.status) list = list.filter((e) => e.status === filters.status);
  if (filters.severity) list = list.filter((e) => e.severity === filters.severity);
  if (filters.type) list = list.filter((e) => e.type === filters.type);
  return ok(clone(list));
}

export async function resolveExceptionLocal(id, notes) {
  const store = getStore();
  const exc = store.exceptions.find((e) => e.id === id);
  if (!exc) return fail('Exception not found.');
  if (['High', 'Critical'].includes(exc.severity)) {
    return fail('High-severity exceptions must be resolved by Operations Management.');
  }
  exc.status = 'Resolved';
  exc.resolutionOutcome = notes || 'Resolved';
  exc.resolvedAt = nowIso();
  saveStore();
  return ok(clone(exc));
}

/* ===================== REPORTS ===================== */

export async function getReportsSummary() {
  const store = getStore();
  const staff = myStaff(store);
  const batches = store.batches.filter((b) => isVisibleFlight(staff, findFlight(store, b.flightCode)));
  const flights = store.flights.filter((f) => isVisibleFlight(staff, f));
  const dcsLog = store.dcsLog.filter((e) => isVisibleFlight(staff, findFlight(store, e.flightCode)));
  return ok({
    generatedAt: nowIso(),
    receipts: batches.filter((b) => ['Accepted', 'Partially Accepted', 'Rejected'].includes(b.status)).map((b) => ({
      batch: b.id, flight: b.flightCode, status: b.status, accepted: b.acceptedCount || 0, rejected: b.rejectedCount || 0,
    })),
    loadReports: flights.map((f) => {
      const stats = flightBagStats(store, f);
      return { flight: f.code, destination: f.destination, status: f.status, expected: stats.expected, loaded: stats.loaded };
    }),
    dcsMessages: dcsLog.map((e) => ({ batch: e.batchId, flight: e.flightCode, status: e.status, at: e.at })),
    dailySummary: {
      bagsHandled: store.bags.filter((b) => isVisibleFlight(staff, findFlight(store, b.flightCode)) && b.scannedAt).length,
      exceptionsOpen: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)
        && (e.flightCode ? isVisibleFlight(staff, findFlight(store, e.flightCode)) : true)).length,
    },
  });
}

/* ===================== HANDOVER ===================== */

export async function getHandoverSummary() {
  const store = getStore();
  const staff = myStaff(store);
  const batches = store.batches.filter((b) => isVisibleFlight(staff, findFlight(store, b.flightCode)));
  const flights = store.flights.filter((f) => isVisibleFlight(staff, f));
  return ok({
    openExceptions: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)
      && (e.flightCode ? isVisibleFlight(staff, findFlight(store, e.flightCode)) : true)).length,
    batchesMidVerification: batches.filter((b) => b.status === 'Verifying').length,
    flightsNearCutoffUnconfirmed: flights.filter((f) => !f.confirmedLoadedAt && cutoffAt(store, f) - Date.now() < 60 * 60000 && !['Closed', 'Departed'].includes(f.status)).length,
    notes: clone(store.handoverNotes),
  });
}

export async function submitHandover(notes) {
  const store = getStore();
  const text = (notes || '').trim();
  if (text.length < 10 || text.length > 1000) return fail('Handover notes must be 10–1000 characters.');
  const entry = { id: newId('HO'), notes: text, submittedAt: nowIso(), by: getSession()?.name || 'Staff' };
  store.handoverNotes.unshift(entry);
  saveStore();
  return ok(entry);
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

/* ===================== DEMO MENU ===================== */

export async function demoSendNewBatch() {
  const store = getStore();
  const flight = store.flights.find((f) => f.code === 'GA 981') || store.flights[0];
  const vehicle = store.vehicles.find((v) => !v.batchId);
  const mu = store.makeupPositions.find((p) => !p.batchId);
  if (!vehicle || !mu) return fail('No free vehicle or make-up position for a demo batch.');
  const names = [['Imran Shah', 'ABC201'], ['Zainab Noor', 'ABC202'], ['Bilal Chaudhry', 'ABC203']];
  const batchId = newId('AHO');
  const bagIds = [];
  names.forEach(([name, pnr], i) => {
    const pid = newId('PIL');
    store.pilgrims.push({ id: pid, name, nationality: 'Pakistani', groupName: 'Lahore Group 5', pnr });
    const bagId = newId('BAG');
    const tag = `172${Math.floor(1000000 + Math.random() * 8999999)}`;
    store.bags.push({
      id: bagId, tagNumber: `RBL-D-${newId('').slice(0, 6)}`, airlineTagNumber: tag, pilgrimId: pid,
      batchId, flightCode: flight.code, status: 'In Transit to Airport', weightKg: 20 + i,
      scannedAt: null, verified: null, verificationNote: null, rejected: false, rejectReason: null,
      uldId: null, holdPosition: null, timeline: [{ stage: 'In Transit to Airport', time: nowIso(), result: 'ok' }],
    });
    store.bsms.push({
      id: newId('BSM'), flightCode: flight.code, std: flight.std, destination: flight.destination, classOfService: 'Y',
      airlineTag: tag, pnr, passengerName: name.split(' ').reverse().join('/').toUpperCase(), weightKg: 20 + i,
      active: true, deletedReason: null, receivedAt: nowIso(),
    });
    bagIds.push(bagId);
  });
  store.batches.push({
    id: batchId, flightCode: flight.code, vehicleId: vehicle.id, mu: mu.code,
    status: 'Pending Airline', sentAt: nowIso(), acknowledgedAt: null, directedAt: null, bagIds,
    acceptedAt: null, rejectedAt: null, rejectReason: null, receiverName: null, signatureDataUrl: null,
    acceptedCount: 0, rejectedCount: 0,
  });
  vehicle.batchId = batchId;
  mu.batchId = batchId;
  store.notifications.unshift({ id: newId('N'), title: 'Handover ready', body: `${batchId} (${flight.code}, ${bagIds.length} bags) is waiting to be acknowledged.`, time: nowIso(), unread: true, link: '#/inbox' });
  saveStore();
  return ok({ batchId });
}

export async function demoInjectPnrMismatch(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const bag = store.bags.find((b) => batch.bagIds.includes(b.id) && activeBsmForBag(store, b));
  if (!bag) return fail('No bag with an active BSM to corrupt.');
  const bsmRec = activeBsmForBag(store, bag);
  bsmRec.pnr = `${bsmRec.pnr.slice(0, -1)}${bsmRec.pnr.slice(-1) === 'Z' ? 'Y' : 'Z'}`;
  bag.verified = null;
  saveStore();
  return ok({ bagId: bag.id });
}

export async function demoDeleteBsm() {
  const store = getStore();
  const bsmRec = store.bsms.find((m) => m.active);
  if (!bsmRec) return fail('No active BSM to delete.');
  return markBsmDeleted(bsmRec.id, 'Demo: passenger no-show.');
}

export async function demoSimulateUnloadingScan(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId) || store.batches.find((b) => ['Pending Airline', 'Verifying'].includes(b.status));
  if (!batch) return fail('No batch in progress.');
  const bags = store.bags.filter((b) => batch.bagIds.includes(b.id) && !b.scannedAt);
  for (const bag of bags) {
    bag.status = 'Received at Airport';
    bag.scannedAt = nowIso();
    bag.timeline.push({ stage: 'Received at Airport', time: bag.scannedAt, result: 'ok' });
  }
  if (batch.status === 'Pending Airline') batch.status = 'Verifying';
  saveStore();
  return ok({ scanned: bags.length, batchId: batch.id });
}

export async function demoToggleDcsOffline() {
  const store = getStore();
  store.dcsOffline = !store.dcsOffline;
  saveStore();
  return ok({ dcsOffline: store.dcsOffline });
}

export async function demoAutoBuildUlds(flightCode) {
  const store = getStore();
  const bags = store.bags.filter((b) => b.flightCode === flightCode && b.verified && !b.rejected && !b.uldId);
  if (!bags.length) return fail('No accepted bags ready to load for this flight.');
  const capacity = store.config.uldCapacity;
  let built = 0;
  for (let i = 0; i < bags.length; i += capacity) {
    const chunk = bags.slice(i, i + capacity);
    const uld = store.ulds.find((u) => u.status === 'Empty');
    if (!uld) break;
    uld.flightCode = flightCode;
    uld.status = 'Closed';
    uld.closedAt = nowIso();
    uld.bagIds = chunk.map((b) => b.id);
    for (const bag of chunk) bag.uldId = uld.id;
    built += 1;
  }
  saveStore();
  return ok({ uldsBuilt: built });
}

export async function demoAutoLoadUlds(flightCode) {
  const store = getStore();
  const flight = findFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const closedUlds = store.ulds.filter((u) => u.flightCode === flightCode && u.status === 'Closed');
  let loaded = 0;
  for (const uld of closedUlds) {
    const position = flight.holdPositions.find((p) => !p.uldId);
    if (!position) break;
    position.uldId = uld.id;
    uld.position = position.code;
    uld.status = 'Loaded';
    uld.loadedAt = nowIso();
    for (const bag of store.bags.filter((b) => uld.bagIds.includes(b.id))) {
      bag.status = 'Loaded on Aircraft';
      bag.timeline.push({ stage: 'Loaded on Aircraft', time: nowIso(), result: 'ok' });
    }
    loaded += 1;
  }
  saveStore();
  return ok({ uldsLoaded: loaded });
}

export function demoForceNextFail() {
  const store = getStore();
  store.demoForceFail = true;
  saveStore();
}

export function demoReset() { resetStore(); }
