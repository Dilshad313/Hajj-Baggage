/**
 * Mock REST API for the Airport Coordinator console. Covers both the
 * Departure lane (receive Rabel trucks, hand baggage to the airline) and
 * the Arrival lane (receive baggage from the ground handler, security-check
 * it, load hotel trucks). Every function is async, resolves after a
 * realistic delay, and can be made to reject via `?fail=1` or the one-shot
 * demo "force fail" flag. A real backend can replace this file without the
 * UI code changing.
 */
import { getStore, saveStore, resetStore, setSession, getSession } from './store.js';
import { SOP_STEPS } from './seed.js';

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

function forAirport(staff, record) { return !record.airport || record.airport === staff?.airport; }

function findTrip(store, id) { return store.depTrips.find((t) => t.id === id); }
function findDepBag(store, id) { return store.depBags.find((b) => b.id === id); }
function findDepBagByTag(store, tag) {
  const q = String(tag).trim().toLowerCase();
  return store.depBags.find((b) => b.tagNumber.toLowerCase() === q);
}
function findDepPilgrim(store, id) { return store.depPilgrims.find((p) => p.id === id); }
function hydrateDepBag(store, b) { return { ...clone(b), pilgrimName: findDepPilgrim(store, b.pilgrimId)?.name || '' }; }
function findBatch(store, id) { return store.depBatches.find((b) => b.id === id); }

function findArrFlight(store, code) { return store.arrFlights.find((f) => f.code === code || f.id === code); }
function findArrBag(store, id) { return store.arrBags.find((b) => b.id === id); }
function findArrBagByTag(store, tag) {
  const q = String(tag).trim().toLowerCase();
  return store.arrBags.find((b) => b.tagNumber.toLowerCase() === q || (b.airlineTagNumber || '').toLowerCase() === q);
}
function findArrPilgrim(store, id) { return store.arrPilgrims.find((p) => p.id === id); }
function hydrateArrBag(store, b) {
  const p = findArrPilgrim(store, b.pilgrimId);
  return { ...clone(b), pilgrimName: p?.name || (b.unidentified ? 'Unidentified' : ''), hotel: b.hotel || p?.hotel || null };
}
function findTruck(store, id) { return store.outboundTrucks.find((t) => t.id === id || t.code === id); }
function findArrTrip(store, id) { return store.arrTrips.find((t) => t.id === id); }

function ensureException(store, { type, severity, tripId, batchId, bagId, flightCode, note }) {
  const exc = {
    id: newId('EXC'), time: nowIso(), type, severity, status: 'Open',
    tripId: tripId || null, batchId: batchId || null, bagId: bagId || null, flightCode: flightCode || null,
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
  const session = { id: staff.id, name: staff.name, employeeId: staff.employeeId, airport: staff.airport, shiftStartedAt: nowIso() };
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

export async function getDashboardDeparture() {
  const store = getStore();
  const staff = myStaff(store);
  const trips = store.depTrips.filter((t) => forAirport(staff, t));
  const bags = store.depBags.filter((b) => {
    const trip = b.truckTripId ? findTrip(store, b.truckTripId) : null;
    return !trip || forAirport(staff, trip);
  });
  const today = new Date().toDateString();
  const flightsClosing = [...new Set(bags.map((b) => b.flightCode).filter(Boolean))].map((code) => {
    const flightBags = bags.filter((b) => b.flightCode === code);
    const batch = store.depBatches.find((bt) => bt.flightCode === code && bt.status !== 'Rejected');
    return { flightCode: code, bagCount: flightBags.length, batchStatus: batch?.status || 'None' };
  });
  return ok({
    enRoute: trips.filter((t) => t.status === 'En route').length,
    atGate: trips.filter((t) => ['At Destination', 'Security Hold'].includes(t.status)).length,
    receivedToday: bags.filter((b) => b.scannedAt && new Date(b.scannedAt).toDateString() === today).length,
    awaitingHandover: bags.filter((b) => b.status === 'Received at Airport' && !b.batchId && !b.rejected).length,
    handedToday: bags.filter((b) => b.status === 'Handed to Airline' && b.scannedAt && new Date(b.scannedAt).toDateString() === today).length,
    openExceptions: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status) && e.tripId).length,
    flightsClosing,
  });
}

export async function getDashboardArrival() {
  const store = getStore();
  const staff = myStaff(store);
  const flights = store.arrFlights.filter((f) => forAirport(staff, f));
  const bags = store.arrBags.filter((b) => flights.some((f) => f.code === b.flightCode));
  return ok({
    flightsToday: flights.length,
    bagsExpected: bags.length,
    received: bags.filter((b) => ['Received at Airport', 'Security Checked', 'Loaded to Truck', 'In Transit to Accommodation'].includes(b.status)).length,
    securityChecked: bags.filter((b) => b.securityStatus === 'Clear').length,
    loaded: bags.filter((b) => b.status === 'Loaded to Truck' || b.status === 'In Transit to Accommodation').length,
    missingUnidentified: bags.filter((b) => b.unidentified || !b.scannedAt).length,
    arrivalFlights: flights.map((f) => ({
      code: f.code, eta: f.eta, status: f.status,
      nusukSynced: !!f.nusukSyncedAt, prepComplete: !!f.prepCompletedAt,
    })),
  });
}

/* ===================== DEPARTURE: INCOMING ===================== */

export async function getIncoming() {
  const store = getStore();
  const staff = myStaff(store);
  return ok(store.depTrips.filter((t) => forAirport(staff, t) && t.status !== 'Handed Over').map((t) => clone(t)));
}

