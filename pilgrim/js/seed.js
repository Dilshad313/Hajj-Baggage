/**
 * Mock data for the Pilgrim app. The seven demo pilgrim personas are
 * hand-specified to match the product brief, each illustrating a different
 * point in the departure or arrival journey; everything incidental
 * (addresses, hours, scan locations) is filled in deterministically.
 */

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();
const minutesFromNow = (m) => new Date(NOW + m * 60000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);
const hoursFromNow = (h) => minutesFromNow(h * 60);
const daysFromNow = (d) => minutesFromNow(d * 24 * 60);
const daysAgo = (d) => minutesAgo(d * 24 * 60);

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

export const SUPPORT_SUBJECTS = ['Missing bag', 'Damaged bag', 'Booking question', 'Delivery question', 'Other'];

function buildConfig() {
  return {
    maxBagKg: 23, maxBags: 2, slotMinutes: 15, slotCapacity: 6, closeHoursBeforeCutoff: 4,
    supportPhone: '+966 800 000 0000',
  };
}

function buildFlights() {
  return [
    { code: 'GA 981', origin: 'JED', destination: 'CGK', direction: 'departure', std: daysFromNow(3), status: 'Open' },
    { code: 'PK 760', origin: 'JED', destination: 'LHE', direction: 'departure', std: daysFromNow(2), status: 'Open' },
    { code: 'BG 136', origin: 'JED', destination: 'DAC', direction: 'departure', std: daysFromNow(1), status: 'Open' },
    { code: 'XY 801', origin: 'MED', destination: 'KAN', direction: 'departure', std: daysAgo(1), status: 'Departed' },
    { code: 'SV 817', origin: 'CGK', destination: 'JED', direction: 'arrival', std: hoursAgo(5), status: 'Arrived' },
    { code: 'PK 741', origin: 'LHE', destination: 'MED', direction: 'arrival', std: hoursAgo(2), status: 'Landed' },
  ];
}

function buildCentres() {
  return [
    { id: 'CTR-AZIZIYAH', name: 'Aziziyah Check-in Centre', city: 'Makkah', address: 'King Faisal Rd, Al Aziziyah, Makkah', hours: '08:00–20:00' },
    { id: 'CTR-ALAWALI', name: 'Al-Awali Check-in Centre', city: 'Makkah', address: 'Al Awali District, Makkah', hours: '08:00–20:00' },
    { id: 'CTR-MADINAH', name: 'Madinah Central Check-in Centre', city: 'Madinah', address: 'Central District, Madinah', hours: '08:00–20:00' },
  ];
}

function buildHotels() {
  return [
    { id: 'HTL-SAFWA', name: 'Al-Safwa Hotel', buildings: ['A', 'B'] },
    { id: 'HTL-EIMAN', name: 'Dar Al-Eiman', buildings: ['A'] },
    { id: 'HTL-ANSAR', name: 'Al-Ansar Hotel', buildings: ['A'] },
  ];
}

function depTimeline(uptoIndex, startHoursAgo) {
  const events = [];
  for (let i = 0; i <= uptoIndex; i++) {
    const locations = ['Makkah', 'Makkah', 'Makkah', 'Makkah', 'Warehouse — Makkah', 'Warehouse — Makkah',
      'Warehouse — Makkah', 'Warehouse — Makkah', 'En route to JED', 'Jeddah Airport', 'Jeddah Airport', 'Jeddah Airport'];
    const roles = ['Pilgrim', 'Check-in Staff', 'Check-in Staff', 'Warehouse Staff', 'Warehouse Staff', 'Warehouse Staff',
      'Warehouse Staff', 'Warehouse Staff', 'Driver', 'Airport Coordinator', 'Airport Coordinator', 'Airline / Ground Handler'];
    events.push({
      stage: DEPARTURE_STAGES[i],
      time: hoursAgo(startHoursAgo - i * (startHoursAgo / 12)),
      location: locations[i], role: roles[i], result: 'ok',
    });
  }
  return events;
}

