/**
 * Mock data for the System Admin console.
 * Deterministic pseudo-random generation so the demo looks the same on every fresh seed.
 */

/** Tiny deterministic PRNG (mulberry32). @param {number} seed */
function makeRng(seed) {
  let a = seed;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(42);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const int = (min, max) => Math.floor(rng() * (max - min + 1)) + min;

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);
const daysAgo = (d) => hoursAgo(d * 24);
const daysFromNow = (d) => new Date(NOW + d * 86400000).toISOString();

export const STAFF_ROLES = [
  { id: 'checkin', label: 'Check-in Staff', prefix: 'CHK', scopeType: 'centre', scopeLabel: 'Check-in centre' },
  { id: 'warehouse', label: 'Warehouse Staff', prefix: 'WH', scopeType: 'warehouse', scopeLabel: 'Warehouse' },
  { id: 'driver', label: 'Driver', prefix: 'DRV', scopeType: 'none', scopeLabel: '—' },
  { id: 'airport', label: 'Airport Coordinator', prefix: 'APC', scopeType: 'airport', scopeLabel: 'Airport' },
  { id: 'airline', label: 'Airline', prefix: 'AL', scopeType: 'airlineCode', scopeLabel: 'Airline code' },
  { id: 'groundhandler', label: 'Ground Handler', prefix: 'GH', scopeType: 'airport', scopeLabel: 'Airport' },
  { id: 'accommodation', label: 'Accommodation Receiving Staff', prefix: 'ACC', scopeType: 'hotel', scopeLabel: 'Hotel' },
  { id: 'delivery', label: 'Delivery Staff', prefix: 'DLV', scopeType: 'hotel', scopeLabel: 'Hotel' },
  { id: 'opsmanager', label: 'Operations Manager', prefix: 'OPS', scopeType: 'none', scopeLabel: '—' },
  { id: 'sysadmin', label: 'System Admin', prefix: 'ADM', scopeType: 'none', scopeLabel: '—' },
];

export const MODULES = ['Bookings', 'Scans', 'Bags', 'Exceptions', 'Trucks', 'Manifests', 'Users', 'Config', 'Reports'];
export const PERMISSION_LEVELS = ['view', 'create', 'edit', 'approve', 'export'];

const FIRST_NAMES = ['Omar', 'Yusuf', 'Bilal', 'Khalid', 'Faisal', 'Imran', 'Tariq', 'Naveed', 'Salman', 'Yasir',
  'Abdullah', 'Mariam', 'Dewi', 'Usman', 'Fahad', 'Hafsa', 'Rashid', 'Sameer', 'Abdul Rahman', 'Idris', 'Layla',
  'Zainab', 'Hamza', 'Noor', 'Aisha', 'Junaid', 'Siraj', 'Huda', 'Amina', 'Waleed'];
const LAST_NAMES = ['Al-Harbi', 'Rahman', 'Siddiqui', 'Khan', 'Al-Otaibi', 'Hussain', 'Malik', 'Farooq', 'Al-Shammari',
  'Qureshi', 'Chaudhry', 'Al-Zahrani', 'Baig', 'Niazi', 'Al-Ghamdi', 'Shah'];