export async function getTripManifest(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  return ok(store.depBags.filter((b) => b.truckTripId === tripId).map((b) => hydrateDepBag(store, b)));
}

export async function preAssignBay(tripId, bay) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.bay = bay;
  saveStore();
  return ok(clone(trip));
}

export async function raiseMissedCutoff(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  ensureException(store, { type: 'Missed Cut-off', severity: 'High', tripId, flightCode: trip.flightCode, note: `${trip.code} is at risk of missing its flight's cut-off.` });
  saveStore();
  return ok({ raised: true });
}

/* ===================== DEPARTURE: GATE & HOLDS ===================== */

export async function gateScan(code) {
  const store = getStore();
  const staff = myStaff(store);
  const q = String(code).trim().toLowerCase();
  const trip = store.depTrips.find((t) => t.truckPlate.toLowerCase() === q || t.code.toLowerCase() === q);
  if (!trip) return fail('Unknown truck — not admitted.', 'unknown');
  if (!forAirport(staff, trip)) return fail(`${trip.code} is not expected at ${staff?.airport}.`, 'wrong-airport');
  if (trip.status === 'Handed Over') return fail('This truck has already completed handover.', 'done');
  if (trip.status === 'En route') trip.status = 'At Destination';
  trip.arrivedAt = trip.arrivedAt || nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function contactTransportCoordinator({ plate, driverName, phone, notes }) {
  const store = getStore();
  if (!plate || !driverName) return fail('Plate and driver name are required.');
  if (notes && notes.length > 300) return fail('Notes must be 300 characters or fewer.');
  ensureException(store, { type: 'Unknown Truck', severity: 'Medium', note: `${plate} / ${driverName}${notes ? ` — ${notes}` : ''}` });
  saveStore();
  return ok({ logged: true });
}

export async function verifySeal(tripId, scannedSeal) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (String(scannedSeal).trim().toUpperCase() !== trip.sealNumber.toUpperCase()) {
    trip.status = 'Security Hold';
    const hold = { id: newId('HOLD'), tripId, reason: `Seal mismatch — scanned "${scannedSeal}", expected ${trip.sealNumber}.`, createdAt: nowIso(), releasedAt: null, releaseNotes: null };
    store.securityHolds.push(hold);
    ensureException(store, { type: 'Seal Mismatch', severity: 'High', tripId, flightCode: trip.flightCode, note: hold.reason });
    saveStore();
    return fail('Seal mismatch — truck placed on security hold.');
  }
  trip.sealVerifiedAt = nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function getSecurityHolds() {
  const store = getStore();
  const staff = myStaff(store);
  return ok(store.securityHolds.filter((h) => !h.releasedAt && forAirport(staff, findTrip(store, h.tripId) || {})).map((h) => clone(h)));
}

export async function getTrucksAtGate() {
  const store = getStore();
  const staff = myStaff(store);
  return ok(store.depTrips.filter((t) => forAirport(staff, t) && ['At Destination', 'Security Hold'].includes(t.status)).map((t) => clone(t)));
}

export async function releaseHold(holdId, notes) {
  const store = getStore();
  const hold = store.securityHolds.find((h) => h.id === holdId);
  if (!hold) return fail('Hold not found.');
  const text = (notes || '').trim();
  if (text.length < 5 || text.length > 300) return fail('Notes must be 5–300 characters.');
  hold.releasedAt = nowIso();
  hold.releaseNotes = text;
  const trip = findTrip(store, hold.tripId);
  if (trip && trip.status === 'Security Hold') trip.status = 'At Destination';
  saveStore();
  return ok(clone(hold));
}

export async function assignBay(tripId, bay) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const busy = store.depTrips.find((t) => t.id !== tripId && t.bay === bay && ['At Destination', 'Security Hold'].includes(t.status));
  if (busy) return fail(`${bay} is busy with ${busy.code} — choose another bay.`);
  trip.bay = bay;
  saveStore();
  return ok(clone(trip));
}

/* ===================== DEPARTURE: RECEIVING & VERIFY ===================== */

export async function getDepReceiving(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.depBags.filter((b) => b.truckTripId === tripId).map((b) => hydrateDepBag(store, b));
  return ok({ trip: clone(trip), bags, extra: clone(trip.extraTags || []) });
}

export async function depScanBag(tripId, scannedTag) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bag = findDepBagByTag(store, scannedTag);
  if (!bag || bag.truckTripId !== tripId) {
    trip.extraTags = trip.extraTags || [];
    trip.extraTags.push({ tag: scannedTag, at: nowIso() });
    saveStore();
    return ok({ extra: true, message: `${scannedTag} is not on this truck's manifest — flagged as extra.` });
  }
  if (bag.status !== 'In Transit to Airport') return fail(`${bag.tagNumber} has already been scanned.`);
  bag.status = 'Received at Airport';
  bag.scannedAt = nowIso();
  bag.timeline.push({ stage: 'Received at Airport', time: bag.scannedAt, result: 'ok' });
  saveStore();
  return ok({ bag: hydrateDepBag(store, bag), message: `${bag.tagNumber} received.` });
}

export async function depComputeDiscrepancy(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.depBags.filter((b) => b.truckTripId === tripId);
  return ok({
    expectedCount: bags.length, scannedCount: bags.filter((b) => b.status !== 'In Transit to Airport').length,
    missing: bags.filter((b) => b.status === 'In Transit to Airport').map((b) => hydrateDepBag(store, b)),
    extra: clone(trip.extraTags || []),
  });
}

