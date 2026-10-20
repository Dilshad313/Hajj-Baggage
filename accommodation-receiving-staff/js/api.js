/**
 * Mock REST API for the Accommodation Receiving Staff console.
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

function findTrip(store, id) { return store.trips.find((t) => t.id === id); }
function findBagById(store, id) { return store.bags.find((b) => b.id === id); }
function findBagByTag(store, tag) {
  const q = String(tag).trim().toLowerCase();
  return store.bags.find((b) => b.tagNumber.toLowerCase() === q || b.airlineTagNumber.toLowerCase() === q);
}
function findPilgrim(store, id) { return store.pilgrims.find((p) => p.id === id); }
function findHotel(store, name) { return store.hotels.find((h) => h.name === name); }
function hydrateBag(store, b) {
  return { ...clone(b), pilgrimName: findPilgrim(store, b.pilgrimId)?.name || '' };
}

function ensureException(store, { type, severity, tripId, bagId, room, note }) {
  const exc = {
    id: newId('EXC'), time: nowIso(), type, severity, status: 'Open',
    tripId: tripId || null, bagId: bagId || null, room: room || null,
    notes: note ? [{ at: nowIso(), text: note }] : [], escalated: false,
    resolutionOutcome: null, resolvedAt: null,
  };
  store.exceptions.unshift(exc);
  return exc;
}

/* ===================== AUTH ===================== */

/** @param {string} employeeId @param {string} pin */
export async function login(employeeId, pin) {
  const store = getStore();
  const staff = store.staff.find((s) => s.employeeId.toLowerCase() === String(employeeId).toLowerCase());
  if (!staff || staff.pin !== pin) return fail('Invalid employee ID or PIN.');
  const session = { id: staff.id, name: staff.name, employeeId: staff.employeeId, hotel: staff.hotel, shiftStartedAt: nowIso() };
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

/** @returns {Promise<{name:string, code:string, bays:string[], buildings:string[]}>} the signed-in staff's hotel metadata */
export async function getMyHotel() {
  const store = getStore();
  const staff = myStaff(store);
  const hotel = findHotel(store, staff?.hotel);
  if (!hotel) return fail('Hotel not found.');
  return ok({ name: hotel.name, code: hotel.code, bays: clone(hotel.bays), buildings: Object.keys(hotel.buildings) });
}

/* ===================== DASHBOARD ===================== */

export async function getDashboard() {
  const store = getStore();
  const staff = myStaff(store);
  const hotel = staff?.hotel;
  const trips = store.trips.filter((t) => t.hotel === hotel);
  const bags = store.bags.filter((b) => b.hotel === hotel);
  const today = new Date().toDateString();
  const receivedToday = bags.filter((b) => b.scannedAt && new Date(b.scannedAt).toDateString() === today).length;
  const byBuilding = {};
  const hotelDef = findHotel(store, hotel);
  if (hotelDef) {
    for (const key of Object.keys(hotelDef.buildings)) {
      const buildingBags = bags.filter((b) => b.building === key);
      const sorted = buildingBags.filter((b) => ['Sorted', 'Out for Delivery', 'Delivered', 'Confirmed by Pilgrim'].includes(b.status)).length;
      byBuilding[key] = { total: buildingBags.length, sorted };
    }
  }
  const waitingBags = bags.filter((b) => b.status === 'Received at Accommodation');
  const oldestWaitMin = waitingBags.length
    ? Math.round((Date.now() - Math.min(...waitingBags.map((b) => new Date(b.scannedAt).getTime()))) / 60000) : null;
  return ok({
    trucksEnRoute: trips.filter((t) => t.status === 'En route').length,
    trucksAtBay: trips.filter((t) => t.status === 'At Destination').length,
    awaitingVerification: trips.filter((t) => t.status === 'At Destination' || t.status === 'Unloading').length,
    receivedToday,
    sorted: bags.filter((b) => b.status === 'Sorted').length,
    assigned: bags.filter((b) => b.runId).length,
    outForDelivery: bags.filter((b) => b.status === 'Out for Delivery').length,
    deliveredToday: 0,
    openExceptions: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)).length,
    arrivalsToday: trips.filter((t) => t.arrivedAt && new Date(t.arrivedAt).toDateString() === today).map((t) => clone(t)),
    sortingByBuilding: byBuilding,
    pilgrimsWaiting: { count: waitingBags.length, oldestWaitMin },
  });
}

