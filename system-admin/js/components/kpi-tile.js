import { esc } from '../ui.js';

/**
 * @param {{label:string, value:string|number, delta?:string, trend?:'up'|'down'}} opts
 * @returns {string}
 */
export function kpiTile(opts) {
  return `
    <div class="kpi-tile">
      <div class="kpi-label">${esc(opts.label)}</div>
      <div class="kpi-value">${esc(opts.value)}</div>
      ${opts.delta ? `<div class="kpi-delta ${opts.trend || ''}">${esc(opts.delta)}</div>` : ''}
    </div>`;
}
