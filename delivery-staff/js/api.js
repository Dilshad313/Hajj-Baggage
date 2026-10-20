/**
 * Mock REST API for the Delivery Staff console.
 * Every function is async, resolves after a realistic delay, and can be made
 * to reject via `?fail=1` in the URL or the one-shot demo "force fail" flag.
 * A real backend can replace this file without the UI code changing.
 */
import { getStore, saveStore, resetStore, setSession, getSession } from './store.js';
import { ARRIVAL_STAGES, EXCEPTION_TYPES } from './seed.js';

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
function floorOf(room) { return Number(room.split('-')[1][0]); }

/* ===================== internal lookups ===================== */

function myStaff(store) {
  const session = getSession();
  if (!session) return null;
  return store.staff.find((s) => s.id === session.id) || null;
}

function findRun(store, id) { return store.runs.find((r) => r.id === id); }
function findStop(store, id) { return store.stops.find((s) => s.id === id); }
function findPilgrim(store, id) { return store.pilgrims.find((p) => p.id === id); }
function findBagByTag(store, runId, tag) {
  return store.bags.find((b) => b.runId === runId && b.tagNumber.toLowerCase() === String(tag).toLowerCase());
}
function stopsOf(store, run) { return run.stopIds.map((id) => findStop(store, id)); }
function bagsOfStop(store, stop) { return stop.bagIds.map((id) => store.bags.find((b) => b.id === id)); }

function orderedStops(store, run) {
  return stopsOf(store, run).slice().sort((a, b) => (a.floor - b.floor) || a.room.localeCompare(b.room));
}

function hydrateStop(store, stop) {
  const bags = bagsOfStop(store, stop);
  const pilgrims = stop.pilgrimIds.map((id) => findPilgrim(store, id));
  return { ...clone(stop), bags: clone(bags), pilgrims: clone(pilgrims) };
}

function activeRunFor(store, staffId) {
  return store.runs.find((r) => r.staffId === staffId && r.status === 'In Progress');
}

/* ===================== AUTH ===================== */

/** @param {string} employeeId @param {string} pin */
export async function login(employeeId, pin) {
  const store = getStore();
  const staff = store.staff.find((s) => s.employeeId.toLowerCase() === String(employeeId).toLowerCase());
  if (!staff || staff.pin !== pin) return fail('Invalid employee ID or PIN.');
  const session = { id: staff.id, name: staff.name, employeeId: staff.employeeId, hotel: staff.hotel };
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

/* ===================== RUNS ===================== */

function runSummary(store, run) {
  const stops = stopsOf(store, run);
  const bags = store.bags.filter((b) => b.runId === run.id);
  const delivered = stops.filter((s) => s.status === 'Delivered').length;
  const floors = stops.map((s) => s.floor);
  const oldestPending = stops.filter((s) => s.status === 'Pending');
  const oldestWaitMinutes = run.status === 'In Progress' && oldestPending.length
    ? Math.round((Date.now() - new Date(run.startedAt).getTime()) / 60000) : null;
  return {
    ...clone(run),
    stopsCount: stops.length,
    bagsCount: bags.length,
    deliveredCount: delivered,
    floorMin: Math.min(...floors), floorMax: Math.max(...floors),
    oldestWaitMinutes,
  };
}

/** @param {{tab?:'today'|'completed'|'cancelled'}} filters */
export async function getRuns(filters = {}) {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  let runs = store.runs.filter((r) => r.staffId === staff.id);
  if (filters.tab === 'completed') runs = runs.filter((r) => r.status === 'Completed' || r.status === 'Completed with exceptions');
  else if (filters.tab === 'cancelled') runs = runs.filter((r) => r.status === 'Cancelled');
  else runs = runs.filter((r) => r.status !== 'Cancelled' && r.status !== 'Completed' && r.status !== 'Completed with exceptions');
  return ok(runs.map((r) => runSummary(store, r)));
}

export async function getRun(id) {
  const store = getStore();
  const run = findRun(store, id);
  if (!run) return fail('Run not found.');
  const stops = orderedStops(store, run).map((s) => hydrateStop(store, s));
  return ok({ ...runSummary(store, run), stops });
}

export async function startRun(id) {
  const store = getStore();
  const run = findRun(store, id);
  if (!run) return fail('Run not found.');
  const active = activeRunFor(store, run.staffId);
  if (active && active.id !== id) return fail(`Finish ${active.code} before starting another run.`);
  if (run.status !== 'In Progress') { run.status = 'In Progress'; run.startedAt = run.startedAt || nowIso(); }
  saveStore();
  return ok(clone(run));
}

/* ===================== TROLLEY ===================== */

export async function pickUpTrolley(runId, scannedCode) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  if (scannedCode.trim().toUpperCase() !== run.trolleyId.toUpperCase()) {
    return fail(`Wrong trolley — this run uses ${run.trolleyId}.`);
  }
  run.trolleyPickedUp = true;
  saveStore();
  return ok({ run: clone(run) });
}

