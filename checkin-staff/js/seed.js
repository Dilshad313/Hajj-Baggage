/**
 * Mock data for the Check-in Staff console.
 * Ten demo appointments are hand-specified to exercise every branch in the
 * product brief; only incidental details (timestamps) are generated.
 */

const NOW = Date.now();
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();
const minutesFromNow = (m) => new Date(NOW + m * 60000).toISOString();
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

/** Bag status lifecycle — departure (centre to airport). Check-in staff drive the first two stages. */
export const DEPARTURE_STAGES = [
  'Declared', 'Checked-in', 'Tagged', 'Loaded to Collection Truck', 'Received at Warehouse', 'Screened',
  'Stored', 'Loaded to Airport Truck', 'In Transit to Airport', 'Received at Airport', 'Handed to Airline',
  'Loaded on Aircraft',
];

export const CHECKIN_STEPS = ['QR', 'Identity', 'Nusuk', 'Bags', 'Receipt', 'Done'];
const STEP_INDEX = { qr: 1, identity: 2, nusuk: 3, bags: 4, receipt: 5, complete: 6 };
export function stepIndexOf(step) { return STEP_INDEX[step] || 1; }

export const SUPERVISOR_REASONS = ['Wrong centre override', 'Identity concern', 'Data mismatch override', 'Other'];

function buildConfig() {
  return { maxBagKg: 23, maxBags: 2, scaleMin: 1, scaleMax: 40, noShowGraceMin: 30, supervisorPin: '9999' };
}

function buildCentres() {
  return [
    { id: 'AZIZIYAH', name: 'Aziziyah' },
    { id: 'AL-AWALI', name: 'Al-Awali' },
    { id: 'MADINAH', name: 'Madinah' },
  ];
}

function buildStaff() {
  return [
    { id: 'CHK-001', employeeId: 'CHK-001', name: 'Omar', pin: '1234', homeCentre: 'AZIZIYAH', role: 'staff' },
    { id: 'CHK-002', employeeId: 'CHK-002', name: 'Yusuf', pin: '1234', homeCentre: 'AL-AWALI', role: 'staff' },
    { id: 'CHK-003', employeeId: 'CHK-003', name: 'Bilal', pin: '1234', homeCentre: 'MADINAH', role: 'staff' },
    { id: 'SUP-001', employeeId: 'SUP-001', name: 'Khalid', pin: '1234', homeCentre: 'AZIZIYAH', role: 'supervisor' },
  ];
}

function buildFlights() {
  return [
    { code: 'SV 1821', destCode: 'JED', closed: false },
    { code: 'SV 1944', destCode: 'JED', closed: false },
    { code: 'SV 2077', destCode: 'JED', closed: true },
  ];
}

function appt(id, opts) {
  return {
    id, pilgrimName: opts.name, nationality: opts.nationality, nusukId: opts.nusukId, passportNo: opts.passportNo,
    phone: opts.phone || '+966500000000', flightCode: opts.flightCode, declaredBags: opts.declaredBags,
    slotAt: opts.slotAt, centreId: opts.centreId || 'AZIZIYAH', status: opts.status || 'Booked',
    bookingCode: opts.bookingCode,
  };
}

