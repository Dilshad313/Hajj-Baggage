import { esc } from '../ui.js';

const COLOR_MAP = {
  // grey
  expected: 'grey', planned: 'grey', 'not started': 'grey',
  // blue
  'en route': 'blue', 'in progress': 'blue', 'in transit': 'blue', assigned: 'blue', open: 'blue', medium: 'blue', sorted: 'blue',
  // amber
  'at destination': 'amber', unloading: 'amber', notified: 'amber', escalated: 'amber', high: 'amber', pending: 'amber', minor: 'amber',
  // red
  'out of service': 'red', failed: 'red', rejected: 'red', critical: 'red', cancelled: 'red', major: 'red',
  // green
  unloaded: 'green', completed: 'green', confirmed: 'green', resolved: 'green', closed: 'green', success: 'green', low: 'green',
  available: 'green', active: 'green', 'out for delivery': 'green',
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
