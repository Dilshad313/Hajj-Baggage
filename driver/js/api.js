/**
 * Mock REST API for the Driver console.
 * Every function is async, resolves after a realistic delay, and can be made
 * to reject via `?fail=1` in the URL or the one-shot demo "force fail" flag.
 * A real backend can replace this file without the UI code changing.
 */
import { getStore, saveStore, resetStore, setSession, getSession } from './store.js';
import { PLACES, DELAY_REASONS, stageMeta } from './seed.js';

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
function newId(prefix) { return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`; }

/* ===================== internal lookups ===================== */

function myStaff(store) {
  const session = getSession();
  if (!session) return null;
  return store.staff.find((s) => s.id === session.id) || null;
}

function findTrip(store, id) { return store.trips.find((t) => t.id === id); }
function findTruck(store, id) { return store.trucks.find((t) => t.id === id); }
function bagsOfTrip(store, trip) { return store.bags.filter((b) => b.tripId === trip.id); }
function placeOf(key) { return PLACES[key]; }

function activeTripFor(store, staffId) {
  return store.trips.find((t) => t.staffId === staffId && t.status !== 'Cancelled' && t.status !== 'Completed' && t.status !== 'Completed with exceptions' && t.stage !== 'complete');
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function lerp(a, b, t) { return a + (b - a) * t; }

function tripExceptionOpen(store, tripId, type) {
  return store.exceptions.find((e) => e.tripId === tripId && e.type === type && !['Resolved', 'Closed'].includes(e.status));
}

function raiseException(store, trip, type, severity, notes) {
  const exc = { id: newId('EXC'), time: nowIso(), type, severity, status: 'Open', tripId: trip.id, truckId: trip.truckId, notes: notes || null, resolvedAt: null };
  store.exceptions.unshift(exc);
  return exc;
}

function resolveException(store, tripId, type) {
  const exc = tripExceptionOpen(store, tripId, type);
  if (exc) { exc.status = 'Resolved'; exc.resolvedAt = nowIso(); }
}

function log(trip, text) {
  trip.log.push({ at: nowIso(), text });
}

function hydrateTrip(store, trip) {
  const bags = bagsOfTrip(store, trip);
  const truck = findTruck(store, trip.truckId);
  const from = placeOf(trip.routeFromKey);
  const to = placeOf(trip.routeToKey);
  const meta = stageMeta(trip.direction);
  return {
    ...clone(trip),
    bags: clone(bags),
    truck: clone(truck),
    fromName: from.name, toName: to.name,
    fromKey: trip.routeFromKey, toKey: trip.routeToKey,
    fromPosition: [from.lat, from.lng], toPosition: [to.lat, to.lng],
    stepLabels: meta.labels,
    stepIndex: meta.indexOf(trip.stage),
    stepCount: meta.labels.length,
  };
}

/* ===================== AUTH ===================== */

/** @param {string} employeeId @param {string} pin */
export async function login(employeeId, pin) {
  const store = getStore();
  const staff = store.staff.find((s) => s.employeeId.toLowerCase() === String(employeeId).toLowerCase());
  if (!staff || staff.pin !== pin) return fail('Invalid employee ID or PIN.');
  const session = { id: staff.id, name: staff.name, employeeId: staff.employeeId };
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

/* ===================== TRIPS ===================== */

function tripSortRank(t) {
  if (t.status === 'In Progress') return 0;
  if (t.status === 'On Hold') return 1;
  if (t.status === 'Assigned') return 2;
  return 3;
}

/** @param {{tab?:'today'|'upcoming'|'completed'|'cancelled'}} filters */
export async function getTrips(filters = {}) {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  let trips = store.trips.filter((t) => t.staffId === staff.id);
  if (filters.tab === 'completed') trips = trips.filter((t) => t.status === 'Completed' || t.status === 'Completed with exceptions');
  else if (filters.tab === 'cancelled') trips = trips.filter((t) => t.status === 'Cancelled');
  else if (filters.tab === 'upcoming') trips = trips.filter((t) => t.status === 'Assigned');
  else trips = trips.filter((t) => t.status === 'In Progress' || t.status === 'On Hold');
  trips = trips.slice().sort((a, b) => tripSortRank(a) - tripSortRank(b));
  return ok(trips.map((t) => hydrateTrip(store, t)));
}

export async function getTrip(id) {
  const store = getStore();
  const trip = findTrip(store, id);
  if (!trip) return fail('Trip not found.');
  return ok(hydrateTrip(store, trip));
}

/* ===================== VEHICLE ===================== */

export async function scanVehicle(tripId, scannedCode) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const code = String(scannedCode || '').trim().toUpperCase();
  const truck = findTruck(store, trip.truckId);
  const scannedTruck = store.trucks.find((t) => t.id === code);
  if (!scannedTruck) return fail('Vehicle not found.');
  if (scannedTruck.id !== truck.id) return fail(`Wrong vehicle — this trip uses ${truck.id}.`);
  if (truck.status === 'Out of Service') return fail(`${truck.id} is out of service.`);
  trip.vehicle.scannedOk = true;
  trip.vehicle.scannedAt = nowIso();
  trip.stage = 'pretrip';
  log(trip, `Vehicle ${truck.id} scanned — OK.`);
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== PRE-TRIP ===================== */

export async function submitPreTrip(tripId, { odometer, fuel, rows }) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const truck = findTruck(store, trip.truckId);
  const odo = Number(odometer);
  if (!Number.isInteger(odo)) return fail('Odometer is required.');
  if (odo < truck.odometer) return fail(`Odometer can't be lower than ${truck.odometer.toLocaleString('en-US')} km.`);
  if (!fuel) return fail('Fuel level is required.');
  for (const row of rows) {
    if (row.result !== 'Pass' && row.result !== 'Fail') return fail(`${row.label}: mark Pass or Fail.`);
    if (row.result === 'Fail' && (!row.note || row.note.trim().length < 5)) return fail(`${row.label}: a note of at least 5 characters is required for a Fail.`);
  }
  trip.preTrip = { odometerStart: odo, fuelStart: fuel, rows: clone(rows), submittedAt: nowIso() };
  truck.odometer = odo;
  const failedRow = rows.find((r) => r.result === 'Fail');
  if (failedRow) {
    trip.status = 'On Hold';
    raiseException(store, trip, 'Vehicle Issue', 'High', `${failedRow.label}: ${failedRow.note}`);
    log(trip, `Pre-trip check failed — ${failedRow.label}.`);
    saveStore();
    return ok({ passed: false, failedItem: failedRow.label, trip: hydrateTrip(store, trip) });
  }
  trip.stage = 'pickup';
  log(trip, 'Pre-trip check submitted — all pass.');
  saveStore();
  return ok({ passed: true, trip: hydrateTrip(store, trip) });
}