export async function getTrolleyChecklist(runId) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  const bags = store.bags.filter((b) => b.runId === runId);
  return ok(bags.map((b) => ({ ...clone(b), pilgrimName: findPilgrim(store, b.pilgrimId)?.name || '' })));
}

export async function collectFromHold(runId, scannedTag) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  const bag = findBagByTag(store, runId, scannedTag);
  if (!bag) return fail('This bag is not part of this run.');
  if (bag.status !== 'In hold (missing)') return fail(`${bag.tagNumber} is already on the trolley.`);
  bag.status = 'On trolley';
  saveStore();
  return ok(clone(bag));
}

/* ===================== OUT FOR DELIVERY ===================== */

export async function outForDelivery(runId, scannedTag) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  const bag = findBagByTag(store, runId, scannedTag);
  if (!bag) return fail('This bag is not part of this run.');
  if (bag.status === 'In hold (missing)') return fail(`${bag.tagNumber} is still in hold — collect it first.`);
  if (bag.status !== 'On trolley') return fail(`${bag.tagNumber} is already out for delivery.`);
  bag.status = 'Out for delivery';
  saveStore();
  return ok(clone(bag));
}

export async function getOutForDeliveryStatus(runId) {
  const store = getStore();
  const bags = store.bags.filter((b) => b.runId === runId);
  return ok({
    ready: bags.filter((b) => b.status !== 'On trolley' && b.status !== 'In hold (missing)').length,
    total: bags.length,
    bags: clone(bags),
  });
}

/* ===================== STOPS / ROOM ARRIVAL ===================== */

export async function routeStops(runId) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  return ok(orderedStops(store, run).map((s) => hydrateStop(store, s)));
}

export async function getStop(stopId) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  const run = findRun(store, stop.runId);
  return ok({ ...hydrateStop(store, stop), run: clone(run) });
}

export async function arriveRoom(stopId, scannedCode) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  if (scannedCode && scannedCode.trim().toUpperCase() !== stop.room.toUpperCase()) {
    return fail(`That QR doesn't match room ${stop.room}.`);
  }
  return ok({ arrived: true });
}

export async function skipRoom(stopId, reason) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  if (!reason || !reason.trim()) return fail('A reason is required to skip this room.');
  stop.status = 'Rescheduled';
  stop.skippedReason = reason.trim();
  saveStore();
  return ok(clone(stop));
}

/* ===================== IDENTITY ===================== */

export async function verifyIdentity(stopId, pilgrimId, method, data) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  const pilgrim = findPilgrim(store, pilgrimId);
  if (!pilgrim) return fail('Pilgrim not found.');
  let verified = false;
  if (method === 'nusuk-qr') {
    verified = String(data.code || '').trim() === pilgrim.nusukId;
  } else if (method === 'passport') {
    const last4 = String(data.last4 || '').trim();
    verified = last4.length === 4 && last4 === pilgrim.passportLast4 && !!data.photoMatch;
  }
  if (!verified) return fail('Identity could not be verified — check the code and try again.');
  return ok({ verified: true, pilgrim: clone(pilgrim) });
}

/* ===================== NOT FOUND ===================== */

function ensureException(store, stop, pilgrim) {
  let exc = store.exceptions.find((e) => e.stopId === stop.id && !['Resolved', 'Closed'].includes(e.status));
  if (!exc) {
    exc = {
      id: newId('EXC'), time: nowIso(), type: 'Pilgrim Not Found', severity: 'Medium',
      status: 'Open', stopId: stop.id, runId: stop.runId, room: stop.room,
      pilgrimName: pilgrim?.name || '', attempts: [], escalated: false,
    };
    store.exceptions.unshift(exc);
  }
  return exc;
}

