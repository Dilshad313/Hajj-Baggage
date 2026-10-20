/**
 * Mock data for the Delivery Staff console.
 * The two demo runs are hand-specified to match the product brief exactly;
 * only incidental details (timestamps, ids) are generated.
 */

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();
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

/** Bag status lifecycle for the arrival flow, ending at the pilgrim. */
export const ARRIVAL_STAGES = [
  'Expected', 'Received at Airport', 'Security Checked', 'Loaded to Truck', 'In Transit to Accommodation',
  'Received at Accommodation', 'Sorted', 'Out for Delivery', 'Delivered', 'Confirmed by Pilgrim',
];

export const NOT_FOUND_REASONS = [
  'No answer', 'Pilgrim not in room', 'Wrong room / occupant denies', 'Do not disturb', 'Room locked / inaccessible',
];

export const RESOLUTION_OPTIONS = [
  { id: 'located', label: 'Pilgrim located — return to room' },
  { id: 'room-changed', label: 'Room changed' },
  { id: 'proxy', label: 'Deliver to authorised proxy' },
  { id: 'reattempt', label: 'Reattempt later' },
  { id: 'refused', label: 'Pilgrim refuses bag' },
];

export const PROXY_RELATIONS = ['Group leader', 'Family member', 'Roommate'];

function buildConfig() {
  return { maxAttempts: 3, reattemptAfterMin: 60, proxyRequiresPin: true, supervisorPin: '9999' };
}

function buildStaff() {
  return [
    { id: 'DLV-001', employeeId: 'DLV-001', name: 'Sameer', pin: '1234', hotel: 'Al-Safwa Hotel' },
    { id: 'DLV-002', employeeId: 'DLV-002', name: 'Abdul Rahman', pin: '1234', hotel: 'Al-Safwa Hotel' },
    { id: 'DLV-003', employeeId: 'DLV-003', name: 'Idris', pin: '1234', hotel: 'Dar Al-Eiman' },
  ];
}

function buildHotels() {
  return [
    {
      name: 'Al-Safwa Hotel',
      buildings: {
        A: { floors: [3, 5], rooms: ['A-301', 'A-302', 'A-305', 'A-306', 'A-510', 'A-512'] },
        B: { floors: [1, 2], rooms: ['B-110', 'B-118', 'B-201', 'B-207'] },
      },
    },
    { name: 'Dar Al-Eiman', buildings: { Main: { floors: [1], rooms: ['M-101', 'M-102'] } } },
  ];
}

/** @param {string} room e.g. "A-305" @returns {number} */
function floorOf(room) {
  const digits = room.split('-')[1];
  return Number(digits[0]);
}

function pilgrim(id, name, nationality, groupName, nusukId, passportLast4, phone, room, groupLeader) {
  return {
    id, name, nationality, groupName, nusukId, passportLast4, phone, room,
    groupLeaderName: groupLeader ? groupLeader.name : null,
    groupLeaderPhone: groupLeader ? groupLeader.phone : null,
  };
}

function bag(id, tagNumber, pilgrimId, stopId, runId, opts = {}) {
  return {
    id, tagNumber, pilgrimId, stopId, runId,
    damaged: !!opts.damaged, damageNote: opts.damageNote || null,
    status: opts.status || 'On trolley',
    deliveredAt: null, deliveredTo: null, signatureDataUrl: null, witnessName: null,
  };
}

function stop(id, runId, room, building, opts = {}) {
  return {
    id, runId, room, building, floor: floorOf(room),
    pilgrimIds: opts.pilgrimIds || [],
    bagIds: opts.bagIds || [],
    status: opts.status || 'Pending',
    attempts: [],
    resolution: null,
    skippedReason: null,
    deliveredAt: null,
  };
}