export async function cancelTrip(tripId, reason) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.status = 'Cancelled';
  trip.cancelReason = reason || 'Vehicle failed pre-trip check.';
  trip.cancelledAt = nowIso();
  log(trip, `Trip cancelled — ${trip.cancelReason}`);
  saveStore();
  return ok(clone(trip));
}

export async function assignBackup(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const wantType = trip.direction === 'Departure' ? 'Airport Transfer' : 'Arrival Transfer';
  const busyTruckIds = new Set(store.trips.filter((t) => t.id !== trip.id && !['Cancelled', 'Completed', 'Completed with exceptions'].includes(t.status)).map((t) => t.truckId));
  const spare = store.trucks.find((t) => t.type === wantType && t.status === 'Active' && t.id !== trip.truckId && !busyTruckIds.has(t.id));
  if (!spare) return fail('No backup vehicle is available right now — contact your supervisor.');

  const newTripId = newId(trip.direction === 'Departure' ? 'TRP-D' : 'TRP-A');
  const backup = {
    ...clone(trip),
    id: newTripId, truckId: spare.id, status: 'Assigned', stage: 'vehicle',
    vehicle: { scannedOk: false, scannedAt: null },
    preTrip: { odometerStart: spare.odometer, fuelStart: spare.fuel, rows: null, submittedAt: null },
    pickup: { departedAt: null, arrivedAt: null, scannedCode: null },
    count: { ...clone(trip.count), loadedBagIds: [], verifiedCount: null, verified: false, mismatchNote: null },
    seal: { number: null, sealedBy: null, confirmedByDriver: false },
    transit: { startedAt: null, position: null, speedKmh: 0, distanceRemainingKm: null, etaAt: null, gpsActive: false, lastPingAt: null, trail: [] },
    delays: [], arrive: { arrivedAt: null, scannedCode: null },
    security: { outcome: null, reason: null, notes: null, clearedAt: null, holdStartedAt: null },
    offload: { bay: null, sealBroken: false, unloadedBagIds: [], searchStartedAt: null, missingBagIds: [] },
    handover: { receiverName: null, receiverId: null, org: null, signatureDataUrl: null, driverConfirmed: false, qrPayload: null, generatedAt: null, receiverScanned: false },
    completion: null, cancelReason: null, cancelledAt: null, backupTripId: null,
    createdAt: nowIso(), log: [{ at: nowIso(), text: `Backup vehicle assigned — ${spare.id}, replacing ${trip.truckId}.` }],
  };
  store.trips.push(backup);
  bagsOfTrip(store, trip).forEach((b) => { b.tripId = newTripId; b.status = 'Awaiting load'; });
  trip.backupTripId = newTripId;
  if (trip.status !== 'Cancelled') {
    trip.status = 'Cancelled';
    trip.cancelReason = trip.cancelReason || `${trip.truckId} unavailable.`;
    trip.cancelledAt = nowIso();
    log(trip, `Trip cancelled — ${trip.cancelReason}`);
  }
  saveStore();
  return ok({ tripId: newTripId });
}

