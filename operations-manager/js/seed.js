/**
 * Mock data for the Operations Manager console.
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

const rng = makeRng(7);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const int = (min, max) => Math.floor(rng() * (max - min + 1)) + min;

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();
const minutesFromNow = (m) => new Date(NOW + m * 60000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);
const hoursFromNow = (h) => minutesFromNow(h * 60);
const daysAgo = (d) => hoursAgo(d * 24);

export const DEPARTURE_STAGES = [
  'Declared', 'Checked-in', 'Tagged', 'Loaded to Collection Truck', 'Received at Warehouse',
  'Screened', 'Stored', 'Loaded to Airport Truck', 'In Transit to Airport', 'Received at Airport',
  'Handed to Airline', 'Loaded on Aircraft',
];

export const ARRIVAL_STAGES = [
  'Expected', 'Received at Airport', 'Security Checked', 'Loaded to Truck', 'In Transit to Accommodation',
  'Received at Accommodation', 'Sorted', 'Out for Delivery', 'Delivered', 'Confirmed by Pilgrim',
];

export const EXCEPTION_TYPES = [
  'Missing Bag', 'Extra Bag', 'Damaged Bag', 'Prohibited Items', 'Scan Failed', 'Unknown Truck',
  'Pilgrim Not Found', 'Data Mismatch', 'Overweight', 'Wrong Centre', 'Vehicle Issue', 'Count Mismatch',
  'Seal Mismatch', 'Security Hold', 'Handover Rejected', 'PNR Mismatch', 'No BSM', 'Weight Mismatch',
  'Unidentified Bag', 'Passenger Not Found', 'Delivery Refused', 'Missed Cut-off', 'Offloaded Bag',
  'Pilgrim Reported Missing',
];

export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
export const EXCEPTION_STATUSES = ['Open', 'Assigned', 'In Progress', 'Escalated', 'Resolved', 'Closed'];
export const TEAMS = ['Investigation', 'Claims', 'Security', 'IT Support', 'Transport', 'Supervisor'];
export const RAISED_BY_ROLES = [
  'Check-in Staff', 'Warehouse Staff', 'Driver', 'Airport Coordinator', 'Airline / Ground Handler',
  'Accommodation Receiving Staff', 'Delivery Staff', 'Pilgrim',
];
export const DISCREPANCY_OUTCOMES = ['Found & delivered', 'Lost — claim filed', 'Offloaded', 'Duplicate record', 'Other'];

/** @param {string} type @returns {string} auto-suggested team per the role's assignment rule */
export function suggestTeam(type) {
  if (type === 'Missing Bag' || type === 'Pilgrim Reported Missing' || type === 'Unidentified Bag') return 'Investigation';
  if (type === 'Damaged Bag') return 'Claims';
  if (type === 'Prohibited Items' || type === 'Security Hold') return 'Security';
  if (type === 'Scan Failed' || type === 'Data Mismatch' || type === 'No BSM') return 'IT Support';
  if (['Vehicle Issue', 'Unknown Truck', 'Missed Cut-off', 'Wrong Centre'].includes(type)) return 'Transport';
  return 'Supervisor';
}

const FIRST_NAMES = ['Omar', 'Yusuf', 'Bilal', 'Khalid', 'Faisal', 'Imran', 'Tariq', 'Naveed', 'Salman', 'Yasir',
  'Abdullah', 'Mariam', 'Dewi', 'Usman', 'Fahad', 'Hafsa', 'Rashid', 'Sameer', 'Abdul Rahman', 'Idris', 'Layla',
  'Zainab', 'Hamza', 'Noor', 'Aisha', 'Junaid', 'Siraj', 'Huda', 'Amina', 'Waleed'];
const LAST_NAMES = ['Al-Harbi', 'Rahman', 'Siddiqui', 'Khan', 'Al-Otaibi', 'Hussain', 'Malik', 'Farooq', 'Al-Shammari',
  'Qureshi', 'Chaudhry', 'Al-Zahrani', 'Baig', 'Niazi', 'Al-Ghamdi', 'Shah'];

