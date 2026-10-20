/**
 * Mock data for the Driver console.
 * The three demo trips are hand-specified to match the product brief exactly;
 * only incidental details (timestamps) are generated.
 */

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);
const minutesFromNow = (m) => new Date(NOW + m * 60000).toISOString();

export const EXCEPTION_TYPES = [
  'Missing Bag', 'Extra Bag', 'Damaged Bag', 'Prohibited Items', 'Scan Failed', 'Unknown Truck',
  'Pilgrim Not Found', 'Data Mismatch', 'Overweight', 'Wrong Centre', 'Vehicle Issue', 'Count Mismatch',
  'Seal Mismatch', 'Security Hold', 'Handover Rejected', 'PNR Mismatch', 'No BSM', 'Weight Mismatch',
  'Unidentified Bag', 'Passenger Not Found', 'Delivery Refused', 'Missed Cut-off', 'Offloaded Bag',
  'Pilgrim Reported Missing',
];
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
export const EXCEPTION_STATUSES = ['Open', 'Assigned', 'In Progress', 'Escalated', 'Resolved', 'Closed'];

/** Bag status lifecycle — departure (warehouse to airport). */
export const DEPARTURE_STAGES = [
  'Declared', 'Checked-in', 'Tagged', 'Loaded to Collection Truck', 'Received at Warehouse', 'Screened',
  'Stored', 'Loaded to Airport Truck', 'In Transit to Airport', 'Received at Airport', 'Handed to Airline',
  'Loaded on Aircraft',
];
/** Bag status lifecycle — arrival (airport to accommodation). */
export const ARRIVAL_STAGES = [
  'Expected', 'Received at Airport', 'Security Checked', 'Loaded to Truck', 'In Transit to Accommodation',
  'Received at Accommodation', 'Sorted', 'Out for Delivery', 'Delivered', 'Confirmed by Pilgrim',
];

/** Workflow stage keys, in order, for each trip direction. Drives routing + the stepper. */
export const DEPARTURE_STAGE_KEYS = ['vehicle', 'pretrip', 'pickup', 'count', 'seal', 'transit', 'arrive', 'security', 'offload', 'handover', 'complete'];
export const ARRIVAL_STAGE_KEYS = ['vehicle', 'pretrip', 'pickup', 'count', 'seal', 'transit', 'arrive', 'offload', 'handover', 'complete'];

/** Stepper labels + the 1-based step each stage key lights up. */
export const DEPARTURE_STEPS = ['Vehicle', 'Pre-trip', 'Pickup', 'Count', 'Seal', 'In transit', 'Security', 'Offload', 'Handover', 'Done'];
export const ARRIVAL_STEPS = ['Vehicle', 'Pre-trip', 'Pickup', 'Count', 'Seal', 'In transit', 'Offload', 'Handover', 'Done'];
const DEPARTURE_STEP_INDEX = { vehicle: 1, pretrip: 2, pickup: 3, count: 4, seal: 5, transit: 6, arrive: 6, security: 7, offload: 8, handover: 9, complete: 10 };
const ARRIVAL_STEP_INDEX = { vehicle: 1, pretrip: 2, pickup: 3, count: 4, seal: 5, transit: 6, arrive: 6, offload: 7, handover: 8, complete: 9 };

/** @param {'Departure'|'Arrival'} direction @returns {{labels:string[], indexOf:(stage:string)=>number}} */
export function stageMeta(direction) {
  return direction === 'Departure'
    ? { labels: DEPARTURE_STEPS, indexOf: (s) => DEPARTURE_STEP_INDEX[s] || 1, order: DEPARTURE_STAGE_KEYS }
    : { labels: ARRIVAL_STEPS, indexOf: (s) => ARRIVAL_STEP_INDEX[s] || 1, order: ARRIVAL_STAGE_KEYS };
}