/* ===================== PICKUP ===================== */

export async function departPickup(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.pickup.departedAt = nowIso();
  log(trip, `Departed for pickup at ${placeOf(trip.routeFromKey).name}.`);
  saveStore();
  return ok(clone(trip.pickup));
}

export async function arrivePickup(tripId, scannedCode) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const gate = placeOf(trip.routeFromKey).pickupGateCode;
  const code = String(scannedCode || '').trim().toUpperCase();
  if (code !== gate.toUpperCase()) return fail(`That QR doesn't match the pickup point (${gate}).`);
  trip.pickup.arrivedAt = nowIso();
  trip.pickup.scannedCode = code;
  trip.stage = 'count';
  log(trip, `Arrived at ${placeOf(trip.routeFromKey).name}.`);
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== LOADING & COUNT ===================== */

export async function getLoadCount(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const c = trip.count;
  if (!c.verified && c.loadedBagIds.length < c.expected) {
    const last = c.lastAutoLoadAt ? new Date(c.lastAutoLoadAt).getTime() : 0;
    if (Date.now() - last > 4000) {
      const bags = bagsOfTrip(store, trip).filter((b) => !c.loadedBagIds.includes(b.id));
      const next = bags[0];
      if (next) {
        c.loadedBagIds.push(next.id);
        next.status = 'On truck';
        c.lastAutoLoadAt = nowIso();
        saveStore();
      }
    }
  }
  return ok({ loaded: c.loadedBagIds.length, expected: c.expected, bags: clone(bagsOfTrip(store, trip)) });
}

export async function verifyCount(tripId, physicalCount) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const n = Number(physicalCount);
  if (!Number.isInteger(n) || n < 0 || n > 999) return fail('Enter a count between 0 and 999.');
  const c = trip.count;
  c.verifiedCount = n;
  if (n !== c.expected) {
    c.mismatchNote = `Count mismatch: system ${c.expected}, counted ${n}.`;
    raiseException(store, trip, 'Count Mismatch', 'Medium', c.mismatchNote);
    log(trip, c.mismatchNote);
    saveStore();
    return ok({ verified: false, message: c.mismatchNote, trip: hydrateTrip(store, trip) });
  }
  c.verified = true;
  c.mismatchNote = null;
  resolveException(store, tripId, 'Count Mismatch');
  trip.stage = 'seal';
  log(trip, `Count verified — ${n} bags.`);
  saveStore();
  return ok({ verified: true, trip: hydrateTrip(store, trip) });
}

export async function scanCountBag(tripId, scannedTag) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bag = bagsOfTrip(store, trip).find((b) => b.tagNumber.toLowerCase() === String(scannedTag).toLowerCase());
  if (!bag) return fail('This bag is not part of this trip.');
  if (trip.count.loadedBagIds.includes(bag.id)) return fail(`${bag.tagNumber} is already scanned.`);
  trip.count.loadedBagIds.push(bag.id);
  bag.status = 'On truck';
  saveStore();
  return ok({ bag: clone(bag), scanned: trip.count.loadedBagIds.length, expected: trip.count.expected });
}

