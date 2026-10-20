/**
 * Mock REST API for the System Admin console.
 * Every function is async, resolves after a realistic delay, and can be made
 * to reject via `?fail=1` in the URL or the one-shot demo "force fail" flag.
 * A real backend can replace this file without the UI code changing.
 */
import { getStore, saveStore, resetStore, setSession, getSession } from './store.js';
import { STAFF_ROLES, MODULES, PERMISSION_LEVELS, createSeed } from './seed.js';

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

function addAudit(store, { action, entity, entityId, before = null, after = null, result = 'Success' }) {
  const session = getSession();
  store.auditLog.unshift({
    id: newId('AUD'),
    time: nowIso(),
    userId: session ? session.id : 'SYSTEM',
    userName: session ? session.name : 'System',
    roleLabel: 'System Admin',
    action, entity, entityId, before, after,
    ip: '10.0.0.1', device: 'Chrome / Windows', result,
  });
}

/* ===================== AUTH ===================== */

/** @param {string} employeeId @param {string} pin */
export async function adminLogin(employeeId, pin) {
  const store = getStore();
  const admin = store.admins.find((a) => a.employeeId.toLowerCase() === String(employeeId).toLowerCase());
  if (!admin || admin.pin !== pin) {
    return fail('Invalid employee ID or PIN.');
  }
  return ok({ pendingAdminId: admin.id });
}

/** @param {string} pendingAdminId @param {string} code */
export async function verify2fa(pendingAdminId, code) {
  const store = getStore();
  const admin = store.admins.find((a) => a.id === pendingAdminId);
  if (!admin || admin.twoFACode !== code) {
    return fail('Incorrect verification code.');
  }
  const session = { id: admin.id, name: admin.name, employeeId: admin.employeeId };
  setSession(session);
  addAudit(store, { action: 'Login', entity: 'Session', entityId: admin.id });
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

/* ===================== DASHBOARD ===================== */

export async function dashboard() {
  const store = getStore();
  const activeByRole = {};
  for (const r of STAFF_ROLES) activeByRole[r.label] = store.users.filter((u) => u.roleId === r.id && u.status === 'Active').length;
  const usersOnline = store.users.filter((u) => u.activeSessions && u.activeSessions.length > 0).length;
  const disabledUsers = store.users.filter((u) => u.status === 'Disabled').length;
  const integrationsOk = [store.config.nusuk.lastTestOk, ...store.config.airlines.map((a) => a.lastTestOk)].filter((v) => v === true).length;
  const integrationsTotal = 1 + store.config.airlines.length;
  const openIssues = store.services.filter((s) => s.status !== 'Healthy').length + store.errors.filter((e) => e.status === 'Open').length;
  return ok({
    activeByRole,
    usersOnline,
    disabledUsers,
    integrationsOk,
    integrationsTotal,
    openIssues,
    lastBackup: store.lastBackup || new Date(Date.now() - 6 * 3600000).toISOString(),
    services: clone(store.services),
    recentAudit: clone(store.auditLog.slice(0, 6)),
  });
}

/* ===================== USERS ===================== */

function withComputedPermissions(store, user) {
  const base = clone(store.rolePermissions[user.roleId] || {});
  const overrides = store.permissionOverrides[user.id];
  if (overrides) {
    for (const mod of Object.keys(overrides)) {
      base[mod] = { ...base[mod], ...overrides[mod] };
    }
  }
  return { ...clone(user), permissions: base };
}

export async function getUsers(filters = {}) {
  const store = getStore();
  let list = store.users.map((u) => withComputedPermissions(store, u));
  if (filters.q) {
    const q = filters.q.toLowerCase();
    list = list.filter((u) => u.name.toLowerCase().includes(q) || u.employeeId.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }
  if (filters.role) list = list.filter((u) => u.roleId === filters.role);
  if (filters.status) list = list.filter((u) => u.status === filters.status);
  if (filters.location) list = list.filter((u) => u.scope === filters.location);
  return ok(list);
}

export async function getUser(id) {
  const store = getStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) return fail('User not found.');
  return ok(withComputedPermissions(store, user));
}

export async function createUser(payload) {
  const store = getStore();
  if (store.users.some((u) => u.employeeId.toLowerCase() === payload.employeeId.toLowerCase())) {
    return fail('Employee ID already exists.');
  }
  const user = {
    id: newId('U'),
    employeeId: payload.employeeId,
    name: payload.name,
    roleId: payload.roleId,
    roleLabel: STAFF_ROLES.find((r) => r.id === payload.roleId)?.label || payload.roleId,
    scope: payload.scope || null,
    phone: payload.phone,
    email: payload.email,
    status: 'Active',
    disabledReason: null,
    twoFA: false,
    lastLogin: null,
    pin: String(Math.floor(1000 + Math.random() * 9000)),
    activeSessions: [],
    createdAt: nowIso(),
  };
  store.users.unshift(user);
  if (payload.permissionOverrides) store.permissionOverrides[user.id] = payload.permissionOverrides;
  addAudit(store, { action: 'Create user', entity: 'User', entityId: user.employeeId, after: { status: 'Active', role: user.roleLabel } });
  saveStore();
  return ok(withComputedPermissions(store, user));
}

export async function updateUser(id, payload) {
  const store = getStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) return fail('User not found.');
  const before = { name: user.name, phone: user.phone, email: user.email, scope: user.scope, roleId: user.roleId };
  Object.assign(user, { name: payload.name, phone: payload.phone, email: payload.email, scope: payload.scope, roleId: payload.roleId });
  user.roleLabel = STAFF_ROLES.find((r) => r.id === user.roleId)?.label || user.roleId;
  if (payload.permissionOverrides) store.permissionOverrides[id] = payload.permissionOverrides;
  addAudit(store, { action: 'Edit user', entity: 'User', entityId: user.employeeId, before, after: { name: user.name, phone: user.phone, email: user.email, scope: user.scope, roleId: user.roleId } });
  saveStore();
  return ok(withComputedPermissions(store, user));
}

