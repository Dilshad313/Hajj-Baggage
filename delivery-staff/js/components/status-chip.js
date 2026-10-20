import { esc } from '../ui.js';

const COLOR_MAP = {
  // grey
  pending: 'grey', expected: 'grey', 'not started': 'grey',
  // blue
  'in progress': 'blue', 'in transit': 'blue', assigned: 'blue', notified: 'blue', open: 'blue', medium: 'blue',
  // amber
  rescheduled: 'amber', 'on hold': 'amber', escalated: 'amber', high: 'amber', 'completed with exceptions': 'amber',
  // red
  'not found': 'red', failed: 'red', rejected: 'red', critical: 'red', returned: 'red', cancelled: 'red',
  // green
  delivered: 'green', confirmed: 'green', completed: 'green', resolved: 'green', closed: 'green', success: 'green', low: 'green',
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