export async function finalizeScanCount(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (trip.count.loadedBagIds.length !== trip.count.expected) return fail(`${trip.count.loadedBagIds.length} of ${trip.count.expected} bags scanned — keep scanning or recount.`);
  trip.count.verified = true;
  trip.count.verifiedCount = trip.count.loadedBagIds.length;
  trip.count.mismatchNote = null;
  resolveException(store, tripId, 'Count Mismatch');
  trip.stage = 'seal';
  log(trip, `Count verified by scan — ${trip.count.loadedBagIds.length} bags.`);
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== SEAL ===================== */

const SEAL_FORMAT = /^SL-[A-Z0-9]{6}$/;

function randomSealNumber() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `SL-${s}`;
}

export async function seal(tripId, { number } = {}) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const n = (number || randomSealNumber()).toUpperCase();
  if (!SEAL_FORMAT.test(n)) return fail('Seal must be in the format SL- followed by 6 letters/numbers.');
  trip.seal.number = n;
  trip.seal.sealedBy = 'driver';
  log(trip, `Truck sealed — ${n}.`);
  saveStore();
  return ok(clone(trip.seal));
}

export async function confirmSeal(tripId, scannedCode) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.seal.number) return fail('No seal has been recorded for this trip yet.');
  const code = String(scannedCode || '').trim().toUpperCase();
  if (code !== trip.seal.number) {
    raiseException(store, trip, 'Seal Mismatch', 'High', `Scanned ${code}, expected ${trip.seal.number}.`);
    saveStore();
    return fail(`Seal does not match ${trip.seal.number}.`);
  }
  trip.seal.confirmedByDriver = true;
  resolveException(store, tripId, 'Seal Mismatch');
  log(trip, `Seal ${trip.seal.number} confirmed.`);
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== START / TRANSIT (GPS) ===================== */

export async function startTrip(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.seal.confirmedByDriver) return fail('Confirm the seal before starting the trip.');
  const from = placeOf(trip.routeFromKey);
  const to = placeOf(trip.routeToKey);
  const distanceKm = haversineKm(from, to);
  const durationMin = (distanceKm / store.config.avgSpeedKmh) * 60;
  const startedAt = nowIso();
  trip.transit = {
    startedAt, position: [from.lat, from.lng], speedKmh: store.config.avgSpeedKmh,
    distanceRemainingKm: distanceKm, distanceTotalKm: distanceKm, durationMin,
    etaAt: new Date(Date.now() + durationMin * 60000).toISOString(),
    gpsActive: true, lastPingAt: startedAt, trail: [[from.lat, from.lng]],
  };
  trip.stage = 'transit';
  log(trip, `Trip started — en route to ${to.name}.`);
  saveStore();
  return ok(hydrateTrip(store, trip));
}

function recomputeTransit(store, trip) {
  const t = trip.transit;
  if (!t.startedAt) return;
  const from = placeOf(trip.routeFromKey);
  const to = placeOf(trip.routeToKey);
  const totalDelayMin = trip.delays.reduce((sum, d) => sum + d.minutes, 0);
  const adjustedDurationMs = (t.durationMin + totalDelayMin) * 60000;
  const elapsedMs = Date.now() - new Date(t.startedAt).getTime();
  const progress = Math.max(0, Math.min(1, elapsedMs / adjustedDurationMs));
  const lat = lerp(from.lat, to.lat, progress);
  const lng = lerp(from.lng, to.lng, progress);
  t.position = [lat, lng];
  t.distanceRemainingKm = t.distanceTotalKm * (1 - progress);
  t.speedKmh = progress < 1 && t.gpsActive ? Math.round(store.config.avgSpeedKmh + (Math.random() * 10 - 5)) : 0;
  t.etaAt = new Date(new Date(t.startedAt).getTime() + adjustedDurationMs).toISOString();
  t.lastPingAt = nowIso();
  if (t.gpsActive) {
    t.trail.push([lat, lng]);
    if (t.trail.length > 20) t.trail.shift();
  }
  return progress;
}

export async function gpsTick(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const progress = recomputeTransit(store, trip);
  saveStore();
  return ok({ ...clone(trip.transit), progress, nearDestination: trip.transit.distanceRemainingKm <= 3 });
}

export async function setGpsPaused(tripId, paused) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.transit.gpsActive = !paused;
  saveStore();
  return ok({ gpsActive: trip.transit.gpsActive });
}