/* ===================== INCOMING TRUCKS ===================== */

export async function getIncoming() {
  const store = getStore();
  const staff = myStaff(store);
  const trips = store.trips.filter((t) => t.hotel === staff?.hotel && t.status !== 'Unloaded');
  return ok(trips.map((t) => clone(t)));
}

export async function getTripManifest(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => b.tripId === tripId);
  return ok(bags.map((b) => hydrateBag(store, b)));
}

export async function preAssignBay(tripId, bay) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.bay = bay;
  saveStore();
  return ok(clone(trip));
}

/* ===================== ARRIVAL (truck scan) ===================== */

export async function truckScan(scannedCode) {
  const store = getStore();
  const staff = myStaff(store);
  const code = String(scannedCode).trim().toLowerCase();
  const trip = store.trips.find((t) => t.truckPlate.toLowerCase() === code || t.code.toLowerCase() === code);
  if (!trip) return fail('Unknown truck — contact the transport coordinator, then verify & log manually.', 'unknown');
  if (trip.hotel !== staff?.hotel) return fail(`Truck belongs to ${trip.hotel}.`, 'wrong-hotel');
  if (trip.status === 'Unloaded') return fail('This truck has already been unloaded.', 'done');
  if (trip.status === 'En route') trip.status = 'At Destination';
  trip.arrivedAt = trip.arrivedAt || nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function contactTc({ plate, driverName, phone, claimedTripId }) {
  const store = getStore();
  if (!plate || !driverName) return fail('Plate and driver name are required.');
  if (phone && !/^\+\d{8,15}$/.test(phone)) return fail('Phone must start with + and have 8–15 digits.');
  const entry = { id: newId('TC'), plate, driverName, phone: phone || null, claimedTripId: claimedTripId || null, at: nowIso() };
  store.unknownTrucks.push(entry);
  saveStore();
  return ok(entry);
}

export async function getExpectedTrips() {
  const store = getStore();
  const staff = myStaff(store);
  return ok(store.trips.filter((t) => t.hotel === staff?.hotel && t.status !== 'Unloaded').map((t) => clone(t)));
}

export async function manualLog(plate, { tripId, tcRef }) {
  const store = getStore();
  if (!tripId) return fail('Select the matching expected trip.');
  if (!tcRef || tcRef.trim().length < 3 || tcRef.trim().length > 60) return fail('TC reference must be 3–60 characters.');
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  trip.truckPlate = plate;
  trip.manualLog = { plate, tcRef: tcRef.trim(), at: nowIso() };
  trip.status = 'At Destination';
  trip.arrivedAt = trip.arrivedAt || nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function verifySeal(tripId, scannedSeal) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (String(scannedSeal).trim().toUpperCase() !== trip.sealNumber.toUpperCase()) {
    ensureException(store, { type: 'Seal Mismatch', severity: 'High', tripId, note: `Scanned "${scannedSeal}", expected ${trip.sealNumber}.` });
    saveStore();
    return fail('Seal mismatch — unloading blocked.');
  }
  trip.sealVerifiedAt = nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function assignBay(tripId, bay) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const busy = store.trips.find((t) => t.id !== tripId && t.bay === bay && t.status === 'At Destination');
  if (busy) return fail(`${bay} is busy with ${busy.code} — choose another bay.`);
  trip.bay = bay;
  saveStore();
  return ok(clone(trip));
}

export async function startReceiving(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  if (!trip.bay) return fail('Assign a bay before starting unloading.');
  trip.status = 'Unloading';
  saveStore();
  return ok(clone(trip));
}

/* ===================== RECEIVING (unloading) ===================== */

export async function getReceiving(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => b.tripId === tripId).map((b) => hydrateBag(store, b));
  return ok({ trip: clone(trip), bags, extra: clone(trip.extraTags || []) });
}