function fullName() { return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`; }

function buildMasterData() {
  const centres = [
    { id: 'C1', code: 'AZ-01', name: 'Aziziyah Check-in Centre', city: 'Makkah', active: true },
    { id: 'C2', code: 'AW-01', name: 'Al-Awali Check-in Centre', city: 'Makkah', active: true },
    { id: 'C3', code: 'MD-01', name: 'Madinah Central Check-in Centre', city: 'Madinah', active: true },
  ];
  const warehouses = [
    { id: 'WH1', code: 'WH-MK-01', name: 'Makkah Warehouse 1', city: 'Makkah', bays: 12, zones: ['Screening', 'Storage A', 'Storage B'], active: true },
    { id: 'WH2', code: 'WH-MD-01', name: 'Madinah Warehouse 1', city: 'Madinah', bays: 8, zones: ['Screening', 'Storage A'], active: true },
  ];
  const airports = [
    { id: 'AP1', code: 'JED', name: 'King Abdulaziz Intl', gates: ['G1', 'G2', 'G3'], offloadBays: ['OB1', 'OB2'], active: true },
    { id: 'AP2', code: 'MED', name: 'Prince Mohammad bin Abdulaziz Intl', gates: ['G1', 'G2'], offloadBays: ['OB1'], active: true },
  ];
  const hotels = [
    { id: 'H1', code: 'HTL-SAF', name: 'Al-Safwa Hotel', city: 'Makkah', buildings: ['A', 'B'], bays: ['Bay 1', 'Bay 2'], active: true },
    { id: 'H2', code: 'HTL-DAE', name: 'Dar Al-Eiman', city: 'Makkah', buildings: ['Main'], bays: ['Bay 1'], active: true },
    { id: 'H3', code: 'HTL-ANS', name: 'Al-Ansar Hotel', city: 'Madinah', buildings: ['Main', 'Annex'], bays: ['Bay 1'], active: true },
  ];
  const vehicles = [
    { id: 'V1', code: 'TRK-101', type: 'Collection Truck', capacity: 120, active: true },
    { id: 'V2', code: 'TRK-102', type: 'Airport Truck', capacity: 150, active: true },
    { id: 'V3', code: 'TRL-201', type: 'Trolley', capacity: 20, active: true },
    { id: 'V4', code: 'DLY-301', type: 'Dolly', capacity: 40, active: true },
  ];
  const flights = [
    { id: 'F1', code: 'GA 981', route: 'JED → CGK', date: daysFromNow(3), status: 'Open', active: true },
    { id: 'F2', code: 'PK 760', route: 'JED → LHE', date: daysFromNow(2), status: 'Open', active: true },
    { id: 'F3', code: 'BG 136', route: 'JED → DAC', date: daysFromNow(1), status: 'Open', active: true },
    { id: 'F4', code: 'SV 817', route: 'CGK → JED', date: daysAgo(0), status: 'Arrived', active: true },
    { id: 'F5', code: 'PK 741', route: 'LHE → MED', date: daysAgo(0), status: 'Landed', active: true },
  ];
  return { centres, warehouses, airports, hotels, vehicles, flights };
}

function buildUsers(masterData) {
  const users = [];
  let seq = 1;
  for (const role of STAFF_ROLES) {
    const count = role.id === 'sysadmin' ? 2 : int(3, 6);
    for (let i = 0; i < count; i++) {
      const num = String(seq++).padStart(3, '0');
      const scopeOptions = {
        centre: masterData.centres.map((c) => c.name),
        warehouse: masterData.warehouses.map((w) => w.name),
        airport: masterData.airports.map((a) => a.code),
        hotel: masterData.hotels.map((h) => h.name),
        airlineCode: ['GA', 'PK', 'BG', 'SV', 'XY'],
        none: [null],
      }[role.scopeType];
      const disabled = rng() < 0.12;
      users.push({
        id: `U${num}`,
        employeeId: `${role.prefix}-${num}`,
        name: fullName(),
        roleId: role.id,
        roleLabel: role.label,
        scope: pick(scopeOptions),
        phone: `+9665${int(10000000, 99999999)}`,
        email: `user${num}@rabel.sa`,
        status: disabled ? 'Disabled' : 'Active',
        disabledReason: disabled ? pick(['Resigned', 'On leave', 'Policy violation', 'Season ended']) : null,
        twoFA: rng() < 0.7,
        lastLogin: rng() < 0.85 ? hoursAgo(int(1, 400)) : null,
        pin: String(int(1000, 9999)),
        activeSessions: disabled ? [] : Array.from({ length: int(0, 2) }, (_, j) => ({
          id: `S${num}-${j}`, device: pick(['Android scanner', 'iPhone', 'Windows desktop', 'Samsung tablet']), since: hoursAgo(int(1, 48)),
        })),
        permissions: null, // filled from role preset + overrides at runtime by api.js
        createdAt: daysAgo(int(10, 300)),
      });
    }
  }
  return users;
}

function buildRolePermissions() {
  const presets = {};
  for (const role of STAFF_ROLES) {
    const matrix = {};
    for (const mod of MODULES) {
      matrix[mod] = {};
      for (const lvl of PERMISSION_LEVELS) {
        let allowed = rng() < 0.4;
        if (role.id === 'sysadmin') allowed = true;
        if (role.id === 'opsmanager' && lvl !== 'approve') allowed = rng() < 0.7;
        if (mod === 'Config' && role.id !== 'sysadmin') allowed = false;
        matrix[mod][lvl] = allowed;
      }
    }
    presets[role.id] = matrix;
  }
  return presets;
}

function buildConfig() {
  return {
    thresholds: {
      maxBagWeightKg: { value: 23, min: 15, max: 32, unit: 'kg', help: 'Maximum weight per checked bag.', liveImpact: true },
      maxBagsPerPilgrim: { value: 2, min: 1, max: 6, unit: 'bags', help: 'Maximum bags a pilgrim may check in.', liveImpact: true },
      slotMinutes: { value: 15, min: 5, max: 60, unit: 'min', help: 'Length of each check-in appointment slot.', liveImpact: false },
      slotCapacity: { value: 6, min: 1, max: 50, unit: 'pilgrims', help: 'Pilgrims allowed per slot.', liveImpact: false },
      closeHoursBeforeCutoff: { value: 4, min: 1, max: 24, unit: 'h', help: 'City check-in closes this many hours before flight cut-off.', liveImpact: true },
      noShowGraceMinutes: { value: 20, min: 0, max: 120, unit: 'min', help: 'Grace period before a booking is marked no-show.', liveImpact: false },
      airportTransitMinutes: { value: 60, min: 10, max: 240, unit: 'min', help: 'Expected warehouse → airport transit time.', liveImpact: false },
      dispatchWarningMinutes: { value: 120, min: 10, max: 300, unit: 'min', help: 'Warn when dispatch is this close to cut-off.', liveImpact: false },
      handoverCutoffBufferMinutes: { value: 45, min: 5, max: 180, unit: 'min', help: 'Buffer before cut-off to force airline handover.', liveImpact: true },
      bsmWeightToleranceKg: { value: 1.0, min: 0.1, max: 5, unit: 'kg', help: 'Allowed BSM weight mismatch tolerance.', liveImpact: false },
      uldCapacity: { value: 40, min: 10, max: 60, unit: 'bags', help: 'Maximum bags per ULD.', liveImpact: false },
      trolleyCapacity: { value: 12, min: 4, max: 30, unit: 'bags', help: 'Maximum bags per trolley.', liveImpact: false },
      maxDeliveryAttempts: { value: 3, min: 1, max: 10, unit: 'attempts', help: 'Delivery attempts before escalation.', liveImpact: false },
      supervisorPin: { value: '9999', min: null, max: null, unit: 'PIN', help: 'Supervisor override PIN (4 digits).', liveImpact: true },
    },
    nusuk: {
      baseUrl: 'https://api.nusuk.sa/v2', clientId: 'rabel-prod-client', clientSecret: 'nsk_live_8f2a91cd44ee', timeoutSec: 15,
      environment: 'Sandbox', lastTestOk: true, lastTestAt: hoursAgo(6),
    },
    airlines: [
      { code: 'GA', name: 'Garuda Indonesia', endpoint: 'https://dcs.garuda-id.example/bsm', apiKey: 'ga_key_7719bc02', bsmFeed: true, format: 'IATA Type B', lastTestOk: true, lastTestAt: hoursAgo(10) },
      { code: 'PK', name: 'PIA', endpoint: 'https://dcs.piac.example/bsm', apiKey: 'pk_key_a3f0129e', bsmFeed: true, format: 'IATA Type B', lastTestOk: false, lastTestAt: hoursAgo(2) },
      { code: 'BG', name: 'Biman Bangladesh', endpoint: 'https://dcs.biman.example/bsm', apiKey: 'bg_key_551cde77', bsmFeed: false, format: 'IATA Type B', lastTestOk: null, lastTestAt: null },
    ],
  };
}

function buildAlertRules() {
  return [
    { id: 'AR1', condition: 'Exception severity ≥', threshold: 'High', notifyRoles: ['opsmanager', 'sysadmin'], channel: 'In-app', active: true },
    { id: 'AR2', condition: 'Truck delay > (min)', threshold: 30, notifyRoles: ['opsmanager'], channel: 'SMS', active: true },
    { id: 'AR3', condition: 'Cut-off < (min) with bags not loaded', threshold: 60, notifyRoles: ['opsmanager', 'airport'], channel: 'In-app', active: true },
    { id: 'AR4', condition: 'Bag stuck at stage > (h)', threshold: 6, notifyRoles: ['opsmanager'], channel: 'Email', active: false },
  ];
}

function buildServices() {
  const base = [
    { id: 'SV1', name: 'Nusuk API', status: 'Healthy', uptime: 99.95 },
    { id: 'SV2', name: 'Airline B-Type feed', status: 'Degraded', uptime: 97.1 },
    { id: 'SV3', name: 'GPS feed', status: 'Healthy', uptime: 99.6 },
    { id: 'SV4', name: 'Scanner gateway', status: 'Healthy', uptime: 99.9 },
    { id: 'SV5', name: 'Notification service', status: 'Healthy', uptime: 99.8 },
    { id: 'SV6', name: 'Database', status: 'Healthy', uptime: 99.99 },
  ];
  return base.map((s) => ({
    ...s,
    latencyMs: int(40, 320),
    lastCheck: minutesAgo(int(1, 10)),
    history: Array.from({ length: 24 }, () => int(s.status === 'Degraded' ? 150 : 40, s.status === 'Degraded' ? 600 : 180)),
  }));
}

function buildErrors(services) {
  const templates = [
    { service: 'Nusuk API', severity: 'High', code: '401', message: 'API key expired' },
    { service: 'Nusuk API', severity: 'Medium', code: 'ETIMEDOUT', message: 'Request timed out after 15s' },
    { service: 'Airline B-Type feed', severity: 'High', code: 'BSM-400', message: 'Malformed BSM message' },
    { service: 'Airline B-Type feed', severity: 'Critical', code: 'BSM-500', message: 'BSM feed connection reset' },
    { service: 'GPS feed', severity: 'Medium', code: 'GPS-GAP', message: 'GPS data gap > 10 min for vehicle TRK-101' },
    { service: 'Scanner gateway', severity: 'Low', code: 'SCN-409', message: 'Duplicate scan ignored' },
    { service: 'Notification service', severity: 'Low', code: 'NTF-429', message: 'Rate limited, queued for retry' },
    { service: 'Database', severity: 'Medium', code: 'DB-SLOW', message: 'Slow query > 2s on scanEvents' },
  ];
  const errors = [];
  for (let i = 0; i < 30; i++) {
    const t = pick(templates);
    errors.push({
      id: `ERR${1000 + i}`,
      time: hoursAgo(int(0, 240)),
      service: t.service,
      severity: t.severity,
      code: t.code,
      message: t.message,
      count: int(1, 14),
      status: pick(['Open', 'Open', 'Resolved', 'Escalated']),
      stack: `at connector.fetch (${t.service.replace(/\s/g, '')}.js:${int(10, 400)})\nat process.processTicksAndRejections (node:internal)`,
      payload: JSON.stringify({ service: t.service, code: t.code, requestId: `req_${int(100000, 999999)}` }, null, 2),
      rootCause: null,
      vendorTicket: null,
    });
  }
  return errors.sort((a, b) => new Date(b.time) - new Date(a.time));
}

function buildAuditLog(users) {
  const actions = [
    { action: 'Login', entity: 'Session' },
    { action: 'Create user', entity: 'User' },
    { action: 'Edit user', entity: 'User' },
    { action: 'Disable user', entity: 'User' },
    { action: 'Update config', entity: 'Config' },
    { action: 'Test connection', entity: 'Integration' },
    { action: 'Resolve error', entity: 'ErrorLog' },
    { action: 'Escalate error', entity: 'ErrorLog' },
    { action: 'Export data', entity: 'Export' },
    { action: 'Update master data', entity: 'MasterData' },
  ];
  const log = [];
  for (let i = 0; i < 200; i++) {
    const a = pick(actions);
    const u = pick(users);
    const before = a.action.startsWith('Edit') || a.action.startsWith('Update') ? { status: 'Active', value: int(1, 100) } : null;
    const after = before ? { status: pick(['Active', 'Disabled']), value: int(1, 100) } : null;
    log.push({
      id: `AUD${10000 + i}`,
      time: hoursAgo(int(0, 720)),
      userId: u.id,
      userName: u.name,
      roleLabel: u.roleLabel,
      action: a.action,
      entity: a.entity,
      entityId: `${a.entity.slice(0, 3).toUpperCase()}-${int(100, 999)}`,
      ip: `10.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
      device: pick(['Chrome / Windows', 'Safari / iPhone', 'Chrome / Android', 'Edge / Windows']),
      result: rng() < 0.92 ? 'Success' : 'Failure',
      before,
      after,
    });
  }
  return log.sort((x, y) => new Date(y.time) - new Date(x.time));
}