export async function recordAttempt(stopId, { reason, notes }) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  if (!reason) return fail('A reason is required.');
  if (!notes || notes.trim().length < 5 || notes.trim().length > 300) return fail('Notes must be 5–300 characters.');
  const run = findRun(store, stop.runId);
  const pilgrim = findPilgrim(store, stop.pilgrimIds[0]);
  const attempt = { at: nowIso(), reason, notes: notes.trim() };
  stop.attempts.push(attempt);
  stop.status = 'Not found';
  const exc = ensureException(store, stop, pilgrim);
  exc.attempts.push(attempt);
  const maxAttempts = store.config.maxAttempts;
  if (stop.attempts.length >= maxAttempts) {
    exc.status = 'Escalated';
    exc.escalated = true;
    exc.severity = 'High';
  } else {
    exc.status = 'Open';
  }
  saveStore();
  return ok({ stop: clone(stop), attemptNumber: stop.attempts.length, maxAttempts, escalated: exc.escalated, run: clone(run) });
}

export async function contactSupervisor(stopId, note) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  const entry = { id: newId('CALL'), stopId, time: nowIso(), note: note || null };
  store.supervisorCallLog.unshift(entry);
  saveStore();
  return ok(entry);
}

const ROOM_FORMAT = /^[A-Za-z]+-\d{3}$/;

/** Marks the stop's open exception (if any) Resolved, recording the outcome. */
function resolveLinkedException(store, stop, outcome) {
  const exc = store.exceptions.find((e) => e.stopId === stop.id && !['Resolved', 'Closed'].includes(e.status));
  if (exc) {
    exc.status = 'Resolved';
    exc.resolutionOutcome = outcome;
    exc.resolvedAt = nowIso();
  }
}

export async function resolveNotFound(stopId, option, data = {}) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  const run = findRun(store, stop.runId);
  const hotel = store.hotels.find((h) => h.name === run.hotel);

  if (option === 'located') {
    stop.status = 'Pending';
    resolveLinkedException(store, stop, 'Pilgrim located');
  } else if (option === 'room-changed') {
    const newRoom = String(data.room || '').trim().toUpperCase();
    if (!ROOM_FORMAT.test(newRoom)) return fail('Room must be in the format Building-000, e.g. A-305.');
    const buildingKey = newRoom.split('-')[0];
    const exists = hotel && hotel.buildings[buildingKey] && hotel.buildings[buildingKey].rooms.includes(newRoom);
    if (!exists) return fail(`${newRoom} does not exist at ${run.hotel}.`);
    stop.room = newRoom;
    stop.building = buildingKey;
    stop.floor = floorOf(newRoom);
    stop.status = 'Pending';
    resolveLinkedException(store, stop, `Room changed to ${newRoom}`);
  } else if (option === 'proxy') {
    const name = String(data.name || '').trim();
    const relation = data.relation;
    const idNumber = String(data.idNumber || '').trim();
    const pin = String(data.pin || '').trim();
    if (name.length < 3 || name.length > 80) return fail('Proxy name must be 3–80 characters.');
    if (!relation) return fail('Relation to the pilgrim is required.');
    if (idNumber.length < 4 || idNumber.length > 20) return fail('ID must be 4–20 characters.');
    if (pin !== store.config.supervisorPin) return fail('Incorrect supervisor PIN.');
    stop.resolution = { option, proxy: { name, relation, idNumber }, at: nowIso() };
    stop.status = 'Pending';
    resolveLinkedException(store, stop, `Delivered to authorised proxy: ${name}`);
    saveStore();
    return ok(clone(stop));
  } else if (option === 'reattempt') {
    stop.status = 'Rescheduled';
  } else if (option === 'refused') {
    stop.status = 'Returned';
    resolveLinkedException(store, stop, 'Pilgrim refused the bag');
  } else {
    return fail('Unknown resolution option.');
  }
  stop.resolution = { option, data, at: nowIso() };
  saveStore();
  return ok(clone(stop));
}

/* ===================== HANDOVER / DELIVERY ===================== */

export async function handoverScan(stopId, scannedTag) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  const bag = store.bags.find((b) => b.tagNumber.toLowerCase() === String(scannedTag).toLowerCase());
  if (!bag) return fail('Unrecognised bag tag.');
  if (bag.stopId !== stopId) {
    const otherStop = findStop(store, bag.stopId);
    const otherPilgrim = findPilgrim(store, otherStop?.pilgrimIds[0]);
    return fail(`Belongs to ${otherPilgrim?.name || 'another pilgrim'}, room ${otherStop?.room || '?'}.`);
  }
  bag.handoverScanned = true;
  saveStore();
  return ok(clone(bag));
}

