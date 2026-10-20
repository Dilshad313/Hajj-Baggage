import * as api from '../api.js';
import { esc, icon, toast, openModal } from '../ui.js';
import { DELAY_REASONS } from '../seed.js';

/**
 * Opens the delay-report sheet for a trip: reason chips, a 5–240 min stepper
 * (step 5) and notes, plus a standalone "Send ETA update" action.
 * @param {string} tripId
 * @param {{onDone?:(trip:object)=>void}} [opts]
 */
export function openDelaySheet(tripId, opts = {}) {
  let reason = null;
  let minutes = 15;

  const close = openModal({
    title: 'Report a delay',
    bodyHtml: `<div id="delay-sheet-body"></div>`,
    onMount: () => render(),
  });

  function render() {
    const root = document.querySelector('#delay-sheet-body');
    if (!root) return;
    root.innerHTML = `
      <div class="field">
        <label>Reason <span class="req">*</span></label>
        <div class="row gap-2 wrap">
          ${DELAY_REASONS.map((r) => `<button type="button" class="demo-chip" data-reason="${esc(r)}" style="${reason === r ? 'background:var(--accent-soft);border-color:var(--accent)' : ''}">${esc(r)}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label for="delay-minutes">Minutes <span class="req">*</span></label>
        <div class="row gap-3">
          <button type="button" class="btn btn-secondary btn-icon" data-act="minus" aria-label="Decrease minutes">−</button>
          <strong class="fs-lg" id="delay-minutes-value" style="min-width:64px;text-align:center">${minutes} min</strong>
          <button type="button" class="btn btn-secondary btn-icon" data-act="plus" aria-label="Increase minutes">+</button>
        </div>
      </div>
      <div class="field">
        <label for="delay-notes">Notes ${(reason === 'Other' || reason === 'Vehicle problem') ? '<span class="req">*</span>' : ''}</label>
        <textarea id="delay-notes" maxlength="300" placeholder="What's causing the delay?"></textarea>
        <div class="error" id="err-delay" hidden></div>
      </div>
      <div class="modal-actions" style="justify-content:space-between">
        <button type="button" class="btn btn-secondary" data-act="send-eta">${icon('send', 16)} Send ETA update</button>
        <button type="button" class="btn btn-primary" data-act="report">${icon('clock-alert', 16)} Report delay</button>
      </div>`;
    root.querySelectorAll('[data-reason]').forEach((btn) => btn.addEventListener('click', () => { reason = btn.dataset.reason; render(); }));
    root.querySelector('[data-act="minus"]').addEventListener('click', () => { minutes = Math.max(5, minutes - 5); render(); });
    root.querySelector('[data-act="plus"]').addEventListener('click', () => { minutes = Math.min(240, minutes + 5); render(); });
    root.querySelector('[data-act="send-eta"]').addEventListener('click', async () => {
      try { await api.sendEta(tripId); toast('ETA update sent.', 'success'); } catch (err) { toast(err.message, 'error'); }
    });
    root.querySelector('[data-act="report"]').addEventListener('click', async () => {
      const notes = root.querySelector('#delay-notes').value;
      const errEl = root.querySelector('#err-delay');
      try {
        const res = await api.reportDelay(tripId, { reason, minutes, notes });
        errEl.hidden = true;
        toast(`Delay reported — ${reason}, +${minutes} min.${res.notifiedDestination ? ' Destination notified.' : ''}`, 'success');
        close();
        opts.onDone?.(res.trip);
      } catch (err) {
        errEl.textContent = err.message; errEl.hidden = false;
      }
    });
  }
}
