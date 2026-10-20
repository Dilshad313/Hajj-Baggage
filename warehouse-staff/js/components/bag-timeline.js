import { esc, fmtDateTime, fmtRelative, icon } from '../ui.js';

const RESULT_ICON = { ok: 'check', failed: 'x', manual: 'keyboard' };

/**
 * Renders a vertical chain-of-custody timeline for a bag: one row per
 * lifecycle stage, matched against recorded scan events. Stages with no
 * event yet are greyed out as "future"; failed/manual-entry scans are tagged.
 * @param {{stages:string[], timeline:{stage:string,time:string,location?:string,role?:string,result?:'ok'|'failed'|'manual'}[]}} opts
 * @returns {string}
 */
export function bagTimelineHtml(opts) {
  const byStage = new Map((opts.timeline || []).map((e) => [e.stage, e]));
  return `<div class="bag-timeline">${opts.stages.map((stage) => {
    const event = byStage.get(stage);
    const state = !event ? 'future' : event.result === 'failed' ? 'failed' : 'done';
    const dotIcon = !event ? 'circle' : RESULT_ICON[event.result] || 'check';
    return `
      <div class="bag-timeline-item ${state}">
        <div class="bag-timeline-dot">${icon(dotIcon, 16)}</div>
        <div class="bag-timeline-body">
          <div class="row gap-2 wrap">
            <strong class="fs-sm">${esc(stage)}</strong>
            ${event?.result === 'manual' ? '<span class="chip chip-amber">Manual entry</span>' : ''}
            ${event?.result === 'failed' ? '<span class="chip chip-red">Scan failed</span>' : ''}
          </div>
          ${event ? `
            <div class="fs-xs muted" title="${esc(fmtDateTime(event.time))}">${fmtRelative(event.time)}
              ${event.location ? ` · ${esc(event.location)}` : ''}${event.role ? ` · ${esc(event.role)}` : ''}</div>
          ` : `<div class="fs-xs muted">Not yet reached</div>`}
        </div>
      </div>`;
  }).join('')}</div>`;
}
