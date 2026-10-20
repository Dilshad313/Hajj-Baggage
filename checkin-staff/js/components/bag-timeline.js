import { esc, icon, fmtDateTime } from '../ui.js';

const KEYWORD_ICONS = [
  [/declared/i, 'file-text'],
  [/checked-in/i, 'check-circle'],
  [/weigh/i, 'scale'],
  [/tag/i, 'tag'],
  [/scan|verif/i, 'scan-line'],
  [/log/i, 'clipboard-check'],
  [/cart/i, 'shopping-cart'],
  [/truck/i, 'truck'],
  [/warehouse|screen|stor/i, 'warehouse'],
  [/airport/i, 'building-2'],
  [/airline|aircraft/i, 'plane'],
];

function iconFor(text) {
  const hit = KEYWORD_ICONS.find(([re]) => re.test(text));
  return hit ? hit[1] : 'circle-dot';
}

/**
 * Renders a vertical timeline of bag scan events (icon by keyword, time).
 * Future stages are greyed out; failed / manual-entry results are tagged.
 * @param {{at:string, text:string, failed?:boolean, manual?:boolean}[]} entries
 * @param {{futureLabels?:string[]}} [opts]
 * @returns {string}
 */
export function timelineHtml(entries, opts = {}) {
  const past = entries.map((e) => `
    <div class="bag-timeline-item ${e.failed ? 'failed' : 'done'}">
      <div class="bag-timeline-dot">${icon(e.failed ? 'x' : iconFor(e.text), 16)}</div>
      <div class="bag-timeline-body">
        <div class="fs-sm">${esc(e.text)}${e.manual ? ' <strong>(Manual entry)</strong>' : ''}</div>
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