export async function scanBag(tripId, scannedTag) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bag = findBagByTag(store, scannedTag);
  if (!bag || bag.tripId !== tripId) {
    trip.extraTags = trip.extraTags || [];
    trip.extraTags.push({ tag: scannedTag, at: nowIso() });
    saveStore();
    return ok({ extra: true, message: `${scannedTag} is not on this trip's manifest — flagged as extra/unknown.` });
  }
  if (bag.status !== 'Expected') return fail(`${bag.tagNumber} has already been scanned.`);
  bag.status = 'Received at Accommodation';
  bag.scannedAt = nowIso();
  saveStore();
  return ok({ bag: hydrateBag(store, bag), message: `${bag.tagNumber} received.` });
}

export async function recordDamage(bagId, { type, severity, description, photoRef, repaired }) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (!type) return fail('Damage type is required.');
  if (!severity) return fail('Severity is required.');
  const desc = (description || '').trim();
  if (desc.length < 10 || desc.length > 300) return fail('Description must be 10–300 characters.');
  if (photoRef && photoRef.length > 60) return fail('Photo reference must be 60 characters or fewer.');
  bag.damaged = true;
  bag.damageInfo = { type, severity, description: desc, photoRef: photoRef || null, repaired: !!repaired, at: nowIso() };
  const exc = ensureException(store, {
    type: 'Damaged Bag', severity: severity === 'Major' ? 'High' : 'Medium',
    tripId: bag.tripId, bagId: bag.id, room: bag.room, note: desc,
  });
  if (severity === 'Major') exc.claimsTag = true;
  saveStore();
  return ok({ bag: hydrateBag(store, bag), claimsTag: severity === 'Major' });
}

/* ===================== VERIFY / RECONCILE ===================== */

export async function computeDiscrepancy(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => b.tripId === tripId);
  const missing = bags.filter((b) => b.status === 'Expected');
  const damaged = bags.filter((b) => b.damaged);
  const scanned = bags.filter((b) => b.status !== 'Expected');
  return ok({
    expectedCount: bags.length,
    scannedCount: scanned.length,
    missing: missing.map((b) => hydrateBag(store, b)),
    damaged: damaged.map((b) => hydrateBag(store, b)),
    extra: clone(trip.extraTags || []),
  });
}

export async function recordDiscrepancy(tripId, notes) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const text = (notes || '').trim();
  if (text.length < 10 || text.length > 500) return fail('Discrepancy notes must be 10–500 characters.');
  const bags = store.bags.filter((b) => b.tripId === tripId && b.status === 'Expected');
  for (const bag of bags) {
    ensureException(store, { type: 'Missing Bag', severity: 'Medium', tripId, bagId: bag.id, room: bag.room, note: text });
  }
  trip.discrepancyRecorded = true;
  saveStore();
  return ok({ exceptionsCreated: bags.length });
}

export async function investigate(bagId, { checklist, notes }) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const exc = store.exceptions.find((e) => e.bagId === bagId && !['Resolved', 'Closed'].includes(e.status));
  const entry = { at: nowIso(), checklist: checklist || [], notes: notes || '' };
  if (exc) { exc.notes.push({ at: entry.at, text: `Investigation: ${entry.checklist.filter(Boolean).length}/${entry.checklist.length} checked. ${entry.notes}` }); exc.status = 'In Progress'; }
  saveStore();
  return ok({ bagId, recorded: true });
}

export async function bagFound(bagId, scannedTag) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (String(scannedTag).trim().toLowerCase() !== bag.tagNumber.toLowerCase()) {
    return fail(`That tag doesn't match ${bag.tagNumber}.`);
  }
  bag.status = 'Received at Accommodation';
  bag.scannedAt = nowIso();
  const exc = store.exceptions.find((e) => e.bagId === bagId && !['Resolved', 'Closed'].includes(e.status));
  if (exc) { exc.status = 'Resolved'; exc.resolutionOutcome = 'Bag found'; exc.resolvedAt = nowIso(); }
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function escalateMissing(bagId, notes) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const exc = store.exceptions.find((e) => e.bagId === bagId && !['Resolved', 'Closed'].includes(e.status));
  if (exc) {
    exc.status = 'Escalated'; exc.escalated = true; exc.severity = 'High';
    if (notes) exc.notes.push({ at: nowIso(), text: notes });
  }
  saveStore();
  return ok({ bagId, escalated: true });
}