export async function reportDelay(tripId, { reason, minutes, notes }) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!DELAY_REASONS.includes(reason)) return fail('Select a delay reason.');
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 5 || m > store.config.maxDelayMin || m % 5 !== 0) return fail(`Minutes must be between 5 and ${store.config.maxDelayMin}, in steps of 5.`);
  if ((reason === 'Other' || reason === 'Vehicle problem') && (!notes || !notes.trim())) return fail('Notes are required for this reason.');
  if (notes && notes.trim().length > 300) return fail('Notes must be 300 characters or fewer.');
  trip.delays.push({ reason, minutes: m, notes: notes ? notes.trim() : null, at: nowIso() });
  recomputeTransit(store, trip);
  log(trip, `Delay reported — ${reason}, +${m} min.`);
  const notifiedDestination = trip.direction === 'Arrival';
  saveStore();
  return ok({ trip: hydrateTrip(store, trip), notifiedDestination });
}

export async function sendEta(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  log(trip, `ETA update sent — ${new Date(trip.transit.etaAt).toISOString()}.`);
  saveStore();
  return ok({ sent: true });
}

/* ===================== ARRIVE AT DESTINATION ===================== */

export async function arriveDestination(tripId, scannedCode) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const gate = placeOf(trip.routeToKey).destGateCode;
  const code = String(scannedCode || '').trim().toUpperCase();
  if (code !== gate.toUpperCase()) return fail(`That QR doesn't match the destination (${gate}).`);
  trip.arrive.arrivedAt = nowIso();
  trip.arrive.scannedCode = code;
  trip.transit.gpsActive = false;
  trip.stage = trip.direction === 'Departure' ? 'security' : 'offload';
  log(trip, `Arrived at ${placeOf(trip.routeToKey).name}.`);
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== SECURITY (departure only) ===================== */

export async function securityOutcome(tripId, { outcome, reason, notes }) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (outcome === 'hold') {
    if (!reason) return fail('A reason is required.');
    if (!notes || notes.trim().length < 5 || notes.trim().length > 300) return fail('Notes must be 5–300 characters.');
    trip.security.outcome = 'hold';
    trip.security.reason = reason;
    trip.security.notes = notes.trim();
    trip.security.holdStartedAt = nowIso();
    trip.status = 'On Hold';
    raiseException(store, trip, 'Security Hold', 'Critical', `${reason}: ${notes.trim()}`);
    log(trip, `Security hold — ${reason}.`);
    saveStore();
    return ok(hydrateTrip(store, trip));
  }
  trip.security.outcome = 'cleared';
  trip.security.clearedAt = nowIso();
  trip.status = 'In Progress';
  trip.stage = 'offload';
  resolveException(store, tripId, 'Security Hold');
  log(trip, 'Security cleared.');
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== OFFLOAD & UNLOAD ===================== */

export async function offloadStart(tripId, { bay } = {}) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.offload.bay = bay || placeOf(trip.routeToKey).bays[0] || 'Bay 1';
  log(trip, `At offload bay — ${trip.offload.bay}.`);
  saveStore();
  return ok(clone(trip.offload));
}

export async function breakSeal(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.seal.confirmedByDriver) return fail('Seal was never confirmed for this trip.');
  trip.offload.sealBroken = true;
  log(trip, `Seal ${trip.seal.number} broken for unloading.`);
  saveStore();
  return ok(hydrateTrip(store, trip));
}

export async function unloadScan(tripId, scannedTag) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bag = bagsOfTrip(store, trip).find((b) => b.tagNumber.toLowerCase() === String(scannedTag).toLowerCase());
  if (!bag) return fail('This bag is not part of this trip.');
  if (trip.offload.unloadedBagIds.includes(bag.id)) return fail(`${bag.tagNumber} is already unloaded.`);
  trip.offload.unloadedBagIds.push(bag.id);
  bag.status = 'Unloaded';
  saveStore();
  return ok({ bag: clone(bag), unloaded: trip.offload.unloadedBagIds.length, expected: trip.count.expected });
}

export async function startSearch(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.offload.searchStartedAt = nowIso();
  saveStore();
  return ok({ searchStartedAt: trip.offload.searchStartedAt });
}