function buildAppointments() {
  return [
    appt('APT-1', { name: 'Siti Rahmawati', nationality: 'Indonesian', nusukId: 'NSK1001001', passportNo: 'RB0010001', flightCode: 'SV 1821', declaredBags: 2, slotAt: minutesFromNow(10), bookingCode: 'BKSITI01' }),
    appt('APT-2', { name: 'Hassan Ibrahim', nationality: 'Egyptian', nusukId: 'NSK1001002', passportNo: 'RB0010002', flightCode: 'SV 1821', declaredBags: 1, slotAt: minutesAgo(45), bookingCode: 'BKHASN02' }),
    appt('APT-3', { name: 'Zainab Noor', nationality: 'Pakistani', nusukId: 'NSK1001003', passportNo: 'RB0010003', flightCode: 'SV 1944', declaredBags: 1, slotAt: minutesFromNow(30), centreId: 'AL-AWALI', bookingCode: 'BKZAIN03' }),
    appt('APT-4', { name: 'Rahmat Hidayat', nationality: 'Indonesian', nusukId: 'NSK1001004', passportNo: 'RB0010004', flightCode: 'SV 1821', declaredBags: 1, slotAt: minutesFromNow(50), bookingCode: 'BKRAHM04' }),
    appt('APT-5', { name: 'Abdul Karim', nationality: 'Indian', nusukId: 'NSK1001005', passportNo: 'BX0987645', flightCode: 'SV 1821', declaredBags: 2, slotAt: minutesFromNow(20), bookingCode: 'BKKARM05' }),
    appt('APT-6', { name: 'Yusuf Hamzah', nationality: 'Bangladeshi', nusukId: 'NSK1001006', passportNo: 'RB0010006', flightCode: 'SV 1821', declaredBags: 1, slotAt: minutesAgo(90), status: 'Checked-in', bookingCode: 'BKYHAM06' }),
    appt('APT-7', { name: 'Aisha Binte Zainal', nationality: 'Malaysian', nusukId: 'NSK1001007', passportNo: 'RB0010007', flightCode: 'SV 1944', declaredBags: 1, slotAt: minutesFromNow(60), status: 'Cancelled', bookingCode: 'BKAISH07' }),
    appt('APT-8', { name: 'Fatima Zahra', nationality: 'Iranian', nusukId: 'NSK1001008', passportNo: 'RB0010008', flightCode: 'SV 1821', declaredBags: 1, slotAt: hoursFromNow(26), bookingCode: 'BKFATM08' }),
    appt('APT-9', { name: 'Mohammed Tahir', nationality: 'Turkish', nusukId: 'NSK1001009', passportNo: 'RB0010009', flightCode: 'SV 2077', declaredBags: 1, slotAt: minutesFromNow(40), bookingCode: 'BKTAHR09' }),
    appt('APT-10', { name: 'Idris Suleiman', nationality: 'Sudanese', nusukId: 'NSK1001010', passportNo: 'RB0010010', flightCode: 'SV 1821', declaredBags: 2, slotAt: minutesFromNow(120), bookingCode: 'BKIDRS10' }),
  ];
}

function nusuk(nusukId, opts) {
  return {
    nusukId, name: opts.name, passportNo: opts.passportNo, nationality: opts.nationality,
    flightCode: opts.flightCode, visaStatus: opts.visaStatus || 'valid',
  };
}

function buildNusukRecords() {
  return [
    nusuk('NSK1001001', { name: 'Siti Rahmawati', passportNo: 'RB0010001', nationality: 'Indonesian', flightCode: 'SV 1821' }),
    nusuk('NSK1001002', { name: 'Hassan Ibrahim', passportNo: 'RB0010002', nationality: 'Egyptian', flightCode: 'SV 1821' }),
    nusuk('NSK1001003', { name: 'Zainab Noor', passportNo: 'RB0010003', nationality: 'Pakistani', flightCode: 'SV 1944' }),
    nusuk('NSK1001004', { name: 'Rahmat Hidayat', passportNo: 'RB0010004', nationality: 'Indonesian', flightCode: 'SV 1821', visaStatus: 'expired' }),
    nusuk('NSK1001005', { name: 'Abdul Karim', passportNo: 'BX0987654', nationality: 'Indian', flightCode: 'SV 1821' }),
    nusuk('NSK1001006', { name: 'Yusuf Hamzah', passportNo: 'RB0010006', nationality: 'Bangladeshi', flightCode: 'SV 1821' }),
    nusuk('NSK1001007', { name: 'Aisha Binte Zainal', passportNo: 'RB0010007', nationality: 'Malaysian', flightCode: 'SV 1944' }),
    nusuk('NSK1001008', { name: 'Fatima Zahra', passportNo: 'RB0010008', nationality: 'Iranian', flightCode: 'SV 1821' }),
    nusuk('NSK1001009', { name: 'Mohammed Tahir', passportNo: 'RB0010009', nationality: 'Turkish', flightCode: 'SV 2077' }),
    nusuk('NSK1001010', { name: 'Idris Suleiman', passportNo: 'RB0010010', nationality: 'Sudanese', flightCode: 'SV 1821' }),
  ];
}

