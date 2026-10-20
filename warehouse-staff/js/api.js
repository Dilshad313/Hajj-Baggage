/**
 * Mock REST API for the Warehouse Staff console. Every function is async,
 * resolves after a realistic delay, and can be made to reject via `?fail=1`
 * or the one-shot demo "force fail" flag. A real backend can replace this
 * file without the UI code changing.
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

function findTrip(store, id) { return store.trips.find((t) => t.id === id); }
function findBag(store, id) { return store.bags.find((b) => b.id === id); }
function findBagByTag(store, tag) {
  const q = String(tag).trim().toLowerCase();
  return store.bags.find((b) => b.tagNumber.toLowerCase() === q);
}
function findPilgrim(store, id) { return store.pilgrims.find((p) => p.id === id); }
function hydrateBag(store, b) { return { ...clone(b), pilgrimName: findPilgrim(store, b.pilgrimId)?.name || '' }; }
function findZone(store, code) { return store.zones.find((z) => z.code === code); }
function findLocation(store, code) { return store.zones.flatMap((z) => z.locations).find((l) => l.code === code); }
function findFlight(store, code) { return store.flights.find((f) => f.code === code); }
function findOutboundTrip(store, id) { return store.outboundTrips.find((t) => t.id === id); }
function findDriver(store, id) { return store.drivers.find((d) => d.id === id); }
function findTruck(store, id) { return store.outboundTrucks.find((t) => t.id === id || t.code === id); }
function findOpenException(store, bagId) {
  return store.exceptions.find((e) => e.bagId === bagId && !['Resolved', 'Closed'].includes(e.status));
}

function ensureException(store, { type, severity, tripId, bagId, flightCode, note }) {
  const exc = {
    id: newId('EXC'), time: nowIso(), type, severity, status: 'Open',
    tripId: tripId || null, bagId: bagId || null, flightCode: flightCode || null,
    notes: note ? [{ at: nowIso(), text: note }] : [], escalated: false,
    resolutionOutcome: null, resolvedAt: null,
  };
  store.exceptions.unshift(exc);
  return exc;
}

function resolveBagException(store, bagId, outcome) {
  const exc = findOpenException(store, bagId);
  if (exc) { exc.status = 'Resolved'; exc.resolutionOutcome = outcome; exc.resolvedAt = nowIso(); }
}

function pushGateLog(store, entry) {
  store.gateLog = store.gateLog || [];
  store.gateLog.unshift({ id: newId('GL'), time: nowIso(), ...entry });
  store.gateLog = store.gateLog.slice(0, 10);
}

/* ===================== AUTH ===================== */

/** @param {string} employeeId @param {string} pin */
export async function login(employeeId, pin) {
  const store = getStore();
  const staff = store.staff.find((s) => s.employeeId.toLowerCase() === String(employeeId).toLowerCase());
  if (!staff || staff.pin !== pin) return fail('Invalid employee ID or PIN.');
  const session = { id: staff.id, name: staff.name, employeeId: staff.employeeId, shiftStartedAt: nowIso() };
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

export async function getDashboard() {
  const store = getStore();
  const bags = store.bags;
  const totalLocations = store.zones.reduce((sum, z) => sum + z.locations.length, 0);
  const occupiedLocations = store.zones.reduce((sum, z) => sum + z.locations.filter((l) => l.bagIds.length > 0).length, 0);
  const today = new Date().toDateString();
  const flightsAtRisk = store.flights.filter((f) => new Date(f.dispatchDeadline).getTime() - Date.now() < store.config.dispatchWarningMin * 60000)
    .map((f) => ({ code: f.code, destination: f.destination, dispatchDeadline: f.dispatchDeadline }));
  return ok({
    inboundEnRoute: store.trips.filter((t) => t.status === 'En route').length,
    atGateUnloading: store.trips.filter((t) => ['At Gate', 'Unloading'].includes(t.status)).length,
    awaitingScreening: bags.filter((b) => b.status === 'Received at Warehouse' && !b.screeningStatus).length,
    awaitingStorage: bags.filter((b) => b.status === 'Screened' && !b.locationCode).length,
    stored: bags.filter((b) => b.status === 'Stored').length,
    loadedOutboundToday: bags.filter((b) => b.status === 'Loaded to Airport Truck' && b.scannedAt && new Date(b.scannedAt).toDateString() === today).length,
    openExceptions: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)).length,
    zoneOccupancyPct: totalLocations ? Math.round((occupiedLocations / totalLocations) * 100) : 0,
    flightsAtRisk,
  });
}

