import { esc } from '../ui.js';

const COLOR_MAP = {
  // grey
  assigned: 'grey', 'not started': 'grey', 'awaiting load': 'grey', pending: 'grey',
  // blue
  'in progress': 'blue', 'in transit': 'blue', 'on truck': 'blue', notified: 'blue', open: 'blue', medium: 'blue', active: 'blue',
  // amber
  'on hold': 'amber', 'security hold': 'amber', escalated: 'amber', high: 'amber', 'completed with exceptions': 'amber', assigned_backup: 'amber',
  // red
  cancelled: 'red', failed: 'red', critical: 'red', missing: 'red', 'out of service': 'red',
  // green
  completed: 'green', delivered: 'green', resolved: 'green', closed: 'green', success: 'green', low: 'green', cleared: 'green', unloaded: 'green', 'handed over': 'green',
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

/** @param {'Departure'|'Arrival'} direction @returns {string} */
export function directionChip(direction) {
  return `<span class="chip ${direction === 'Departure' ? 'chip-direction-dep' : 'chip-direction-arr'}">${esc(direction)}</span>`;
}
