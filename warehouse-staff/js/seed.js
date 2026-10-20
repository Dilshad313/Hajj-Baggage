/**
 * Mock data for the Warehouse Staff console. The inbound/outbound truck
 * scenarios are hand-specified to match the product brief; zones, locations
 * and incidental details are generated deterministically.
 */

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();
const minutesFromNow = (m) => new Date(NOW + m * 60000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);

export const EXCEPTION_TYPES = [
  'Missing Bag', 'Extra Bag', 'Damaged Bag', 'Prohibited Items', 'Scan Failed', 'Unknown Truck',
  'Pilgrim Not Found', 'Data Mismatch', 'Overweight', 'Wrong Centre', 'Vehicle Issue', 'Count Mismatch',
  'Seal Mismatch', 'Security Hold', 'Handover Rejected', 'PNR Mismatch', 'No BSM', 'Weight Mismatch',
  'Unidentified Bag', 'Passenger Not Found', 'Delivery Refused', 'Missed Cut-off', 'Offloaded Bag',
  'Pilgrim Reported Missing',
];
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
export const EXCEPTION_STATUSES = ['Open', 'Assigned', 'In Progress', 'Escalated', 'Resolved', 'Closed'];

/** Full departure bag lifecycle; this role drives the middle 6 stages. */
export const DEPARTURE_STAGES = [
  'Declared', 'Checked-in', 'Tagged', 'Loaded to Collection Truck', 'Received at Warehouse', 'Screened',
  'Stored', 'Loaded to Airport Truck', 'In Transit to Airport', 'Received at Airport', 'Handed to Airline',
  'Loaded on Aircraft',
];

export const PROHIBITED_CATEGORIES = ['Flammable liquid', 'Sharp object', 'Power bank (oversized)', 'Aerosol', 'Weapon-like item', 'Other restricted item'];
export const DISPOSAL_OPTIONS = ['Returned to pilgrim at centre', 'Handed to airport security', 'Disposed on-site', 'Other'];
export const OFF_ZONE_REASONS = ['Zone full', 'Oversized', 'Supervisor instruction', 'Other'];

function buildConfig() {
  return { airportTransitMin: 60, dispatchWarningMin: 120, xraySeconds: 3, outboundTruckCapacity: 40, locationCapacity: 25 };
}

function buildStaff() {
  return [
    { id: 'WH-001', employeeId: 'WH-001', name: 'Faisal', pin: '1234' },
    { id: 'WH-002', employeeId: 'WH-002', name: 'Imran', pin: '1234' },
  ];
}

function buildDrivers() {
  return [
    { id: 'DRV-001', name: 'Tariq', pin: '1234', status: 'Available', busyOnTripId: null },
    { id: 'DRV-002', name: 'Naveed', pin: '1234', status: 'Available', busyOnTripId: null },
  ];
}

function buildWarehouse() {
  return {
    name: 'Rabel Central Warehouse — Makkah',
    gates: ['Gate 1', 'Gate 2'],
    bays: [
      { code: 'BAY-1', status: 'Free', tripId: null },
      { code: 'BAY-2', status: 'Free', tripId: null },
      { code: 'BAY-3', status: 'Free', tripId: null },
      { code: 'BAY-4', status: 'Out of Service', tripId: null },
    ],
  };
}

function buildLocations(zoneCode, count, capacity) {
  return Array.from({ length: count }, (_, i) => ({
    code: `LOC-${zoneCode}-${String(i + 1).padStart(2, '0')}`, zoneCode, capacity, bagIds: [],
  }));
}

function buildZones() {
  const capacity = 25;
  return [
    { code: 'Z-A1', flightCode: 'GA 981', destination: 'CGK', status: 'Open', locations: buildLocations('Z-A1', 6, capacity) },
    { code: 'Z-A2', flightCode: 'PK 760', destination: 'LHE', status: 'Open', locations: buildLocations('Z-A2', 6, capacity) },
    { code: 'Z-A3', flightCode: 'BG 136', destination: 'DAC', status: 'Open', locations: buildLocations('Z-A3', 4, capacity) },
    { code: 'Z-B1', flightCode: 'XY 801', destination: 'KAN', status: 'Open', locations: buildLocations('Z-B1', 4, capacity) },
    { code: 'Z-OV', flightCode: null, destination: 'Overflow', status: 'Open', locations: buildLocations('Z-OV', 6, capacity) },
    { code: 'Z-Q', flightCode: null, destination: 'Quarantine', status: 'Open', locations: buildLocations('Z-Q', 4, capacity) },
  ];
}

function pilgrim(id, name, nationality, groupName) {
  return { id, name, nationality, groupName };
}

function bag(id, tagNumber, pilgrimId, flightCode, destination, opts = {}) {
  return {
    id, tagNumber, pilgrimId, flightCode, destination, direction: 'departure',
    status: opts.status || 'Loaded to Collection Truck',
    weightKg: opts.weightKg || 20 + Math.random() * 6,
    truckTripId: opts.truckTripId || null,
    screeningStatus: null, prohibitedInfo: null,
    zoneCode: null, locationCode: null, sortedLane: null,
    outboundTripId: null, xrayFlag: !!opts.xrayFlag,
    scannedAt: opts.scannedAt || null,
    timeline: opts.timeline || [
      { stage: 'Declared', time: hoursAgo(8), result: 'ok' },
      { stage: 'Checked-in', time: hoursAgo(7), result: 'ok' },
      { stage: 'Tagged', time: hoursAgo(7), result: 'ok' },
      { stage: 'Loaded to Collection Truck', time: hoursAgo(1), result: 'ok' },
    ],
  };
}