/* ===================== INCOMING ===================== */

export async function getIncoming() {
  const store = getStore();
  return ok(store.trips.filter((t) => t.status !== 'Received').map((t) => clone(t)));
}

export async function getTripManifest(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  return ok(store.bags.filter((b) => b.truckTripId === tripId).map((b) => hydrateBag(store, b)));
}

/* ===================== GATE ===================== */

export async function gateScan(code) {
  const store = getStore();
  const q = String(code).trim().toLowerCase();
  const trip = store.trips.find((t) => t.truckPlate.toLowerCase() === q || t.code.toLowerCase() === q);
  if (!trip) {
    pushGateLog(store, { plate: code, outcome: 'Unknown', message: 'Unknown truck — not in system.' });
    saveStore();
    return fail('Unknown truck — not in system. Gate stays closed.', 'unknown');
  }
  if (trip.status === 'Received') {
    pushGateLog(store, { plate: trip.truckPlate, outcome: 'Not expected', message: `${trip.code} has already completed unloading.` });
    saveStore();
    return fail(`${trip.code} is not expected (status: ${trip.status}).`, 'not-expected');
  }
  if (trip.status === 'En route') trip.status = 'At Gate';
  trip.arrivedAt = trip.arrivedAt || nowIso();
  pushGateLog(store, { plate: trip.truckPlate, outcome: 'Admitted', message: `${trip.code} admitted.` });
  saveStore();
  return ok(clone(trip));
}

/**
 * Looks up a trip by plate/code regardless of status — unlike getIncoming(),
 * which excludes 'Received' trips. Needed so the gate's "not expected"
 * override (admit-with-PIN / reject) can resolve a trip id for exactly the
 * one status (`'Received'`) that getIncoming() deliberately omits.
 */
export async function findTripByCode(code) {
  const store = getStore();
  const q = String(code).trim().toLowerCase();
  const trip = store.trips.find((t) => t.truckPlate.toLowerCase() === q || t.code.toLowerCase() === q);
  if (!trip) return fail('No matching trip for that code.');
  return ok(clone(trip));
}

export async function admitWithPin(tripId, pin) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (pin !== '1234') return fail('Incorrect PIN.');
  trip.status = 'At Gate';
  trip.arrivedAt = trip.arrivedAt || nowIso();
  pushGateLog(store, { plate: trip.truckPlate, outcome: 'Admitted with PIN', message: `${trip.code} admitted by supervisor override.` });
  saveStore();
  return ok(clone(trip));
}

export async function rejectTruck(tripId, reason) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.status = 'Rejected';
  pushGateLog(store, { plate: trip.truckPlate, outcome: 'Rejected', message: reason || 'Rejected at gate.' });
  ensureException(store, { type: 'Vehicle Issue', severity: 'Medium', tripId, note: reason || 'Rejected at gate.' });
  saveStore();
  return ok(clone(trip));
}

export async function contactTransportCoordinator({ plate, driverName, phone, notes }) {
  const store = getStore();
  const p = String(plate || '').trim();
  if (p.length < 3 || p.length > 12) return fail('Plate must be 3–12 characters.');
  if (!driverName || !driverName.trim()) return fail('Driver name is required.');
  if (phone && !/^\+\d{8,15}$/.test(phone)) return fail('Phone must start with + and have 8–15 digits.');
  if (notes && notes.length > 300) return fail('Notes must be 300 characters or fewer.');
  pushGateLog(store, { plate: p, outcome: 'Unknown — contacted coordinator', message: `${p} / ${driverName}` });
  ensureException(store, { type: 'Unknown Truck', severity: 'Medium', note: `${p} / ${driverName}${notes ? ` — ${notes}` : ''}` });
  saveStore();
  return ok({ logged: true });
}

export async function getGateEvents() {
  const store = getStore();
  return ok(clone(store.gateLog || []));
}

