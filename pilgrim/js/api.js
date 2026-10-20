/**
 * Mock REST API for the Pilgrim app. Every function is async, resolves
 * after a realistic delay, and can be made to reject via `?fail=1` or the
 * one-shot demo "force fail" flag. A real backend can replace this file
 * without the UI code changing.
 */
import { getStore, saveStore, resetStore, setSession, getSession } from './store.js';
import { DEPARTURE_STAGES, ARRIVAL_STAGES } from './seed.js';

const GLOBAL_FAIL = new URLSearchParams(location.search).get('fail') === '1';

function randomDelay() { return 300 + Math.random() * 400; }

function ok(value) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const store = getStore();
      if (GLOBAL_FAIL || store.demoForceFail) {
        store.demoForceFail = false;
        saveStore();
        reject(new ApiError('Simulated failure — the server could not complete this request.'));
        return;
      }
      resolve(value);
    }, randomDelay());
  });
}

function fail(message, code, extra) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const err = new ApiError(message, code);
      if (extra) Object.assign(err, extra);
      reject(err);
    }, randomDelay());
  });
}

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code || null; }
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function nowIso() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}${Math.floor(Math.random() * 900000 + 100000)}`; }

/* ===================== internal lookups ===================== */

function myPilgrim(store) {
  const session = getSession();
  if (!session) return null;
  return store.pilgrims.find((p) => p.id === session.id) || null;
}

function findFlight(store, code) { return store.flights.find((f) => f.code === code); }
function findCentre(store, id) { return store.centres.find((c) => c.id === id); }
function findBooking(store, id) { return store.bookings.find((b) => b.id === id); }
function findBag(store, id) { return store.bags.find((b) => b.id === id); }
function findTicket(store, id) { return store.tickets.find((t) => t.id === id); }
function findException(store, id) { return store.exceptions.find((e) => e.id === id); }

function maskPassport(passport) {
  const s = String(passport || '');
  return s.length <= 4 ? s : `${'•'.repeat(s.length - 4)}${s.slice(-4)}`;
}

function hydrateBag(store, b) {
  const flight = findFlight(store, b.flightCode);
  return { ...clone(b), flightDestination: flight?.destination || '', flightOrigin: flight?.origin || '' };
}

function myBags(store, direction) {
  const p = myPilgrim(store);
  if (!p) return [];
  return store.bags.filter((b) => b.pilgrimId === p.id && (!direction || b.direction === direction));
}

function openExceptionForBag(store, bagId) {
  return store.exceptions.find((e) => e.bagId === bagId && !['Resolved', 'Closed'].includes(e.status));
}

/* ===================== AUTH ===================== */

/** @param {string} nusukId @param {string} passport */
export async function login(nusukId, passport) {
  const store = getStore();
  const p = store.pilgrims.find((x) => x.nusukId === String(nusukId).trim() && x.passport.toUpperCase() === String(passport).trim().toUpperCase());
  if (!p) return fail('Invalid credentials — check your Nusuk ID and passport number.');
  const session = { id: p.id, name: `${p.firstName} ${p.lastName}`, firstName: p.firstName, shiftStartedAt: nowIso() };
  setSession(session);
  saveStore();
  return ok(session);
}

export async function getMe() {
  const session = getSession();
  if (!session) return fail('Not authenticated.');
  const store = getStore();
  const p = myPilgrim(store);
  return ok({ ...clone(session), passportMasked: p ? maskPassport(p.passport) : '', group: p?.group, agency: p?.agency });
}

export function logout() { setSession(null); }

/* ===================== HOME ===================== */

export async function getHome() {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');

  const booking = store.bookings.find((b) => b.pilgrimId === p.id && b.status !== 'Cancelled');
  const depBags = myBags(store, 'departure');
  const departure = {
    hasBooking: !!booking,
    booking: booking ? clone(booking) : null,
    flightCode: booking?.flightCode || p.flightCode || null,
    allOnAircraft: depBags.length > 0 && depBags.every((b) => b.status === 'Loaded on Aircraft'),
    bagsTotal: depBags.length,
  };

  const arrBags = myBags(store, 'arrival');
  const flight = p.arrivalFlightCode ? findFlight(store, p.arrivalFlightCode) : null;
  const delivered = arrBags.filter((b) => ['Delivered', 'Confirmed by Pilgrim'].includes(b.status)).length;
  const arrival = {
    hasArrival: !!p.arrivalFlightCode,
    flightCode: p.arrivalFlightCode, flightStatus: flight?.status || null,
    hotel: p.hotel, bagsTotal: arrBags.length, bagsDelivered: delivered,
  };

  const notifications = store.notifications.filter((n) => n.pilgrimId === p.id).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 3);

  return ok({
    firstName: p.firstName, group: p.group, agency: p.agency,
    departure, arrival, notifications: clone(notifications),
  });
}

/* ===================== BOOKING ===================== */

export async function getBookingLimits() {
  const store = getStore();
  return ok(clone(store.config));
}

export async function getFlights() {
  const store = getStore();
  return ok(store.flights.filter((f) => f.direction === 'departure').map((f) => clone(f)));
}

export async function getCentres() {
  const store = getStore();
  return ok(clone(store.centres));
}

const FULL_SLOT_TIMES = ['10:00', '10:15'];

export async function getSlots(centreId, date) {
  const store = getStore();
  const centre = findCentre(store, centreId);
  if (!centre) return fail('Centre not found.');
  const slots = [];
  const now = new Date();
  const isToday = date === now.toISOString().slice(0, 10);
  for (let h = 8; h < 20; h++) {
    for (let m = 0; m < 60; m += store.config.slotMinutes) {
      const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const taken = store.bookings.filter((b) => b.centreId === centreId && b.slot.date === date && b.slot.time === time && b.status !== 'Cancelled').length;
      const full = FULL_SLOT_TIMES.includes(time) ? store.config.slotCapacity : taken;
      const left = Math.max(0, store.config.slotCapacity - full);
      const past = isToday && (h < now.getHours() || (h === now.getHours() && m <= now.getMinutes()));
      slots.push({ time, left, past, full: left <= 0 });
    }
  }
  return ok({ date, slots });
}

export async function createBooking(payload) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const { flightCode, bagCount, bagWeights, centreId, slot } = payload;
  const existing = store.bookings.find((b) => b.pilgrimId === p.id && b.flightCode === flightCode && b.status !== 'Cancelled');
  if (existing) return fail('You already have a booking for this flight.', 'existing-booking', { bookingId: existing.id });
  if (!findFlight(store, flightCode)) return fail('Flight not found.');
  if (!findCentre(store, centreId)) return fail('Centre not found.');
  if (!bagCount || bagCount < 1 || bagCount > store.config.maxBags) return fail(`Bag count must be between 1 and ${store.config.maxBags}.`);
  for (const w of bagWeights || []) {
    if (!w || w < 1 || w > store.config.maxBagKg) return fail(`Repack required — bag exceeds ${store.config.maxBagKg} kg.`, 'overweight');
  }
  const taken = store.bookings.filter((b) => b.centreId === centreId && b.slot.date === slot.date && b.slot.time === slot.time && b.status !== 'Cancelled').length;
  const full = FULL_SLOT_TIMES.includes(slot.time) ? store.config.slotCapacity : taken;
  if (full >= store.config.slotCapacity) return fail('This slot just filled up — pick another.', 'slot-full');
  // Accepts a client-generated id so the QR code shown mid-wizard (before the
  // booking actually exists) stays correct once it's confirmed, instead of
  // minting a different code the pilgrim never saw.
  const id = payload.id || newId('APT-');
  const newBooking = {
    id, pilgrimId: p.id, serviceType: 'City Check-in', flightCode, bagCount, bagWeights,
    centreId, slot: { ...slot }, status: 'Booked', createdAt: nowIso(), qrCode: id,
  };
  store.bookings.push(newBooking);
  saveStore();
  return ok(clone(newBooking));
}

export async function getBooking(id) {
  const store = getStore();
  const booking = findBooking(store, id);
  if (!booking) return fail('Booking not found.');
  const flight = findFlight(store, booking.flightCode);
  const centre = findCentre(store, booking.centreId);
  const bags = store.bags.filter((b) => b.bookingId === id).map((b) => hydrateBag(store, b));
  return ok({ booking: clone(booking), flight: flight ? clone(flight) : null, centre: centre ? clone(centre) : null, bags });
}

export async function reschedule(id, centreId, slot) {
  const store = getStore();
  const booking = findBooking(store, id);
  if (!booking) return fail('Booking not found.');
  if (!findCentre(store, centreId)) return fail('Centre not found.');
  const taken = store.bookings.filter((b) => b.id !== id && b.centreId === centreId && b.slot.date === slot.date && b.slot.time === slot.time && b.status !== 'Cancelled').length;
  const full = FULL_SLOT_TIMES.includes(slot.time) ? store.config.slotCapacity : taken;
  if (full >= store.config.slotCapacity) return fail('This slot just filled up — pick another.', 'slot-full');
  booking.centreId = centreId;
  booking.slot = { ...slot };
  saveStore();
  return ok(clone(booking));
}

export async function cancelBooking(id) {
  const store = getStore();
  const booking = findBooking(store, id);
  if (!booking) return fail('Booking not found.');
  booking.status = 'Cancelled';
  saveStore();
  return ok(clone(booking));
}

/* ===================== BAGS ===================== */

export async function getBags(direction) {
  const store = getStore();
  return ok(myBags(store, direction).map((b) => {
    const h = hydrateBag(store, b);
    const exc = openExceptionForBag(store, b.id);
    return { ...h, exception: exc ? clone(exc) : null };
  }));
}

export async function getBag(id) {
  const store = getStore();
  const bag = findBag(store, id);
  if (!bag) return fail('Bag not found.');
  const exc = openExceptionForBag(store, id);
  return ok({ ...hydrateBag(store, bag), exception: exc ? clone(exc) : null });
}

export async function getTimeline(bagId) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  return ok(clone(bag.timeline));
}

export async function getReceipt(id) {
  const store = getStore();
  const receipt = store.receipts.find((r) => r.id === id);
  if (!receipt) return fail('Receipt not found.');
  const booking = findBooking(store, receipt.bookingId);
  const centre = booking ? findCentre(store, booking.centreId) : null;
  const p = myPilgrim(store);
  const bags = receipt.bagIds.map((bid) => hydrateBag(store, findBag(store, bid))).filter(Boolean);
  return ok({ receipt: clone(receipt), booking: booking ? clone(booking) : null, centre: centre ? clone(centre) : null, passportMasked: p ? maskPassport(p.passport) : '', bags });
}

/** @returns {Promise<object|null>} the receipt issued for a booking, or null if not checked in yet */
export async function getReceiptForBooking(bookingId) {
  const store = getStore();
  const receipt = store.receipts.find((r) => r.bookingId === bookingId);
  return ok(receipt ? clone(receipt) : null);
}

/* ===================== SUPPORT ===================== */

export async function getTickets() {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  return ok(store.tickets.filter((t) => t.pilgrimId === p.id).map((t) => clone(t)));
}

export async function createTicket({ subject, bagId, message }) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  if (!subject) return fail('Subject is required.');
  if (['Missing bag', 'Damaged bag'].includes(subject) && !bagId) return fail('Select a bag for this subject.');
  const text = (message || '').trim();
  if (text.length < 10 || text.length > 1000) return fail('Message must be 10–1000 characters.');
  const ticket = {
    id: newId('TCK-'), pilgrimId: p.id, subject, bagId: bagId || null, status: 'Open', createdAt: nowIso(),
    messages: [{ from: 'pilgrim', text, at: nowIso() }],
  };
  store.tickets.push(ticket);
  saveStore();
  return ok(clone(ticket));
}

export async function getTicket(id) {
  const store = getStore();
  const ticket = findTicket(store, id);
  if (!ticket) return fail('Ticket not found.');
  return ok(clone(ticket));
}

export async function sendMessage(ticketId, text) {
  const store = getStore();
  const ticket = findTicket(store, ticketId);
  if (!ticket) return fail('Ticket not found.');
  const value = (text || '').trim();
  if (!value) return fail('Message cannot be empty.');
  ticket.messages.push({ from: 'pilgrim', text: value, at: nowIso() });
  saveStore();
  return ok(clone(ticket));
}

/* ===================== ARRIVAL ===================== */

export async function confirmReceipt(bagId) {
  const store = getStore();
  const bag = findBag(store, bagId);
  if (!bag) return fail('Bag not found.');
  if (bag.status !== 'Delivered') return fail('This bag has not been delivered yet.');
  bag.status = 'Confirmed by Pilgrim';
  bag.timeline.push({ stage: 'Confirmed by Pilgrim', time: nowIso(), location: 'Room', role: 'Pilgrim', result: 'ok' });
  saveStore();
  const remaining = myBags(store, 'arrival').filter((b) => !['Confirmed by Pilgrim'].includes(b.status)).length;
  return ok({ bag: hydrateBag(store, bag), allConfirmed: remaining === 0 });
}

export async function reportMissing({ bagIds, description, phone }) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  if (!bagIds || !bagIds.length) return fail('Select at least one bag.');
  const desc = (description || '').trim();
  if (desc.length < 10 || desc.length > 500) return fail('Description must be 10–500 characters.');
  if (!/^\+\d{8,15}$/.test(phone || '')) return fail('Phone must start with + and have 8–15 digits.');
  const created = [];
  for (const bagId of bagIds) {
    const bag = findBag(store, bagId);
    if (!bag) continue;
    if (openExceptionForBag(store, bagId)) continue;
    const exc = {
      id: newId('EXC-'), type: 'Pilgrim Reported Missing', severity: 'Medium', status: 'Open',
      bagId, pilgrimId: p.id, note: desc, createdAt: nowIso(), resolvedAt: null, resolutionOutcome: null,
    };
    store.exceptions.push(exc);
    bag.exceptionId = exc.id;
    created.push(exc);
  }
  saveStore();
  return ok({ created: created.length });
}

export async function getResolution() {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const list = store.exceptions.filter((e) => e.pilgrimId === p.id
    && ['Pilgrim Reported Missing', 'Missing Bag'].includes(e.type)
    && findBag(store, e.bagId)?.direction === 'arrival');
  return ok(list.map((e) => {
    const bag = findBag(store, e.bagId);
    const lastEvent = bag?.timeline[bag.timeline.length - 1];
    return { ...clone(e), bagTagNumber: bag?.tagNumber || null, lastKnownLocation: lastEvent?.location || null, lastKnownTime: lastEvent?.time || null };
  }));
}

export async function rate({ stars, comment }) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  if (!stars || stars < 1 || stars > 5) return fail('Select a rating of 1–5 stars.');
  const text = (comment || '').trim();
  if (text.length > 500) return fail('Comment must be 500 characters or fewer.');
  const existing = store.ratings.find((r) => r.pilgrimId === p.id);
  if (existing) { existing.stars = stars; existing.comment = text; existing.submittedAt = nowIso(); }
  else store.ratings.push({ id: newId('RAT-'), pilgrimId: p.id, stars, comment: text, submittedAt: nowIso() });
  saveStore();
  return ok({ stars, comment: text });
}

export async function getRating() {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const existing = store.ratings.find((r) => r.pilgrimId === p.id);
  return ok(existing ? clone(existing) : null);
}

/* ===================== NOTIFICATIONS ===================== */

export async function getNotifications() {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  return ok(store.notifications.filter((n) => n.pilgrimId === p.id).sort((a, b) => new Date(b.time) - new Date(a.time)).map((n) => clone(n)));
}

export async function markRead(id) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const mine = store.notifications.filter((n) => n.pilgrimId === p.id);
  if (id === 'all') mine.forEach((n) => { n.unread = false; });
  else { const n = mine.find((x) => x.id === id); if (n) n.unread = false; }
  saveStore();
  return ok(mine.map((n) => clone(n)));
}

/* ===================== DEMO MENU ===================== */

export async function demoSimulateCheckIn() {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const booking = store.bookings.find((b) => b.pilgrimId === p.id && b.status === 'Booked');
  if (!booking) return fail('No pending booking to check in.');
  booking.status = 'Checked-in';
  const newBags = (booking.bagWeights || []).map((w, i) => ({
    id: newId('BAG-'), tagNumber: `RBL-D-${newId('').slice(0, 6)}`, pilgrimId: p.id, bookingId: booking.id,
    direction: 'departure', flightCode: booking.flightCode, weightKg: w, status: 'Checked-in',
    timeline: [
      { stage: 'Declared', time: nowIso(), location: 'Makkah', role: 'Pilgrim', result: 'ok' },
      { stage: 'Checked-in', time: nowIso(), location: 'Makkah', role: 'Check-in Staff', result: 'ok' },
    ],
    exceptionId: null,
  }));
  store.bags.push(...newBags);
  const receipt = {
    id: newId('RCP-'), bookingId: booking.id, receiptNo: newId('RCP-'), centreName: findCentre(store, booking.centreId)?.name || '',
    staffName: 'Demo Check-in Staff', generatedAt: nowIso(), bagIds: newBags.map((b) => b.id),
  };
  store.receipts.push(receipt);
  saveStore();
  return ok({ bookingId: booking.id, bagsCreated: newBags.length, receiptId: receipt.id });
}

export async function demoAdvanceBag(bagId) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const bag = bagId ? findBag(store, bagId) : myBags(store).find((b) => canAdvance(b));
  if (!bag) return fail('No eligible bag to advance.');
  advanceBag(bag);
  saveStore();
  return ok(hydrateBag(store, bag));
}

export async function demoAdvanceAll() {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const bags = myBags(store).filter((b) => canAdvance(b));
  if (!bags.length) return fail('No bags are eligible to advance.');
  bags.forEach(advanceBag);
  saveStore();
  return ok({ advanced: bags.length });
}

function stagesFor(bag) { return bag.direction === 'departure' ? DEPARTURE_STAGES : ARRIVAL_STAGES; }
function canAdvance(bag) {
  const stages = stagesFor(bag);
  const idx = stages.indexOf(bag.status);
  return idx >= 0 && idx < stages.length - 1;
}
function advanceBag(bag) {
  const stages = stagesFor(bag);
  const idx = stages.indexOf(bag.status);
  if (idx < 0 || idx >= stages.length - 1) return;
  bag.status = stages[idx + 1];
  bag.timeline.push({ stage: bag.status, time: nowIso(), location: 'In transit', role: 'Staff', result: 'ok' });
}

export async function demoRaiseException(bagId) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const bag = bagId ? findBag(store, bagId) : myBags(store).find((b) => !openExceptionForBag(store, b.id));
  if (!bag) return fail('No eligible bag to flag.');
  const exc = {
    id: newId('EXC-'), type: 'Missing Bag', severity: 'Medium', status: 'Open', bagId: bag.id, pilgrimId: p.id,
    note: 'Flagged for demo purposes.', createdAt: nowIso(), resolvedAt: null, resolutionOutcome: null,
  };
  store.exceptions.push(exc);
  bag.exceptionId = exc.id;
  saveStore();
  return ok(clone(exc));
}

export async function demoResolveException(exceptionId) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const exc = exceptionId ? findException(store, exceptionId)
    : store.exceptions.find((e) => e.pilgrimId === p.id && !['Resolved', 'Closed'].includes(e.status));
  if (!exc) return fail('No open exception to resolve.');
  exc.status = 'Resolved';
  exc.resolvedAt = nowIso();
  exc.resolutionOutcome = 'Bag located and resolved.';
  const bag = findBag(store, exc.bagId);
  if (bag && bag.status !== 'Delivered' && bag.status !== 'Confirmed by Pilgrim') {
    advanceBag(bag);
  }
  saveStore();
  return ok(clone(exc));
}

export async function demoReplyAsSupport(ticketId) {
  const store = getStore();
  const p = myPilgrim(store);
  if (!p) return fail('Not authenticated.');
  const ticket = ticketId ? findTicket(store, ticketId) : store.tickets.find((t) => t.pilgrimId === p.id);
  if (!ticket) return fail('No ticket to reply to.');
  const steps = ['Open', 'Assigned', 'In Progress', 'Resolved'];
  const idx = steps.indexOf(ticket.status);
  if (idx < steps.length - 1) ticket.status = steps[idx + 1];
  ticket.messages.push({ from: 'support', text: `Update: your ticket is now "${ticket.status}".`, at: nowIso() });
  saveStore();
  return ok(clone(ticket));
}

export function demoForceNextFail() {
  const store = getStore();
  store.demoForceFail = true;
  saveStore();
}

export function demoReset() { resetStore(); }
