/**
 * Mock data for the Airline / Ground Handler console.
 * Flight GA 983's single handover batch is hand-specified to match the
 * product brief (6 clean bags, 1 PNR-mismatch bag, 1 no-BSM bag); everything
 * else is generated deterministically.
 */

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();
const minutesFromNow = (m) => new Date(NOW + m * 60000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);
const hoursFromNow = (h) => minutesFromNow(h * 60);

export const EXCEPTION_TYPES = [
  'Missing Bag', 'Extra Bag', 'Damaged Bag', 'Prohibited Items', 'Scan Failed', 'Unknown Truck',
  'Pilgrim Not Found', 'Data Mismatch', 'Overweight', 'Wrong Centre', 'Vehicle Issue', 'Count Mismatch',
  'Seal Mismatch', 'Security Hold', 'Handover Rejected', 'PNR Mismatch', 'No BSM', 'Weight Mismatch',
  'Unidentified Bag', 'Passenger Not Found', 'Delivery Refused', 'Missed Cut-off', 'Offloaded Bag',
  'Pilgrim Reported Missing',
];
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
export const EXCEPTION_STATUSES = ['Open', 'Assigned', 'In Progress', 'Escalated', 'Resolved', 'Closed'];

/** Full departure bag lifecycle; this role drives the last 3 stages. */
export const DEPARTURE_STAGES = [
  'Declared', 'Checked-in', 'Tagged', 'Loaded to Collection Truck', 'Received at Warehouse', 'Screened',
  'Stored', 'Loaded to Airport Truck', 'In Transit to Airport', 'Received at Airport', 'Handed to Airline',
  'Loaded on Aircraft',
];

export const RESOLUTION_OPTIONS = ['BSM corrected', 'Pilgrim record corrected', 'Cannot resolve — reject'];
export const REJECT_REASONS = ['No BSM', 'PNR cannot be resolved', 'Weight discrepancy', 'Damaged beyond acceptance', 'Security hold', 'Other'];

const HOLD_LAYOUT = [
  { row: 11, x: 60 }, { row: 21, x: 280 }, { row: 31, x: 500 },
];

function buildConfig() {
  return { bsmWeightToleranceKg: 1.0, uldCapacity: 40, cutoffMinutesBeforeStd: 45 };
}

function buildStaff() {
  return [
    { id: 'AL-GA-01', employeeId: 'AL-GA-01', name: 'Dewi', pin: '1234', airline: 'GA', airlineName: 'Garuda Indonesia', scope: 'airline' },
    { id: 'AL-PK-01', employeeId: 'AL-PK-01', name: 'Usman', pin: '1234', airline: 'PK', airlineName: 'Pakistan International', scope: 'airline' },
    { id: 'GH-001', employeeId: 'GH-001', name: 'Fahad', pin: '1234', airline: null, airlineName: 'Ground Handler', scope: 'all' },
  ];
}

function buildVehicles() {
  return [
    { id: 'DOL-01', code: 'DOL-01', batchId: null },
    { id: 'DOL-02', code: 'DOL-02', batchId: 'AHO-000201' },
    { id: 'DOL-03', code: 'DOL-03', batchId: null },
  ];
}

function buildMakeupPositions() {
  return Array.from({ length: 8 }, (_, i) => {
    const code = `MU-${i + 1}`;
    return { code, batchId: code === 'MU-3' ? 'AHO-000201' : null };
  });
}

function buildHoldPositions() {
  const positions = [];
  for (const { row, x } of HOLD_LAYOUT) {
    positions.push({ code: `${row}L`, x, y: 40, uldId: null });
    positions.push({ code: `${row}R`, x, y: 120, uldId: null });
  }
  return positions;
}

function buildFlights() {
  return [
    {
      code: 'GA 983', airline: 'GA', origin: 'JED', destination: 'CGK', std: hoursFromNow(6),
      aircraft: 'B777-300ER', tailNumber: 'PK-GIK', stand: '14', status: 'Open', departedAt: null,
      closedAt: null, holdPositions: buildHoldPositions(),
    },
    {
      code: 'GA 981', airline: 'GA', origin: 'JED', destination: 'SUB', std: hoursFromNow(9),
      aircraft: 'A330-300', tailNumber: 'PK-GPC', stand: '9', status: 'Open', departedAt: null,
      closedAt: null, holdPositions: buildHoldPositions(),
    },
    {
      code: 'PK 760', airline: 'PK', origin: 'JED', destination: 'LHE', std: hoursFromNow(10),
      aircraft: 'B777-200ER', tailNumber: 'AP-BMG', stand: '21', status: 'Open', departedAt: null,
      closedAt: null, holdPositions: buildHoldPositions(),
    },
  ];
}