export async function getBays() {
  const store = getStore();
  return ok(clone(store.warehouse.bays));
}

export async function assignBay(tripId, bayCode) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bay = store.warehouse.bays.find((b) => b.code === bayCode);
  if (!bay) return fail('Bay not found.');
  if (bay.status === 'Out of Service') return fail(`${bayCode} is out of service.`);
  if (bay.status === 'Occupied' && bay.tripId !== tripId) return fail(`${bayCode} is occupied.`);
  const previous = store.warehouse.bays.find((b) => b.tripId === tripId);
  if (previous) { previous.status = 'Free'; previous.tripId = null; }
  bay.status = 'Occupied';
  bay.tripId = tripId;
  trip.bay = bayCode;
  saveStore();
  return ok(clone(trip));
}

export async function startReceiving(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.bay) return fail('Assign a bay before opening the gate.');
  trip.status = 'Unloading';
  saveStore();
  return ok(clone(trip));
}

/* ===================== UNLOADING & VERIFY ===================== */

export async function getUnloadingSession(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => b.truckTripId === tripId).map((b) => hydrateBag(store, b));
  return ok({ trip: clone(trip), bags, extra: clone(trip.extraTags || []) });
}

export async function unloadScan(tripId, scannedTag) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bag = findBagByTag(store, scannedTag);
  if (!bag) return fail('Unrecognised tag.', 'not-found');
  if (bag.truckTripId === tripId) {
    if (bag.status !== 'Loaded to Collection Truck') return fail(`${bag.tagNumber} has already been scanned.`, 'duplicate');
    bag.status = 'Received at Warehouse';
    bag.scannedAt = nowIso();
    bag.timeline.push({ stage: 'Received at Warehouse', time: bag.scannedAt, result: 'ok' });
    saveStore();
    return ok({ bag: hydrateBag(store, bag), message: `${bag.tagNumber} received.` });
  }
  // Belongs to a different truck's manifest — a real mix-up, flagged as extra for this session.
  if (bag.status === 'Loaded to Collection Truck') {
    bag.status = 'Received at Warehouse';
    bag.scannedAt = nowIso();
    bag.timeline.push({ stage: 'Received at Warehouse', time: bag.scannedAt, result: 'ok' });
  }
  trip.extraTags = trip.extraTags || [];
  trip.extraTags.push({ tag: bag.tagNumber, bagId: bag.id, at: nowIso() });
  saveStore();
  return ok({ extra: true, bag: hydrateBag(store, bag), message: `${bag.tagNumber} is not on this truck's manifest — flagged as EXTRA.` });
}

export async function computeDiscrepancy(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => b.truckTripId === tripId);
  return ok({
    expectedCount: bags.length,
    scannedCount: bags.filter((b) => b.status !== 'Loaded to Collection Truck').length,
    missing: bags.filter((b) => b.status === 'Loaded to Collection Truck').map((b) => hydrateBag(store, b)),
    extra: clone(trip.extraTags || []),
  });
}

export async function recordDiscrepancy(tripId, notes) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const text = (notes || '').trim();
  if (text.length < 10 || text.length > 500) return fail('Discrepancy notes must be 10–500 characters.');
  const missing = store.bags.filter((b) => b.truckTripId === tripId && b.status === 'Loaded to Collection Truck');
  for (const bag of missing) {
    ensureException(store, { type: 'Missing Bag', severity: 'Medium', tripId, bagId: bag.id, flightCode: bag.flightCode, note: text });
  }
  trip.discrepancyRecorded = true;
  saveStore();
  return ok({ exceptionsCreated: missing.length });
}

export async function acceptReceiving(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const missing = store.bags.filter((b) => b.truckTripId === tripId && b.status === 'Loaded to Collection Truck');
  if (missing.length && !trip.discrepancyRecorded) return fail('Record the discrepancy before accepting.');
  trip.status = 'Received';
  trip.acceptedAt = nowIso();
  const bay = store.warehouse.bays.find((b) => b.tripId === tripId);
  if (bay) { bay.status = 'Free'; bay.tripId = null; }
  const accepted = store.bags.filter((b) => b.truckTripId === tripId && b.status !== 'Loaded to Collection Truck').length;
  saveStore();
  return ok({ acceptedCount: accepted, tripCode: trip.code });
}