export async function depRecordDiscrepancy(tripId, notes) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const text = (notes || '').trim();
  if (text.length < 10 || text.length > 500) return fail('Discrepancy notes must be 10–500 characters.');
  const missing = store.depBags.filter((b) => b.truckTripId === tripId && b.status === 'In Transit to Airport');
  for (const bag of missing) {
    ensureException(store, { type: 'Missing Bag', severity: 'Medium', tripId, bagId: bag.id, flightCode: trip.flightCode, note: text });
  }
  trip.discrepancyRecorded = true;
  saveStore();
  return ok({ exceptionsCreated: missing.length });
}

export async function depReconcile(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const missing = store.depBags.filter((b) => b.truckTripId === tripId && b.status === 'In Transit to Airport');
  if (missing.length && !trip.discrepancyRecorded) return fail('Record the discrepancy before reconciling.');
  trip.reconciledAt = nowIso();
  trip.status = 'Handed Over';
  saveStore();
  return ok(clone(trip));
}

export async function getDepReceipt(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.depBags.filter((b) => b.truckTripId === tripId).map((b) => hydrateDepBag(store, b));
  return ok({
    trip: clone(trip), received: bags.filter((b) => b.status !== 'In Transit to Airport'),
    missing: bags.filter((b) => b.status === 'In Transit to Airport'), generatedAt: nowIso(),
  });
}

/* ===================== DEPARTURE: AIRLINE HANDOVER ===================== */

export async function getFlightsReadyForHandover() {
  const store = getStore();
  const bags = store.depBags.filter((b) => b.status === 'Received at Airport' && !b.batchId && !b.rejected);
  const byFlight = {};
  for (const b of bags) { byFlight[b.flightCode] = byFlight[b.flightCode] || []; byFlight[b.flightCode].push(b); }
  return ok(Object.keys(byFlight).map((code) => ({
    flightCode: code, bagCount: byFlight[code].length,
    openBatch: !!store.depBatches.find((bt) => bt.flightCode === code && !['Accepted', 'Rejected'].includes(bt.status)),
  })));
}

export async function getHandoverOptions() {
  const store = getStore();
  return ok({ deliveryVehicles: clone(store.deliveryVehicles), makeupPositions: clone(store.makeupPositions) });
}

export async function getBatches() {
  const store = getStore();
  return ok(clone(store.depBatches));
}

export async function createBatch(flightCode) {
  const store = getStore();
  const existing = store.depBatches.find((b) => b.flightCode === flightCode && !['Accepted', 'Rejected'].includes(b.status));
  if (existing) return fail(`An open batch already exists for ${flightCode} (${existing.id}).`);
  const batch = {
    id: newId('BATCH'), flightCode, status: 'Open', bagIds: [], vehicleId: null, mu: null, sentAt: null,
    decision: null, rejectedBagIds: [], rejectReason: null, resolution: null,
    receiver: null, createdAt: nowIso(),
  };
  store.depBatches.push(batch);
  saveStore();
  return ok(clone(batch));
}

export async function getBatch(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const bags = store.depBags.filter((b) => b.batchId === batchId).map((b) => hydrateDepBag(store, b));
  return ok({ ...clone(batch), bags });
}

export async function batchScanBag(batchId, scannedTag) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const bag = findDepBagByTag(store, scannedTag);
  if (!bag) return fail('Unrecognised tag.', 'not-found');
  if (bag.flightCode !== batch.flightCode) return fail(`${bag.tagNumber} is on a different flight.`, 'wrong-flight');
  if (bag.status !== 'Received at Airport') return fail(`${bag.tagNumber} has not been received at the airport yet.`, 'not-received');
  if (bag.batchId && bag.batchId !== batchId) return fail(`${bag.tagNumber} is already in batch ${bag.batchId}.`, 'already-batched');
  if (bag.rejected) return fail(`${bag.tagNumber} was rejected by the airline — resolve it first.`, 'rejected');
  if (bag.batchId === batchId) {
    // Already in this batch — happens when re-scanning to resubmit after a resolved rejection.
    saveStore();
    return ok({ bag: hydrateDepBag(store, bag), count: batch.bagIds.length, message: `${bag.tagNumber} confirmed.` });
  }
  bag.batchId = batchId;
  batch.bagIds.push(bag.id);
  saveStore();
  return ok({ bag: hydrateDepBag(store, bag), count: batch.bagIds.length, message: `${bag.tagNumber} added to ${batch.id}.` });
}

export async function sendBatch(batchId, { vehicleId, mu }) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  if (!batch.bagIds.length) return fail('Scan at least one bag into the batch first.');
  if (!vehicleId || !mu) return fail('Delivery vehicle and make-up position are both required.');
  batch.vehicleId = vehicleId;
  batch.mu = mu;
  batch.sentAt = nowIso();
  batch.status = 'Sent';
  saveStore();
  return ok(clone(batch));
}

export async function getAirlineDecision(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  return ok({ decided: !!batch.decision, decision: batch.decision, rejectedBagIds: batch.rejectedBagIds, rejectReason: batch.rejectReason });
}