function buildDemoRuns() {
  const pilgrims = [
    pilgrim('PIL-SITI', 'Siti Rahmawati', 'Indonesian', 'Jakarta Group 4', 'NSK3310221', '7788', '+966501110001', 'A-305'),
    pilgrim('PIL-FATIMAH', 'Fatimah Zahra', 'Indonesian', 'Jakarta Group 4', 'NSK3310347', '4471', '+966501110002', 'A-306',
      { name: 'Hendra Wijaya', phone: '+966501119999' }),
    pilgrim('PIL-JUNAID', 'Junaid Akhtar', 'Pakistani', 'Lahore Group 2', 'NSK5521190', '2290', '+966501110003', 'A-512'),
    pilgrim('PIL-HASSAN', 'Hassan Ibrahim', 'Egyptian', 'Cairo Group 1', 'NSK7712044', '9981', '+966501110004', 'B-118'),
    pilgrim('PIL-AISYAH', 'Nur Aisyah', 'Malaysian', 'KL Group 7', 'NSK9981203', '6650', '+966501110005', 'B-207'),
  ];

  // ---- DA-DEMO-01 — Al-Safwa, Building A, Sameer, not yet started ----
  const stopsA = [
    stop('DA-DEMO-01-STOP-1', 'DA-DEMO-01', 'A-305', 'A', { pilgrimIds: ['PIL-SITI'], bagIds: ['DA1-BAG-1', 'DA1-BAG-2'] }),
    stop('DA-DEMO-01-STOP-2', 'DA-DEMO-01', 'A-306', 'A', { pilgrimIds: ['PIL-FATIMAH'], bagIds: ['DA1-BAG-3', 'DA1-BAG-4'] }),
    stop('DA-DEMO-01-STOP-3', 'DA-DEMO-01', 'A-512', 'A', { pilgrimIds: ['PIL-JUNAID'], bagIds: ['DA1-BAG-5', 'DA1-BAG-6'] }),
  ];
  const bagsA = [
    bag('DA1-BAG-1', 'RB-A305-01', 'PIL-SITI', 'DA-DEMO-01-STOP-1', 'DA-DEMO-01'),
    bag('DA1-BAG-2', 'RB-A305-02', 'PIL-SITI', 'DA-DEMO-01-STOP-1', 'DA-DEMO-01', { status: 'In hold (missing)' }),
    bag('DA1-BAG-3', 'RB-A306-01', 'PIL-FATIMAH', 'DA-DEMO-01-STOP-2', 'DA-DEMO-01'),
    bag('DA1-BAG-4', 'RB-A306-02', 'PIL-FATIMAH', 'DA-DEMO-01-STOP-2', 'DA-DEMO-01', { damaged: true, damageNote: 'Wheel broken' }),
    bag('DA1-BAG-5', 'RB-A512-01', 'PIL-JUNAID', 'DA-DEMO-01-STOP-3', 'DA-DEMO-01'),
    bag('DA1-BAG-6', 'RB-A512-02', 'PIL-JUNAID', 'DA-DEMO-01-STOP-3', 'DA-DEMO-01'),
  ];
  const runA = {
    id: 'DA-DEMO-01', code: 'DA-DEMO-01', hotel: 'Al-Safwa Hotel', building: 'A', staffId: 'DLV-001',
    status: 'Notified', trolleyId: 'TR-SAFWA-01', trolleyPickedUp: false, trolleyReturned: false,
    trolleyDamaged: false, trolleyDamageReason: null,
    stopIds: stopsA.map((s) => s.id),
    createdAt: hoursAgo(1), startedAt: null, completedAt: null, notes: null,
  };

  // ---- DA-DEMO-02 — Al-Safwa, Building B, Abdul Rahman, already in progress ----
  const stopsB = [
    stop('DA-DEMO-02-STOP-1', 'DA-DEMO-02', 'B-118', 'B', { pilgrimIds: ['PIL-HASSAN'], bagIds: ['DA2-BAG-1', 'DA2-BAG-2'], status: 'Delivered' }),
    stop('DA-DEMO-02-STOP-2', 'DA-DEMO-02', 'B-207', 'B', { pilgrimIds: ['PIL-AISYAH'], bagIds: ['DA2-BAG-3'] }),
  ];
  stopsB[0].deliveredAt = minutesAgo(20);
  const bagsB = [
    bag('DA2-BAG-1', 'RB-B118-01', 'PIL-HASSAN', 'DA-DEMO-02-STOP-1', 'DA-DEMO-02', { status: 'Delivered' }),
    bag('DA2-BAG-2', 'RB-B118-02', 'PIL-HASSAN', 'DA-DEMO-02-STOP-1', 'DA-DEMO-02', { status: 'Delivered' }),
    bag('DA2-BAG-3', 'RB-B207-01', 'PIL-AISYAH', 'DA-DEMO-02-STOP-2', 'DA-DEMO-02', { status: 'Out for delivery' }),
  ];
  bagsB[0].deliveredAt = minutesAgo(20); bagsB[0].deliveredTo = 'Hassan Ibrahim';
  bagsB[1].deliveredAt = minutesAgo(20); bagsB[1].deliveredTo = 'Hassan Ibrahim';
  const runB = {
    id: 'DA-DEMO-02', code: 'DA-DEMO-02', hotel: 'Al-Safwa Hotel', building: 'B', staffId: 'DLV-002',
    status: 'In Progress', trolleyId: 'TR-SAFWA-02', trolleyPickedUp: true, trolleyReturned: false,
    trolleyDamaged: false, trolleyDamageReason: null,
    stopIds: stopsB.map((s) => s.id),
    createdAt: hoursAgo(3), startedAt: hoursAgo(2), completedAt: null, notes: null,
  };

  return {
    pilgrims,
    runs: [runA, runB],
    stops: [...stopsA, ...stopsB],
    bags: [...bagsA, ...bagsB],
  };
}

function buildAlerts() {
  return [
    { id: 'N1', title: 'New delivery run ready', body: 'DA-DEMO-01 is ready for pickup at Al-Safwa, Building A.', time: hoursAgo(1), unread: true, link: '#/run/DA-DEMO-01' },
    { id: 'N2', title: 'Run in progress', body: 'DA-DEMO-02 has 1 stop remaining.', time: hoursAgo(2), unread: false, link: '#/run/DA-DEMO-02' },
  ];
}

export function createSeed() {
  const { pilgrims, runs, stops, bags } = buildDemoRuns();
  return {
    session: null,
    demoMode: false,
    config: buildConfig(),
    staff: buildStaff(),
    hotels: buildHotels(),
    pilgrims,
    runs,
    stops,
    bags,
    exceptions: [],
    notifications: buildAlerts(),
    supervisorCallLog: [],
    runHistory: [],
  };
}