/* ===================== SCREENING ===================== */

export async function getScreeningQueue() {
  const store = getStore();
  const bags = store.bags.filter((b) => b.status === 'Received at Warehouse' && !b.screeningStatus)
    .sort((a, b) => new Date(a.scannedAt) - new Date(b.scannedAt));
  return ok(bags.map((b) => {
    const flight = findFlight(store, b.flightCode);
    const priority = flight && new Date(flight.dispatchDeadline).getTime() - Date.now() < store.config.dispatchWarningMin * 60000;
    return { ...hydrateBag(store, b), priority };
  }));
}

export async function screenXray(bagId) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  return ok({ result: bag.xrayFlag ? 'Prohibited' : 'Clear' });
}

export async function clearBag(bagId) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  bag.status = 'Screened';
  bag.screeningStatus = 'Clear';
  bag.timeline.push({ stage: 'Screened', time: nowIso(), result: 'ok' });
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function recordProhibited(bagId, { rows, disposal }) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (!rows || !rows.length) return fail('At least one item row is required.');
  for (const r of rows) {
    if (!r.category) return fail('Category is required for every row.');
    const desc = (r.description || '').trim();
    if (desc.length < 3 || desc.length > 200) return fail('Description must be 3–200 characters.');
    const qty = Number(r.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) return fail('Quantity must be an integer 1–50.');
  }
  if (!disposal) return fail('Disposal is required.');
  bag.prohibitedInfo = { rows, disposal, removedAt: nowIso(), resealNo: null, reSealedAt: null };
  ensureException(store, { type: 'Prohibited Items', severity: 'High', bagId, flightCode: bag.flightCode, note: `${rows.map((r) => r.category).join(', ')} — ${disposal}` });
  saveStore();
  return ok(clone(bag));
}

export async function reseal(bagId, resealNo) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (!bag.prohibitedInfo) return fail('Record the prohibited items before resealing.');
  const value = String(resealNo).trim().toUpperCase();
  if (!/^RS-[A-Z0-9]{6}$/.test(value)) return fail('Reseal number must be RS- followed by 6 alphanumeric characters.');
  store.resealNumbers = store.resealNumbers || [];
  if (store.resealNumbers.includes(value)) return fail('That reseal number has already been used.');
  store.resealNumbers.push(value);
  bag.prohibitedInfo.resealNo = value;
  bag.prohibitedInfo.reSealedAt = nowIso();
  bag.status = 'Screened';
  bag.screeningStatus = 'Clear';
  bag.timeline.push({ stage: 'Screened', time: nowIso(), result: 'ok' });
  resolveBagException(store, bagId, `Items removed, disposal: ${bag.prohibitedInfo.disposal}. Re-sealed ${value}.`);
  saveStore();
  return ok(clone(bag));
}

/* ===================== SORT & STORE ===================== */

export async function getSortQueue() {
  const store = getStore();
  const bags = store.bags.filter((b) => b.status === 'Screened' && !b.sortedLane);
  return ok(bags.map((b) => hydrateBag(store, b)));
}

export async function sortBag(scannedTag) {
  const store = getStore();
  const bag = findBagByTag(store, scannedTag);
  if (!bag) return fail('Unrecognised tag.', 'not-found');
  if (bag.status !== 'Screened') return fail(`${bag.tagNumber} is not ready to sort (status: ${bag.status}).`);
  if (bag.sortedLane) return fail(`${bag.tagNumber} has already been sorted.`);
  const zone = store.zones.find((z) => z.flightCode === bag.flightCode);
  const target = zone || store.zones.find((z) => z.code === 'Z-Q');
  bag.sortedLane = { zoneCode: target.code, flightCode: bag.flightCode, destination: bag.destination, quarantine: !zone };
  saveStore();
  return ok({ bag: hydrateBag(store, bag), lane: bag.sortedLane });
}

export async function getStoreQueue() {
  const store = getStore();
  const bags = store.bags.filter((b) => b.sortedLane && b.status !== 'Stored');
  return ok(bags.map((b) => hydrateBag(store, b)));
}