export async function disableUser(id, reason) {
  const store = getStore();
  const session = getSession();
  const user = store.users.find((u) => u.id === id);
  if (!user) return fail('User not found.');
  if (session && user.id === session.id) return fail("You can't disable your own account.");
  const before = { status: user.status };
  user.status = 'Disabled';
  user.disabledReason = reason;
  user.activeSessions = [];
  addAudit(store, { action: 'Disable user', entity: 'User', entityId: user.employeeId, before, after: { status: 'Disabled', reason } });
  saveStore();
  return ok(withComputedPermissions(store, user));
}

export async function enableUser(id) {
  const store = getStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) return fail('User not found.');
  const before = { status: user.status };
  user.status = 'Active';
  user.disabledReason = null;
  addAudit(store, { action: 'Edit user', entity: 'User', entityId: user.employeeId, before, after: { status: 'Active' } });
  saveStore();
  return ok(withComputedPermissions(store, user));
}

export async function revokeTokens(id) {
  const store = getStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) return fail('User not found.');
  user.activeSessions = [];
  addAudit(store, { action: 'Revoke access tokens', entity: 'User', entityId: user.employeeId });
  saveStore();
  return ok({ revoked: true });
}

export async function sendCredentials(id) {
  const store = getStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) return fail('User not found.');
  addAudit(store, { action: 'Send credentials', entity: 'User', entityId: user.employeeId });
  saveStore();
  const masked = `${user.phone.slice(0, 6)}•• ••• ${user.phone.slice(-3)}`;
  return ok({ sentTo: masked, pin: user.pin });
}

export async function getUserActivity(id, filters = {}) {
  const store = getStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) return fail('User not found.');
  let list = store.auditLog.filter((a) => a.entityId === user.employeeId || a.userId === user.id);
  if (filters.from) list = list.filter((a) => new Date(a.time) >= new Date(filters.from));
  if (filters.to) list = list.filter((a) => new Date(a.time) <= new Date(filters.to));
  return ok(clone(list));
}

/* ===================== ROLES & PERMISSIONS ===================== */

export async function getRoles() {
  const store = getStore();
  const counts = {};
  for (const r of STAFF_ROLES) counts[r.id] = store.users.filter((u) => u.roleId === r.id).length;
  return ok({ roles: clone(STAFF_ROLES), modules: MODULES, levels: PERMISSION_LEVELS, permissions: clone(store.rolePermissions), counts });
}

export async function updateRolePermissions(roleId, matrix) {
  const store = getStore();
  const before = clone(store.rolePermissions[roleId]);
  store.rolePermissions[roleId] = matrix;
  addAudit(store, { action: 'Update role permissions', entity: 'Role', entityId: roleId, before, after: matrix });
  saveStore();
  return ok({ roleId, matrix });
}

export async function resetRolePermissions(roleId) {
  const store = getStore();
  const seeded = createSeed().rolePermissions[roleId];
  store.rolePermissions[roleId] = seeded;
  saveStore();
  return ok({ roleId, matrix: clone(seeded) });
}

/* ===================== CONFIG ===================== */

const testedThisSession = new Set();

export async function getConfig() {
  const store = getStore();
  return ok(clone(store.config));
}