export async function recordDecisionFallback(batchId, { decision, rejectedBagIds, reason, notes }) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  let finalDecision = decision;
  let finalRejected = rejectedBagIds || [];
  let finalReason = reason;
  if (store.airlineRejectsNext) {
    const proneBagId = store.depBags.find((b) => batch.bagIds.includes(b.id) && b.rejectionProne)?.id;
    finalDecision = 'reject';
    finalRejected = proneBagId ? [proneBagId] : finalRejected;
    finalReason = 'PNR mismatch';
    store.airlineRejectsNext = false;
  }
  if (finalDecision === 'reject') {
    if (!finalReason) return fail('A rejection reason is required.');
    if (!notes || !notes.trim()) return fail('Notes are required.');
    if (!finalRejected.length) return fail('Select at least one bag to reject.');
    for (const bagId of finalRejected) {
      const bag = findDepBag(store, bagId);
      if (bag) {
        bag.rejected = true; bag.rejectReason = finalReason;
        ensureException(store, { type: 'Handover Rejected', severity: 'High', batchId, bagId, flightCode: batch.flightCode, note: `${finalReason} — ${notes}` });
      }
    }
    batch.status = finalRejected.length === batch.bagIds.length ? 'Rejected' : 'Partially Rejected';
  } else {
    batch.status = 'Decided';
  }
  batch.decision = finalDecision;
  batch.rejectedBagIds = finalRejected;
  batch.rejectReason = finalDecision === 'reject' ? finalReason : null;
  saveStore();
  return ok(clone(batch));
}

export async function resolveWithAirline(batchId, { action, notes }) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  if (!action) return fail('Choose a resolution action.');
  const text = (notes || '').trim();
  if (!text) return fail('Notes are required.');
  batch.resolution = { action, notes: text, at: nowIso() };
  for (const bagId of batch.rejectedBagIds) {
    const bag = findDepBag(store, bagId);
    if (!bag) continue;
    resolveBagException(store, bagId, `${action} — ${text}`);
    if (action === 'Bag withdrawn from batch') {
      bag.batchId = null;
      batch.bagIds = batch.bagIds.filter((id) => id !== bagId);
    } else {
      bag.rejected = false;
      bag.rejectReason = null;
    }
  }
  batch.rejectedBagIds = [];
  batch.status = 'Open';
  batch.decision = null;
  saveStore();
  return ok(clone(batch));
}

export async function recordReceiver(batchId, { name, staffId, company, role, signatureDataUrl }) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const n = (name || '').trim();
  const id = (staffId || '').trim();
  if (n.length < 3 || n.length > 80) return fail('Receiver name must be 3–80 characters.');
  if (id.length < 4 || id.length > 20) return fail('Staff ID must be 4–20 characters.');
  if (!company || !company.trim()) return fail('Company is required.');
  if (!role) return fail('Role is required.');
  if (!signatureDataUrl) return fail('A signature is required.');
  batch.receiver = { name: n, staffId: id, company: company.trim(), role, signatureDataUrl, at: nowIso() };
  batch.status = 'Accepted';
  const bags = store.depBags.filter((b) => batch.bagIds.includes(b.id) && !b.rejected);
  for (const bag of bags) {
    bag.status = 'Handed to Airline';
    bag.timeline.push({ stage: 'Handed to Airline', time: nowIso(), result: 'ok' });
  }
  saveStore();
  return ok(clone(batch));
}

export async function getHandoverReceipt(batchId) {
  const store = getStore();
  const batch = findBatch(store, batchId);
  if (!batch) return fail('Batch not found.');
  const bags = store.depBags.filter((b) => batch.bagIds.includes(b.id)).map((b) => hydrateDepBag(store, b));
  return ok({ batch: clone(batch), bags, generatedAt: nowIso() });
}

export async function generateHandoverReport(flightCode) {
  const store = getStore();
  const batches = store.depBatches.filter((b) => b.flightCode === flightCode);
  const bags = store.depBags.filter((b) => b.flightCode === flightCode);
  return ok({
    flightCode, generatedAt: nowIso(),
    batches: batches.map((b) => ({ id: b.id, status: b.status, bagCount: b.bagIds.length, rejectedCount: b.rejectedBagIds.length })),
    handedCount: bags.filter((b) => b.status === 'Handed to Airline').length,
    totalCount: bags.length,
  });
}

export async function notifyOperationsManager(message) {
  return ok({ notified: true, message: message || 'Operations Manager notified.' });
}

/* ===================== ARRIVAL: FLIGHTS & PREP ===================== */

export async function getArrFlights() {
  const store = getStore();
  const staff = myStaff(store);
  return ok(store.arrFlights.filter((f) => forAirport(staff, f)).map((f) => clone(f)));
}

export async function getArrFlight(id) {
  const store = getStore();
  const flight = findArrFlight(store, id);
  if (!flight) return fail('Flight not found.');
  return ok(clone(flight));
}

export async function syncNusuk(flightCode) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (flight.nusukSyncedAt) {
    const unchanged = store.arrPilgrims.filter((p) => store.arrBags.some((b) => b.flightCode === flightCode && b.pilgrimId === p.id)).length;
    return ok({ created: 0, unchanged, message: `0 new, ${unchanged} unchanged` });
  }
  const source = store.nusukSource.flightCode === flightCode ? store.nusukSource : null;
  if (!source) return fail('No Nusuk manifest available for this flight.');
  store.arrPilgrims.push(...source.pilgrims);
  store.arrBags.push(...source.bags);
  flight.nusukSyncedAt = nowIso();
  saveStore();
  return ok({ created: source.pilgrims.length, unchanged: 0, message: `${source.pilgrims.length} new, 0 unchanged` });
}

export async function togglePrepItem(flightCode, index, done) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const item = flight.prepChecklist[index];
  if (!item) return fail('Checklist item not found.');
  item.done = done;
  item.at = done ? nowIso() : null;
  saveStore();
  return ok(clone(flight));
}

export async function notifyHotels(flightCode) {
  return ok({ notified: true, flightCode });
}

export async function markPrepComplete(flightCode) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (!flight.nusukSyncedAt) return fail('Sync passengers from Nusuk first.');
  if (flight.prepChecklist.some((i) => !i.done)) return fail('Complete every checklist item first.');
  flight.prepCompletedAt = nowIso();
  saveStore();
  return ok(clone(flight));
}

