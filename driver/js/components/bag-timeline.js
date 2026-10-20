import { esc, icon, fmtDateTime } from '../ui.js';

const KEYWORD_ICONS = [
  [/vehicle|truck/i, 'truck'],
  [/pre-trip/i, 'clipboard-check'],
  [/arrived|arrival/i, 'map-pin'],
  [/departed/i, 'navigation'],
  [/loaded|count|scanned/i, 'package'],
  [/seal/i, 'lock'],
  [/delay/i, 'clock-alert'],
  [/security/i, 'shield-alert'],
  [/offload|unload/i, 'package-open'],
  [/handover|receipt/i, 'file-check'],
  [/completed/i, 'check-check'],
  [/cancelled|fail/i, 'x-circle'],
  [/backup/i, 'replace'],
];

function iconFor(text) {
  const hit = KEYWORD_ICONS.find(([re]) => re.test(text));
  return hit ? hit[1] : 'circle-dot';
}

/**
 * Renders a vertical timeline of trip log events (icon by keyword, time).
 * @param {{at:string, text:string}[]} entries
 * @param {{futureLabels?:string[]}} [opts] trailing greyed-out "future" steps
 * @returns {string}
 */
export function timelineHtml(entries, opts = {}) {
  const past = entries.map((e) => `
    <div class="bag-timeline-item done">
      <div class="bag-timeline-dot">${icon(iconFor(e.text), 16)}</div>
      <div class="bag-timeline-body">
        <div class="fs-sm">${esc(e.text)}</div>
        <div class="fs-xs muted">${fmtDateTime(e.at)}</div>
      </div>
    </div>`).join('');
  const future = (opts.futureLabels || []).map((label) => `
    <div class="bag-timeline-item future">
      <div class="bag-timeline-dot">${icon('circle', 16)}</div>
      <div class="bag-timeline-body"><div class="fs-sm">${esc(label)}</div></div>
    </div>`).join('');
  if (!past && !future) return `<p class="fs-sm muted">No activity yet.</p>`;
  return `<div class="bag-timeline">${past}${future}</div>`;
}