/** @param {'nusuk'|string} target - 'nusuk' or an airline code */
export async function testConnection(target, payload) {
  let success;
  if (target === 'nusuk') {
    success = !!(payload.clientSecret && payload.clientSecret.length > 6) && Math.random() > 0.15;
  } else {
    success = !!(payload.apiKey && payload.apiKey.length > 4) && Math.random() > 0.3;
  }
  const steps = [
    { label: 'Resolving host…', ok: true },
    { label: 'TLS handshake…', ok: true },
    { label: 'Auth…', ok: success, detail: success ? undefined : '401 Unauthorized — API key expired' },
  ];
  if (success) testedThisSession.add(target);
  return ok({ steps, ok: success });
}

export function wasTested(target) { return testedThisSession.has(target); }

export async function saveNusukConfig(payload) {
  const store = getStore();
  if (!wasTested('nusuk')) return fail('Test the connection before saving.');
  const before = clone(store.config.nusuk);
  store.config.nusuk = { ...store.config.nusuk, ...payload, lastTestOk: true, lastTestAt: nowIso() };
  addAudit(store, { action: 'Update config', entity: 'Config', entityId: 'Nusuk API', before, after: store.config.nusuk });
  saveStore();
  return ok(clone(store.config.nusuk));
}

export async function saveAirlineConfig(code, payload) {
  const store = getStore();
  if (!wasTested(code)) return fail('Test the connection before saving.');
  const airline = store.config.airlines.find((a) => a.code === code);
  if (!airline) return fail('Airline not found.');
  const before = clone(airline);
  Object.assign(airline, payload, { lastTestOk: true, lastTestAt: nowIso() });
  addAudit(store, { action: 'Update config', entity: 'Config', entityId: `Airline ${code}`, before, after: airline });
  saveStore();
  return ok(clone(airline));
}

export async function saveThresholds(payload) {
  const store = getStore();
  const before = clone(store.config.thresholds);
  for (const key of Object.keys(payload)) {
    store.config.thresholds[key].value = payload[key];
  }
  addAudit(store, { action: 'Update config', entity: 'Config', entityId: 'Thresholds', before, after: store.config.thresholds });
  saveStore();
  return ok(clone(store.config.thresholds));
}

export async function getAlertRules() {
  const store = getStore();
  return ok(clone(store.alertRules));
}

export async function saveAlertRule(rule) {
  const store = getStore();
  if (rule.id) {
    const existing = store.alertRules.find((r) => r.id === rule.id);
    Object.assign(existing, rule);
  } else {
    store.alertRules.push({ ...rule, id: newId('AR') });
  }
  addAudit(store, { action: 'Update config', entity: 'AlertRule', entityId: rule.id || 'new' });
  saveStore();
  return ok(clone(store.alertRules));
}

export async function deleteAlertRule(id) {
  const store = getStore();
  store.alertRules = store.alertRules.filter((r) => r.id !== id);
  addAudit(store, { action: 'Update config', entity: 'AlertRule', entityId: id, after: { deleted: true } });
  saveStore();
  return ok(clone(store.alertRules));
}

/* ===================== HEALTH / ERRORS ===================== */

export async function getHealth() {
  const store = getStore();
  return ok(clone(store.services));
}

export async function getErrors(filters = {}) {
  const store = getStore();
  let list = clone(store.errors);
  if (filters.service) list = list.filter((e) => e.service === filters.service);
  if (filters.severity) list = list.filter((e) => e.severity === filters.severity);
  if (filters.status) list = list.filter((e) => e.status === filters.status);
  return ok(list);
}

export async function getError(id) {
  const store = getStore();
  const err = store.errors.find((e) => e.id === id);
  if (!err) return fail('Error not found.');
  const related = store.auditLog.filter((a) => a.entity === 'ErrorLog' && a.entityId === id);
  return ok({ ...clone(err), related: clone(related) });
}

export async function setRootCause(id, { category, note }) {
  const store = getStore();
  const err = store.errors.find((e) => e.id === id);
  if (!err) return fail('Error not found.');
  err.rootCause = { category, note, at: nowIso() };
  addAudit(store, { action: 'Root cause recorded', entity: 'ErrorLog', entityId: id, after: err.rootCause });
  saveStore();
  return ok(clone(err));
}

export async function applyFix(id, { action }) {
  const store = getStore();
  const err = store.errors.find((e) => e.id === id);
  if (!err) return fail('Error not found.');
  err.status = 'Resolved';
  const svc = store.services.find((s) => s.name === err.service);
  if (svc) { svc.status = 'Healthy'; svc.latencyMs = 60; }
  addAudit(store, { action: 'Apply fix', entity: 'ErrorLog', entityId: id, after: { action, status: 'Resolved' } });
  saveStore();
  return ok({ error: clone(err), service: svc ? clone(svc) : null });
}