function pilgrim(id, name, nationality, groupName, pnr) {
  return { id, name, nationality, groupName, pnr };
}

function bag(id, tagNumber, airlineTagNumber, pilgrimId, batchId, flightCode, weightKg) {
  return {
    id, tagNumber, airlineTagNumber, pilgrimId, batchId, flightCode,
    status: 'In Transit to Airport', weightKg,
    scannedAt: null, verified: null, verificationNote: null,
    rejected: false, rejectReason: null,
    uldId: null, holdPosition: null,
    timeline: [
      { stage: 'Declared', time: hoursAgo(30), result: 'ok' },
      { stage: 'Checked-in', time: hoursAgo(29), result: 'ok' },
      { stage: 'Tagged', time: hoursAgo(29), result: 'ok' },
      { stage: 'Loaded to Collection Truck', time: hoursAgo(27), result: 'ok' },
      { stage: 'Received at Warehouse', time: hoursAgo(26), result: 'ok' },
      { stage: 'Screened', time: hoursAgo(25), result: 'ok' },
      { stage: 'Stored', time: hoursAgo(24), result: 'ok' },
      { stage: 'Loaded to Airport Truck', time: hoursAgo(2), result: 'ok' },
      { stage: 'In Transit to Airport', time: hoursAgo(1), result: 'ok' },
    ],
  };
}

function bsm(id, flightCode, std, destination, classOfService, airlineTag, pnr, passengerName, weightKg) {
  return {
    id, flightCode, std, destination, classOfService, airlineTag, pnr, passengerName, weightKg,
    active: true, deletedReason: null, receivedAt: hoursAgo(5),
  };
}

