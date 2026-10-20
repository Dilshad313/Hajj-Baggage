import { esc } from '../ui.js';

const COLOR_MAP = {
  // grey
  declared: 'grey', 'not started': 'grey', booked: 'grey', pending: 'grey', open: 'grey',
  // blue
  'in progress': 'blue', 'checked-in': 'blue', assigned: 'blue', medium: 'blue', available: 'blue', active: 'blue',
  // amber
  'on hold': 'amber', escalated: 'amber', high: 'amber', overweight: 'amber', 'pending-weigh': 'amber',
  // red
  cancelled: 'red', 'no-show': 'red', failed: 'red', critical: 'red', 'out of service': 'red', rejected: 'red',
  // green
  completed: 'green', 'checked in': 'green', delivered: 'green', resolved: 'green', closed: 'green', success: 'green', low: 'green', tagged: 'green', logged: 'green', loaded: 'green', match: 'green', verified: 'green',
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