export async function escalateVendor(id, { vendor, priority, description }) {
  const store = getStore();
  const err = store.errors.find((e) => e.id === id);
  if (!err) return fail('Error not found.');
  const ticketNo = `VT-${Math.floor(10000 + Math.random() * 89999)}`;
  err.status = 'Escalated';
  err.vendorTicket = ticketNo;
  store.vendorTickets.push({ id: ticketNo, errorId: id, vendor, priority, description, openedAt: nowIso() });
  addAudit(store, { action: 'Escalate error', entity: 'ErrorLog', entityId: id, after: { ticketNo, vendor, priority } });
  saveStore();
  return ok({ ticketNo });
}

export async function getIncidentHistory() {
  const store = getStore();
  return ok(clone(store.errors.filter((e) => e.status === 'Resolved' || e.status === 'Escalated')));
}

/* ===================== AUDIT ===================== */

export async function searchAudit(filters = {}) {
  const store = getStore();
  let list = clone(store.auditLog);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    list = list.filter((a) => a.userName.toLowerCase().includes(q) || a.entityId.toLowerCase().includes(q) || a.action.toLowerCase().includes(q));
  }
  if (filters.role) list = list.filter((a) => a.roleLabel === filters.role);
  if (filters.action) list = list.filter((a) => a.action === filters.action);
  if (filters.entity) list = list.filter((a) => a.entity === filters.entity);
  if (filters.from) list = list.filter((a) => new Date(a.time) >= new Date(filters.from));
  if (filters.to) list = list.filter((a) => new Date(a.time) <= new Date(filters.to));
  return ok(list);
}

/* ===================== REPORTS ===================== */

export async function generateReport(type, range) {
  const store = getStore();
  const from = range?.from ? new Date(range.from) : new Date(0);
  const to = range?.to ? new Date(range.to) : new Date();
  let rows = [];
  let chart = null;
  switch (type) {
    case 'User activity':
      rows = store.auditLog.filter((a) => new Date(a.time) >= from && new Date(a.time) <= to)
        .map((a) => ({ time: a.time, user: a.userName, action: a.action, result: a.result }));
      break;
    case 'Login / failed login':
      rows = store.auditLog.filter((a) => a.action === 'Login' && new Date(a.time) >= from && new Date(a.time) <= to)
        .map((a) => ({ time: a.time, user: a.userName, result: a.result, ip: a.ip }));
      chart = { labels: ['Success', 'Failure'], data: [rows.filter((r) => r.result === 'Success').length, rows.filter((r) => r.result === 'Failure').length] };
      break;
    case 'Integration uptime':
      rows = store.services.map((s) => ({ service: s.name, uptime: s.uptime, status: s.status }));
      chart = { labels: rows.map((r) => r.service), data: rows.map((r) => r.uptime) };
      break;
    case 'Error summary':
      rows = store.errors.filter((e) => new Date(e.time) >= from && new Date(e.time) <= to)
        .map((e) => ({ time: e.time, service: e.service, severity: e.severity, code: e.code, status: e.status }));
      chart = { labels: ['Low', 'Medium', 'High', 'Critical'], data: ['Low', 'Medium', 'High', 'Critical'].map((s) => rows.filter((r) => r.severity === s).length) };
      break;
    case 'Config change history':
      rows = store.auditLog.filter((a) => a.action === 'Update config' && new Date(a.time) >= from && new Date(a.time) <= to)
        .map((a) => ({ time: a.time, user: a.userName, entityId: a.entityId }));
      break;
    case 'Data volume by entity':
      rows = [
        { entity: 'Pilgrims', count: 1240 }, { entity: 'Bags', count: 2460 }, { entity: 'ScanEvents', count: 18650 },
        { entity: 'Exceptions', count: 86 }, { entity: 'Trips', count: 310 }, { entity: 'Manifests', count: 58 },
        { entity: 'Receipts', count: 1180 }, { entity: 'Users', count: store.users.length }, { entity: 'AuditLog', count: store.auditLog.length },
      ];
      chart = { labels: rows.map((r) => r.entity), data: rows.map((r) => r.count) };
      break;
    default:
      rows = [];
  }
  const report = { id: newId('RPT'), type, range, rows, chart, generatedAt: nowIso() };
  store.reportsHistory.unshift({ id: report.id, type, range, generatedAt: report.generatedAt, rowCount: rows.length });
  saveStore();
  return ok(report);
}

/* ===================== EXPORT ===================== */

