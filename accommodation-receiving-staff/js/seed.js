/**
 * Mock data for the Accommodation Receiving Staff console.
 * The two demo hotels/trips are hand-specified to match the product brief;
 * room lists and incidental details are generated deterministically.
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

/** Bag status lifecycle for arrival; this app only drives Expected → Out for Delivery. */
export const ARRIVAL_STAGES = [
  'Expected', 'Received at Airport', 'Security Checked', 'Loaded to Truck', 'In Transit to Accommodation',
  'Received at Accommodation', 'Sorted', 'Out for Delivery', 'Delivered', 'Confirmed by Pilgrim',
];

export const DAMAGE_TYPES = ['Torn / ripped', 'Wheel broken', 'Handle broken', 'Zipper broken', 'Water damage', 'Crushed', 'Other'];
export const DAMAGE_SEVERITIES = ['Minor', 'Major'];
export const INVESTIGATE_CHECKLIST = [
  'Re-checked unloading bay and truck bed',
  'Checked nearby trolleys and hold area',
  'Confirmed tag number against the manifest',
  'Contacted the driver for confirmation',
];
export const PROXY_RELATIONS = ['Group leader', 'Family member', 'Roommate'];

function buildConfig() {
  return { trolleyDefaultCapacity: 12, maxActiveRunsPerLead: 2 };
}

function buildStaff() {
  return [
    { id: 'ACC-001', employeeId: 'ACC-001', name: 'Hafsa', pin: '1234', hotel: 'Al-Safwa Hotel' },
    { id: 'ACC-002', employeeId: 'ACC-002', name: 'Rashid', pin: '1234', hotel: 'Dar Al-Eiman' },
  ];
}

const DELIVERY_STAFF_NAMES = ['Sameer', 'Abdul Rahman', 'Idris'];

function buildRooms(buildingKey, floors, roomsPerFloor) {
  const rooms = [];
  for (let f = 1; f <= floors; f++) {
    for (let r = 1; r <= roomsPerFloor; r++) {
      rooms.push(`${buildingKey}-${f}${String(r).padStart(2, '0')}`);
    }
  }
  return rooms;
}

function buildHotels() {
  return [
    {
      code: 'SAFWA', name: 'Al-Safwa Hotel',
      buildings: {
        A: { floors: 10, rooms: buildRooms('A', 10, 6) },
        B: { floors: 10, rooms: buildRooms('B', 10, 6) },
      },
      bays: ['ACC-SAFWA-BAY-1', 'ACC-SAFWA-BAY-2'],
    },
    {
      code: 'EIMAN', name: 'Dar Al-Eiman',
      buildings: { A: { floors: 6, rooms: buildRooms('A', 6, 6) } },
      bays: ['ACC-EIMAN-BAY-1'],
    },
    {
      code: 'ANSAR', name: 'Al-Ansar Hotel',
      buildings: { A: { floors: 5, rooms: buildRooms('A', 5, 6) } },
      bays: ['ACC-ANSAR-BAY-1'],
    },
  ];
}

function buildTeams() {
  return [
    { id: 'TEAM-A', name: 'Team A', hotel: 'Al-Safwa Hotel', building: 'A', leadName: 'Sameer', memberNames: ['Sameer', 'Hamza Malik', 'Junaid Shah'], active: true },
    { id: 'TEAM-B', name: 'Team B', hotel: 'Al-Safwa Hotel', building: 'B', leadName: 'Abdul Rahman', memberNames: ['Abdul Rahman', 'Rashid Qureshi'], active: true },
    { id: 'TEAM-E', name: 'Team E', hotel: 'Dar Al-Eiman', building: 'A', leadName: 'Idris', memberNames: ['Idris', 'Tariq Khan'], active: true },
  ];
}

function buildTrolleys() {
  const safwa = [1, 2, 3, 4].map((n) => ({
    id: `TR-SAFWA-${String(n).padStart(2, '0')}`, code: `TR-SAFWA-${String(n).padStart(2, '0')}`,
    hotel: 'Al-Safwa Hotel', capacity: 12,
    status: n === 4 ? 'Out of service' : 'Available',
    outOfServiceReason: n === 4 ? 'Wheel damaged' : null,
  }));
  const eiman = [1, 2].map((n) => ({
    id: `TR-EIMAN-${String(n).padStart(2, '0')}`, code: `TR-EIMAN-${String(n).padStart(2, '0')}`,
    hotel: 'Dar Al-Eiman', capacity: 12, status: 'Available', outOfServiceReason: null,
  }));
  return [...safwa, ...eiman];
}