/** The one appointment (APT-6) that is already fully checked in, with its finished session and bag. */
function buildCompletedSessionAndBags() {
  const session = {
    id: 'SESS-YH', appointmentId: 'APT-6', status: 'completed', step: 'complete',
    staffId: 'CHK-001', centreId: 'AZIZIYAH',
    identity: { ticks: { photo: true, document: true, name: true }, verifiedAt: minutesAgo(88), mismatchReason: null },
    nusuk: { checked: true, result: 'match', mismatchFields: [], checkedAt: minutesAgo(87) },
    bags: [{
      id: 'BAG-APT6-1', seq: 1, extra: false, status: 'logged',
      weight: 18.0, weighAccepted: true, overweightRepackCount: 0,
      tagNumber: 'RBTAG-APT6-1', printed: true, attached: true, verifyAttempts: 1, manualEntries: 0, logged: true,
    }],
    currentBagIndex: 0,
    receipt: { receiptNo: 'RCPT-APT-6', printed: true, handed: true, digital: false, generatedAt: minutesAgo(80) },
    exceptionIds: [], createdAt: minutesAgo(90), completedAt: minutesAgo(80), cancelledAt: null, cancelReason: null,
  };
  const bag = {
    id: 'BAG-APT6-1', appointmentId: 'APT-6', sessionId: 'SESS-YH', centreId: 'AZIZIYAH', flightCode: 'SV 1821',
    pilgrimName: 'Yusuf Hamzah', tagNumber: 'RBTAG-APT6-1', weightKg: 18.0, status: 'Tagged', cartId: null, truckId: null,
    timeline: [
      { at: minutesAgo(90), text: 'Pilgrim QR scanned.' },
      { at: minutesAgo(89), text: 'Identity verified.' },
      { at: minutesAgo(88), text: 'Nusuk check passed.' },
      { at: minutesAgo(85), text: 'Bag 1 weighed — 18.0 kg.' },
      { at: minutesAgo(84), text: 'Bag 1 tag generated — RBTAG-APT6-1.' },
      { at: minutesAgo(83), text: 'Bag 1 tag printed.' },
      { at: minutesAgo(82), text: 'Bag 1 tag verified.' },
      { at: minutesAgo(82), text: 'Bag 1 logged in system.' },
      { at: minutesAgo(80), text: 'Check-in complete — 1 bags.' },
    ],
  };
  const history = {
    sessionId: 'SESS-YH', appointmentId: 'APT-6', pilgrimName: 'Yusuf Hamzah', passportNo: 'RB0010006',
    bookingCode: 'BKYHAM06', completedAt: minutesAgo(80), bagsCount: 1, totalKg: 18.0,
    receiptNo: 'RCPT-APT-6', centreId: 'AZIZIYAH', tagNumbers: ['RBTAG-APT6-1'],
  };
  return { session, bag, history };
}

function buildCarts() {
  return [
    { id: 'CART-AZ-01', centreId: 'AZIZIYAH', status: 'Open', bagIds: [] },
    { id: 'CART-AZ-02', centreId: 'AZIZIYAH', status: 'Open', bagIds: [] },
  ];
}

function buildTrucks() {
  return [
    { id: 'TRK-12', status: 'Available', driverName: null, bagIds: [], cartIds: [], loadedAt: null, manifestId: null },
    { id: 'TRK-14', status: 'Available', driverName: null, bagIds: [], cartIds: [], loadedAt: null, manifestId: null },
    { id: 'TRK-31', status: 'Out of Service', driverName: null, bagIds: [], cartIds: [], loadedAt: null, manifestId: null },
  ];
}

function buildNotifications() {
  return [
    { id: 'N1', title: 'Shift reminder', body: 'Remember to submit a shift handover before you leave the counter.', time: minutesAgo(5), unread: true, link: '#/handover', critical: false },
  ];
}

export function createSeed() {
  const { session: completedSession, bag: completedBag, history: completedHistory } = buildCompletedSessionAndBags();
  return {
    session: null,
    demoMode: false,
    config: buildConfig(),
    centres: buildCentres(),
    staff: buildStaff(),
    flights: buildFlights(),
    appointments: buildAppointments(),
    nusukRecords: buildNusukRecords(),
    checkinSessions: [completedSession],
    bags: [completedBag],
    carts: buildCarts(),
    trucks: buildTrucks(),
    manifests: [],
    exceptions: [],
    shifts: [],
    notifications: buildNotifications(),
    checkinHistory: [completedHistory],
    handovers: [],
  };
}