function buildInbound() {
  const pilgrims = [
    pilgrim('WPIL-1', 'Yusuf Hadi', 'Indonesian', 'Jakarta Group 2'),
    pilgrim('WPIL-2', 'Maryam Idris', 'Indonesian', 'Jakarta Group 2'),
    pilgrim('WPIL-3', 'Omar Farouk', 'Egyptian', 'Cairo Group 3'),
    pilgrim('WPIL-4', 'Layla Hassan', 'Egyptian', 'Cairo Group 3'),
    pilgrim('WPIL-5', 'Imran Qureshi', 'Pakistani', 'Lahore Group 1'),
    pilgrim('WPIL-6', 'Farida Shah', 'Pakistani', 'Lahore Group 1'),
    pilgrim('WPIL-7', 'Zaid Malik', 'Pakistani', 'Lahore Group 1'),
    pilgrim('WPIL-8', 'Noor Jamil', 'Malaysian', 'KL Group 4'),
    pilgrim('WPIL-9', 'Hamid Rauf', 'Malaysian', 'KL Group 4'),
    pilgrim('WPIL-10', 'Sara Anwar', 'Malaysian', 'KL Group 4'),
  ];

  const trk14 = {
    id: 'TRP-W14', code: 'TRP-W14', truckPlate: 'TRK-14', driverName: 'Rafiq Noor', centre: 'Aziziyah Check-in Centre',
    manifestNo: 'MAN-33201', status: 'En route', eta: minutesAgo(1), arrivedAt: null, bay: null, extraTags: [],
    bagIds: [],
  };
  // 5 of TRK-14's 6 manifest bags are physically scannable; the 6th ("missing")
  // is deliberately never scannable in the demo so the verify step always
  // shows a real discrepancy to record.
  const trk14Bags = [1, 2, 3, 4, 5, 6].map((n) => bag(
    `W14-BAG-${n}`, `RBL-A-00${30 + n}`, pilgrims[(n - 1) % pilgrims.length].id, 'GA 981', 'CGK',
    { truckTripId: 'TRP-W14', xrayFlag: n === 2 },
  ));
  trk14.bagIds = trk14Bags.map((b) => b.id);

  const trk21 = {
    id: 'TRP-W21', code: 'TRP-W21', truckPlate: 'TRK-21', driverName: 'Hamid Sultan', centre: 'Al-Awali Check-in Centre',
    manifestNo: 'MAN-33202', status: 'En route', eta: minutesFromNow(40), arrivedAt: null, bay: null, extraTags: [],
    bagIds: [],
  };
  // One of TRK-21's bags is the "extra" bag that shows up (and scans
  // successfully) while unloading TRK-14 — a manifest mix-up between the
  // two trucks, exactly the kind of discrepancy this screen exists to catch.
  const trk21Bags = [1, 2, 3, 4].map((n) => bag(
    `W21-BAG-${n}`, `RBL-A-00${40 + n}`, pilgrims[(n + 5) % pilgrims.length].id, 'PK 760', 'LHE',
    { truckTripId: 'TRP-W21' },
  ));
  trk21.bagIds = trk21Bags.map((b) => b.id);

  return { pilgrims, trips: [trk14, trk21], bags: [...trk14Bags, ...trk21Bags] };
}

function buildFlights() {
  return [
    { code: 'GA 981', destination: 'CGK', dispatchDeadline: minutesFromNow(90) },
    { code: 'PK 760', destination: 'LHE', dispatchDeadline: minutesFromNow(200) },
    { code: 'BG 136', destination: 'DAC', dispatchDeadline: minutesFromNow(320) },
    { code: 'XY 801', destination: 'KAN', dispatchDeadline: minutesFromNow(420) },
  ];
}

function buildOutboundTrucks() {
  return [
    { id: 'TRK-41', code: 'TRK-41', status: 'Available' },
    { id: 'TRK-42', code: 'TRK-42', status: 'Available' },
    { id: 'TRK-43', code: 'TRK-43', status: 'Out of Service' },
  ];
}

function buildNotifications() {
  return [
    { id: 'N1', title: 'Truck arriving', body: 'TRK-14 from Aziziyah is at the gate now.', time: minutesAgo(1), unread: true, link: '#/gate' },
    { id: 'N2', title: 'Flight at risk', body: 'GA 981 dispatch deadline is approaching.', time: minutesAgo(5), unread: false, link: '#/outbound' },
  ];
}

export function createSeed() {
  const { pilgrims, trips, bags } = buildInbound();
  return {
    session: null,
    demoMode: false,
    demoForceFail: false,
    workstation: 'Gate',
    config: buildConfig(),
    staff: buildStaff(),
    drivers: buildDrivers(),
    warehouse: buildWarehouse(),
    zones: buildZones(),
    flights: buildFlights(),
    pilgrims,
    trips,
    bags,
    outboundTrucks: buildOutboundTrucks(),
    outboundTrips: [],
    resealNumbers: [],
    sealNumbers: [],
    exceptions: [],
    notifications: buildNotifications(),
    handoverNotes: [],
    reportHistory: [],
  };
}