export async function accept(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId);
  if (!trip) return fail('Trip not found.');
  const bags = store.bags.filter((b) => b.tripId === tripId);
  // A still-missing bag only blocks acceptance if it hasn't even been
  // escalated yet — once escalated it's formally handed off to Operations
  // and shouldn't hold up accepting the rest of the shipment.
  const unresolved = bags.filter((b) => {
    if (b.status !== 'Expected') return false;
    const exc = store.exceptions.find((e) => e.bagId === b.id);
    return !exc || !['Escalated', 'Resolved', 'Closed'].includes(exc.status);
  });
  if (unresolved.length) return fail(`${unresolved.length} bag${unresolved.length === 1 ? '' : 's'} still missing — find or escalate before accepting.`);
  trip.status = 'Unloaded';
  trip.acceptedAt = nowIso();
  saveStore();
  return ok({
    tripCode: trip.code, hotel: trip.hotel, bay: trip.bay, acceptedAt: trip.acceptedAt,
    totalBags: bags.length, damagedCount: bags.filter((b) => b.damaged).length,
    extraCount: (trip.extraTags || []).length,
  });
}

/* ===================== SORTING ===================== */

export async function getSortBoard() {
  const store = getStore();
  const staff = myStaff(store);
  const hotel = findHotel(store, staff?.hotel);
  const bags = store.bags.filter((b) => b.hotel === staff?.hotel);
  const toSort = bags.filter((b) => b.status === 'Received at Accommodation').map((b) => hydrateBag(store, b));
  const lanes = {};
  if (hotel) {
    for (const key of Object.keys(hotel.buildings)) {
      const sortedInBuilding = bags.filter((b) => b.building === key && b.status === 'Sorted');
      const floors = {};
      for (const b of sortedInBuilding) {
        const floor = b.room ? b.room.split('-')[1]?.[0] : '?';
        floors[floor] = (floors[floor] || 0) + 1;
      }
      lanes[key] = { total: sortedInBuilding.length, floors };
    }
  }
  return ok({ toSort, lanes });
}

export async function sortBag(scannedTag) {
  const store = getStore();
  const staff = myStaff(store);
  const bag = findBagByTag(store, scannedTag);
  if (!bag) return fail('Unrecognised bag tag.');
  if (bag.hotel !== staff?.hotel) return fail(`This bag belongs to ${bag.hotel} — wrong hotel.`, 'wrong-hotel');
  if (bag.status !== 'Received at Accommodation') return fail(`${bag.tagNumber} is not ready to sort (status: ${bag.status}).`);
  if (!bag.room) return fail('No room on file for this bag.', 'room-unknown');
  const floor = bag.room.split('-')[1]?.[0];
  bag.status = 'Sorted';
  bag.sortedLane = { building: bag.building, floor, room: bag.room };
  saveStore();
  return ok({ bag: hydrateBag(store, bag), lane: bag.sortedLane });
}

export async function assignRoom(bagId, room) {
  const store = getStore();
  const staff = myStaff(store);
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const formatted = String(room).trim().toUpperCase();
  if (!/^[A-Za-z]+-\d{3}$/.test(formatted)) return fail('Room must be in the format Building-000, e.g. B-207.');
  const buildingKey = formatted.split('-')[0];
  const hotel = findHotel(store, staff?.hotel);
  if (!hotel || !hotel.buildings[buildingKey] || !hotel.buildings[buildingKey].rooms.includes(formatted)) {
    return fail(`${formatted} does not exist at ${staff?.hotel}.`);
  }
  bag.room = formatted;
  bag.building = buildingKey;
  saveStore();
  return ok(hydrateBag(store, bag));
}

/* ===================== PLANNING ===================== */

function activeRunsForLead(store, leadName) {
  return store.runs.filter((r) => r.lead === leadName && !['Completed', 'Cancelled'].includes(r.status)).length;
}

export async function getReadyForDelivery() {
  const store = getStore();
  const staff = myStaff(store);
  const bags = store.bags.filter((b) => b.hotel === staff?.hotel && b.status === 'Sorted');
  return ok(bags.map((b) => hydrateBag(store, b)));
}