function arrTimeline(uptoIndex, startHoursAgo) {
  const events = [];
  for (let i = 0; i <= uptoIndex; i++) {
    const locations = ['Jeddah Airport', 'Jeddah Airport', 'Jeddah Airport', 'Jeddah Airport', 'En route to hotel',
      'Hotel', 'Hotel', 'Hotel', 'Room', 'Room'];
    const roles = ['Airline / Ground Handler', 'Airport Coordinator', 'Airport Coordinator', 'Airport Coordinator', 'Driver',
      'Accommodation Receiving Staff', 'Accommodation Receiving Staff', 'Delivery Staff', 'Delivery Staff', 'Pilgrim'];
    events.push({
      stage: ARRIVAL_STAGES[i],
      time: hoursAgo(startHoursAgo - i * (startHoursAgo / 10)),
      location: locations[i], role: roles[i], result: 'ok',
    });
  }
  return events;
}

function bag(id, tagNumber, pilgrimId, bookingId, direction, flightCode, weightKg, status, timeline) {
  return { id, tagNumber, pilgrimId, bookingId, direction, flightCode, weightKg, status, timeline, exceptionId: null };
}

function booking(id, pilgrimId, flightCode, bagCount, bagWeights, centreId, date, time, status, createdAt) {
  return {
    id, pilgrimId, serviceType: 'City Check-in', flightCode, bagCount, bagWeights,
    centreId, slot: { date, time }, status, createdAt, qrCode: id,
  };
}

function pilgrim(opts) {
  return {
    id: opts.id, nusukId: opts.nusukId, passport: opts.passport, firstName: opts.firstName, lastName: opts.lastName,
    group: opts.group, agency: opts.agency, phone: opts.phone,
    flightCode: opts.flightCode || null, arrivalFlightCode: opts.arrivalFlightCode || null,
    hotel: opts.hotel || null,
  };
}

function buildPilgrims() {
  return [
    pilgrim({ id: 'PIL-SITI', nusukId: '1000000001', passport: 'C1234567', firstName: 'Siti', lastName: 'Rahmawati', group: 'Jakarta Group 4', agency: 'Al-Noor Travel', phone: '+966501110001', flightCode: 'GA 981' }),
    pilgrim({ id: 'PIL-ASIF', nusukId: '1000000002', passport: 'AB7654321', firstName: 'Asif', lastName: 'Khan', group: 'Lahore Group 2', agency: 'Baitullah Tours', phone: '+966501110002', flightCode: 'PK 760' }),
    pilgrim({ id: 'PIL-KARIM', nusukId: '1000000003', passport: 'BX0987654', firstName: 'Karim', lastName: 'Haddad', group: 'Cairo Group 1', agency: 'Nile Hajj Services', phone: '+966501110003', flightCode: 'PK 760' }),
    pilgrim({ id: 'PIL-FATIMA', nusukId: '1000000004', passport: 'A09876543', firstName: 'Fatima', lastName: 'Zahra', group: 'Jakarta Group 4', agency: 'Al-Noor Travel', phone: '+966501110004', flightCode: 'BG 136' }),
    pilgrim({ id: 'PIL-AISYAH', nusukId: '1000000005', passport: 'C7654321', firstName: 'Nur', lastName: 'Aisyah', group: 'KL Group 7', agency: 'Mekkah Mabrur', phone: '+966501110005', arrivalFlightCode: 'SV 817', hotel: { id: 'HTL-SAFWA', name: 'Al-Safwa Hotel', building: 'B', room: 'B-207', address: 'Central Area, Makkah' } }),
    pilgrim({ id: 'PIL-AHMED', nusukId: '1000000006', passport: 'AB1234567', firstName: 'Ahmed', lastName: 'Bashir', group: 'Lahore Group 2', agency: 'Baitullah Tours', phone: '+966501110006', arrivalFlightCode: 'PK 741', hotel: { id: 'HTL-EIMAN', name: 'Dar Al-Eiman', building: 'A', room: 'A-512', address: 'Central Area, Madinah' } }),
    pilgrim({ id: 'PIL-HASSAN', nusukId: '1000000007', passport: 'A01234567', firstName: 'Hassan', lastName: 'Ibrahim', group: 'Cairo Group 1', agency: 'Nile Hajj Services', phone: '+966501110007', arrivalFlightCode: 'SV 817', hotel: { id: 'HTL-ANSAR', name: 'Al-Ansar Hotel', building: 'A', room: 'A-118', address: 'Central Area, Makkah' } }),
  ];
}