export async function suggestZone(bagId) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (!bag.sortedLane) return fail('Sort this bag before storing it.');
  const zone = findZone(store, bag.sortedLane.zoneCode);
  const freeLocations = zone.locations.filter((l) => l.bagIds.length < l.capacity).map((l) => ({ code: l.code, free: l.capacity - l.bagIds.length }));
  return ok({ zoneCode: zone.code, destination: zone.destination, quarantine: bag.sortedLane.quarantine, freeLocations });
}

function applyStore(store, bag, locationCode, reason) {
  const location = findLocation(store, locationCode);
  if (!location) return fail('Location not found.');
  const zone = findZone(store, location.zoneCode);
  if (bag.sortedLane && location.zoneCode !== bag.sortedLane.zoneCode && !reason) return fail('Wrong zone — a reason is required to store off-zone.', 'wrong-zone');
  if (location.bagIds.length >= location.capacity) return fail(`${locationCode} is full.`, 'location-full');
  const prevLocation = bag.locationCode ? findLocation(store, bag.locationCode) : null;
  if (prevLocation) prevLocation.bagIds = prevLocation.bagIds.filter((id) => id !== bag.id);
  location.bagIds.push(bag.id);
  bag.zoneCode = zone.code;
  bag.locationCode = locationCode;
  bag.status = 'Stored';
  bag.timeline.push({ stage: 'Stored', time: nowIso(), result: 'ok' });
  return null;
}

export async function storeBag(bagId, locationCode, reason) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  const err = applyStore(store, bag, locationCode, reason);
  if (err) return err;
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function getProcessingTotals() {
  const store = getStore();
  return ok({
    awaitingScreening: store.bags.filter((b) => b.status === 'Received at Warehouse' && !b.screeningStatus).length,
    awaitingStorage: store.bags.filter((b) => b.sortedLane && b.status !== 'Stored').length,
    stored: store.bags.filter((b) => b.status === 'Stored').length,
  });
}

/* ===================== INVENTORY ===================== */

export async function getZones() {
  const store = getStore();
  return ok(store.zones.map((z) => ({
    code: z.code, flightCode: z.flightCode, destination: z.destination, status: z.status,
    locationCount: z.locations.length,
    occupied: z.locations.reduce((s, l) => s + l.bagIds.length, 0),
    capacity: z.locations.reduce((s, l) => s + l.capacity, 0),
  })));
}

export async function getZoneDetail(zoneCode) {
  const store = getStore();
  const zone = findZone(store, zoneCode);
  if (!zone) return fail('Zone not found.');
  return ok({
    ...clone(zone),
    locations: zone.locations.map((l) => ({ ...clone(l), bags: l.bagIds.map((id) => hydrateBag(store, findBag(store, id))) })),
  });
}

export async function searchInventory(query) {
  const store = getStore();
  const q = String(query || '').trim().toLowerCase();
  let bags = store.bags.filter((b) => b.locationCode || b.status === 'Stored');
  if (q) {
    bags = bags.filter((b) => {
      const p = findPilgrim(store, b.pilgrimId);
      return b.tagNumber.toLowerCase().includes(q) || (b.zoneCode || '').toLowerCase().includes(q) || (p?.name || '').toLowerCase().includes(q);
    });
  }
  return ok(bags.map((b) => hydrateBag(store, b)));
}

export async function moveLocation(bagId, newLocationCode, reason) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  const err = applyStore(store, bag, newLocationCode, reason);
  if (err) return err;
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function moveToQuarantine(bagId, reason) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (!reason || !reason.trim()) return fail('A reason is required.');
  const zone = findZone(store, 'Z-Q');
  const location = zone.locations.find((l) => l.bagIds.length < l.capacity);
  if (!location) return fail('Quarantine is full.');
  const err = applyStore(store, bag, location.code, reason);
  if (err) return err;
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function releaseFromQuarantine(bagId, newLocationCode) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  const err = applyStore(store, bag, newLocationCode, 'Released from quarantine');
  if (err) return err;
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function setZoneStatus(zoneCode, status) {
  const store = getStore();
  const zone = findZone(store, zoneCode);
  if (!zone) return fail('Zone not found.');
  zone.status = status;
  saveStore();
  return ok(clone(zone));
}

/* ===================== REPORTS ===================== */