export async function generateExport(payload) {
  const store = getStore();
  const exp = {
    id: newId('EXP'),
    entities: payload.entities,
    range: payload.range,
    format: payload.format,
    maskPii: payload.maskPii,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
    sizeKb: Math.floor(40 + Math.random() * 900),
  };
  store.exportsList.unshift(exp);
  addAudit(store, { action: 'Export data', entity: 'Export', entityId: exp.id, after: { entities: payload.entities, format: payload.format } });
  saveStore();
  return ok(exp);
}

export async function getExports() {
  const store = getStore();
  return ok(clone(store.exportsList));
}

/* ===================== MASTER DATA ===================== */

const MD_KEYS = { centres: 'centres', warehouses: 'warehouses', airports: 'airports', hotels: 'hotels', vehicles: 'vehicles', flights: 'flights' };

export async function getMasterData(type) {
  const store = getStore();
  if (!MD_KEYS[type]) return fail('Unknown master data type.');
  return ok(clone(store.masterData[type]));
}

export async function createMasterData(type, payload) {
  const store = getStore();
  const list = store.masterData[MD_KEYS[type]];
  if (list.some((r) => r.code.toLowerCase() === payload.code.toLowerCase())) return fail('Code already exists.');
  const record = { id: newId('MD'), active: true, ...payload };
  list.push(record);
  addAudit(store, { action: 'Update master data', entity: 'MasterData', entityId: record.code, after: record });
  saveStore();
  return ok(clone(record));
}

export async function updateMasterData(type, id, payload) {
  const store = getStore();
  const list = store.masterData[MD_KEYS[type]];
  const record = list.find((r) => r.id === id);
  if (!record) return fail('Record not found.');
  const before = clone(record);
  Object.assign(record, payload);
  addAudit(store, { action: 'Update master data', entity: 'MasterData', entityId: record.code, before, after: record });
  saveStore();
  return ok(clone(record));
}

export async function deactivateMasterData(type, id) {
  const store = getStore();
  const list = store.masterData[MD_KEYS[type]];
  const record = list.find((r) => r.id === id);
  if (!record) return fail('Record not found.');
  record.active = false;
  addAudit(store, { action: 'Update master data', entity: 'MasterData', entityId: record.code, after: { active: false } });
  saveStore();
  return ok(clone(record));
}

/* ===================== HANDOVER ===================== */

export async function getHandoverSummary() {
  const store = getStore();
  const today = new Date().toDateString();
  return ok({
    openIncidents: store.errors.filter((e) => e.status === 'Open' || e.status === 'Escalated').length,
    vendorTickets: store.vendorTickets.length,
    configChangesToday: store.auditLog.filter((a) => a.action === 'Update config' && new Date(a.time).toDateString() === today).length,
    disabledAccounts: store.users.filter((u) => u.status === 'Disabled').length,
    notes: clone(store.handoverNotes),
  });
}

export async function submitHandover(notes) {
  const store = getStore();
  const entry = { id: newId('HO'), notes, submittedAt: nowIso(), by: getSession()?.name || 'System' };
  store.handoverNotes.unshift(entry);
  addAudit(store, { action: 'Admin handover', entity: 'Handover', entityId: entry.id });
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

export async function demoDegradeService() {
  const store = getStore();
  const svc = store.services.find((s) => s.status === 'Healthy') || store.services[0];
  svc.status = 'Degraded';
  svc.latencyMs = 450;
  saveStore();
  return ok(clone(svc));
}

export async function demoGenerateErrorBurst() {
  const store = getStore();
  const svc = store.services[Math.floor(Math.random() * store.services.length)];
  for (let i = 0; i < 4; i++) {
    store.errors.unshift({
      id: newId('ERR'), time: nowIso(), service: svc.name, severity: 'High', code: 'BURST',
      message: `Burst error ${i + 1} on ${svc.name}`, count: 1, status: 'Open',
      stack: 'simulated burst error', payload: '{}', rootCause: null, vendorTicket: null,
    });
  }
  saveStore();
  return ok({ added: 4 });
}

export async function demoExpireNusukKey() {
  const store = getStore();
  store.config.nusuk.lastTestOk = false;
  store.config.nusuk.lastTestAt = nowIso();
  store.notifications.unshift({ id: newId('N'), title: 'Nusuk key expired', body: 'The Nusuk API key has expired.', time: nowIso(), unread: true, link: '#/config' });
  saveStore();
  return ok({ expired: true });
}

export function demoForceNextFail() {
  const store = getStore();
  store.demoForceFail = true;
  saveStore();
}

export function demoReset() {
  resetStore();
  testedThisSession.clear();
}