export async function reportMissing(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const missing = bagsOfTrip(store, trip).filter((b) => !trip.offload.unloadedBagIds.includes(b.id));
  trip.offload.missingBagIds = missing.map((b) => b.id);
  missing.forEach((b) => { b.status = 'Missing'; });
  if (missing.length) {
    raiseException(store, trip, 'Missing Bag', 'High', `${missing.length} bag(s) not found on truck: ${missing.map((b) => b.tagNumber).join(', ')}.`);
  }
  trip.offload.searchStartedAt = null;
  trip.stage = 'handover';
  const notifiedOpsManager = trip.direction === 'Arrival';
  log(trip, missing.length ? `Finished offload — ${missing.length} bag(s) missing.` : 'Finished offload — all bags accounted for.');
  saveStore();
  return ok({ missing: clone(missing), notifiedOpsManager, trip: hydrateTrip(store, trip) });
}

export async function finishOffloadAllFound(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (trip.offload.unloadedBagIds.length !== trip.count.expected) return fail(`${trip.count.expected - trip.offload.unloadedBagIds.length} bag(s) still not scanned.`);
  trip.stage = 'handover';
  log(trip, 'Finished offload — all bags accounted for.');
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== HANDOVER ===================== */

export async function createReceipt(tripId, { receiverName, receiverId, org, signatureDataUrl, driverConfirmed }) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const name = String(receiverName || '').trim();
  const id = String(receiverId || '').trim();
  if (name.length < 3 || name.length > 80) return fail('Receiver name must be 3–80 characters.');
  if (id.length < 4 || id.length > 20) return fail('Receiver ID must be 4–20 characters.');
  if (!org) return fail('Organisation is required.');
  if (!signatureDataUrl) return fail("Please capture the receiver's signature.");
  if (!driverConfirmed) return fail('Driver confirmation is required.');
  const bagCount = trip.direction === 'Departure' ? trip.count.loadedBagIds.length : trip.offload.unloadedBagIds.length;
  const qrPayload = `RABEL-HO-${tripId}-${bagCount}`;
  trip.handover = { receiverName: name, receiverId: id, org, signatureDataUrl, driverConfirmed: true, qrPayload, generatedAt: nowIso(), receiverScanned: false };
  log(trip, `Handover receipt generated for ${name} (${org}).`);
  saveStore();
  return ok({ ...clone(trip.handover), bagCount, tagList: bagsOfTrip(store, trip).filter((b) => (trip.direction === 'Departure' ? trip.count.loadedBagIds : trip.offload.unloadedBagIds).includes(b.id)).map((b) => b.tagNumber) });
}

export async function confirmHandover(tripId, scannedCode) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.handover.qrPayload) return fail('Generate the handover receipt first.');
  const code = String(scannedCode || '').trim();
  if (code && code !== trip.handover.qrPayload) return fail('That code does not match this handover receipt.');
  trip.handover.receiverScanned = true;
  log(trip, 'Handover confirmed.');
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== COMPLETE ===================== */

export async function completeTrip(tripId, notes) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.handover.receiverScanned) return fail('Confirm the handover before completing this trip.');
  const openExceptions = store.exceptions.filter((e) => e.tripId === tripId && !['Resolved', 'Closed'].includes(e.status));
  const missingCount = trip.offload.missingBagIds.length;
  const durationMin = trip.transit.startedAt ? Math.round((Date.now() - new Date(trip.transit.startedAt).getTime()) / 60000) : 0;
  trip.status = (openExceptions.length || missingCount) ? 'Completed with exceptions' : 'Completed';
  trip.stage = 'complete';
  const receiptNo = `RCPT-${tripId}`;
  trip.completion = {
    endedAt: nowIso(), durationMin, distanceKm: Math.round(trip.transit.distanceTotalKm || 0),
    delaysCount: trip.delays.length, bagsHandedOrDelivered: trip.direction === 'Departure' ? trip.count.loadedBagIds.length : trip.offload.unloadedBagIds.length,
    bagsMissing: missingCount, receiptNo, notes: notes || null,
  };
  store.tripHistory.unshift({ tripId, completedAt: trip.completion.endedAt, status: trip.status });
  log(trip, `Trip completed — ${trip.status}.`);
  saveStore();
  return ok(hydrateTrip(store, trip));
}

/* ===================== RETURN VEHICLE / END SHIFT ===================== */

