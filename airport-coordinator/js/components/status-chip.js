import { esc } from '../ui.js';

const COLOR_MAP = {
  // grey — not started
  declared: 'grey', expected: 'grey', planned: 'grey', 'not started': 'grey', empty: 'grey',
  // blue — in progress / intermediate
  'checked-in': 'blue', tagged: 'blue', 'loaded to collection truck': 'blue', 'received at warehouse': 'blue',
  screened: 'blue', stored: 'blue', 'loaded to airport truck': 'blue', 'in transit to airport': 'blue',
  'received at airport': 'blue', 'handed to airline': 'blue', 'in progress': 'blue', verifying: 'blue',
  open: 'blue', medium: 'blue', assigned: 'blue', sent: 'blue', 'en route': 'blue', 'security checked': 'blue',
  'loaded to truck': 'blue', 'in transit to accommodation': 'blue', building: 'blue',
  // amber — waiting / action needed
  'pending airline': 'amber', pending: 'amber', 'on hold': 'amber', escalated: 'amber', high: 'amber',
  minor: 'amber', notified: 'amber', occupied: 'amber', 'at destination': 'amber', unloading: 'amber',
  'security hold': 'amber', warn: 'amber',
  // red — exception / failed / rejected
  failed: 'red', rejected: 'red', 'partially accepted': 'red', critical: 'red', cancelled: 'red',
  major: 'red', 'out of service': 'red', unidentified: 'red', missing: 'red',
  // green — completed
  'loaded on aircraft': 'green', accepted: 'green', confirmed: 'green', delivered: 'green', loaded: 'green',
  closed: 'green', departed: 'green', acknowledged: 'green', resolved: 'green', success: 'green', low: 'green',
  available: 'green', active: 'green', complete: 'green', cleared: 'green', 'handed over': 'green',
};

/** @param {string} status @returns {'grey'|'blue'|'amber'|'red'|'green'} */
export function colorForStatus(status) {
  const key = String(status || '').toLowerCase();
  return COLOR_MAP[key] || 'blue';
}

/** @param {string} status @param {{color?:string}} [opts] @returns {string} HTML for a status chip */
export function statusChip(status, opts = {}) {
  const color = opts.color || colorForStatus(status);
  return `<span class="chip chip-${color}">${esc(status)}</span>`;
}

const SEVERITY_COLOR = { Low: 'grey', Medium: 'blue', High: 'amber', Critical: 'red' };

/** @param {'Low'|'Medium'|'High'|'Critical'} severity @returns {string} */
export function severityChip(severity) {
  return `<span class="chip chip-${SEVERITY_COLOR[severity] || 'grey'}">${esc(severity)}</span>`;
}

/** @param {string|Date} value @param {string} cls precomputed from ui.js's countdownClass @returns {string} */
export function countdownChip(label, cls) {
  return `<span class="countdown-chip ${cls}">${esc(label)}</span>`;
}
