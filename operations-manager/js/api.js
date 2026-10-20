/**
 * Mock REST API for the Operations Manager console.
 * Every function is async, resolves after a realistic delay, and can be made
 * to reject via `?fail=1` in the URL or the one-shot demo "force fail" flag.
 * A real backend can replace this file without the UI code changing.
 */
import { getStore, saveStore, resetStore, setSession, getSession, getDirection, setDirection } from './store.js';
import {
  DEPARTURE_STAGES, ARRIVAL_STAGES, EXCEPTION_TYPES, suggestTeam,
} from './seed.js';

const GLOBAL_FAIL = new URLSearchParams(location.search).get('fail') === '1';

/** @returns {number} ms */
function randomDelay() { return 300 + Math.random() * 400; }

/** @template T @param {T} value @returns {Promise<T>} */
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

/** @param {string} message */
function fail(message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new ApiError(message)), randomDelay());
  });
}

export class ApiError extends Error {}

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function nowIso() { return new Date().toISOString(); }

function newId(prefix) { return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`; }

function stagesFor(direction) { return direction === 'departure' ? DEPARTURE_STAGES : ARRIVAL_STAGES; }

/* ===================== AUTH ===================== */

/** @param {string} employeeId @param {string} pin */
export async function login(employeeId, pin) {
  const store = getStore();
  const staff = store.staff;
  if (staff.employeeId.toLowerCase() !== String(employeeId).toLowerCase() || staff.pin !== pin) {
    return fail('Invalid employee ID or PIN.');
  }
  const session = { id: staff.id, name: staff.name, employeeId: staff.employeeId, role: staff.role };
  setSession(session);
  saveStore();
  return ok(session);
}

export async function getMe() {
  const session = getSession();
  if (!session) return fail('Not authenticated.');
  return ok(clone(session));
}

export function logout() {
  setSession(null);
}

/* ===================== DIRECTION ===================== */

export async function getDirectionPref() {
  return ok(getDirection());
}

/** @param {'departure'|'arrival'} direction */
export async function setDirectionPref(direction) {
  setDirection(direction);
  return ok(direction);
}

/* ===================== DASHBOARD ===================== */

function flightRisk(flight) {
  if (flight.closed) return 'Completed';
  if (flight.direction === 'departure') {
    const minsToCutoff = (new Date(flight.cutoffAt) - Date.now()) / 60000;
    if (minsToCutoff < 0) return 'Delayed';
    if (minsToCutoff < 120) return 'At risk';
    return 'On time';
  }
  const pctDelivered = flight.stageCounts.delivered / flight.totalBags;
  if (pctDelivered < 0.5 && (Date.now() - new Date(flight.landedAt)) / 3600000 > 4) return 'At risk';
  return 'On time';
}

/** @param {'departure'|'arrival'} direction */
export async function getDashboard(direction) {
  const store = getStore();
  const flights = store.flights.filter((f) => f.direction === direction);
  const bags = store.bags.filter((b) => b.direction === direction);
  const exceptions = store.exceptions;
  const openExceptions = exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status));
  const bySeverity = { Low: 0, Medium: 0, High: 0, Critical: 0 };
  for (const e of openExceptions) bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;

  const stages = stagesFor(direction);
  const bagsByStage = stages.map((stage) => ({
    stage,
    count: bags.filter((b) => b.currentStage === stage).length,
  }));

  const trucksInTransit = store.trips.length;
  const flightsAtRisk = flights.filter((f) => flightRisk(f) === 'At risk' || flightRisk(f) === 'Delayed').length;
  const avgHandlingMin = Math.round(store.history.reduce((s, h) => s + h.avgHandlingMin, 0) / store.history.length);
  const onTimePct = Number((store.history[store.history.length - 1]?.onTimePct || 95).toFixed(1));

  return ok({
    direction,
    bagsInSystem: bags.filter((b) => b.currentStage !== stages[stages.length - 1]).length,
    onTimePct,
    openExceptionsBySeverity: bySeverity,
    openExceptionsTotal: openExceptions.length,
    trucksInTransit,
    flightsAtRisk,
    avgHandlingMin,
    bagsByStage,
    flights: flights.map((f) => ({ ...clone(f), risk: flightRisk(f) })),
    activity: clone(store.activity.slice(0, 12)),
    lastUpdated: nowIso(),
  });
}

/* ===================== BAGS ===================== */

/** @param {{q?:string, preset?:'stuck'|'exception-open'|'damaged'}} filters */
export async function searchBags(filters = {}) {
  const store = getStore();
  let list = store.bags;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    list = list.filter((b) => [b.tagNumber, b.airlineTagNumber, b.pilgrimName, b.passport, b.nusukId, b.flightCode]
      .some((v) => String(v).toLowerCase().includes(q)));
  }
  if (filters.preset === 'stuck') list = list.filter((b) => b.stuckHours > 2);
  if (filters.preset === 'exception-open') {
    const openBagIds = new Set(store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status) && e.bagId).map((e) => e.bagId));
    list = list.filter((b) => openBagIds.has(b.id));
  }
  if (filters.preset === 'damaged') {
    const damagedBagIds = new Set(store.exceptions.filter((e) => e.type === 'Damaged Bag' && e.bagId).map((e) => e.bagId));
    list = list.filter((b) => damagedBagIds.has(b.id));
  }
  return ok(clone(list.slice(0, 200)));
}

export async function getBag(id) {
  const store = getStore();
  const bag = store.bags.find((b) => b.id === id);
  if (!bag) return fail('Bag not found.');
  const exceptions = store.exceptions.filter((e) => e.bagId === id);
  const stages = stagesFor(bag.direction);
  return ok({ ...clone(bag), stages, exceptions: clone(exceptions) });
}

/* ===================== EXCEPTIONS ===================== */

/** @param {{q?:string, type?:string, severity?:string, status?:string, team?:string, tab?:string}} filters */
export async function getExceptions(filters = {}) {
  const store = getStore();
  let list = store.exceptions;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    list = list.filter((e) => [e.type, e.flightCode, e.bagTag, e.description].some((v) => String(v || '').toLowerCase().includes(q)));
  }
  if (filters.type) list = list.filter((e) => e.type === filters.type);
  if (filters.severity) list = list.filter((e) => e.severity === filters.severity);
  if (filters.status) list = list.filter((e) => e.status === filters.status);
  if (filters.team) list = list.filter((e) => e.team === filters.team);
  if (filters.tab === 'open') list = list.filter((e) => e.status === 'Open');
  if (filters.tab === 'assigned') list = list.filter((e) => ['Assigned', 'In Progress'].includes(e.status));
  if (filters.tab === 'escalated') list = list.filter((e) => e.status === 'Escalated');
  if (filters.tab === 'resolved-today') {
    const today = new Date().toDateString();
    list = list.filter((e) => e.status === 'Resolved' && new Date(e.time).toDateString() === today);
  }
  return ok(clone(list));
}

export async function getException(id) {
  const store = getStore();
  const e = store.exceptions.find((x) => x.id === id);
  if (!e) return fail('Exception not found.');
  return ok(clone(e));
}

export async function assignException(id, { team, assignee, dueAt }) {
  const store = getStore();
  const e = store.exceptions.find((x) => x.id === id);
  if (!e) return fail('Exception not found.');
  e.team = team;
  e.assignee = assignee || null;
  e.dueAt = dueAt;
  if (e.status === 'Open') e.status = 'Assigned';
  saveStore();
  return ok(clone(e));
}

export async function bulkAssign(ids, { team, assignee, dueAt }) {
  const store = getStore();
  let count = 0;
  for (const id of ids) {
    const e = store.exceptions.find((x) => x.id === id);
    if (!e) continue;
    e.team = team;
    e.assignee = assignee || null;
    e.dueAt = dueAt;
    if (e.status === 'Open') e.status = 'Assigned';
    count++;
  }
  saveStore();
  return ok({ updated: count });
}

export async function addUpdate(id, text) {
  const store = getStore();
  const e = store.exceptions.find((x) => x.id === id);
  if (!e) return fail('Exception not found.');
  if (e.status === 'Assigned') e.status = 'In Progress';
  e.notes.unshift({ time: nowIso(), author: getSession()?.name || 'Operations Manager', text });
  saveStore();
  return ok(clone(e));
}

export async function escalate(id, reason) {
  const store = getStore();
  const e = store.exceptions.find((x) => x.id === id);
  if (!e) return fail('Exception not found.');
  e.status = 'Escalated';
  e.severity = 'Critical';
  e.escalated = true;
  e.escalationReason = reason;
  e.notes.unshift({ time: nowIso(), author: getSession()?.name || 'Operations Manager', text: `Escalated: ${reason}` });
  saveStore();
  return ok(clone(e));
}

export async function resolve(id, resolutionNotes) {
  const store = getStore();
  const e = store.exceptions.find((x) => x.id === id);
  if (!e) return fail('Exception not found.');
  if (['Resolved', 'Closed'].includes(e.status)) return fail('This exception is already resolved.');
  e.status = 'Resolved';
  e.resolutionNotes = resolutionNotes;
  e.notes.unshift({ time: nowIso(), author: getSession()?.name || 'Operations Manager', text: `Resolved: ${resolutionNotes}` });
  saveStore();
  return ok(clone(e));
}

export async function close(id) {
  const store = getStore();
  const e = store.exceptions.find((x) => x.id === id);
  if (!e) return fail('Exception not found.');
  if (e.status !== 'Resolved') return fail('Only resolved exceptions can be closed.');
  e.status = 'Closed';
  saveStore();
  return ok(clone(e));
}

/* ===================== TRUCKS ===================== */

export async function getTrucks() {
  const store = getStore();
  for (const t of store.trips) {
    if (!t.delayed && t.progress < 0.97) {
      t.progress = Math.min(0.97, t.progress + 0.01 + Math.random() * 0.02);
      t.position = [t.from[0] + (t.to[0] - t.from[0]) * t.progress, t.from[1] + (t.to[1] - t.from[1]) * t.progress];
    }
  }
  saveStore();
  return ok(clone(store.trips));
}

export async function getTruck(id) {
  const store = getStore();
  const t = store.trips.find((x) => x.id === id);
  if (!t) return fail('Trip not found.');
  return ok(clone(t));
}

export async function contactDriver(id, { type, message }) {
  const store = getStore();
  const t = store.trips.find((x) => x.id === id);
  if (!t) return fail('Trip not found.');
  t.contactLog.unshift({ time: nowIso(), type, message: message || null });
  saveStore();
  return ok(clone(t));
}

export async function updateEta(id, { etaAt, reason }) {
  const store = getStore();
  const t = store.trips.find((x) => x.id === id);
  if (!t) return fail('Trip not found.');
  t.etaAt = etaAt;
  t.contactLog.unshift({ time: nowIso(), type: 'eta-update', message: `New ETA ${new Date(etaAt).toLocaleTimeString()} — ${reason}` });
  saveStore();
  return ok(clone(t));
}

const REROUTE_DESTINATIONS = ['Bay 1', 'Bay 2', 'Gate G1', 'Gate G2', 'Offload Bay OB1', 'Offload Bay OB2'];
export { REROUTE_DESTINATIONS };

export async function reroute(id, { destination, reason }) {
  const store = getStore();
  const t = store.trips.find((x) => x.id === id);
  if (!t) return fail('Trip not found.');
  t.toName = destination;
  t.contactLog.unshift({ time: nowIso(), type: 'reroute', message: `Rerouted to ${destination} — ${reason}` });
  saveStore();
  return ok(clone(t));
}

/* ===================== CUT-OFFS (departure) ===================== */

export async function getCutoffs() {
  const store = getStore();
  const flights = store.flights.filter((f) => f.direction === 'departure' && !f.closed);
  return ok(flights.map((f) => {
    const minsToCutoff = Math.round((new Date(f.cutoffAt) - Date.now()) / 60000);
    const notAtAirport = Math.max(0, f.totalBags - f.stageCounts.atAirport);
    return {
      ...clone(f),
      minsToCutoff,
      atRisk: minsToCutoff < 120,
      notAtAirport,
      breakdown: {
        'Checked-in only': Math.max(0, f.stageCounts.checkedIn - f.stageCounts.atWarehouse),
        'At warehouse': Math.max(0, f.stageCounts.atWarehouse - f.stageCounts.atAirport),
        'At airport, not loaded': Math.max(0, f.stageCounts.atAirport - f.stageCounts.loaded),
      },
    };
  }));
}

export async function prioritise(flightId) {
  const store = getStore();
  const f = store.flights.find((x) => x.id === flightId);
  if (!f) return fail('Flight not found.');
  f.priority = true;
  saveStore();
  return ok(clone(f));
}

export async function notifyWarehouse(flightId, message) {
  const store = getStore();
  const f = store.flights.find((x) => x.id === flightId);
  if (!f) return fail('Flight not found.');
  f.warehouseNotifications = f.warehouseNotifications || [];
  f.warehouseNotifications.unshift({ time: nowIso(), message });
  saveStore();
  return ok(clone(f));
}

/* ===================== RECONCILIATION ===================== */

function unaccountedBags(store, flight) {
  const stages = stagesFor(flight.direction);
  const finalStage = stages[stages.length - 1];
  return store.bags.filter((b) => b.flightId === flight.id && b.currentStage !== finalStage);
}

export async function getReconciliation(flightId) {
  const store = getStore();
  const f = store.flights.find((x) => x.id === flightId);
  if (!f) return fail('Flight not found.');
  const unaccounted = unaccountedBags(store, f);
  const undocumented = unaccounted.filter((b) => !b.discrepancy || !b.discrepancy.documented);
  return ok({
    flight: clone(f),
    unaccounted: clone(unaccounted),
    undocumentedCount: undocumented.length,
    canApprove: unaccounted.length === 0 || undocumented.length === 0,
  });
}

export async function discrepancyReport(flightId) {
  const store = getStore();
  const f = store.flights.find((x) => x.id === flightId);
  if (!f) return fail('Flight not found.');
  const unaccounted = unaccountedBags(store, f);
  const rows = unaccounted.map((b) => ({
    tagNumber: b.tagNumber, pilgrimName: b.pilgrimName, currentStage: b.currentStage,
    stuckHours: b.stuckHours, outcome: b.discrepancy?.outcome || '', documented: !!b.discrepancy?.documented,
  }));
  return ok({ flightCode: f.code, generatedAt: nowIso(), rows });
}

export async function resolveDiscrepancy(flightId, bagId, { outcome, notes }) {
  const store = getStore();
  const bag = store.bags.find((b) => b.id === bagId && b.flightId === flightId);
  if (!bag) return fail('Bag not found for this flight.');
  bag.discrepancy = { outcome, notes, resolvedAt: nowIso(), documented: false };
  saveStore();
  return ok(clone(bag));
}

export async function documentResolution(flightId, bagId) {
  const store = getStore();
  const bag = store.bags.find((b) => b.id === bagId && b.flightId === flightId);
  if (!bag) return fail('Bag not found for this flight.');
  if (!bag.discrepancy) return fail('Resolve the discrepancy before documenting it.');
  bag.discrepancy.documented = true;
  bag.discrepancy.documentedAt = nowIso();
  saveStore();
  return ok(clone(bag));
}

export async function approveClosure(flightId) {
  const store = getStore();
  const f = store.flights.find((x) => x.id === flightId);
  if (!f) return fail('Flight not found.');
  const unaccounted = unaccountedBags(store, f);
  const undocumented = unaccounted.filter((b) => !b.discrepancy || !b.discrepancy.documented);
  if (undocumented.length > 0) {
    return fail(`${undocumented.length} bag${undocumented.length === 1 ? '' : 's'} unaccounted — document them first.`);
  }
  f.status = 'Completed';
  saveStore();
  return ok(clone(f));
}

/* ===================== CLOSURE ===================== */

export async function closureChecklist(flightId) {
  const store = getStore();
  const f = store.flights.find((x) => x.id === flightId);
  if (!f) return fail('Flight not found.');
  const unaccounted = unaccountedBags(store, f);
  const undocumented = unaccounted.filter((b) => !b.discrepancy || !b.discrepancy.documented);
  return ok({
    flight: clone(f),
    allBagsAccounted: undocumented.length === 0,
    investigateList: clone(undocumented),
    finalReportGenerated: !!f.finalReportGeneratedAt,
    kpisUpdated: !!f.closed,
    auditLogEntry: !!f.closed,
    archivedForArrival: f.direction === 'arrival' ? !!f.closed : null,
  });
}

export async function closeFlight(flightId) {
  const store = getStore();
  const f = store.flights.find((x) => x.id === flightId);
  if (!f) return fail('Flight not found.');
  if (f.status !== 'Completed') return fail('Approve flight closure in Reconciliation before closing.');
  f.closed = true;
  f.closedAt = nowIso();
  f.finalReportGeneratedAt = nowIso();
  f.status = 'Closed';
  saveStore();
  return ok(clone(f));
}

export async function getClosedFlights() {
  const store = getStore();
  return ok(clone(store.flights.filter((f) => f.closed)));
}

/* ===================== REPORTS ===================== */

export async function shiftReport() {
  const store = getStore();
  const sinceMs = Date.now() - 8 * 3600000;
  const recentExceptions = store.exceptions.filter((e) => new Date(e.time).getTime() >= sinceMs);
  const stages = [...DEPARTURE_STAGES, ...ARRIVAL_STAGES];
  const volumesPerStage = stages.map((stage) => ({ stage, count: store.bags.filter((b) => b.currentStage === stage).length })).filter((r) => r.count > 0);
  const report = {
    generatedAt: nowIso(),
    windowHours: 8,
    volumesPerStage,
    exceptionsOpened: recentExceptions.length,
    exceptionsClosed: recentExceptions.filter((e) => e.status === 'Closed').length,
    delays: store.trips.filter((t) => t.delayed).length,
    cutoffMisses: store.flights.filter((f) => f.direction === 'departure' && !f.closed && (new Date(f.cutoffAt) - Date.now()) < 0).length,
  };
  store.reportsHistory.unshift({ id: newId('RPT'), type: 'Shift report', generatedAt: report.generatedAt });
  saveStore();
  return ok(report);
}

export async function kpis(range = {}) {
  const store = getStore();
  let rows = store.history;
  if (range.from) rows = rows.filter((r) => r.date >= range.from);
  if (range.to) rows = rows.filter((r) => r.date <= range.to);
  const exceptionsByType = {};
  for (const e of store.exceptions) exceptionsByType[e.type] = (exceptionsByType[e.type] || 0) + 1;
  return ok({ history: clone(rows), exceptionsByType });
}

export async function postSeason() {
  const store = getStore();
  const byFlight = store.flights.map((f) => ({
    flight: f.code, direction: f.direction, totalBags: f.totalBags,
    delivered: f.direction === 'departure' ? f.stageCounts.loaded : f.stageCounts.delivered,
    status: f.closed ? 'Closed' : f.status,
  }));
  const report = {
    generatedAt: nowIso(),
    totalFlights: store.flights.length,
    totalBags: store.bags.length,
    totalExceptions: store.exceptions.length,
    byFlight,
  };
  store.reportsHistory.unshift({ id: newId('RPT'), type: 'Post-season report', generatedAt: report.generatedAt });
  saveStore();
  return ok(report);
}

/* ===================== STAKEHOLDERS ===================== */

export async function notifyStakeholders({ audiences, subject, message, reportLink }) {
  const store = getStore();
  const entry = { id: newId('MSG'), audiences, subject, message, reportLink: reportLink || null, sentAt: nowIso() };
  store.stakeholderLog.unshift(entry);
  saveStore();
  return ok(entry);
}

export async function getStakeholderLog() {
  const store = getStore();
  return ok(clone(store.stakeholderLog));
}

/* ===================== HANDOVER ===================== */

export async function getHandoverSummary() {
  const store = getStore();
  return ok({
    openCriticalHigh: store.exceptions.filter((e) => !['Resolved', 'Closed'].includes(e.status) && ['High', 'Critical'].includes(e.severity)).length,
    flightsPendingClosure: store.flights.filter((f) => !f.closed).length,
    trucksDelayed: store.trips.filter((t) => t.delayed).length,
    notes: clone(store.handoverNotes),
  });
}

export async function submitHandover({ notes, handoverTo }) {
  const store = getStore();
  const entry = { id: newId('HO'), notes, handoverTo: handoverTo || null, submittedAt: nowIso(), by: getSession()?.name || 'Operations Manager' };
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
  else {
    const n = store.notifications.find((x) => x.id === id);
    if (n) n.unread = false;
  }
  saveStore();
  return ok(clone(store.notifications));
}

/* ===================== DEMO MENU ===================== */

export async function demoInjectException() {
  const store = getStore();
  const type = EXCEPTION_TYPES[Math.floor(Math.random() * EXCEPTION_TYPES.length)];
  const flight = store.flights[Math.floor(Math.random() * store.flights.length)];
  const severity = ['Medium', 'High', 'Critical'][Math.floor(Math.random() * 3)];
  const e = {
    id: newId('EXC'), time: nowIso(), type, severity, flightId: flight.id, flightCode: flight.code,
    bagId: null, bagTag: null, raisedByRole: 'Airport Coordinator', status: 'Open', team: null,
    suggestedTeam: suggestTeam(type), assignee: null, dueAt: null,
    description: `${type} reported for flight ${flight.code}.`, notes: [], escalated: false,
    escalationReason: null, resolutionNotes: null,
  };
  store.exceptions.unshift(e);
  store.notifications.unshift({ id: newId('N'), title: `${severity} exception raised`, body: `${type} on ${flight.code}.`, time: nowIso(), unread: true, link: '#/exceptions', critical: severity === 'Critical' });
  saveStore();
  return ok(e);
}

export async function demoDelayTruck() {
  const store = getStore();
  const candidate = store.trips.find((t) => !t.delayed) || store.trips[0];
  candidate.delayed = true;
  candidate.delayReason = 'Unexpected checkpoint delay (demo).';
  candidate.etaAt = nowIso();
  saveStore();
  return ok(clone(candidate));
}

export async function demoPushCutoffRisk() {
  const store = getStore();
  const candidate = store.flights.find((f) => f.direction === 'departure' && !f.closed);
  if (candidate) {
    candidate.cutoffAt = new Date(Date.now() + 45 * 60000).toISOString();
    saveStore();
  }
  return ok(candidate ? clone(candidate) : null);
}

export function demoForceNextFail() {
  const store = getStore();
  store.demoForceFail = true;
  saveStore();
}

export function demoReset() {
  resetStore();
}