export function createSeed() {
  const pilgrims = buildPilgrims();

  const bookings = [
    booking('APT-100021', 'PIL-ASIF', 'PK 760', 2, [22.0, 20.5], 'CTR-AZIZIYAH', daysAgo(1).slice(0, 10), '10:30', 'Checked-in', daysAgo(3)),
    booking('APT-100022', 'PIL-KARIM', 'PK 760', 1, [21.0], 'CTR-AZIZIYAH', daysAgo(1).slice(0, 10), '11:00', 'Checked-in', daysAgo(3)),
    booking('APT-100023', 'PIL-FATIMA', 'BG 136', 2, [19.5, 23.0], 'CTR-AZIZIYAH', daysAgo(2).slice(0, 10), '09:15', 'Checked-in', daysAgo(4)),
  ];

  const bags = [
    bag('BAG-ASIF-1', 'RBL-D-000401', 'PIL-ASIF', 'APT-100021', 'departure', 'PK 760', 22.0, 'Stored', depTimeline(6, 30)),
    bag('BAG-ASIF-2', 'RBL-D-000402', 'PIL-ASIF', 'APT-100021', 'departure', 'PK 760', 20.5, 'In Transit to Airport', depTimeline(8, 30)),
    bag('BAG-KARIM-1', 'RBL-D-000403', 'PIL-KARIM', 'APT-100022', 'departure', 'PK 760', 21.0, 'Received at Warehouse', depTimeline(4, 28)),
    bag('BAG-FATIMA-1', 'RBL-D-000404', 'PIL-FATIMA', 'APT-100023', 'departure', 'BG 136', 19.5, 'Loaded on Aircraft', depTimeline(11, 48)),
    bag('BAG-FATIMA-2', 'RBL-D-000405', 'PIL-FATIMA', 'APT-100023', 'departure', 'BG 136', 23.0, 'Loaded on Aircraft', depTimeline(11, 48)),
    bag('BAG-AISYAH-1', 'RBL-B-000501', 'PIL-AISYAH', null, 'arrival', 'SV 817', 21.5, 'Delivered', arrTimeline(9, 7)),
    bag('BAG-AISYAH-2', 'RBL-B-000502', 'PIL-AISYAH', null, 'arrival', 'SV 817', 20.0, 'Out for Delivery', arrTimeline(7, 7)),
    bag('BAG-AHMED-1', 'RBL-B-000503', 'PIL-AHMED', null, 'arrival', 'PK 741', 22.5, 'In Transit to Accommodation', arrTimeline(4, 3)),
    bag('BAG-AHMED-2', 'RBL-B-000504', 'PIL-AHMED', null, 'arrival', 'PK 741', 18.0, 'In Transit to Accommodation', arrTimeline(4, 3)),
    bag('BAG-HASSAN-1', 'RBL-B-000505', 'PIL-HASSAN', null, 'arrival', 'SV 817', 20.5, 'Delivered', arrTimeline(9, 7)),
    bag('BAG-HASSAN-2', 'RBL-B-000506', 'PIL-HASSAN', null, 'arrival', 'SV 817', 19.0, 'Received at Airport', arrTimeline(1, 6)),
  ];

  const exceptions = [
    {
      id: 'EXC-100001', type: 'Missing Bag', severity: 'Medium', status: 'Open',
      bagId: 'BAG-KARIM-1', pilgrimId: 'PIL-KARIM', note: 'Bag not located after warehouse screening — investigating.',
      createdAt: hoursAgo(20), resolvedAt: null, resolutionOutcome: null,
    },
  ];
  bags.find((b) => b.id === 'BAG-KARIM-1').exceptionId = 'EXC-100001';

  const tickets = [
    {
      id: 'TCK-200001', pilgrimId: 'PIL-KARIM', subject: 'Missing bag', bagId: 'BAG-KARIM-1', status: 'In Progress',
      createdAt: hoursAgo(20),
      messages: [
        { from: 'pilgrim', text: 'My bag RBL-D-000403 has not moved since yesterday. Please check.', at: hoursAgo(20) },
        { from: 'support', text: 'Thank you for reporting this — our warehouse team is locating your bag now. We will update you shortly.', at: hoursAgo(18) },
      ],
    },
  ];

  const receipts = [
    {
      id: 'RCP-300001', bookingId: 'APT-100021', receiptNo: 'RCP-300001', centreName: 'Aziziyah Check-in Centre',
      staffName: 'Faisal (Check-in Staff)', generatedAt: daysAgo(1), bagIds: ['BAG-ASIF-1', 'BAG-ASIF-2'],
    },
    {
      id: 'RCP-300002', bookingId: 'APT-100022', receiptNo: 'RCP-300002', centreName: 'Aziziyah Check-in Centre',
      staffName: 'Faisal (Check-in Staff)', generatedAt: daysAgo(1), bagIds: ['BAG-KARIM-1'],
    },
    {
      id: 'RCP-300003', bookingId: 'APT-100023', receiptNo: 'RCP-300003', centreName: 'Aziziyah Check-in Centre',
      staffName: 'Imran (Check-in Staff)', generatedAt: daysAgo(2), bagIds: ['BAG-FATIMA-1', 'BAG-FATIMA-2'],
    },
  ];

  const ratings = [];

  const notifications = [
    { id: 'N1', pilgrimId: 'PIL-ASIF', title: 'Bag received at warehouse', body: 'RBL-D-000401 has been received and screened.', time: hoursAgo(26), unread: false, link: '#/bag/BAG-ASIF-1' },
    { id: 'N2', pilgrimId: 'PIL-ASIF', title: 'Bag in transit to airport', body: 'RBL-D-000402 is on its way to Jeddah Airport.', time: hoursAgo(2), unread: true, link: '#/bag/BAG-ASIF-2' },
    { id: 'N3', pilgrimId: 'PIL-KARIM', title: 'Issue with your bag', body: 'There is an issue with bag RBL-D-000403. Our team is on it.', time: hoursAgo(20), unread: true, link: '#/ticket/TCK-200001' },
    { id: 'N4', pilgrimId: 'PIL-FATIMA', title: 'Bags on board', body: 'Your bags are on board flight BG 136. Proceed to the airport without bags.', time: hoursAgo(12), unread: true, link: '#/track' },
    { id: 'N5', pilgrimId: 'PIL-AISYAH', title: 'Bag delivered to your room', body: 'RBL-B-000501 has been delivered to room B-207.', time: hoursAgo(1), unread: true, link: '#/bag/BAG-AISYAH-1' },
    { id: 'N6', pilgrimId: 'PIL-AHMED', title: 'Bags on the way to your hotel', body: 'Your bags are in transit to Dar Al-Eiman.', time: hoursAgo(1), unread: true, link: '#/arrival' },
    { id: 'N7', pilgrimId: 'PIL-HASSAN', title: 'Bag delivered to your room', body: 'RBL-B-000505 has been delivered to room A-118.', time: hoursAgo(3), unread: false, link: '#/bag/BAG-HASSAN-1' },
  ];

  return {
    session: null,
    demoMode: false,
    demoForceFail: false,
    config: buildConfig(),
    flights: buildFlights(),
    centres: buildCentres(),
    hotels: buildHotels(),
    pilgrims,
    bookings,
    bags,
    exceptions,
    tickets,
    receipts,
    ratings,
    notifications,
  };
}