export async function markLanded(flightCode, actualTime) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const diffMin = Math.abs(new Date(actualTime).getTime() - new Date(flight.eta).getTime()) / 60000;
  if (diffMin > 60) return fail('Actual landing time must be within ±60 minutes of the scheduled ETA.');
  flight.landedAt = actualTime;
  flight.status = 'Landed';
  saveStore();
  return ok(clone(flight));
}

export async function markArrivedAtGate(flightCode, { gate, carousel }) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (!gate || !carousel) return fail('Gate and carousel are both required.');
  flight.gate = gate;
  flight.carousel = carousel;
  flight.gateArrivedAt = nowIso();
  flight.status = 'At Gate';
  saveStore();
  return ok(clone(flight));
}

export async function requestBaggageRelease(flightCode, notes) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  flight.releaseTime = nowIso();
  flight.coordinationNotes = (notes || '').trim() || null;
  saveStore();
  return ok(clone(flight));
}

export async function startReceivingBaggage(flightCode) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (!flight.gateArrivedAt) return fail('Mark the flight arrived at the gate before receiving baggage.');
  flight.status = 'Receiving';
  saveStore();
  return ok(clone(flight));
}

/* ===================== ARRIVAL: RECEIVING & VERIFY ===================== */

export async function getArrReceiving(flightCode) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const bags = store.arrBags.filter((b) => b.flightCode === flightCode).map((b) => hydrateArrBag(store, b));
  return ok({
    flight: clone(flight),
    expected: bags.filter((b) => !b.scannedAt),
    received: bags.filter((b) => b.scannedAt),
  });
}

export async function arrScanBag(flightCode, scannedCode) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (String(scannedCode).trim() === '0000000000') {
    return ok({ unidentified: true, message: 'Tag not recognised — record as unidentified.' });
  }
  const bag = findArrBagByTag(store, scannedCode);
  if (!bag || bag.flightCode !== flightCode) return fail('Unrecognised tag.', 'not-found');
  if (bag.scannedAt) return fail(`${bag.tagNumber} has already been scanned.`);
  bag.status = 'Received at Airport';
  bag.scannedAt = nowIso();
  bag.timeline.push({ stage: 'Received at Airport', time: bag.scannedAt, result: 'ok' });
  saveStore();
  return ok({ bag: hydrateArrBag(store, bag), message: `${bag.tagNumber} received.` });
}

export async function recordUnidentifiedBag(flightCode, description) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const text = (description || '').trim();
  if (text.length < 5 || text.length > 200) return fail('Description must be 5–200 characters.');
  const bag = {
    id: newId('UNID'), tagNumber: `UNIDENTIFIED-${newId('')}`.slice(0, 20), airlineTagNumber: null,
    pilgrimId: null, direction: 'arrival', flightCode, hotel: null, status: 'Received at Airport',
    scannedAt: nowIso(), securityStatus: null, prohibitedInfo: null, unidentified: true, description: text,
    xrayFlag: false, missingFlag: false, timeline: [{ stage: 'Received at Airport', time: nowIso(), result: 'manual' }],
  };
  store.arrBags.push(bag);
  ensureException(store, { type: 'Unidentified Bag', severity: 'Medium', bagId: bag.id, flightCode, note: text });
  saveStore();
  return ok(hydrateArrBag(store, bag));
}

export async function recordGroundHandlerHandoff(flightCode, { repName, signatureDataUrl }) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (!repName || !repName.trim()) return fail('Ground handler representative name is required.');
  flight.handoffRecord = { repName: repName.trim(), signatureDataUrl: signatureDataUrl || null, at: nowIso() };
  saveStore();
  return ok(clone(flight));
}

export async function computeArrDiscrepancy(flightCode) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const bags = store.arrBags.filter((b) => b.flightCode === flightCode);
  return ok({
    missing: bags.filter((b) => !b.scannedAt && !b.unidentified).map((b) => hydrateArrBag(store, b)),
    unidentifiedList: bags.filter((b) => b.unidentified).map((b) => hydrateArrBag(store, b)),
  });
}

export async function recordArrDiscrepancy(flightCode, notes) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const text = (notes || '').trim();
  if (text.length < 10 || text.length > 500) return fail('Discrepancy notes must be 10–500 characters.');
  const bags = store.arrBags.filter((b) => b.flightCode === flightCode);
  let created = 0;
  for (const bag of bags.filter((b) => !b.scannedAt && !b.unidentified)) {
    if (!store.exceptions.some((e) => e.bagId === bag.id && !['Resolved', 'Closed'].includes(e.status))) {
      ensureException(store, { type: 'Missing Bag', severity: 'Medium', bagId: bag.id, flightCode, note: text });
      created += 1;
    }
  }
  for (const bag of bags.filter((b) => b.unidentified)) {
    if (!store.exceptions.some((e) => e.bagId === bag.id && !['Resolved', 'Closed'].includes(e.status))) {
      ensureException(store, { type: 'Unidentified Bag', severity: 'Medium', bagId: bag.id, flightCode, note: text });
      created += 1;
    }
  }
  flight.discrepancyRecorded = true;
  saveStore();
  return ok({ exceptionsCreated: created });
}

export async function getSopState(flightCode) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  if (!flight.sopChecklist) {
    flight.sopChecklist = SOP_STEPS.map((label) => ({ label, done: false, note: null, at: null, staffInitials: null }));
    flight.pir = null;
    saveStore();
  }
  return ok({ sopChecklist: clone(flight.sopChecklist), pir: flight.pir });
}