export async function returnVehicle(truckId, data) {
  const store = getStore();
  const truck = findTruck(store, truckId);
  if (!truck) return fail('Vehicle not found.');
  const odo = Number(data.odometerEnd);
  if (!Number.isInteger(odo) || odo < truck.odometer) return fail(`Odometer can't be lower than ${truck.odometer.toLocaleString('en-US')} km.`);
  if (!data.fuel) return fail('Fuel level is required.');
  if (!data.condition) return fail('Vehicle condition is required.');
  if (data.condition !== 'Good' && (!data.damageNotes || !data.damageNotes.trim())) return fail('Damage notes are required unless condition is Good.');
  if (!data.parkingLocation || !data.parkingLocation.trim()) return fail('Parking location is required.');
  if (!data.keysReturned) return fail('Confirm the keys have been returned.');
  truck.odometer = odo;
  truck.fuel = Number(data.fuel) || truck.fuel;
  store.vehicleReturns.push({ id: newId('RET'), truckId, at: nowIso(), odometerEnd: odo, condition: data.condition, damageNotes: data.damageNotes || null, parkingLocation: data.parkingLocation.trim() });
  saveStore();
  return ok({ returned: true });
}

export async function getActiveTrip() {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  const trip = activeTripFor(store, staff.id);
  return ok(trip ? hydrateTrip(store, trip) : null);
}

export async function endShift() {
  const store = getStore();
  const staff = myStaff(store);
  const active = activeTripFor(store, staff?.id);
  if (active) return fail(`Complete trip ${active.id} first.`);
  const myTrips = store.trips.filter((t) => t.staffId === staff?.id && (t.status === 'Completed' || t.status === 'Completed with exceptions'));
  const unreturned = myTrips.filter((t) => !store.vehicleReturns.some((r) => r.truckId === t.truckId && new Date(r.at) > new Date(t.completion?.endedAt || 0)));
  if (unreturned.length) return fail(`Return the vehicle for ${unreturned[unreturned.length - 1].truckId} before ending your shift.`);
  saveStore();
  return ok({ ended: true });
}

/* ===================== ALERTS / CONTACT / HISTORY ===================== */

export async function getAlerts() {
  const store = getStore();
  const staff = myStaff(store);
  const myTripIds = store.trips.filter((t) => t.staffId === staff?.id).map((t) => t.id);
  const exceptions = store.exceptions.filter((e) => myTripIds.includes(e.tripId));
  return ok({ notifications: clone(store.notifications), exceptions: clone(exceptions) });
}

export async function markRead(id) {
  const store = getStore();
  if (id === 'all') store.notifications.forEach((n) => { n.unread = false; });
  else { const n = store.notifications.find((x) => x.id === id); if (n) n.unread = false; }
  saveStore();
  return ok(clone(store.notifications));
}

export async function contactSupervisor(tripId, note) {
  const store = getStore();
  const entry = { id: newId('CALL'), tripId: tripId || null, time: nowIso(), note: note || null };
  store.supervisorCallLog.unshift(entry);
  saveStore();
  return ok(entry);
}

export async function getHistory() {
  const store = getStore();
  const staff = myStaff(store);
  const trips = store.trips.filter((t) => t.staffId === staff?.id && ['Completed', 'Completed with exceptions', 'Cancelled'].includes(t.status));
  return ok(trips.map((t) => hydrateTrip(store, t)));
}

/* ===================== DEMO MENU ===================== */