export async function deliver(stopId, { signatureDataUrl, witnessName, recipientType, recipientName }) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  if (!signatureDataUrl && (!witnessName || witnessName.trim().length < 3)) {
    return fail('A signature, or a witness name, is required.');
  }
  const bags = bagsOfStop(store, stop).filter((b) => b.handoverScanned);
  if (!bags.length) return fail('Scan at least one bag before confirming delivery.');
  const at = nowIso();
  for (const bag of bags) {
    bag.status = 'Delivered';
    bag.deliveredAt = at;
    bag.deliveredTo = recipientName;
    bag.signatureDataUrl = signatureDataUrl || null;
    bag.witnessName = witnessName || null;
  }
  stop.status = 'Delivered';
  stop.deliveredAt = at;
  saveStore();
  const receipt = {
    stopId, room: stop.room, recipientType, recipientName, bagsDelivered: bags.length,
    deliveredAt: at, qrPayload: `RABEL-DLV-${stopId}-${bags.length}`,
  };
  return ok(receipt);
}

/* ===================== RETURN ===================== */

export async function getUndelivered(runId) {
  const store = getStore();
  const bags = store.bags.filter((b) => b.runId === runId && !['Delivered', 'Returned to hold'].includes(b.status));
  return ok(bags.map((b) => ({ ...clone(b), stop: clone(findStop(store, b.stopId)), pilgrimName: findPilgrim(store, b.pilgrimId)?.name || '' })));
}

export async function returnToHold(runId, bagTag, opts = {}) {
  const store = getStore();
  const bag = findBagByTag(store, runId, bagTag);
  if (!bag) return fail('This bag is not part of this run.');
  if (opts.manual && (!opts.reason || !opts.reason.trim())) return fail('A reason is required for manual entry.');
  bag.status = 'Returned to hold';
  saveStore();
  return ok(clone(bag));
}

export async function returnTrolley(runId, scannedCode, opts = {}) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  if (scannedCode.trim().toUpperCase() !== run.trolleyId.toUpperCase()) {
    return fail(`Wrong trolley — this run uses ${run.trolleyId}.`);
  }
  if (opts.damaged && (!opts.reason || !opts.reason.trim())) return fail('A reason is required for a damaged trolley.');
  run.trolleyReturned = true;
  run.trolleyDamaged = !!opts.damaged;
  run.trolleyDamageReason = opts.damaged ? opts.reason.trim() : null;
  saveStore();
  return ok(clone(run));
}

/* ===================== RECONCILE ===================== */

export async function reconcile(runId) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  const stops = orderedStops(store, run);
  const rows = stops.map((s) => {
    const bags = bagsOfStop(store, s);
    return {
      stopId: s.id, room: s.room, pilgrimName: findPilgrim(store, s.pilgrimIds[0])?.name || '',
      assigned: bags.length,
      delivered: bags.filter((b) => b.status === 'Delivered').length,
      proxy: s.resolution?.option === 'proxy' ? s.resolution.proxy.name : null,
      returned: bags.filter((b) => b.status === 'Returned to hold').length,
      stillOnTrolley: bags.filter((b) => b.status === 'On trolley' || b.status === 'Out for delivery' || b.status === 'In hold (missing)').length,
      attempts: s.attempts.length,
      status: s.status,
    };
  });
  const unaccounted = rows.reduce((sum, r) => sum + r.stillOnTrolley, 0);
  return ok({ run: clone(run), rows, unaccounted, canComplete: unaccounted === 0 });
}

export async function completeRun(runId, notes) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  const bags = store.bags.filter((b) => b.runId === runId);
  const unaccounted = bags.filter((b) => ['On trolley', 'Out for delivery', 'In hold (missing)'].includes(b.status));
  if (unaccounted.length > 0) return fail(`${unaccounted.length} bag${unaccounted.length === 1 ? '' : 's'} still unaccounted for.`);
  const hasExceptions = store.exceptions.some((e) => e.runId === runId && !['Resolved', 'Closed'].includes(e.status))
    || bags.some((b) => b.status === 'Returned to hold');
  run.status = hasExceptions ? 'Completed with exceptions' : 'Completed';
  run.completedAt = nowIso();
  run.notes = notes || null;
  store.runHistory.unshift({ runId, completedAt: run.completedAt, status: run.status });
  saveStore();
  return ok(clone(run));
}