export async function buildPlan() {
  const store = getStore();
  const staff = myStaff(store);
  const capacity = store.config.trolleyDefaultCapacity;
  const bags = store.bags.filter((b) => b.hotel === staff?.hotel && b.status === 'Sorted');
  const byBuildingRoom = {};
  for (const b of bags) {
    byBuildingRoom[b.building] = byBuildingRoom[b.building] || {};
    byBuildingRoom[b.building][b.room] = byBuildingRoom[b.building][b.room] || [];
    byBuildingRoom[b.building][b.room].push(b);
  }
  const proposals = [];
  for (const building of Object.keys(byBuildingRoom)) {
    const rooms = Object.keys(byBuildingRoom[building]).sort();
    let current = { building, rooms: [], bagIds: [] };
    for (const room of rooms) {
      const roomBags = byBuildingRoom[building][room];
      if (current.bagIds.length + roomBags.length > capacity && current.rooms.length) {
        proposals.push(current);
        current = { building, rooms: [], bagIds: [] };
      }
      current.rooms.push(room);
      current.bagIds.push(...roomBags.map((b) => b.id));
    }
    if (current.rooms.length) proposals.push(current);
  }
  return ok(proposals.map((p, i) => ({
    draftId: `draft-${i}`, building: p.building, rooms: p.rooms, bagIds: p.bagIds, capacity,
  })));
}

export async function savePlan(drafts) {
  const store = getStore();
  const staff = myStaff(store);
  const capacity = store.config.trolleyDefaultCapacity;
  for (const d of drafts) {
    if (d.bagIds.length > capacity) return fail(`Run exceeds trolley capacity (${d.bagIds.length}/${capacity}).`);
  }
  const saved = drafts.map((d) => ({
    id: newId('RUN'), code: newId('DA-'), hotel: staff?.hotel, building: d.building, rooms: d.rooms, bagIds: d.bagIds,
    team: null, lead: null, trolleyId: null, status: 'Planned', createdAt: nowIso(), statusChangedAt: nowIso(), notifiedAt: null, cancelReason: null,
  }));
  store.runs.push(...saved);
  saveStore();
  return ok(clone(saved));
}

export async function getRuns(filters = {}) {
  const store = getStore();
  const staff = myStaff(store);
  let runs = store.runs.filter((r) => r.hotel === staff?.hotel);
  if (filters.status) runs = runs.filter((r) => r.status === filters.status);
  return ok(clone(runs));
}

export async function getRun(id) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === id);
  if (!run) return fail('Run not found.');
  const bags = store.bags.filter((b) => run.bagIds.includes(b.id)).map((b) => hydrateBag(store, b));
  return ok({ ...clone(run), bags });
}

export async function assign(runId, { teamId, leadName, trolleyId }) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === runId);
  if (!run) return fail('Run not found.');
  if (!teamId) return fail('Team is required.');
  if (!leadName) return fail('Lead is required.');
  if (!trolleyId) return fail('Trolley is required.');
  const trolley = store.trolleys.find((t) => t.id === trolleyId);
  if (!trolley || trolley.status !== 'Available') return fail('Selected trolley is not available.');
  if (run.bagIds.length > trolley.capacity) return fail(`Run exceeds trolley capacity (${run.bagIds.length}/${trolley.capacity}).`);
  if (activeRunsForLead(store, leadName) >= store.config.maxActiveRunsPerLead && run.lead !== leadName) {
    return fail(`${leadName} already leads ${store.config.maxActiveRunsPerLead} active runs.`);
  }
  const team = store.teams.find((t) => t.id === teamId);
  run.team = team?.name || teamId;
  run.lead = leadName;
  run.trolleyId = trolleyId;
  run.trolleyCode = trolley.code;
  if (run.status !== 'Assigned') run.statusChangedAt = nowIso();
  run.status = 'Assigned';
  saveStore();
  return ok(clone(run));
}

export async function trolleyScan(runId, scannedCode) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === runId);
  if (!run) return fail('Run not found.');
  if (!run.trolleyCode) return fail('Assign a trolley before scanning it.');
  if (String(scannedCode).trim().toUpperCase() !== run.trolleyCode.toUpperCase()) {
    return fail(`Wrong trolley — this run uses ${run.trolleyCode}.`);
  }
  return ok({ ok: true });
}