export const PRETRIP_ITEMS = [
  'Tyres', 'Brakes', 'Lights & indicators', 'Mirrors', 'Fuel adequate', 'Doors & seal points', 'Cargo area clean', 'Documents on board',
];

export const DELAY_REASONS = ['Traffic', 'Checkpoint', 'Road closure', 'Vehicle problem', 'Weather', 'Other'];

export const SECURITY_DOCS = ['Driver ID / Iqama', 'Vehicle registration', 'Trip manifest', 'Seal intact'];
export const SECURITY_HOLD_REASONS = ['Random check', 'Document issue', 'Manifest mismatch', 'Prohibited item suspected', 'Other'];

export const HANDOVER_ORGS = ['Airline / Ground Handler', 'Airport Coordinator', 'Accommodation Receiving Staff', 'Operations Manager'];

export const PLACES = {
  'WH-MAK': { name: 'Warehouse — Makkah', lat: 21.3891, lng: 39.8579, pickupGateCode: 'WH-MAK-GATE-1', bays: [] },
  'JED-TERM': { name: 'Jeddah Hajj Terminal', lat: 21.6796, lng: 39.1565, pickupGateCode: 'JED-GATE-7', destGateCode: 'JED-GATE-3', bays: ['JED-BAY-A1', 'JED-BAY-A2', 'JED-BAY-B1'] },
  'ACC-SAFWA': { name: 'Al-Safwa Hotel', lat: 21.4225, lng: 39.8262, destGateCode: 'ACC-SAFWA-BAY', bays: ['Bay 1', 'Bay 2'] },
  'ACC-EIMAN': { name: 'Dar Al-Eiman', lat: 21.4210, lng: 39.8250, destGateCode: 'ACC-EIMAN-BAY', bays: ['Bay 1'] },
  'ACC-ANSAR-MAD': { name: 'Al-Ansar Madinah', lat: 24.4672, lng: 39.6112, destGateCode: 'ACC-ANSAR-BAY', bays: ['Bay 1', 'Bay 2'] },
};

function buildConfig() {
  return { avgSpeedKmh: 40, gpsIntervalSec: 10, etaNotifyMin: 15, maxDelayMin: 240 };
}

function buildStaff() {
  return [
    { id: 'DRV-001', employeeId: 'DRV-001', name: 'Tariq', pin: '1234' },
    { id: 'DRV-002', employeeId: 'DRV-002', name: 'Naveed', pin: '1234' },
    { id: 'DRV-003', employeeId: 'DRV-003', name: 'Salman', pin: '1234' },
  ];
}

function buildTrucks() {
  return [
    { id: 'TRK-41', type: 'Airport Transfer', status: 'Active', odometer: 48210, fuel: 70 },
    { id: 'TRK-42', type: 'Airport Transfer', status: 'Active', odometer: 51330, fuel: 55 },
    { id: 'TRK-44', type: 'Airport Transfer', status: 'Active', odometer: 45012, fuel: 90 },
    { id: 'TRK-43', type: 'Airport Transfer', status: 'Out of Service', odometer: 60500, fuel: 20 },
    { id: 'TRK-51', type: 'Arrival Transfer', status: 'Active', odometer: 39870, fuel: 65 },
    { id: 'TRK-52', type: 'Arrival Transfer', status: 'Active', odometer: 44410, fuel: 80 },
    { id: 'TRK-54', type: 'Arrival Transfer', status: 'Active', odometer: 36200, fuel: 95 },
    { id: 'TRK-53', type: 'Arrival Transfer', status: 'Out of Service', odometer: 58120, fuel: 10 },
  ];
}

function bagRow(id, tripId, tagNumber, weightKg, opts = {}) {
  return { id, tripId, tagNumber, weightKg, status: opts.status || 'Awaiting load' };
}