export async function demoAssignTrip(direction) {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  const wantType = direction === 'Departure' ? 'Airport Transfer' : 'Arrival Transfer';
  const busyTruckIds = new Set(store.trips.filter((t) => !['Cancelled', 'Completed', 'Completed with exceptions'].includes(t.status)).map((t) => t.truckId));
  const truck = store.trucks.find((t) => t.type === wantType && t.status === 'Active' && !busyTruckIds.has(t.id));
  if (!truck) return fail('No spare vehicle is available for a new demo trip.');
  const fromKey = direction === 'Departure' ? 'WH-MAK' : 'JED-TERM';
  const toOptions = direction === 'Departure' ? ['JED-TERM'] : ['ACC-SAFWA', 'ACC-EIMAN', 'ACC-ANSAR-MAD'];
  const toKey = toOptions[Math.floor(Math.random() * toOptions.length)];
  const tripId = newId(direction === 'Departure' ? 'TRP-D' : 'TRP-A');
  const bagCount = 4 + Math.floor(Math.random() * 4);
  const bags = Array.from({ length: bagCount }, (_, i) => ({ id: `${tripId}-BAG-${i + 1}`, tripId, tagNumber: `RB-${tripId}-${String(i + 1).padStart(2, '0')}`, weightKg: 16 + (i % 5), status: 'Awaiting load' }));
  store.bags.push(...bags);
  store.trips.push({
    id: tripId, direction, staffId: staff.id, truckId: truck.id,
    routeFromKey: fromKey, routeToKey: toKey, status: 'Assigned', stage: 'vehicle',
    bagIds: bags.map((b) => b.id),
    vehicle: { scannedOk: false, scannedAt: null },
    preTrip: { odometerStart: truck.odometer, fuelStart: truck.fuel, rows: null, submittedAt: null },
    pickup: { departedAt: null, arrivedAt: null, scannedCode: null },
    count: { expected: bagCount, loadedBagIds: [], verifiedCount: null, verified: false, mismatchNote: null },
    seal: { number: null, sealedBy: null, confirmedByDriver: false },
    transit: { startedAt: null, position: null, speedKmh: 0, distanceRemainingKm: null, etaAt: null, gpsActive: false, lastPingAt: null, trail: [] },
    delays: [], arrive: { arrivedAt: null, scannedCode: null },
    security: { outcome: null, reason: null, notes: null, clearedAt: null, holdStartedAt: null },
    offload: { bay: null, sealBroken: false, unloadedBagIds: [], searchStartedAt: null, missingBagIds: [] },
    handover: { receiverName: null, receiverId: null, org: null, signatureDataUrl: null, driverConfirmed: false, qrPayload: null, generatedAt: null, receiverScanned: false },
    completion: null, cancelReason: null, cancelledAt: null, backupTripId: null,
    createdAt: nowIso(), cutoffAt: direction === 'Departure' ? new Date(Date.now() + 90 * 60000).toISOString() : null, flightNumber: `SV ${1000 + Math.floor(Math.random() * 9000)}`,
    log: [],
  });
  store.notifications.unshift({ id: newId('N'), title: `New ${direction.toLowerCase()} trip assigned`, body: `${tripId} has been assigned to you.`, time: nowIso(), unread: true, link: `#/trip/${tripId}` });
  saveStore();
  return ok({ tripId });
}

export async function demoFastForwardGps(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip || !trip.transit.startedAt) return fail('Trip is not in transit.');
  const totalDelayMin = trip.delays.reduce((sum, d) => sum + d.minutes, 0);
  const adjustedDurationMs = (trip.transit.durationMin + totalDelayMin) * 60000;
  trip.transit.startedAt = new Date(Date.now() - adjustedDurationMs * 0.9).toISOString();
  recomputeTransit(store, trip);
  saveStore();
  return ok(clone(trip.transit));
}

export async function demoSimulateTrafficDelay(tripId) {
  return reportDelay(tripId, { reason: 'Traffic', minutes: 25, notes: 'Demo: simulated traffic delay.' });
}

export async function demoReleaseSecurityHold(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (trip.security.outcome !== 'hold') return fail('There is no active security hold on this trip.');
  trip.security.outcome = 'cleared';
  trip.security.clearedAt = nowIso();
  trip.status = 'In Progress';
  trip.stage = 'offload';
  resolveException(store, tripId, 'Security Hold');
  log(trip, 'Security hold released (demo).');
  saveStore();
  return ok(hydrateTrip(store, trip));
}

export async function demoDepotSealed(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.seal.number = randomSealNumber();
  trip.seal.sealedBy = trip.direction === 'Departure' ? 'warehouse' : 'ground-handler';
  log(trip, `Sealed by ${trip.direction === 'Departure' ? 'the warehouse' : 'the ground handler'} — ${trip.seal.number}.`);
  saveStore();
  return ok(clone(trip.seal));
}

export async function demoSimulateUnloading(tripId, mode) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = bagsOfTrip(store, trip);
  const howMany = mode === 'all-but-one' ? bags.length - 1 : bags.length;
  bags.slice(0, howMany).forEach((b) => {
    if (!trip.offload.unloadedBagIds.includes(b.id)) { trip.offload.unloadedBagIds.push(b.id); b.status = 'Unloaded'; }
  });
  saveStore();
  return ok({ unloaded: trip.offload.unloadedBagIds.length, expected: trip.count.expected });
}

export async function demoSimulateReceiverConfirmation(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.handover.qrPayload) return fail('Generate the handover receipt first.');
  trip.handover.receiverScanned = true;
  log(trip, 'Handover confirmed by receiver (demo).');
  saveStore();
  return ok(hydrateTrip(store, trip));
}

export function demoReset() { resetStore(); }
