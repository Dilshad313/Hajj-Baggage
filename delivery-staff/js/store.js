import { createSeed } from './seed.js';

const KEY = 'rabel_ui_delivery-staff';

let state = null;

/** Safely read JSON from localStorage. @returns {object|null} */
function readRaw() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Safely write current state to localStorage. */
function writeRaw() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* storage unavailable (private mode / quota) — app still works in-memory */
  }
}

/** Load state from storage, seeding it on first run. @returns {object} */
export function loadStore() {
  if (state) return state;
  const existing = readRaw();
  if (existing && existing.__v === 1) {
    state = existing;
  } else {
    state = { __v: 1, ...createSeed() };
    writeRaw();
  }
  return state;
}

/** @returns {object} the live mutable state object */
export function getStore() {
  return loadStore();
}

/** Persist the current state to localStorage. */
export function saveStore() {
  writeRaw();
}

/** Reset all demo data back to the original seed. @returns {object} */
export function resetStore() {
  state = { __v: 1, ...createSeed() };
  writeRaw();
  return state;
}

/** @returns {boolean} whether a session token is present */
export function isAuthed() {
  return !!loadStore().session;
}

/** @param {object|null} session */
export function setSession(session) {
  loadStore().session = session;
  saveStore();
}

/** @returns {object|null} */
export function getSession() {
  return loadStore().session;
}

/** @returns {boolean} whether demo mode (simulate toggles) is on */
export function isDemoMode() {
  return !!loadStore().demoMode;
}

/** @param {boolean} on */
export function setDemoMode(on) {
  loadStore().demoMode = on;
  saveStore();
}