function fullName() { return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`; }

/* ===================== Flights ===================== */

const MAKKAH_CENTRES = ['Aziziyah Check-in Centre', 'Al-Awali Check-in Centre'];
const MADINAH_CENTRES = ['Madinah Central Check-in Centre'];
const HOTELS = ['Al-Safwa Hotel', 'Dar Al-Eiman', 'Al-Ansar Hotel', 'Anwar Al Madinah Movenpick'];

function buildFlights() {
  const departureDefs = [
    { code: 'GA 981', route: 'JED → CGK', cutoffInMin: 95 },
    { code: 'GA 983', route: 'MED → CGK', cutoffInMin: 340 },
    { code: 'PK 760', route: 'JED → LHE', cutoffInMin: 48 },
    { code: 'BG 136', route: 'JED → DAC', cutoffInMin: 610 },
    { code: 'XY 801', route: 'MED → IST', cutoffInMin: 1180 },
  ];
  const arrivalDefs = [
    { code: 'SV 817', route: 'CGK → JED', landedMinAgo: 70 },
    { code: 'SV 819', route: 'LHE → MED', landedMinAgo: 310 },
    { code: 'PK 741', route: 'DAC → JED', landedMinAgo: 20 },
  ];

  const flights = [];
  for (const d of departureDefs) {
    const total = int(100, 400);
    const checkedIn = total;
    const receivedAtAirport = Math.round(total * (d.cutoffInMin < 100 ? 0.78 : 0.4));
    const loaded = d.cutoffInMin < 60 ? Math.round(receivedAtAirport * 0.9) : Math.round(receivedAtAirport * 0.5);
    flights.push({
      id: `F-${d.code.replace(/\s/g, '')}`,
      code: d.code,
      route: d.route,
      direction: 'departure',
      centre: pick([...MAKKAH_CENTRES, ...MADINAH_CENTRES]),
      cutoffAt: minutesFromNow(d.cutoffInMin),
      status: 'Open',
      priority: false,
      closed: false,
      totalBags: total,
      stageCounts: { checkedIn, atWarehouse: Math.round(total * 0.7), atAirport: receivedAtAirport, loaded },
      checkpoints: { a: checkedIn, b: receivedAtAirport, c: loaded },
      checkpointLabels: ['Checked-in', 'Received at Airport', 'Loaded on Aircraft'],
    });
  }
  for (const d of arrivalDefs) {
    const total = int(100, 400);
    const receivedAtAirport = Math.round(total * (d.landedMinAgo > 60 ? 0.96 : 0.55));
    const delivered = d.landedMinAgo > 200 ? Math.round(receivedAtAirport * 0.85) : Math.round(receivedAtAirport * 0.3);
    flights.push({
      id: `F-${d.code.replace(/\s/g, '')}`,
      code: d.code,
      route: d.route,
      direction: 'arrival',
      hotel: pick(HOTELS),
      landedAt: minutesAgo(d.landedMinAgo),
      status: 'Open',
      priority: false,
      closed: false,
      totalBags: total,
      stageCounts: { receivedAtAirport, atAccommodation: Math.round(receivedAtAirport * 0.7), delivered },
      checkpoints: { a: total, b: receivedAtAirport, c: delivered },
      checkpointLabels: ['Expected', 'Received at Airport', 'Delivered / Confirmed'],
    });
  }
  return flights;
}

/* ===================== Bags ===================== */

function stagesForDirection(direction) {
  return direction === 'departure' ? DEPARTURE_STAGES : ARRIVAL_STAGES;
}

function buildBagsForFlight(flight) {
  const bags = [];
  const stages = stagesForDirection(flight.direction);
  const n = Math.min(flight.totalBags, 60); // cap generated bag records per flight for a manageable demo dataset
  for (let i = 0; i < n; i++) {
    const progressIdx = int(1, stages.length - 1);
    const timeline = [];
    let t = int(400, 900);
    for (let s = 0; s <= progressIdx; s++) {
      t -= int(10, 60);
      const failed = rng() < 0.04;
      const manual = !failed && rng() < 0.05;
      timeline.push({
        stage: stages[s],
        time: minutesAgo(Math.max(t, 1)),
        location: flight.direction === 'departure' ? (flight.centre || 'Warehouse') : (flight.hotel || 'Airport'),
        role: pick(RAISED_BY_ROLES),
        result: failed ? 'failed' : manual ? 'manual' : 'ok',
      });
    }
    const tagNum = `RB${flight.code.replace(/\s/g, '')}${String(1000 + i)}`;
    bags.push({
      id: `BAG-${flight.id}-${i}`,
      tagNumber: tagNum,
      airlineTagNumber: `${flight.code.split(' ')[0]}${int(100000, 999999)}`,
      pilgrimName: fullName(),
      nusukId: `NSK${int(1000000, 9999999)}`,
      passport: `P${int(10000000, 99999999)}`,
      flightId: flight.id,
      flightCode: flight.code,
      direction: flight.direction,
      weightKg: Number((int(150, 320) / 10).toFixed(1)),
      currentStage: stages[progressIdx],
      currentHolder: progressIdx === stages.length - 1 ? null : { role: pick(RAISED_BY_ROLES), name: fullName() },
      timeline,
      hasException: false,
      stuckHours: progressIdx < stages.length - 1 ? Number((int(5, 400) / 100).toFixed(1)) : 0,
    });
  }
  return bags;
}

/* ===================== Exceptions ===================== */

function buildExceptions(flights, bags) {
  const exceptions = [];
  for (let i = 0; i < 40; i++) {
    const type = pick(EXCEPTION_TYPES);
    const severity = pick(SEVERITIES);
    const flight = pick(flights);
    const bag = rng() < 0.7 ? pick(bags.filter((b) => b.flightId === flight.id)) : null;
    const ageMin = int(5, 500);
    const status = ageMin > 400 ? pick(['Resolved', 'Closed', 'Escalated'])
      : ageMin > 90 ? pick(['Open', 'Assigned', 'In Progress', 'Escalated'])
        : pick(['Open', 'Open', 'Assigned']);
    const team = suggestTeam(type);
    const assigned = status !== 'Open';
    exceptions.push({
      id: `EXC-${2000 + i}`,
      time: minutesAgo(ageMin),
      type,
      severity,
      flightId: flight.id,
      flightCode: flight.code,
      bagId: bag ? bag.id : null,
      bagTag: bag ? bag.tagNumber : null,
      raisedByRole: pick(RAISED_BY_ROLES),
      status,
      team: assigned ? team : null,
      suggestedTeam: team,
      assignee: assigned ? fullName() : null,
      dueAt: assigned ? minutesFromNow(int(-30, 180)) : null,
      description: `${type} reported for ${bag ? bag.tagNumber : 'flight ' + flight.code} by ${pick(RAISED_BY_ROLES)}.`,
      notes: assigned ? [{ time: minutesAgo(Math.max(ageMin - 10, 1)), author: fullName(), text: `Investigating ${type.toLowerCase()}.` }] : [],
      escalated: status === 'Escalated',
      escalationReason: status === 'Escalated' ? 'No progress within SLA — needs senior visibility.' : null,
      resolutionNotes: (status === 'Resolved' || status === 'Closed') ? 'Verified and corrected at source; confirmed with team lead.' : null,
    });
    if (bag) bag.hasException = true;
  }
  return exceptions.sort((a, b) => new Date(b.time) - new Date(a.time));
}

/* ===================== Trucks / trips ===================== */

const LOCATIONS = {
  'Aziziyah Check-in Centre': [21.4100, 39.8350],
  'Al-Awali Check-in Centre': [21.3850, 39.8700],
  'Madinah Central Check-in Centre': [24.4700, 39.6100],
  'Makkah Warehouse 1': [21.4440, 39.8182],
  'Madinah Warehouse 1': [24.5100, 39.5850],
  'King Abdulaziz Intl (JED)': [21.6796, 39.1565],
  'Prince Mohammad bin Abdulaziz Intl (MED)': [24.5534, 39.7051],
  'Al-Safwa Hotel': [21.4187, 39.8260],
  'Dar Al-Eiman': [21.4175, 39.8240],
  'Al-Ansar Hotel': [24.4740, 39.6050],
};

function lerp(a, b, t) { return a + (b - a) * t; }

function buildTrips() {
  const routePairs = [
    ['Aziziyah Check-in Centre', 'Makkah Warehouse 1'],
    ['Al-Awali Check-in Centre', 'Makkah Warehouse 1'],
    ['Madinah Central Check-in Centre', 'Madinah Warehouse 1'],
    ['Makkah Warehouse 1', 'King Abdulaziz Intl (JED)'],
    ['Madinah Warehouse 1', 'Prince Mohammad bin Abdulaziz Intl (MED)'],
    ['King Abdulaziz Intl (JED)', 'Al-Safwa Hotel'],
    ['King Abdulaziz Intl (JED)', 'Dar Al-Eiman'],
    ['Prince Mohammad bin Abdulaziz Intl (MED)', 'Al-Ansar Hotel'],
  ];
  const drivers = ['Hamza Malik', 'Junaid Shah', 'Rashid Qureshi', 'Idris Baig', 'Sameer Niazi', 'Waleed Farooq', 'Tariq Khan', 'Imran Al-Harbi'];
  return routePairs.map((pair, i) => {
    const [fromName, toName] = pair;
    const from = LOCATIONS[fromName];
    const to = LOCATIONS[toName];
    const progress = rng() * 0.8 + 0.1;
    const delayed = i < 2;
    return {
      id: `TRP-${100 + i}`,
      driver: drivers[i],
      fromName, toName,
      from, to,
      position: [lerp(from[0], to[0], progress), lerp(from[1], to[1], progress)],
      progress,
      bags: int(20, 140),
      etaAt: delayed ? minutesAgo(int(10, 40)) : minutesFromNow(int(10, 90)),
      delayed,
      delayReason: delayed ? pick(['Heavy traffic on the ring road', 'Vehicle checkpoint delay', 'Mechanical inspection stop']) : null,
      contactLog: [],
    };
  });
}

/* ===================== KPI history ===================== */

function buildHistory() {
  const days = [];
  for (let d = 13; d >= 0; d--) {
    days.push({
      date: daysAgo(d).slice(0, 10),
      onTimePct: Number((92 + rng() * 7).toFixed(1)),
      avgHandlingMin: int(18, 42),
      exceptionsOpened: int(4, 14),
      exceptionsClosed: int(3, 13),
      damageRatePct: Number((rng() * 1.8).toFixed(2)),
      missingRatePct: Number((rng() * 0.9).toFixed(2)),
      deliverySuccessPct: Number((93 + rng() * 6).toFixed(1)),
    });
  }
  return days;
}

/* ===================== Activity feed ===================== */

function buildActivity(bags, exceptions) {
  const items = [];
  for (let i = 0; i < 16; i++) {
    const isException = rng() < 0.35;
    if (isException) {
      const e = pick(exceptions);
      items.push({ id: `ACT-${i}`, time: minutesAgo(int(0, 90)), kind: 'exception', text: `${e.type} raised on ${e.flightCode}${e.bagTag ? ' — ' + e.bagTag : ''}.` });
    } else {
      const b = pick(bags);
      items.push({ id: `ACT-${i}`, time: minutesAgo(int(0, 90)), kind: 'scan', text: `${b.tagNumber} scanned at ${b.currentStage} (${b.flightCode}).` });
    }
  }
  return items.sort((a, b) => new Date(b.time) - new Date(a.time));
}

export function createSeed() {
  const flights = buildFlights();
  let bags = [];
  for (const f of flights) bags = bags.concat(buildBagsForFlight(f));
  const exceptions = buildExceptions(flights, bags);
  const trips = buildTrips();
  const history = buildHistory();
  const activity = buildActivity(bags, exceptions);

  return {
    session: null,
    direction: 'departure',
    staff: { id: 'OPS-001', employeeId: 'OPS-001', name: 'Layla Al-Harthi', pin: '1234', role: 'Operations Manager' },
    flights,
    bags,
    exceptions,
    trips,
    history,
    activity,
    notifications: [
      { id: 'N1', title: 'Critical exception raised', body: 'Prohibited Items on GA 981 — needs review.', time: minutesAgo(6), unread: true, link: '#/exceptions', critical: true },
      { id: 'N2', title: 'Cut-off approaching', body: 'PK 760 cuts off in under 1 hour.', time: minutesAgo(15), unread: true, link: '#/cutoffs', critical: false },
      { id: 'N3', title: 'Truck delayed', body: 'TRP-100 is running behind schedule.', time: minutesAgo(40), unread: false, link: '#/trucks', critical: false },
    ],
    stakeholderLog: [],
    handoverNotes: [],
    reportsHistory: [],
  };
}