export async function loadTrolley(runId, scannedTag) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === runId);
  if (!run) return fail('Run not found.');
  const bag = findBagByTag(store, scannedTag);
  if (!bag || !run.bagIds.includes(bag.id)) return fail('This bag is not part of this run.');
  if (bag.status === 'Out for Delivery') return fail(`${bag.tagNumber} is already loaded.`);
  bag.status = 'Out for Delivery';
  saveStore();
  const loadedCount = store.bags.filter((b) => run.bagIds.includes(b.id) && b.status === 'Out for Delivery').length;
  return ok({ bag: hydrateBag(store, bag), loadedCount, total: run.bagIds.length });
}

export async function manifest(runId) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === runId);
  if (!run) return fail('Run not found.');
  const bags = store.bags.filter((b) => run.bagIds.includes(b.id));
  const rows = bags.map((b) => {
    const p = findPilgrim(store, b.pilgrimId);
    return { room: b.room, pilgrimName: p?.name || '', nusukLast4: p?.nusukId?.slice(-4) || '', tag: b.tagNumber, damageNote: b.damageInfo?.description || '' };
  }).sort((a, b) => a.room.localeCompare(b.room));
  return ok({
    hotel: run.hotel, building: run.building, runCode: run.code, team: run.team, lead: run.lead,
    trolleyCode: run.trolleyCode, generatedAt: nowIso(), rows, totalBags: bags.length,
  });
}

/* ===================== BOARD ===================== */

export async function getBoard() {
  const store = getStore();
  const staff = myStaff(store);
  const runs = store.runs.filter((r) => r.hotel === staff?.hotel);
  return ok(clone(runs));
}

export async function notify(runId) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === runId);
  if (!run) return fail('Run not found.');
  const loaded = store.bags.filter((b) => run.bagIds.includes(b.id) && b.status === 'Out for Delivery').length;
  if (loaded < run.bagIds.length) return fail('Load all bags onto the trolley before notifying.');
  run.status = 'Notified';
  run.statusChangedAt = nowIso();
  run.notifiedAt = nowIso();
  saveStore();
  return ok(clone(run));
}

export async function reassign(runId, payload) { return assign(runId, payload); }

export async function cancelAssignment(runId, reason) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === runId);
  if (!run) return fail('Run not found.');
  if (!reason || !reason.trim()) return fail('A reason is required.');
  for (const bag of store.bags.filter((b) => run.bagIds.includes(b.id))) {
    bag.status = 'Sorted';
  }
  run.status = 'Cancelled';
  run.statusChangedAt = nowIso();
  run.cancelReason = reason.trim();
  saveStore();
  return ok(clone(run));
}

export async function simulateDeliveryStarted(runId) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === runId);
  if (!run) return fail('Run not found.');
  run.status = 'In Progress';
  run.statusChangedAt = nowIso();
  saveStore();
  return ok(clone(run));
}

export async function simulateDeliveryCompleted(runId) {
  const store = getStore();
  const run = store.runs.find((r) => r.id === runId);
  if (!run) return fail('Run not found.');
  run.status = 'Completed';
  run.statusChangedAt = nowIso();
  saveStore();
  return ok(clone(run));
}

/* ===================== TEAMS / TROLLEYS ===================== */

export async function getTeams() {
  const store = getStore();
  const staff = myStaff(store);
  return ok(store.teams.filter((t) => t.hotel === staff?.hotel).map((t) => clone(t)));
}

export async function createTeam({ name, building, memberNames }) {
  const store = getStore();
  const staff = myStaff(store);
  const trimmed = (name || '').trim();
  if (!trimmed) return fail('Team name is required.');
  if (store.teams.some((t) => t.hotel === staff?.hotel && t.name.toLowerCase() === trimmed.toLowerCase())) return fail('Team name already exists.');
  if (!memberNames || !memberNames.length) return fail('At least one member is required.');
  const team = { id: newId('TEAM'), name: trimmed, hotel: staff?.hotel, building, leadName: memberNames[0], memberNames, active: true };
  store.teams.push(team);
  saveStore();
  return ok(clone(team));
}