/* ===================== ALERTS / LOOKUP / HISTORY / SUMMARY ===================== */

export async function getAlerts() {
  const store = getStore();
  const staff = myStaff(store);
  const myRunIds = store.runs.filter((r) => r.staffId === staff?.id).map((r) => r.id);
  const exceptions = store.exceptions.filter((e) => myRunIds.includes(e.runId));
  return ok({ notifications: clone(store.notifications), exceptions: clone(exceptions) });
}

export async function markRead(id) {
  const store = getStore();
  if (id === 'all') store.notifications.forEach((n) => { n.unread = false; });
  else { const n = store.notifications.find((x) => x.id === id); if (n) n.unread = false; }
  saveStore();
  return ok(clone(store.notifications));
}

export async function lookup(query) {
  const store = getStore();
  const q = String(query || '').trim().toLowerCase();
  if (!q) return ok([]);
  const results = store.bags.filter((b) => {
    const stop = findStop(store, b.stopId);
    const pilgrim = findPilgrim(store, b.pilgrimId);
    return b.tagNumber.toLowerCase().includes(q)
      || stop?.room.toLowerCase().includes(q)
      || pilgrim?.name.toLowerCase().includes(q);
  }).map((b) => {
    const stop = findStop(store, b.stopId);
    const pilgrim = findPilgrim(store, b.pilgrimId);
    return { ...clone(b), room: stop?.room, pilgrimName: pilgrim?.name, stages: ARRIVAL_STAGES };
  });
  return ok(results.slice(0, 50));
}

export async function getHistory() {
  const store = getStore();
  const staff = myStaff(store);
  const runs = store.runs.filter((r) => r.staffId === staff?.id && (r.status === 'Completed' || r.status === 'Completed with exceptions' || r.status === 'Cancelled'));
  return ok(runs.map((r) => runSummary(store, r)));
}

export async function summary() {
  const store = getStore();
  const staff = myStaff(store);
  const runs = store.runs.filter((r) => r.staffId === staff?.id);
  const bags = store.bags.filter((b) => runs.some((r) => r.id === b.runId));
  return ok({
    generatedAt: nowIso(),
    runsCompleted: runs.filter((r) => r.status === 'Completed' || r.status === 'Completed with exceptions').length,
    bagsDelivered: bags.filter((b) => b.status === 'Delivered').length,
    bagsReturned: bags.filter((b) => b.status === 'Returned to hold').length,
    exceptions: store.exceptions.filter((e) => runs.some((r) => r.id === e.runId)).length,
    rows: runs.map((r) => ({ run: r.code, hotel: r.hotel, building: r.building, status: r.status, bags: bags.filter((b) => b.runId === r.id).length })),
  });
}

export async function endShift() {
  const store = getStore();
  const staff = myStaff(store);
  const blockers = [];
  const active = activeRunFor(store, staff?.id);
  if (active) blockers.push(`${active.code} is still In Progress.`);
  const myRunIds = store.runs.filter((r) => r.staffId === staff?.id).map((r) => r.id);
  const onTrolley = store.bags.filter((b) => myRunIds.includes(b.runId) && ['On trolley', 'Out for delivery', 'In hold (missing)'].includes(b.status));
  if (onTrolley.length) blockers.push(`${onTrolley.length} bag${onTrolley.length === 1 ? '' : 's'} still on a trolley.`);
  const unreturnedTrolley = store.runs.filter((r) => r.staffId === staff?.id && r.trolleyPickedUp && !r.trolleyReturned && r.status !== 'Cancelled');
  if (unreturnedTrolley.length) blockers.push(`Trolley not yet returned for ${unreturnedTrolley.map((r) => r.code).join(', ')}.`);
  if (blockers.length) return fail(blockers.join(' '));
  return ok({ ended: true });
}

/* ===================== DEMO MENU ===================== */