function pilgrim(id, name, nationality, groupName, nusukId, passportLast4, phone, room, groupLeader) {
  return {
    id, name, nationality, groupName, nusukId, passportLast4, phone, room,
    groupLeaderName: groupLeader ? groupLeader.name : null,
    groupLeaderPhone: groupLeader ? groupLeader.phone : null,
  };
}

function bag(id, tagNumber, pilgrimId, tripId, hotel, building, room, opts = {}) {
  return {
    id, tagNumber, airlineTagNumber: `SV${Math.floor(100000 + Math.random() * 899999)}`,
    pilgrimId, tripId, hotel, building, room,
    status: opts.status || 'Expected',
    damaged: false, damageInfo: null,
    scannedAt: opts.scannedAt || null,
    sortedLane: null, runId: null, handoverScanned: false,
  };
}

function buildArrivalData() {
  const pilgrims = [
    pilgrim('PIL-SITI', 'Siti Rahmawati', 'Indonesian', 'Jakarta Group 4', 'NSK3310221', '7788', '+966501110001', 'A-305'),
    pilgrim('PIL-FATIMAH', 'Fatimah Zahra', 'Indonesian', 'Jakarta Group 4', 'NSK3310347', '4471', '+966501110002', 'A-306', { name: 'Hendra Wijaya', phone: '+966501119999' }),
    pilgrim('PIL-HASSAN', 'Hassan Ibrahim', 'Egyptian', 'Cairo Group 1', 'NSK7712044', '9981', '+966501110004', 'B-410'),
    pilgrim('PIL-AISYAH', 'Nur Aisyah', 'Malaysian', 'KL Group 7', 'NSK9981203', '6650', '+966501110005', 'B-411'),
    pilgrim('PIL-JUNAID', 'Junaid Akhtar', 'Pakistani', 'Lahore Group 2', 'NSK5521190', '2290', '+966501110003', 'A-512'),
    pilgrim('PIL-HUDA', 'Huda Mansour', 'Egyptian', 'Cairo Group 1', 'NSK7712088', '3301', '+966501110006', 'B-118'),
  ];

  // ---- TRP-A2002: en-route/arrived truck, 8 bags not yet unloaded ----
  const tripActive = {
    id: 'TRP-A2002', code: 'TRP-A2002', truckPlate: 'TRK-52', driverName: 'Yasir', driverPhone: '+966502220001',
    hotel: 'Al-Safwa Hotel', flightCode: 'SV 817', sealNumber: 'SL-88231',
    status: 'At Destination', eta: minutesAgo(2), arrivedAt: minutesAgo(2),
    bay: null, manualLog: null,
    from: [21.6796, 39.1565], to: [21.4187, 39.8260], position: [21.52, 39.45],
  };
  const bagsActive = [
    bag('A2002-BAG-1', 'RBL-A-000301', 'PIL-SITI', 'TRP-A2002', 'Al-Safwa Hotel', 'A', 'A-305'),
    bag('A2002-BAG-2', 'RBL-A-000302', 'PIL-SITI', 'TRP-A2002', 'Al-Safwa Hotel', 'A', 'A-305'),
    bag('A2002-BAG-3', 'RBL-A-000303', 'PIL-FATIMAH', 'TRP-A2002', 'Al-Safwa Hotel', 'A', 'A-306'),
    bag('A2002-BAG-4', 'RBL-A-000304', 'PIL-FATIMAH', 'TRP-A2002', 'Al-Safwa Hotel', 'A', 'A-306'),
    bag('A2002-BAG-5', 'RBL-A-000305', 'PIL-HASSAN', 'TRP-A2002', 'Al-Safwa Hotel', 'B', 'B-410'),
    bag('A2002-BAG-6', 'RBL-A-000306', 'PIL-HASSAN', 'TRP-A2002', 'Al-Safwa Hotel', 'B', 'B-410'),
    bag('A2002-BAG-7', 'RBL-A-000307', 'PIL-AISYAH', 'TRP-A2002', 'Al-Safwa Hotel', 'B', 'B-411'),
    bag('A2002-BAG-8', 'RBL-A-000311', 'PIL-AISYAH', 'TRP-A2002', 'Al-Safwa Hotel', 'B', 'B-411'),
  ];
  tripActive.bagIds = bagsActive.map((b) => b.id);

  // ---- TRP-A2001: already unloaded & verified, 4 bags ready to sort ----
  const tripDone = {
    id: 'TRP-A2001', code: 'TRP-A2001', truckPlate: 'TRK-41', driverName: 'Hamza Malik', driverPhone: '+966502220002',
    hotel: 'Al-Safwa Hotel', flightCode: 'PK 741', sealNumber: 'SL-77120',
    status: 'Unloaded', eta: hoursAgo(3), arrivedAt: hoursAgo(3),
    bay: 'ACC-SAFWA-BAY-1', manualLog: null,
    from: [21.6796, 39.1565], to: [21.4187, 39.8260], position: [21.4187, 39.8260],
  };
  const bagsDone = [
    bag('A2001-BAG-1', 'RBL-A-000201', 'PIL-JUNAID', 'TRP-A2001', 'Al-Safwa Hotel', 'A', 'A-512', { status: 'Received at Accommodation', scannedAt: hoursAgo(3) }),
    bag('A2001-BAG-2', 'RBL-A-000202', 'PIL-JUNAID', 'TRP-A2001', 'Al-Safwa Hotel', 'A', 'A-512', { status: 'Received at Accommodation', scannedAt: hoursAgo(3) }),
    bag('A2001-BAG-3', 'RBL-A-000203', 'PIL-HUDA', 'TRP-A2001', 'Al-Safwa Hotel', 'B', 'B-118', { status: 'Received at Accommodation', scannedAt: hoursAgo(3) }),
    bag('A2001-BAG-4', 'RBL-A-000204', 'PIL-HUDA', 'TRP-A2001', 'Al-Safwa Hotel', 'B', 'B-118', { status: 'Received at Accommodation', scannedAt: hoursAgo(3) }),
  ];
  tripDone.bagIds = bagsDone.map((b) => b.id);

  // ---- Upcoming scheduled trips for the incoming-trucks screen ----
  const tripsUpcoming = [
    {
      id: 'TRP-A2003', code: 'TRP-A2003', truckPlate: 'TRK-67', driverName: 'Rashid Qureshi', driverPhone: '+966502220003',
      hotel: 'Al-Safwa Hotel', flightCode: 'BG 136', sealNumber: 'SL-90044',
      status: 'En route', eta: minutesFromNow(12), arrivedAt: null, bay: null, manualLog: null,
      from: [21.6796, 39.1565], to: [21.4187, 39.8260], position: [21.58, 39.55], bagIds: [],
    },
    {
      id: 'TRP-A2004', code: 'TRP-A2004', truckPlate: 'TRK-73', driverName: 'Tariq Khan', driverPhone: '+966502220004',
      hotel: 'Dar Al-Eiman', flightCode: 'XY 801', sealNumber: 'SL-90077',
      status: 'En route', eta: minutesFromNow(48), arrivedAt: null, bay: null, manualLog: null,
      from: [21.6796, 39.1565], to: [21.42, 39.81], position: [21.55, 39.47], bagIds: [],
    },
  ];

  return { pilgrims, trips: [tripActive, tripDone, ...tripsUpcoming], bags: [...bagsActive, ...bagsDone] };
}

function buildNotifications() {
  return [
    { id: 'N1', title: 'Truck arriving soon', body: 'TRP-A2003 (TRK-67) arrives in about 12 minutes — prepare a bay.', time: minutesAgo(1), unread: true, link: '#/incoming' },
    { id: 'N2', title: 'Bags ready to sort', body: '4 bags received at Al-Safwa are ready for sorting.', time: hoursAgo(3), unread: false, link: '#/sorting' },
  ];
}

export function createSeed() {
  const { pilgrims, trips, bags } = buildArrivalData();
  return {
    session: null,
    demoMode: false,
    config: buildConfig(),
    staff: buildStaff(),
    deliveryStaffNames: DELIVERY_STAFF_NAMES,
    hotels: buildHotels(),
    teams: buildTeams(),
    trolleys: buildTrolleys(),
    pilgrims,
    trips,
    bags,
    runs: [],
    exceptions: [],
    unknownTrucks: [{ plate: 'TRK-98', note: 'Not found in today\'s schedule' }],
    notifications: buildNotifications(),
    boardLog: [],
    handoverNotes: [],
  };
}