export async function updateTeam(id, payload) {
  const store = getStore();
  const team = store.teams.find((t) => t.id === id);
  if (!team) return fail('Team not found.');
  if (payload.memberNames && !payload.memberNames.length) return fail('At least one member is required.');
  Object.assign(team, payload);
  saveStore();
  return ok(clone(team));
}

export async function toggleTeamActive(id, active) {
  const store = getStore();
  const team = store.teams.find((t) => t.id === id);
  if (!team) return fail('Team not found.');
  team.active = active;
  saveStore();
  return ok(clone(team));
}

export async function getTrolleys() {
  const store = getStore();
  const staff = myStaff(store);
  return ok(store.trolleys.filter((t) => t.hotel === staff?.hotel).map((t) => clone(t)));
}

export async function createTrolley({ code, capacity }) {
  const store = getStore();
  const staff = myStaff(store);
  const formatted = String(code).trim().toUpperCase();
  if (!/^TR-[A-Z]+-\d{2}$/.test(formatted)) return fail('Trolley number must match TR-[A-Z]+-00.');
  if (store.trolleys.some((t) => t.code === formatted)) return fail('Trolley number already exists.');
  const cap = Number(capacity);
  if (!Number.isInteger(cap) || cap < 1 || cap > 40) return fail('Capacity must be an integer 1–40.');
  const trolley = { id: newId('TR'), code: formatted, hotel: staff?.hotel, capacity: cap, status: 'Available', outOfServiceReason: null };
  store.trolleys.push(trolley);
  saveStore();
  return ok(clone(trolley));
}

export async function setTrolleyOutOfService(id, reason) {
  const store = getStore();
  const trolley = store.trolleys.find((t) => t.id === id);
  if (!trolley) return fail('Trolley not found.');
  if (!reason || !reason.trim()) return fail('A reason is required.');
  trolley.status = 'Out of service';
  trolley.outOfServiceReason = reason.trim();
  saveStore();
  return ok(clone(trolley));
}

export async function setTrolleyAvailable(id) {
  const store = getStore();
  const trolley = store.trolleys.find((t) => t.id === id);
  if (!trolley) return fail('Trolley not found.');
  trolley.status = 'Available';
  trolley.outOfServiceReason = null;
  saveStore();
  return ok(clone(trolley));
}

/* ===================== INVENTORY ===================== */

export async function searchInventory(query) {
  const store = getStore();
  const staff = myStaff(store);
  const q = String(query || '').trim().toLowerCase();
  let bags = store.bags.filter((b) => b.hotel === staff?.hotel);
  if (q) {
    bags = bags.filter((b) => {
      const p = findPilgrim(store, b.pilgrimId);
      return b.tagNumber.toLowerCase().includes(q) || (b.room || '').toLowerCase().includes(q) || (p?.name || '').toLowerCase().includes(q);
    });
  }
  return ok(bags.map((b) => hydrateBag(store, b)));
}

export async function moveLane(bagId, newRoom) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (bag.status !== 'Sorted') return fail('Only sorted (not yet loaded) bags can be moved.');
  const result = await assignRoom(bagId, newRoom);
  bag.sortedLane = { building: bag.building, floor: bag.room.split('-')[1]?.[0], room: bag.room };
  saveStore();
  return result;
}

export async function removeFromAssignment(bagId) {
  const store = getStore();
  const bag = findBagById(store, bagId);
  if (!bag) return fail('Bag not found.');
  const run = store.runs.find((r) => r.bagIds.includes(bagId));
  if (run) run.bagIds = run.bagIds.filter((id) => id !== bagId);
  bag.status = 'Sorted';
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function markRoomChanged(bagId, newRoom) {
  return assignRoom(bagId, newRoom);
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

/* ===================== REPORTS ===================== */

export async function getReportsSummary() {
  const store = getStore();
  const staff = myStaff(store);
  const trips = store.trips.filter((t) => t.hotel === staff?.hotel);
  const bags = store.bags.filter((b) => b.hotel === staff?.hotel);
  const runs = store.runs.filter((r) => r.hotel === staff?.hotel);
  return ok({
    generatedAt: nowIso(),
    trucksReceived: trips.filter((t) => t.status === 'Unloaded').length,
    bagsUnloaded: bags.filter((b) => b.status !== 'Expected').length,
    bagsSorted: bags.filter((b) => ['Sorted', 'Out for Delivery'].includes(b.status)).length,
    bagsOutForDelivery: bags.filter((b) => b.status === 'Out for Delivery').length,
    exceptionsOpen: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)).length,
    runRows: runs.map((r) => ({ run: r.code, building: r.building, status: r.status, bags: r.bagIds.length, team: r.team || '—' })),
  });
}

