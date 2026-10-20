import { esc } from '../ui.js';

const COLOR_MAP = {
  // grey — not started
  declared: 'grey', expected: 'grey', 'not started': 'grey',
  // blue — in progress / intermediate
  'checked-in': 'blue', tagged: 'blue', 'loaded to collection truck': 'blue', 'received at warehouse': 'blue',
  screened: 'blue', stored: 'blue', 'loaded to airport truck': 'blue', 'in transit to airport': 'blue',
  'received at airport': 'blue', 'handed to airline': 'blue', 'in progress': 'blue', open: 'blue', medium: 'blue',
  assigned: 'blue', 'security checked': 'blue', 'loaded to truck': 'blue', 'in transit to accommodation': 'blue',
  'received at accommodation': 'blue', sorted: 'blue', booked: 'blue', landed: 'blue',
  // amber — waiting / action needed
  pending: 'amber', 'on hold': 'amber', escalated: 'amber', high: 'amber', 'out for delivery': 'amber',
  // red — exception / failed / rejected
  failed: 'red', rejected: 'red', critical: 'red', cancelled: 'red', missing: 'red',
  // green — completed
  'loaded on aircraft': 'green', confirmed: 'green', delivered: 'green', resolved: 'green', closed: 'green',
  success: 'green', low: 'green', active: 'green', arrived: 'green', 'confirmed by pilgrim': 'green',
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
