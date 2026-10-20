/**
 * Mock data for the Airport Coordinator console. Covers both the Departure
 * lane (receive Rabel trucks, hand baggage to the airline) and the Arrival
 * lane (receive baggage from the ground handler, security-check it, load
 * hotel trucks). The two seeded scenarios are hand-specified to match the
 * product brief; everything incidental is generated deterministically.
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

export const DEPARTURE_STAGES = [
  'Declared', 'Checked-in', 'Tagged', 'Loaded to Collection Truck', 'Received at Warehouse', 'Screened',
  'Stored', 'Loaded to Airport Truck', 'In Transit to Airport', 'Received at Airport', 'Handed to Airline',
  'Loaded on Aircraft',
];
export const ARRIVAL_STAGES = [
  'Expected', 'Received at Airport', 'Security Checked', 'Loaded to Truck', 'In Transit to Accommodation',
  'Received at Accommodation', 'Sorted', 'Out for Delivery', 'Delivered', 'Confirmed by Pilgrim',
];

export const REJECT_REASONS = ['PNR mismatch', 'Data mismatch', 'Overweight', 'Damaged beyond acceptance', 'Wrong flight', 'Other'];
export const RESOLUTION_ACTIONS = ['Corrected and resubmitted', 'Airline reversed decision', 'Bag withdrawn from batch'];
export const PROHIBITED_ITEM_TYPES = ['Flammable liquid', 'Sharp object', 'Power bank (oversized)', 'Aerosol', 'Other restricted item'];

export const PREP_CHECKLIST_ITEMS = [
  'Confirm ground handler contact', 'Review passenger manifest', 'Assign receiving bay',
  'Brief receiving team', 'Prepare SOP kit', 'Check security roster', 'Confirm hotel trucks available',
];

export const SOP_STEPS = [
  'Re-checked unloading bay and carousel', 'Checked nearby carts and hold area',
  'Confirmed tag numbers against the manifest', 'Contacted the ground handler for confirmation',
  'Filed a Property Irregularity Report (PIR)', 'Notified Operations Manager',
];

function buildConfig() {
  return { truckCapacityDefault: 30, prepRequiredCount: PREP_CHECKLIST_ITEMS.length };
}

function buildDeliveryVehicles() {
  return ['DOL-01', 'DOL-02', 'DOL-03'];
}

function buildMakeupPositions() {
  return Array.from({ length: 8 }, (_, i) => `MU-${i + 1}`);
}

function buildStaff() {
  return [
    { id: 'APC-001', employeeId: 'APC-001', name: 'Abdullah', pin: '1234', airport: 'JED' },
    { id: 'APC-002', employeeId: 'APC-002', name: 'Mariam', pin: '1234', airport: 'MED' },
  ];
}

function buildAirports() {
  return [
    { code: 'JED', name: 'Jeddah (JED)', gates: ['JED-GATE-1', 'JED-GATE-2', 'JED-GATE-3'], bays: ['OFF-1', 'OFF-2', 'OFF-3', 'OFF-4', 'OFF-5', 'OFF-6'], carousels: ['Carousel 3', 'Carousel 4', 'Carousel 5'] },
    { code: 'MED', name: 'Madinah (MED)', gates: ['MED-GATE-1', 'MED-GATE-2'], bays: ['OFF-1', 'OFF-2'], carousels: ['Carousel 1', 'Carousel 2'] },
  ];
}

function depPilgrim(id, name, nationality, groupName) {
  return { id, name, nationality, groupName };
}

function depBag(id, tagNumber, pilgrimId, opts = {}) {
  return {
    id, tagNumber, pilgrimId, direction: 'departure',
    status: opts.status || 'In Transit to Airport',
    flightCode: opts.flightCode || null, truckTripId: opts.truckTripId || null, batchId: null,
    rejected: false, rejectReason: null, rejectionProne: !!opts.rejectionProne,
    scannedAt: opts.scannedAt || null,
    timeline: opts.timeline || [
      { stage: 'Declared', time: hoursAgo(10), result: 'ok' },
      { stage: 'Checked-in', time: hoursAgo(9), result: 'ok' },
      { stage: 'Tagged', time: hoursAgo(9), result: 'ok' },
      { stage: 'Loaded to Collection Truck', time: hoursAgo(7), result: 'ok' },
      { stage: 'Received at Warehouse', time: hoursAgo(6), result: 'ok' },
      { stage: 'Screened', time: hoursAgo(5), result: 'ok' },
      { stage: 'Stored', time: hoursAgo(4), result: 'ok' },
      { stage: 'Loaded to Airport Truck', time: hoursAgo(2), result: 'ok' },
    ],
  };
}

function buildDeparture() {
  const pilgrims = [
    depPilgrim('DPIL-1', 'Yusuf Hadi', 'Indonesian', 'Jakarta Group 2'),
    depPilgrim('DPIL-2', 'Maryam Idris', 'Indonesian', 'Jakarta Group 2'),
    depPilgrim('DPIL-3', 'Omar Farouk', 'Egyptian', 'Cairo Group 3'),
    depPilgrim('DPIL-4', 'Layla Hassan', 'Egyptian', 'Cairo Group 3'),
    depPilgrim('DPIL-5', 'Imran Qureshi', 'Pakistani', 'Lahore Group 1'),
    depPilgrim('DPIL-6', 'Farida Shah', 'Pakistani', 'Lahore Group 1'),
    depPilgrim('DPIL-7', 'Zaid Malik', 'Pakistani', 'Lahore Group 1'),
    depPilgrim('DPIL-8', 'Noor Jamil', 'Malaysian', 'KL Group 4'),
    depPilgrim('DPIL-9', 'Hamid Rauf', 'Malaysian', 'KL Group 4'),
    depPilgrim('DPIL-10', 'Sara Anwar', 'Malaysian', 'KL Group 4'),
  ];

  const trip1001 = {
    id: 'TRP-D1001', code: 'TRP-D1001', truckPlate: 'TRK-D11', driverName: 'Khalid Noor', driverPhone: '+966503330001',
    airport: 'JED', flightCode: 'GA 981', sealNumber: 'SL-100221', status: 'En route',
    eta: minutesFromNow(35), arrivedAt: null, bay: null,
    from: [21.4858, 39.1925], to: [21.6796, 39.1565], position: [21.55, 39.17], bagIds: [],
  };
  const trip1002 = {
    id: 'TRP-D1002', code: 'TRP-D1002', truckPlate: 'TRK-D12', driverName: 'Rania Saeed', driverPhone: '+966503330002',
    airport: 'JED', flightCode: 'GA 981', sealNumber: 'SL-100222', status: 'En route',
    eta: minutesFromNow(70), arrivedAt: null, bay: null,
    from: [21.4858, 39.1925], to: [21.6796, 39.1565], position: [21.59, 39.18], bagIds: [],
  };
  const trip1003 = {
    id: 'TRP-D1003', code: 'TRP-D1003', truckPlate: 'TRK-D13', driverName: 'Tariq Bashir', driverPhone: '+966503330003',
    airport: 'JED', flightCode: 'GA 981', sealNumber: 'SL-482913', status: 'At Destination',
    eta: minutesAgo(2), arrivedAt: minutesAgo(2), bay: null,
    from: [21.4858, 39.1925], to: [21.6796, 39.1565], position: [21.6796, 39.1565], bagIds: [],
  };
  const trip1004 = {
    id: 'TRP-D1004', code: 'TRP-D1004', truckPlate: 'TRK-D14', driverName: 'Salim Aziz', driverPhone: '+966503330004',
    airport: 'JED', flightCode: 'GA 983', sealNumber: 'SL-559120', status: 'Security Hold',
    eta: minutesAgo(20), arrivedAt: minutesAgo(20), bay: null,
    from: [21.4858, 39.1925], to: [21.6796, 39.1565], position: [21.6796, 39.1565], bagIds: [],
  };

  const bagsInTransit = [1, 2, 3, 4, 5, 6].map((n) => depBag(
    `D1003-BAG-${n}`, `RBL-A-00${50 + n}`, pilgrims[(n - 1) % pilgrims.length].id,
    { truckTripId: 'TRP-D1003', flightCode: 'GA 981' },
  ));
  trip1003.bagIds = bagsInTransit.map((b) => b.id);

  const bagsReceived = Array.from({ length: 10 }, (_, i) => depBag(
    `GA981-BAG-${i + 1}`, `RBL-A-00${70 + i}`, pilgrims[i % pilgrims.length].id,
    {
      flightCode: 'GA 981', status: 'Received at Airport', scannedAt: hoursAgo(1),
      rejectionProne: i === 3,
      timeline: [
        { stage: 'Declared', time: hoursAgo(10), result: 'ok' },
        { stage: 'Checked-in', time: hoursAgo(9), result: 'ok' },
        { stage: 'Tagged', time: hoursAgo(9), result: 'ok' },
        { stage: 'Loaded to Collection Truck', time: hoursAgo(7), result: 'ok' },
        { stage: 'Received at Warehouse', time: hoursAgo(6), result: 'ok' },
        { stage: 'Screened', time: hoursAgo(5), result: 'ok' },
        { stage: 'Stored', time: hoursAgo(4), result: 'ok' },
        { stage: 'Loaded to Airport Truck', time: hoursAgo(2), result: 'ok' },
        { stage: 'In Transit to Airport', time: hoursAgo(1.5), result: 'ok' },
        { stage: 'Received at Airport', time: hoursAgo(1), result: 'ok' },
      ],
    },
  ));

  const securityHolds = [
    { id: 'HOLD-1', tripId: 'TRP-D1004', reason: 'Seal mismatch on arrival.', createdAt: minutesAgo(20), releasedAt: null, releaseNotes: null },
  ];

  return {
    pilgrims, trips: [trip1001, trip1002, trip1003, trip1004],
    bags: [...bagsInTransit, ...bagsReceived], batches: [], securityHolds,
  };
}

function arrPilgrim(id, name, nationality, groupName, nusukId, passportLast4, phone, hotel) {
  return { id, name, nationality, groupName, nusukId, passportLast4, phone, hotel };
}

function buildNusukSource() {
  const names = [
    ['Siti Rahmawati', 'Indonesian', 'Jakarta Group 4', 'SAFWA'],
    ['Fatimah Zahra', 'Indonesian', 'Jakarta Group 4', 'SAFWA'],
    ['Hassan Ibrahim', 'Egyptian', 'Cairo Group 1', 'EIMAN'],
    ['Nur Aisyah', 'Malaysian', 'KL Group 7', 'EIMAN'],
    ['Junaid Akhtar', 'Pakistani', 'Lahore Group 2', 'SAFWA'],
  ];
  const pilgrims = names.map(([name, nat, group, hotel], i) => arrPilgrim(
    `APIL-${i + 1}`, name, nat, group, `NSK33${10000 + i}`, String(7700 + i * 37).padStart(4, '0'),
    `+96650111${String(i).padStart(4, '0')}`, hotel,
  ));
  const bags = [];
  pilgrims.forEach((p, i) => {
    for (let b = 0; b < 2; b++) {
      const n = i * 2 + b;
      bags.push({
        id: `SV819-BAG-${n + 1}`, tagNumber: `RBL-B-00${60 + n}`, airlineTagNumber: `0812${String(100000 + n).slice(0, 6)}`,
        pilgrimId: p.id, direction: 'arrival', flightCode: 'SV 819', hotel: p.hotel,
        status: 'Expected', scannedAt: null, securityStatus: null, prohibitedInfo: null, unidentified: false,
        xrayFlag: n === 3, missingFlag: n === 9,
        timeline: [],
      });
    }
  });
  return { flightCode: 'SV 819', pilgrims, bags };
}

function buildArrFlights() {
  return [
    {
      id: 'SV819', code: 'SV 819', origin: 'CGK', destination: 'JED', airport: 'JED',
      eta: minutesFromNow(60), landedAt: null, gateArrivedAt: null, gate: null, carousel: null,
      status: 'Scheduled', nusukSyncedAt: null,
      prepChecklist: PREP_CHECKLIST_ITEMS.map((label) => ({ label, done: false, at: null })),
      prepCompletedAt: null,
      groundHandlerContact: { name: 'Hajj Terminal Ground Handling Co.', phone: '+966512220099' },
      releaseTime: null, coordinationNotes: null,
    },
  ];
}

function buildHotelsArrival() {
  return [
    { code: 'SAFWA', name: 'Al-Safwa Hotel' },
    { code: 'EIMAN', name: 'Dar Al-Eiman' },
  ];
}

function buildOutboundTrucks() {
  return [
    { id: 'TRK-51', code: 'TRK-51', driverName: 'Salman', capacity: 30, status: 'Available' },
    { id: 'TRK-52', code: 'TRK-52', driverName: 'Yasir', capacity: 30, status: 'Available' },
  ];
}

function buildNotifications() {
  return [
    { id: 'N1', title: 'Truck approaching cut-off', body: 'TRP-D1001 (GA 981) is 35 minutes out — bay not yet assigned.', time: minutesAgo(3), unread: true, link: '#/dep/incoming' },
    { id: 'N2', title: 'Flight landing soon', body: 'SV 819 lands in about 60 minutes — sync passengers from Nusuk.', time: minutesAgo(1), unread: true, link: '#/arr/flights' },
  ];
}

export function createSeed() {
  const departure = buildDeparture();
  const nusukSource = buildNusukSource();
  return {
    session: null,
    demoMode: false,
    demoForceFail: false,
    airlineRejectsNext: false,
    focus: 'departure',
    config: buildConfig(),
    staff: buildStaff(),
    airports: buildAirports(),
    groundHandlers: ['Hajj Terminal Ground Handling Co.'],
    deliveryVehicles: buildDeliveryVehicles(),
    makeupPositions: buildMakeupPositions(),
    // Departure
    depPilgrims: departure.pilgrims,
    depTrips: departure.trips,
    depBags: departure.bags,
    depBatches: departure.batches,
    securityHolds: departure.securityHolds,
    // Arrival
    nusukSource,
    arrPilgrims: [],
    arrBags: [],
    arrFlights: buildArrFlights(),
    hotelsArrival: buildHotelsArrival(),
    outboundTrucks: buildOutboundTrucks(),
    arrTrips: [],
    // Shared
    exceptions: [],
    notifications: buildNotifications(),
    handoverNotes: [],
  };
}