export async function generateReport(period) {
  const store = getStore();
  const bags = store.bags;
  const report = {
    id: newId('RPT'), period: period || 'today', generatedAt: nowIso(),
    inbound: { trucksReceived: store.trips.filter((t) => t.status === 'Received').length, bagsReceived: bags.filter((b) => b.status !== 'Loaded to Collection Truck').length },
    screening: { screened: bags.filter((b) => b.screeningStatus === 'Clear').length, prohibited: bags.filter((b) => b.prohibitedInfo).length },
    storage: { stored: bags.filter((b) => b.status === 'Stored').length },
    outbound: { loaded: bags.filter((b) => ['Loaded to Airport Truck', 'In Transit to Airport'].includes(b.status)).length, trucksDeparted: store.outboundTrips.filter((t) => t.status === 'Departed').length },
    pending: { awaitingScreening: bags.filter((b) => b.status === 'Received at Warehouse' && !b.screeningStatus).length, awaitingStorage: bags.filter((b) => b.sortedLane && b.status !== 'Stored').length },
    exceptions: { open: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)).length },
  };
  store.reportHistory = store.reportHistory || [];
  store.reportHistory.unshift(report);
  saveStore();
  return ok(clone(report));
}

export async function getReportHistory() {
  const store = getStore();
  return ok(clone(store.reportHistory || []));
}

/* ===================== OUTBOUND ===================== */

export async function getFlightsReadiness() {
  const store = getStore();
  return ok(store.flights.map((f) => {
    const bags = store.bags.filter((b) => b.flightCode === f.code);
    const stored = bags.filter((b) => b.status === 'Stored' || b.status === 'Loaded to Airport Truck' || b.status === 'In Transit to Airport').length;
    const deadlineMs = new Date(f.dispatchDeadline).getTime() - Date.now();
    const status = deadlineMs < 0 ? 'Missed' : deadlineMs < store.config.dispatchWarningMin * 60000 ? 'At risk' : 'Ready';
    return { code: f.code, destination: f.destination, dispatchDeadline: f.dispatchDeadline, stored, total: bags.length, status };
  }));
}

export async function raiseMissedCutoff(flightCode) {
  const store = getStore();
  const flight = findFlight(store, flightCode);
  if (!flight) return fail('Flight not found.');
  ensureException(store, { type: 'Missed Cut-off', severity: 'High', flightCode, note: `${flightCode} is at risk of missing its dispatch deadline.` });
  saveStore();
  return ok({ raised: true });
}

export async function getOutboundTrucks() {
  const store = getStore();
  return ok(clone(store.outboundTrucks));
}

export async function getDrivers() {
  const store = getStore();
  return ok(clone(store.drivers));
}

export async function prepareLoad({ flightCodes, truckId, driverId }) {
  const store = getStore();
  if (!flightCodes || !flightCodes.length) return fail('Select at least one flight.');
  const truck = findTruck(store, truckId);
  if (!truck) return fail('Truck not found.');
  if (truck.status === 'Out of Service') return fail(`${truck.code} is out of service.`);
  const driver = findDriver(store, driverId);
  if (!driver) return fail('Driver not found.');
  if (driver.status === 'Busy') {
    const busyTrip = findOutboundTrip(store, driver.busyOnTripId);
    return fail(`Driver busy on ${busyTrip ? busyTrip.id : driver.busyOnTripId}.`);
  }
  const bags = store.bags.filter((b) => flightCodes.includes(b.flightCode) && b.status === 'Stored' && !b.outboundTripId);
  const trip = {
    id: newId('OTRP'), flightCodes, truckId: truck.id, truckCode: truck.code, driverId: driver.id, driverName: driver.name,
    status: 'Planned', bagIds: bags.map((b) => b.id), driverVerifiedCount: false, driverConfirmedSeal: false,
    sealNumber: null, sealConfirmedAt: null, departureTime: null, createdAt: nowIso(),
  };
  for (const bag of bags) bag.outboundTripId = trip.id;
  driver.status = 'Busy';
  driver.busyOnTripId = trip.id;
  store.outboundTrips.push(trip);
  saveStore();
  return ok(clone(trip));
}

export async function getOutboundTrips() {
  const store = getStore();
  return ok(clone(store.outboundTrips));
}

