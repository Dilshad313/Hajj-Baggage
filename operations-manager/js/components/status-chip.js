import { esc } from '../ui.js';

const COLOR_MAP = {
  // grey
  'not started': 'grey', declared: 'grey', expected: 'grey', pending: 'grey', undocumented: 'grey', archived: 'grey',
  // blue
  'in progress': 'blue', 'in transit': 'blue', assigned: 'blue', open: 'blue', medium: 'blue',
  // amber
  waiting: 'amber', 'on hold': 'amber', degraded: 'amber', escalated: 'amber', 'at risk': 'amber', high: 'amber', priority: 'amber',
  // red
  down: 'red', failed: 'red', rejected: 'red', disabled: 'red', critical: 'red', delayed: 'red', 'manual entry': 'red',
  // green
  completed: 'green', delivered: 'green', confirmed: 'green', active: 'green', healthy: 'green', resolved: 'green',
  closed: 'green', success: 'green', 'on time': 'green', documented: 'green', low: 'green', done: 'green',
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