export async function recordSopStep(flightCode, stepIndex, note) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight || !flight.sopChecklist) return fail('SOP checklist not initialised.');
  const step = flight.sopChecklist[stepIndex];
  if (!step) return fail('Step not found.');
  const text = (note || '').trim();
  if (!text) return fail('A note is required when ticking a step.');
  const staff = myStaff(store);
  step.done = true;
  step.note = text;
  step.at = nowIso();
  step.staffInitials = staff ? staff.name.split(' ').map((p) => p[0]).join('').toUpperCase() : '—';
  saveStore();
  return ok(clone(flight.sopChecklist));
}

export async function setPir(flightCode, pirNumber) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const value = String(pirNumber).trim().toUpperCase();
  if (!/^[A-Z0-9]{8,12}$/.test(value)) return fail('PIR number must be 8–12 alphanumeric characters.');
  flight.pir = value;
  saveStore();
  return ok({ pir: value });
}

export async function bagFoundArrival(bagId, scannedTag) {
  const store = getStore();
  const bag = findArrBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (String(scannedTag).trim().toLowerCase() !== bag.tagNumber.toLowerCase()) {
    return fail(`That tag doesn't match ${bag.tagNumber}.`);
  }
  bag.status = 'Received at Airport';
  bag.scannedAt = nowIso();
  bag.timeline.push({ stage: 'Received at Airport', time: bag.scannedAt, result: 'ok' });
  resolveBagException(store, bagId, 'Bag found');
  saveStore();
  return ok(hydrateArrBag(store, bag));
}

export async function matchUnidentified(unidentifiedBagId, missingBagId) {
  const store = getStore();
  const unid = findArrBag(store, unidentifiedBagId);
  const missing = findArrBag(store, missingBagId);
  if (!unid || !missing) return fail('Bag not found.');
  unid.unidentified = false;
  unid.tagNumber = missing.tagNumber;
  unid.airlineTagNumber = missing.airlineTagNumber;
  unid.pilgrimId = missing.pilgrimId;
  unid.hotel = missing.hotel;
  resolveBagException(store, unidentifiedBagId, `Matched to ${missing.tagNumber}`);
  resolveBagException(store, missingBagId, `Matched to unidentified bag`);
  store.arrBags = store.arrBags.filter((b) => b.id !== missingBagId);
  saveStore();
  return ok(hydrateArrBag(store, unid));
}

export async function acceptBaggageAtAirport(flightCode) {
  const store = getStore();
  const flight = findArrFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  const unresolvedMissing = store.arrBags.filter((b) => b.flightCode === flightCode && !b.scannedAt && !b.unidentified);
  if (unresolvedMissing.length) return fail(`${unresolvedMissing.length} bag(s) still missing — find or match them before accepting.`);
  flight.acceptedAt = nowIso();
  saveStore();
  return ok({ flightCode, acceptedAt: flight.acceptedAt });
}

/* ===================== ARRIVAL: SECURITY ===================== */

export async function getSecurityQueue(flightCode) {
  const store = getStore();
  const bags = store.arrBags.filter((b) => (!flightCode || b.flightCode === flightCode)
    && b.status === 'Received at Airport' && !b.securityStatus);
  return ok(bags.map((b) => hydrateArrBag(store, b)));
}

export async function securityScan(bagId, method) {
  const store = getStore();
  const bag = findArrBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (bag.securityStatus) return fail(`${bag.tagNumber} has already been security-checked.`);
  if (bag.xrayFlag && method === 'xray') {
    bag.securityStatus = 'Prohibited';
    saveStore();
    return ok({ bag: hydrateArrBag(store, bag), result: 'Prohibited' });
  }
  bag.securityStatus = 'Clear';
  bag.status = 'Security Checked';
  bag.timeline.push({ stage: 'Security Checked', time: nowIso(), result: 'ok' });
  saveStore();
  return ok({ bag: hydrateArrBag(store, bag), result: 'Clear' });
}

export async function recordProhibitedItems(bagId, { items, notes }) {
  const store = getStore();
  const bag = findArrBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (!items || !items.length) return fail('Select at least one item type.');
  if (!notes || !notes.trim()) return fail('Notes are required.');
  bag.prohibitedInfo = { items, notes: notes.trim(), removedAt: nowIso(), reSealedAt: null };
  ensureException(store, { type: 'Prohibited Items', severity: 'High', bagId, flightCode: bag.flightCode, note: `${items.join(', ')} — ${notes.trim()}` });
  saveStore();
  return ok(clone(bag));
}

export async function resealBag(bagId) {
  const store = getStore();
  const bag = findArrBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (!bag.prohibitedInfo) return fail('Record the prohibited items before resealing.');
  bag.prohibitedInfo.reSealedAt = nowIso();
  bag.securityStatus = 'Clear';
  bag.status = 'Security Checked';
  bag.timeline.push({ stage: 'Security Checked', time: nowIso(), result: 'ok' });
  resolveBagException(store, bagId, 'Items removed and bag re-sealed.');
  saveStore();
  return ok(clone(bag));
}

/* ===================== ARRIVAL: LOADING & DISPATCH ===================== */

export async function getReadyToLoadGroups() {
  const store = getStore();
  const bags = store.arrBags.filter((b) => b.status === 'Security Checked' && !b.outboundTripId);
  const byHotel = {};
  for (const b of bags) {
    const h = hydrateArrBag(store, b);
    byHotel[h.hotel] = byHotel[h.hotel] || { hotel: h.hotel, bagCount: 0, pilgrimIds: new Set() };
    byHotel[h.hotel].bagCount += 1;
    if (h.pilgrimId) byHotel[h.hotel].pilgrimIds.add(h.pilgrimId);
  }
  return ok(Object.values(byHotel).map((g) => ({ hotel: g.hotel, bagCount: g.bagCount, pilgrimCount: g.pilgrimIds.size })));
}