/* ===================== HANDOVER ===================== */

export async function getHandoverSummary() {
  const store = getStore();
  const staff = myStaff(store);
  const trips = store.trips.filter((t) => t.hotel === staff?.hotel);
  const bags = store.bags.filter((b) => b.hotel === staff?.hotel);
  const runs = store.runs.filter((r) => r.hotel === staff?.hotel);
  return ok({
    openExceptions: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status)).length,
    trucksPendingVerification: trips.filter((t) => t.status === 'At Destination' || t.status === 'Unloading').length,
    bagsAwaitingSort: bags.filter((b) => b.status === 'Received at Accommodation').length,
    runsNotYetAssigned: runs.filter((r) => r.status === 'Planned').length,
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

export async function demoSendTruckNow() {
  const store = getStore();
  const staff = myStaff(store);
  const trip = store.trips.find((t) => t.hotel === staff?.hotel && t.status === 'En route');
  if (!trip) return fail('No en-route truck available.');
  trip.eta = nowIso();
  trip.status = 'At Destination';
  trip.arrivedAt = nowIso();
  saveStore();
  return ok(clone(trip));
}

export async function demoSimulateUnloading(tripId, allButOne) {
  const store = getStore();
  const trip = findTrip(store, tripId) || store.trips.find((t) => t.status === 'Unloading' || t.status === 'At Destination');
  if (!trip) return fail('No trip in progress.');
  const bags = store.bags.filter((b) => b.tripId === trip.id && b.status === 'Expected');
  const toScan = allButOne ? bags.slice(0, -1) : bags;
  toScan.forEach((b) => { b.status = 'Received at Accommodation'; b.scannedAt = nowIso(); });
  saveStore();
  return ok({ scanned: toScan.length });
}

export async function demoFlagDamaged(tripId) {
  const store = getStore();
  const trip = findTrip(store, tripId) || store.trips.find((t) => t.status === 'Unloading' || t.status === 'At Destination');
  if (!trip) return fail('No trip in progress.');
  const bag = store.bags.find((b) => b.tripId === trip.id && b.status !== 'Expected' && !b.damaged);
  if (!bag) return fail('No scanned bag available to flag.');
  return recordDamage(bag.id, { type: 'Wheel broken', severity: 'Minor', description: 'Demo-flagged damage for walkthrough purposes.', photoRef: null, repaired: false });
}

export async function demoSimulateDriverReceipt() {
  return ok({ receiptShown: true });
}

export async function demoAutoSort() {
  const store = getStore();
  const staff = myStaff(store);
  const bags = store.bags.filter((b) => b.hotel === staff?.hotel && b.status === 'Received at Accommodation');
  for (const bag of bags) await sortBag(bag.tagNumber);
  return ok({ sorted: bags.length });
}

export async function demoAutoPlanAndAssign() {
  const store = getStore();
  const staff = myStaff(store);
  const drafts = await buildPlan();
  if (!drafts.length) return fail('No sorted bags ready to plan.');
  const saved = await savePlan(drafts);
  const team = store.teams.find((t) => t.hotel === staff?.hotel && t.active);
  const trolley = store.trolleys.find((t) => t.hotel === staff?.hotel && t.status === 'Available');
  for (const run of saved) {
    if (team && trolley) {
      await assign(run.id, { teamId: team.id, leadName: team.leadName, trolleyId: trolley.id });
      for (const bagId of run.bagIds) {
        const bag = findBagById(store, bagId);
        if (bag) await loadTrolley(run.id, bag.tagNumber);
      }
    }
  }
  return ok({ runs: saved.length });
}

export function demoForceNextFail() {
  const store = getStore();
  store.demoForceFail = true;
  saveStore();
}

export function demoReset() { resetStore(); }