export async function getOutboundTrip(tripId) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => trip.bagIds.includes(b.id)).map((b) => hydrateBag(store, b));
  return ok({ ...clone(trip), bags });
}

export async function getPickList(tripId) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => trip.bagIds.includes(b.id)).map((b) => hydrateBag(store, b));
  return ok({ trip: clone(trip), bags, generatedAt: nowIso() });
}

export async function loadScan(tripId, scannedTag) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bag = findBagByTag(store, scannedTag);
  if (!bag) return fail('Unrecognised tag.', 'not-found');
  if (bag.status === 'Loaded to Airport Truck' || bag.status === 'In Transit to Airport') {
    const otherTrip = store.outboundTrips.find((t) => t.bagIds.includes(bag.id) && t.id !== tripId);
    return fail(`Already loaded on ${otherTrip ? otherTrip.truckCode : 'another truck'}.`, 'already-loaded');
  }
  if (bag.status !== 'Stored') return fail('Not stored yet.', 'not-stored');
  if (!trip.flightCodes.includes(bag.flightCode)) return fail('Different flight.', 'wrong-flight');
  if (findOpenException(store, bag.id)) return fail('Bag has an open exception — cannot load.', 'open-exception');
  bag.status = 'Loaded to Airport Truck';
  bag.outboundTripId = tripId;
  bag.timeline.push({ stage: 'Loaded to Airport Truck', time: nowIso(), result: 'ok' });
  saveStore();
  const loadedCount = store.bags.filter((b) => trip.bagIds.includes(b.id) && b.status === 'Loaded to Airport Truck').length;
  return ok({ bag: hydrateBag(store, bag), loadedCount, total: trip.bagIds.length, message: `${bag.tagNumber} loaded.` });
}

export async function unloadCorrection(tripId, bagId) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  bag.status = 'Stored';
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function markDriverCountVerified(tripId) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.driverVerifiedCount = true;
  saveStore();
  return ok(clone(trip));
}

export async function seal(tripId, sealNumber) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.driverVerifiedCount) return fail('Waiting for driver count verification.');
  const value = String(sealNumber).trim().toUpperCase();
  if (!/^SL-[A-Z0-9]{6}$/.test(value)) return fail('Seal number must be SL- followed by 6 alphanumeric characters.');
  store.sealNumbers = store.sealNumbers || [];
  if (store.sealNumbers.includes(value)) return fail('That seal number has already been used.');
  store.sealNumbers.push(value);
  trip.sealNumber = value;
  trip.status = 'Sealed';
  saveStore();
  return ok(clone(trip));
}

export async function confirmSealScan(tripId, scannedCode) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.sealNumber) return fail('Seal the truck before scanning to confirm.');
  if (String(scannedCode).trim().toUpperCase() !== trip.sealNumber) return fail(`Wrong seal — this truck uses ${trip.sealNumber}.`);
  trip.sealConfirmedAt = nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function depart(tripId, departureTime) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.sealConfirmedAt) return fail('Confirm the seal scan before departing.');
  const diffMin = Math.abs(new Date(departureTime).getTime() - Date.now()) / 60000;
  if (diffMin > 30) return fail('Departure time must be within ±30 minutes of now.');
  trip.status = 'Departed';
  trip.departureTime = departureTime;
  for (const bag of store.bags.filter((b) => trip.bagIds.includes(b.id))) {
    bag.status = 'In Transit to Airport';
    bag.timeline.push({ stage: 'In Transit to Airport', time: nowIso(), result: 'ok' });
  }
  const driver = findDriver(store, trip.driverId);
  if (driver) { driver.status = 'Available'; driver.busyOnTripId = null; }
  saveStore();
  return ok(clone(trip));
}

export async function getOutboundManifest(tripId) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => trip.bagIds.includes(b.id)).map((b) => hydrateBag(store, b));
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

export async function bagFound(bagId, scannedTag) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (String(scannedTag).trim().toLowerCase() !== bag.tagNumber.toLowerCase()) {
    return fail(`That tag doesn't match ${bag.tagNumber}.`);
  }
  if (bag.status === 'Loaded to Collection Truck') {
    bag.status = 'Received at Warehouse';
    bag.scannedAt = nowIso();
    bag.timeline.push({ stage: 'Received at Warehouse', time: bag.scannedAt, result: 'ok' });
  }
  resolveBagException(store, bagId, 'Bag found');
  saveStore();
  return ok(hydrateBag(store, bag));
}