function buildTrips() {
  // ---- TRP-D1001 — Departure, Tariq, already loading at the warehouse ----
  const d1Bags = Array.from({ length: 8 }, (_, i) => bagRow(`D1-BAG-${i + 1}`, 'TRP-D1001', `RB-D1001-${String(i + 1).padStart(2, '0')}`, 18 + (i % 4), { status: i < 6 ? 'On truck' : 'Awaiting load' }));
  const tripD1 = {
    id: 'TRP-D1001', direction: 'Departure', staffId: 'DRV-001', truckId: 'TRK-41',
    routeFromKey: 'WH-MAK', routeToKey: 'JED-TERM',
    status: 'In Progress', stage: 'count',
    bagIds: d1Bags.map((b) => b.id),
    vehicle: { scannedOk: true, scannedAt: hoursAgo(2) },
    preTrip: { odometerStart: 48210, fuelStart: 70, rows: PRETRIP_ITEMS.map((label) => ({ label, result: 'Pass', note: '' })), submittedAt: hoursAgo(2) },
    pickup: { departedAt: hoursAgo(2), arrivedAt: hoursAgo(1.6), scannedCode: 'WH-MAK-GATE-1' },
    count: { expected: 8, loadedBagIds: d1Bags.slice(0, 6).map((b) => b.id), verifiedCount: null, verified: false, mismatchNote: null },
    seal: { number: null, sealedBy: null, confirmedByDriver: false },
    transit: { startedAt: null, position: null, speedKmh: 0, distanceRemainingKm: null, etaAt: null, gpsActive: false, lastPingAt: null, trail: [] },
    delays: [],
    arrive: { arrivedAt: null, scannedCode: null },
    security: { outcome: null, reason: null, notes: null, clearedAt: null, holdStartedAt: null },
    offload: { bay: null, sealBroken: false, unloadedBagIds: [], searchStartedAt: null, missingBagIds: [] },
    handover: { receiverName: null, receiverId: null, org: null, signatureDataUrl: null, driverConfirmed: false, qrPayload: null, generatedAt: null, receiverScanned: false },
    completion: null,
    cancelReason: null, cancelledAt: null, backupTripId: null,
    createdAt: hoursAgo(3), cutoffAt: minutesFromNow(70), flightNumber: 'SV 1821',
    log: [
      { at: hoursAgo(2), text: 'Vehicle TRK-41 scanned — OK.' },
      { at: hoursAgo(2), text: 'Pre-trip check submitted — all pass.' },
      { at: hoursAgo(1.6), text: 'Arrived at Warehouse — Makkah.' },
      { at: minutesAgo(20), text: '6 of 8 bags loaded.' },
    ],
  };

  // ---- TRP-D1002 — Departure, Naveed, fresh — pre-trip failure demo ----
  const d2Bags = Array.from({ length: 6 }, (_, i) => bagRow(`D2-BAG-${i + 1}`, 'TRP-D1002', `RB-D1002-${String(i + 1).padStart(2, '0')}`, 16 + (i % 3)));
  const tripD2 = {
    id: 'TRP-D1002', direction: 'Departure', staffId: 'DRV-002', truckId: 'TRK-42',
    routeFromKey: 'WH-MAK', routeToKey: 'JED-TERM',
    status: 'Assigned', stage: 'vehicle',
    bagIds: d2Bags.map((b) => b.id),
    vehicle: { scannedOk: false, scannedAt: null },
    preTrip: { odometerStart: 51330, fuelStart: 55, rows: null, submittedAt: null },
    pickup: { departedAt: null, arrivedAt: null, scannedCode: null },
    count: { expected: 6, loadedBagIds: [], verifiedCount: null, verified: false, mismatchNote: null },
    seal: { number: null, sealedBy: null, confirmedByDriver: false },
    transit: { startedAt: null, position: null, speedKmh: 0, distanceRemainingKm: null, etaAt: null, gpsActive: false, lastPingAt: null, trail: [] },
    delays: [],
    arrive: { arrivedAt: null, scannedCode: null },
    security: { outcome: null, reason: null, notes: null, clearedAt: null, holdStartedAt: null },
    offload: { bay: null, sealBroken: false, unloadedBagIds: [], searchStartedAt: null, missingBagIds: [] },
    handover: { receiverName: null, receiverId: null, org: null, signatureDataUrl: null, driverConfirmed: false, qrPayload: null, generatedAt: null, receiverScanned: false },
    completion: null,
    cancelReason: null, cancelledAt: null, backupTripId: null,
    createdAt: minutesAgo(20), cutoffAt: minutesFromNow(150), flightNumber: 'SV 1944',
    log: [],
  };

  // ---- TRP-A2001 — Arrival, Salman, fresh — missing-bag demo at offload ----
  const a1Bags = Array.from({ length: 6 }, (_, i) => bagRow(`A1-BAG-${i + 1}`, 'TRP-A2001', `RB-A2001-${String(i + 1).padStart(2, '0')}`, 17 + (i % 5)));
  const tripA1 = {
    id: 'TRP-A2001', direction: 'Arrival', staffId: 'DRV-003', truckId: 'TRK-51',
    routeFromKey: 'JED-TERM', routeToKey: 'ACC-SAFWA',
    status: 'Assigned', stage: 'vehicle',
    bagIds: a1Bags.map((b) => b.id),
    vehicle: { scannedOk: false, scannedAt: null },
    preTrip: { odometerStart: 39870, fuelStart: 65, rows: null, submittedAt: null },
    pickup: { departedAt: null, arrivedAt: null, scannedCode: null },
    count: { expected: 6, loadedBagIds: [], verifiedCount: null, verified: false, mismatchNote: null },
    seal: { number: null, sealedBy: null, confirmedByDriver: false },
    transit: { startedAt: null, position: null, speedKmh: 0, distanceRemainingKm: null, etaAt: null, gpsActive: false, lastPingAt: null, trail: [] },
    delays: [],
    arrive: { arrivedAt: null, scannedCode: null },
    security: { outcome: null, reason: null, notes: null, clearedAt: null, holdStartedAt: null },
    offload: { bay: null, sealBroken: false, unloadedBagIds: [], searchStartedAt: null, missingBagIds: [] },
    handover: { receiverName: null, receiverId: null, org: null, signatureDataUrl: null, driverConfirmed: false, qrPayload: null, generatedAt: null, receiverScanned: false },
    completion: null,
    cancelReason: null, cancelledAt: null, backupTripId: null,
    createdAt: minutesAgo(10), cutoffAt: null, flightNumber: 'SV 1944',
    log: [],
  };

  return { trips: [tripD1, tripD2, tripA1], bags: [...d1Bags, ...d2Bags, ...a1Bags] };
}

function buildAlerts() {
  return [
    { id: 'N1', title: 'Trip ready — TRP-D1001', body: '6 of 8 bags loaded at Warehouse — Makkah. Verify the count when loading is finished.', time: minutesAgo(20), unread: true, link: '#/trip/TRP-D1001' },
    { id: 'N2', title: 'New trip assigned — TRP-D1002', body: 'A departure trip has been assigned to you. Start with the vehicle check.', time: minutesAgo(20), unread: true, link: '#/trip/TRP-D1002' },
    { id: 'N3', title: 'New trip assigned — TRP-A2001', body: 'An arrival trip has been assigned to you. Start with the vehicle check.', time: minutesAgo(10), unread: false, link: '#/trip/TRP-A2001' },
  ];
}

export function createSeed() {
  const { trips, bags } = buildTrips();
  return {
    session: null,
    demoMode: false,
    config: buildConfig(),
    staff: buildStaff(),
    trucks: buildTrucks(),
    places: PLACES,
    trips,
    bags,
    exceptions: [],
    notifications: buildAlerts(),
    supervisorCallLog: [],
    vehicleReturns: [],
    tripHistory: [],
  };
}