function buildBatch() {
  const pilgrims = [
    pilgrim('PIL-SITI', 'Siti Rahmawati', 'Indonesian', 'Jakarta Group 4', 'ABC101'),
    pilgrim('PIL-FATIMAH', 'Fatimah Zahra', 'Indonesian', 'Jakarta Group 4', 'ABC102'),
    pilgrim('PIL-HASSAN', 'Hassan Ibrahim', 'Egyptian', 'Cairo Group 1', 'ABC103'),
    pilgrim('PIL-AISYAH', 'Nur Aisyah', 'Malaysian', 'KL Group 7', 'ABC104'),
    pilgrim('PIL-JUNAID', 'Junaid Akhtar', 'Pakistani', 'Lahore Group 2', 'ABC105'),
    pilgrim('PIL-HUDA', 'Huda Mansour', 'Egyptian', 'Cairo Group 1', 'ABC106'),
    pilgrim('PIL-HENDRA', 'Hendra Wijaya', 'Indonesian', 'Jakarta Group 4', 'ABC12E'),
    pilgrim('PIL-RAHIM', 'Rahim Saleh', 'Indonesian', 'Jakarta Group 4', 'ABC107'),
  ];

  const bags = [
    bag('AHO1-BAG-1', 'RBL-D-000401', '1266100001', 'PIL-SITI', 'AHO-000201', 'GA 983', 22.0),
    bag('AHO1-BAG-2', 'RBL-D-000402', '1266100002', 'PIL-FATIMAH', 'AHO-000201', 'GA 983', 20.5),
    bag('AHO1-BAG-3', 'RBL-D-000403', '1266100003', 'PIL-HASSAN', 'AHO-000201', 'GA 983', 23.2),
    bag('AHO1-BAG-4', 'RBL-D-000404', '1266100004', 'PIL-AISYAH', 'AHO-000201', 'GA 983', 19.8),
    bag('AHO1-BAG-5', 'RBL-D-000405', '1266100005', 'PIL-JUNAID', 'AHO-000201', 'GA 983', 24.1),
    bag('AHO1-BAG-6', 'RBL-D-000406', '1266100006', 'PIL-HUDA', 'AHO-000201', 'GA 983', 21.3),
    bag('AHO1-BAG-7', 'RBL-D-000407', '1266100007', 'PIL-HENDRA', 'AHO-000201', 'GA 983', 22.7),
    bag('AHO1-BAG-8', 'RBL-D-000408', '1266100008', 'PIL-RAHIM', 'AHO-000201', 'GA 983', 20.0),
  ];

  const bsms = [
    bsm('BSM-1', 'GA 983', hoursFromNow(6), 'CGK', 'Y', '1266100001', 'ABC101', 'RAHMAWATI/SITI', 22.0),
    bsm('BSM-2', 'GA 983', hoursFromNow(6), 'CGK', 'Y', '1266100002', 'ABC102', 'ZAHRA/FATIMAH', 20.5),
    bsm('BSM-3', 'GA 983', hoursFromNow(6), 'CGK', 'Y', '1266100003', 'ABC103', 'IBRAHIM/HASSAN', 23.2),
    bsm('BSM-4', 'GA 983', hoursFromNow(6), 'CGK', 'Y', '1266100004', 'ABC104', 'AISYAH/NUR', 19.8),
    bsm('BSM-5', 'GA 983', hoursFromNow(6), 'CGK', 'Y', '1266100005', 'ABC105', 'AKHTAR/JUNAID', 24.1),
    bsm('BSM-6', 'GA 983', hoursFromNow(6), 'CGK', 'Y', '1266100006', 'ABC106', 'MANSOUR/HUDA', 21.3),
    // BSM-7 (for bag 7 / Hendra Wijaya) carries the wrong PNR — "ABC12D" instead of his real booking "ABC12E".
    bsm('BSM-7', 'GA 983', hoursFromNow(6), 'CGK', 'Y', '1266100007', 'ABC12D', 'WIJAYA/HENDRA', 22.7),
    // Bag 8 (Rahim Saleh) has no BSM at all yet.
  ];

  const batch = {
    id: 'AHO-000201', flightCode: 'GA 983', vehicleId: 'DOL-02', mu: 'MU-3',
    status: 'Pending Airline', sentAt: minutesAgo(18), acknowledgedAt: null, directedAt: null,
    bagIds: bags.map((b) => b.id),
    acceptedAt: null, rejectedAt: null, rejectReason: null,
    receiverName: null, signatureDataUrl: null, acceptedCount: 0, rejectedCount: 0,
  };

  return { pilgrims, bags, bsms, batches: [batch] };
}

function buildUlds() {
  const ga = Array.from({ length: 6 }, (_, i) => ({
    id: `AKE1000${i + 1}GA`, code: `AKE1000${i + 1}GA`, type: 'AKE', flightCode: null,
    status: 'Empty', bagIds: [], closedAt: null, loadedAt: null, position: null,
  }));
  const pk = Array.from({ length: 3 }, (_, i) => ({
    id: `AKE2000${i + 1}PK`, code: `AKE2000${i + 1}PK`, type: 'AKE', flightCode: null,
    status: 'Empty', bagIds: [], closedAt: null, loadedAt: null, position: null,
  }));
  return [...ga, ...pk];
}

function buildNotifications() {
  return [
    { id: 'N1', title: 'Handover ready', body: 'AHO-000201 (GA 983, 8 bags) is waiting to be acknowledged.', time: minutesAgo(18), unread: true, link: '#/inbox' },
    { id: 'N2', title: 'Cut-off approaching', body: 'GA 983 baggage cut-off is in under an hour.', time: minutesAgo(5), unread: false, link: '#/manifest' },
  ];
}

export function createSeed() {
  const { pilgrims, bags, bsms, batches } = buildBatch();
  return {
    session: null,
    demoMode: false,
    demoForceFail: false,
    dcsOffline: false,
    config: buildConfig(),
    staff: buildStaff(),
    vehicles: buildVehicles(),
    makeupPositions: buildMakeupPositions(),
    flights: buildFlights(),
    pilgrims,
    bags,
    bsms,
    batches,
    ulds: buildUlds(),
    exceptions: [],
    dcsLog: [],
    notifications: buildNotifications(),
    handoverNotes: [],
  };
}