/* ===================== HANDOVER ===================== */

export async function getHandoverSummary() {
  const store = getStore();
  const openSession = store.trips.find((t) => t.status === 'Unloading');
  const sealedNotDeparted = store.outboundTrips.find((t) => t.status === 'Sealed');
  const blockers = [];
  if (openSession) blockers.push(`${openSession.code} is still mid-unloading.`);
  if (sealedNotDeparted) blockers.push(`${sealedNotDeparted.id} is sealed but hasn't departed.`);
  return ok({
    openExceptions: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)).length,
    inboundAtGate: store.trips.filter((t) => ['At Gate', 'Unloading'].includes(t.status)).length,
    outboundNotDeparted: store.outboundTrips.filter((t) => t.status !== 'Departed').length,
    blockers,
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

export async function demoSendCollectionTruck() {
  const store = getStore();
  const trip = store.trips.find((t) => t.status === 'En route');
  if (!trip) return fail('No en-route truck available.');
  trip.eta = nowIso();
  trip.status = 'At Gate';
  trip.arrivedAt = nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function demoSimulateUnloadingPartial(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId) || store.trips.find((t) => t.status === 'Unloading');
  if (!trip) return fail('No truck is unloading.');
  const bags = store.bags.filter((b) => b.truckTripId === trip.id && b.status === 'Loaded to Collection Truck');
  const toScan = bags.slice(0, -1);
  toScan.forEach((b) => { b.status = 'Received at Warehouse'; b.scannedAt = nowIso(); b.timeline.push({ stage: 'Received at Warehouse', time: b.scannedAt, result: 'ok' }); });
  const extraBag = store.bags.find((b) => b.truckTripId !== trip.id && b.status === 'Loaded to Collection Truck');
  if (extraBag) {
    extraBag.status = 'Received at Warehouse';
    extraBag.scannedAt = nowIso();
    trip.extraTags = trip.extraTags || [];
    trip.extraTags.push({ tag: extraBag.tagNumber, bagId: extraBag.id, at: nowIso() });
  }
  saveStore();
  return ok({ scanned: toScan.length, extra: !!extraBag });
}

export async function demoSimulateUnloadingFull(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId) || store.trips.find((t) => t.status === 'Unloading');
  if (!trip) return fail('No truck is unloading.');
  const bags = store.bags.filter((b) => b.truckTripId === trip.id && b.status === 'Loaded to Collection Truck');
  bags.forEach((b) => { b.status = 'Received at Warehouse'; b.scannedAt = nowIso(); b.timeline.push({ stage: 'Received at Warehouse', time: b.scannedAt, result: 'ok' }); });
  saveStore();
  return ok({ scanned: bags.length });
}

export async function demoFlagXray() {
  const store = getStore();
  const bag = store.bags.find((b) => b.status === 'Received at Warehouse' && !b.screeningStatus && !b.xrayFlag);
  if (!bag) return fail('No eligible bag to flag.');
  bag.xrayFlag = true;
  saveStore();
  return ok({ bagId: bag.id });
}

export async function demoMakeFlightAtRisk() {
  const store = getStore();
  const flight = store.flights.find((f) => new Date(f.dispatchDeadline).getTime() - Date.now() > store.config.dispatchWarningMin * 60000)
    || store.flights[0];
  if (!flight) return fail('No flight available.');
  flight.dispatchDeadline = new Date(Date.now() + 25 * 60000).toISOString();
  saveStore();
  return ok({ flightCode: flight.code });
}

export async function demoMarkDriverCountVerified(tripId) {
  const store = getStore();
  const trip = findOutboundTrip(store, tripId) || store.outboundTrips.find((t) => !t.driverVerifiedCount);
  if (!trip) return fail('No outbound trip awaiting driver verification.');
  trip.driverVerifiedCount = true;
  saveStore();
  return ok(clone(trip));
}

export function demoForceNextFail() {
  const store = getStore();
  store.demoForceFail = true;
  saveStore();
}

export function demoReset() { resetStore(); }