function buildNotifications() {
  return [
    { id: 'N1', title: 'Airline B-Type feed degraded', body: '3 errors in the last 10 minutes.', time: minutesAgo(8), unread: true, link: '#/health' },
    { id: 'N2', title: 'Nusuk key expiring soon', body: 'Sandbox client secret expires in 5 days.', time: hoursAgo(2), unread: true, link: '#/config' },
    { id: 'N3', title: 'New user added', body: 'Fahad Al-Ghamdi (WH-004) was created.', time: hoursAgo(5), unread: false, link: '#/users' },
    { id: 'N4', title: 'Export ready', body: 'Bags export (CSV) is ready to download.', time: daysAgo(1), unread: false, link: '#/export' },
  ];
}

export function createSeed() {
  const masterData = buildMasterData();
  const users = buildUsers(masterData);
  const services = buildServices();
  return {
    session: null,
    admins: [{ id: 'ADM-001', employeeId: 'ADM-001', name: 'Zaid Al-Harbi', pin: '1234', twoFACode: '123456' }],
    users,
    rolePermissions: buildRolePermissions(),
    permissionOverrides: {}, // userId -> partial matrix overrides
    config: buildConfig(),
    alertRules: buildAlertRules(),
    services,
    errors: buildErrors(services),
    incidents: [],
    vendorTickets: [],
    auditLog: buildAuditLog(users),
    masterData,
    notifications: buildNotifications(),
    exportsList: [],
    reportsHistory: [],
    handoverNotes: [],
  };
}