export async function getOutboundTrucks() {
  const store = getStore();
  return ok(clone(store.outboundTrucks));
}

export async function planTrips(groups) {
  const store = getStore();
  const created = [];
  for (const g of groups) {
    const truck = findTruck(store, g.truckId);
    if (!truck) return fail('Select a truck for every group.');
    if (truck.status !== 'Available') return fail(`${truck.code} is not available.`);
    const bags = store.arrBags.filter((b) => b.status === 'Security Checked' && !b.outboundTripId && hydrateArrBag(store, b).hotel === g.hotel);
    if (bags.length > truck.capacity) return fail(`${g.hotel} has ${bags.length} bags — exceeds ${truck.code}'s capacity of ${truck.capacity}. Split across 2 trucks.`);
    const trip = {
      id: newId('ATRP'), hotel: g.hotel, truckId: truck.id, truckCode: truck.code, driverName: truck.driverName,
      status: 'Planned', bagIds: bags.map((b) => b.id), createdAt: nowIso(),
      driverVerifiedCount: false, driverConfirmedSeal: false, departureTime: null,
    };
    for (const bag of bags) bag.outboundTripId = trip.id;
    truck.status = 'Assigned';
    store.arrTrips.push(trip);
    created.push(trip);
  }
  saveStore();
  return ok(clone(created));
}

export async function getArrTrips() {
  const store = getStore();
  return ok(clone(store.arrTrips));
}

export async function getArrTrip(tripId) {
  const store = getStore();
  const trip = findArrTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.arrBags.filter((b) => trip.bagIds.includes(b.id)).map((b) => hydrateArrBag(store, b));
  return ok({ ...clone(trip), bags });
}

export async function loadScan(tripId, scannedTag) {
  const store = getStore();
  const trip = findArrTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bag = findArrBagByTag(store, scannedTag);
  if (!bag || !trip.bagIds.includes(bag.id)) return fail('This bag is not part of this trip.', 'not-found');
  const hydrated = hydrateArrBag(store, bag);
  if (hydrated.hotel !== trip.hotel) return fail(`${bag.tagNumber} belongs to a different hotel.`, 'wrong-hotel');
  if (bag.securityStatus !== 'Clear') return fail(`${bag.tagNumber} has not passed security check.`, 'not-checked');
  if (bag.status === 'Loaded to Truck') return fail(`${bag.tagNumber} is already loaded.`, 'already-loaded');
  bag.status = 'Loaded to Truck';
  bag.timeline.push({ stage: 'Loaded to Truck', time: nowIso(), result: 'ok' });
  saveStore();
  const loadedCount = store.arrBags.filter((b) => trip.bagIds.includes(b.id) && b.status === 'Loaded to Truck').length;
  return ok({ bag: hydrateArrBag(store, bag), loadedCount, total: trip.bagIds.length, message: `${bag.tagNumber} loaded.` });
}

export async function removeFromTrip(tripId, bagId) {
  const store = getStore();
  const trip = findArrTrip(store, tripId);
  const bag = findArrBag(store, bagId);
  if (!trip || !bag) return fail('Not found.');
  bag.status = 'Security Checked';
  saveStore();
  return ok(hydrateArrBag(store, bag));
}

export async function loadingComplete(tripId) {
  const store = getStore();
  const trip = findArrTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const loaded = store.arrBags.filter((b) => trip.bagIds.includes(b.id) && b.status === 'Loaded to Truck').length;
  if (loaded < trip.bagIds.length) return fail('Scan every bag onto the truck before completing loading.');
  trip.status = 'Loaded';
  saveStore();
  return ok(clone(trip));
}

export async function simulateDriverCountSeal(tripId) {
  const store = getStore();
  const trip = findArrTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.driverVerifiedCount = true;
  trip.driverConfirmedSeal = true;
  saveStore();
  return ok(clone(trip));
}

export async function dispatch(tripId, departureTime) {
  const store = getStore();
  const trip = findArrTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.driverVerifiedCount || !trip.driverConfirmedSeal) return fail('Waiting for driver count & seal.');
  const diffMin = Math.abs(new Date(departureTime).getTime() - Date.now()) / 60000;
  if (diffMin > 30) return fail('Departure time must be within ±30 minutes of now.');
  trip.status = 'Dispatched';
  trip.departureTime = departureTime;
  for (const bag of store.arrBags.filter((b) => trip.bagIds.includes(b.id))) {
    bag.status = 'In Transit to Accommodation';
    bag.timeline.push({ stage: 'In Transit to Accommodation', time: nowIso(), result: 'ok' });
  }
  saveStore();
  return ok(clone(trip));
}

export async function getLoadingReport(tripId) {
  const store = getStore();
  const trip = findArrTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.arrBags.filter((b) => trip.bagIds.includes(b.id)).map((b) => hydrateArrBag(store, b));
  return ok({ trip: clone(trip), bags, generatedAt: nowIso() });
}

/* ===================== EXCEPTIONS ===================== */