export async function demoCreateRun() {
  const store = getStore();
  const staff = myStaff(store);
  if (!staff) return fail('Not authenticated.');
  const hotel = store.hotels.find((h) => h.name === staff.hotel);
  const buildingKey = Object.keys(hotel.buildings)[0];
  const building = hotel.buildings[buildingKey];
  const room = building.rooms[Math.floor(Math.random() * building.rooms.length)];
  const pilgrimId = newId('PIL-');
  const pilgrim = { id: pilgrimId, name: 'Demo Pilgrim', nationality: 'Indonesian', groupName: 'Demo Group', nusukId: `NSK${Math.floor(1000000 + Math.random() * 8999999)}`, passportLast4: '1234', phone: '+966500000000', room, groupLeaderName: null, groupLeaderPhone: null };
  store.pilgrims.push(pilgrim);
  const runId = newId('RUN-');
  const stopId = `${runId}-STOP-1`;
  const bagIds = [`${runId}-BAG-1`, `${runId}-BAG-2`];
  store.stops.push({ id: stopId, runId, room, building: buildingKey, floor: floorOf(room), pilgrimIds: [pilgrimId], bagIds, status: 'Pending', attempts: [], resolution: null, skippedReason: null, deliveredAt: null });
  store.bags.push(
    { id: bagIds[0], tagNumber: `RB-DEMO-${Math.floor(Math.random() * 900 + 100)}`, pilgrimId, stopId, runId, damaged: false, damageNote: null, status: 'On trolley', deliveredAt: null, deliveredTo: null, signatureDataUrl: null, witnessName: null },
    { id: bagIds[1], tagNumber: `RB-DEMO-${Math.floor(Math.random() * 900 + 100)}`, pilgrimId, stopId, runId, damaged: false, damageNote: null, status: 'On trolley', deliveredAt: null, deliveredTo: null, signatureDataUrl: null, witnessName: null },
  );
  store.runs.push({ id: runId, code: runId, hotel: staff.hotel, building: buildingKey, staffId: staff.id, status: 'Notified', trolleyId: `TR-DEMO-${Math.floor(Math.random() * 90 + 10)}`, trolleyPickedUp: false, trolleyReturned: false, trolleyDamaged: false, trolleyDamageReason: null, stopIds: [stopId], createdAt: nowIso(), startedAt: null, completedAt: null, notes: null });
  store.notifications.unshift({ id: newId('N'), title: 'New delivery run ready', body: `${runId} is ready for pickup at ${staff.hotel}.`, time: nowIso(), unread: true, link: `#/run/${runId}` });
  saveStore();
  return ok({ runId });
}

export async function demoScanAllOut(runId) {
  const store = getStore();
  const run = findRun(store, runId) || activeRunFor(store, myStaff(store)?.id) || store.runs.find((r) => r.staffId === myStaff(store)?.id);
  if (!run) return fail('No run available.');
  store.bags.filter((b) => b.runId === run.id && b.status === 'On trolley').forEach((b) => { b.status = 'Out for delivery'; });
  saveStore();
  return ok({ runId: run.id });
}

export async function demoSimulateVerified(stopId) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  const pilgrim = findPilgrim(store, stop.pilgrimIds[0]);
  return ok({ verified: true, pilgrim: clone(pilgrim) });
}

export async function demoSimulateNoAnswer(stopId) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  return recordAttempt(stopId, { reason: 'No answer', notes: 'Simulated via demo menu — no answer at the door.' });
}

export async function demoAutoSignDeliver(stopId) {
  const store = getStore();
  const stop = findStop(store, stopId);
  if (!stop) return fail('Stop not found.');
  const pilgrim = findPilgrim(store, stop.pilgrimIds[0]);
  for (const bag of bagsOfStop(store, stop)) bag.handoverScanned = true;
  saveStore();
  return deliver(stopId, {
    signatureDataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
    recipientType: 'pilgrim', recipientName: pilgrim?.name || 'Pilgrim',
  });
}

export async function demoDeliverWholeRun(runId) {
  const store = getStore();
  const run = findRun(store, runId);
  if (!run) return fail('Run not found.');
  if (run.status !== 'In Progress') { run.status = 'In Progress'; run.startedAt = run.startedAt || nowIso(); }
  run.trolleyPickedUp = true;
  for (const stop of stopsOf(store, run)) {
    if (stop.status === 'Delivered') continue;
    for (const bag of bagsOfStop(store, stop)) { bag.status = 'On trolley'; bag.handoverScanned = true; }
  }
  saveStore();
  for (const stop of stopsOf(store, run)) {
    if (stop.status === 'Delivered') continue;
    const pilgrim = findPilgrim(store, stop.pilgrimIds[0]);
    await deliver(stop.id, {
      signatureDataUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
      recipientType: 'pilgrim', recipientName: pilgrim?.name || 'Pilgrim',
    });
  }
  return ok({ runId });
}

export function demoForceNextFail() {
  const store = getStore();
  store.demoForceFail = true;
  saveStore();
}

export function demoReset() { resetStore(); }