export async function getExceptions(filters = {}) {
  const store = getStore();
  let list = store.exceptions;
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

export async function assignToMe(id) {
  const store = getStore();
  const exc = store.exceptions.find((e) => e.id === id);
  if (!exc) return fail('Exception not found.');
  const staff = myStaff(store);
  exc.status = exc.status === 'Open' ? 'Assigned' : exc.status;
  exc.assignee = staff?.name || 'Me';
  saveStore();
  return ok(clone(exc));
}

export async function addExceptionNote(id, text) {
  const store = getStore();
  const exc = store.exceptions.find((e) => e.id === id);
  if (!exc) return fail('Exception not found.');
  const note = (text || '').trim();
  if (!note) return fail('A note is required.');
  exc.notes.push({ at: nowIso(), text: note });
  saveStore();
  return ok(clone(exc));
}

/* ===================== HANDOVER ===================== */

export async function getHandoverSummary() {
  const store = getStore();
  const staff = myStaff(store);
  const depTrips = store.depTrips.filter((t) => forAirport(staff, t));
  const arrFlights = store.arrFlights.filter((f) => forAirport(staff, f));
  return ok({
    departure: {
      trucksAtGate: depTrips.filter((t) => ['At Destination', 'Security Hold'].includes(t.status)).length,
      openBatches: store.depBatches.filter((b) => !['Accepted', 'Rejected'].includes(b.status)).length,
    },
    arrival: {
      flightsReceiving: arrFlights.filter((f) => f.status === 'Receiving').length,
      tripsNotDispatched: store.arrTrips.filter((t) => t.status !== 'Dispatched').length,
    },
    openExceptions: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)).length,
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

export async function demoSendDepartureTruckNow() {
  const store = getStore();
  const trip = store.depTrips.find((t) => t.status === 'En route');
  if (!trip) return fail('No en-route truck available.');
  trip.eta = nowIso();
  trip.status = 'At Destination';
  trip.arrivedAt = nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function demoSimulateUnloading(tripId, allButOne) {
  const store = getStore();
  const trip = findTrip(store, tripId) || store.depTrips.find((t) => ['At Destination', 'Security Hold'].includes(t.status));
  if (!trip) return fail('No truck at the gate.');
  const bags = store.depBags.filter((b) => b.truckTripId === trip.id && b.status === 'In Transit to Airport');
  const toScan = allButOne ? bags.slice(0, -1) : bags;
  toScan.forEach((b) => {
    b.status = 'Received at Airport'; b.scannedAt = nowIso();
    b.timeline.push({ stage: 'Received at Airport', time: b.scannedAt, result: 'ok' });
  });
  saveStore();
  return ok({ scanned: toScan.length, tripId: trip.id });
}

export async function demoAirlineRejectsNext() {
  const store = getStore();
  store.airlineRejectsNext = true;
  saveStore();
  return ok({ armed: true });
}

export async function demoCreateArrivalFlightLanding10Min() {
  const store = getStore();
  const code = `QR ${Math.floor(300 + Math.random() * 600)}`;
  const flight = {
    id: newId('AFL'), code, origin: 'DOH', destination: 'JED', airport: 'JED',
    eta: new Date(Date.now() + 10 * 60000).toISOString(), landedAt: null, gateArrivedAt: null, gate: null, carousel: null,
    status: 'Scheduled', nusukSyncedAt: null,
    prepChecklist: ['Confirm ground handler contact', 'Review passenger manifest', 'Assign receiving bay',
      'Brief receiving team', 'Prepare SOP kit', 'Check security roster', 'Confirm hotel trucks available'].map((label) => ({ label, done: false, at: null })),
    prepCompletedAt: null,
    groundHandlerContact: { name: 'Hajj Terminal Ground Handling Co.', phone: '+966512220099' },
    releaseTime: null, coordinationNotes: null,
  };
  store.arrFlights.push(flight);
  const pilgrims = [1, 2].map((i) => ({
    id: newId('APIL'), name: `Demo Pilgrim ${i}`, nationality: 'Indonesian', groupName: 'Demo Group', nusukId: newId('NSK'),
    passportLast4: String(1000 + i), phone: `+96650199900${i}`, hotel: i % 2 ? 'SAFWA' : 'EIMAN',
  }));
  store.arrPilgrims.push(...pilgrims);
  const bags = [];
  pilgrims.forEach((p, i) => {
    for (let b = 0; b < 2; b++) {
      bags.push({
        id: newId('ABAG'), tagNumber: `RBL-B-${newId('').slice(0, 5)}`, airlineTagNumber: `09${newId('').slice(0, 8)}`,
        pilgrimId: p.id, direction: 'arrival', flightCode: code, hotel: p.hotel, status: 'Expected',
        scannedAt: null, securityStatus: null, prohibitedInfo: null, unidentified: false, xrayFlag: false, missingFlag: false, timeline: [],
      });
    }
  });
  store.arrBags.push(...bags);
  flight.nusukSyncedAt = nowIso();
  saveStore();
  return ok({ flightCode: code });
}

export async function demoSimulateCarousel(flightCode, mode) {
  const store = getStore();
  const bags = store.arrBags.filter((b) => b.flightCode === flightCode && !b.scannedAt && !b.unidentified);
  const toScan = mode === 'all-but-one-plus-unidentified' ? bags.filter((b) => !b.missingFlag) : bags;
  toScan.forEach((b) => {
    b.status = 'Received at Airport'; b.scannedAt = nowIso();
    b.timeline.push({ stage: 'Received at Airport', time: b.scannedAt, result: 'ok' });
  });
  saveStore();
  if (mode === 'all-but-one-plus-unidentified') {
    await recordUnidentifiedBag(flightCode, 'Black hardshell case, no visible name tag, found loose on carousel.');
  }
  return ok({ scanned: toScan.length });
}

export function demoForceNextFail() {
  const store = getStore();
  store.demoForceFail = true;
  saveStore();
}

export function demoReset() { resetStore(); }
