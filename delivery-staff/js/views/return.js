import * as api from '../api.js';
import {
  skeletonBlock, errorState, emptyState, openModal, esc, icon,
} from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { statusChip } from '../components/status-chip.js';
import { navigate } from '../router.js';

let appEl = null;
let runId = null;
let run = null;
let bags = [];
let step = 'return'; // return | trolley | done
let trolleyDamaged = false;
let returnScanInstance = null;
let trolleyScanInstance = null;

/**
 * @param {{id:string}} params
 * @param {HTMLElement} app
 * @returns {{destroy:()=>void}}
 */
export function render(params, app) {
  appEl = app;
  runId = params.id;
  step = 'return';
  trolleyDamaged = false;
  load();
  return { destroy };
}

/** Tears down the view, destroying any mounted scan-input instances. */
export function destroy() {
  returnScanInstance?.destroy();
  trolleyScanInstance?.destroy();
  returnScanInstance = null;
  trolleyScanInstance = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    const [undelivered, runData] = await Promise.all([api.getUndelivered(runId), api.getRun(runId)]);
    bags = undelivered;
    run = runData;
    step = bags.length ? 'return' : (run.trolleyReturned ? 'done' : 'trolley');
    renderStep();
  } catch (err) {
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function renderStep() {
  // Guards a pending setTimeout-deferred transition (see onSubmit handlers
  // below) firing after the user has already navigated away and destroy()
  // has nulled appEl — without this, renderReturn/renderTrolley/renderDone
  // would throw trying to set innerHTML on null.
  if (!appEl) return;
  returnScanInstance?.destroy(); returnScanInstance = null;
  trolleyScanInstance?.destroy(); trolleyScanInstance = null;
  if (step === 'return') renderReturn();
  else if (step === 'trolley') renderTrolley();
  else renderDone();
}

/* ===================== Return bags to hold ===================== */

function bagRowHtml(b) {
  return `
    <div class="card" style="margin-block-end:var(--s2)">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <strong class="mono">${esc(b.tagNumber)}</strong>
          <div class="fs-sm muted">${esc(b.stop?.room || '')} · ${esc(b.pilgrimName)}</div>
        </div>
        ${statusChip(b.status)}
      </div>
    </div>`;
}

function renderReturn() {
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <h1 class="page-title" style="margin-block:var(--s3)">Return undelivered bags</h1>
    <p class="fs-sm muted" style="margin-block-end:var(--s4)">Scan each bag that wasn't delivered as it's returned to hold.</p>
    <div id="return-bag-list"></div>
    <div id="return-scan-root" style="margin-block-start:var(--s4)"></div>`;

  renderBagList();
  returnScanInstance = createScanInput(appEl.querySelector('#return-scan-root'), {
    label: 'Scan bag to return to hold',
    placeholder: 'Scan or type the bag tag',
    onSubmit: async (code, { manual }) => {
      let reason;
      if (manual) reason = await openManualReasonPrompt();
      await api.returnToHold(runId, code, { manual, reason });
      bags = await api.getUndelivered(runId);
      renderBagList();
      if (!bags.length) setTimeout(() => { step = 'trolley'; renderStep(); }, 1000);
      return { message: `${code} returned to hold.` };
    },
  });
}

function renderBagList() {
  const root = appEl.querySelector('#return-bag-list');
  if (!root) return;
  root.innerHTML = bags.length
    ? `<div class="stack gap-2">${bags.map(bagRowHtml).join('')}</div>`
    : emptyState({ message: 'All bags accounted for.' });
}

function openManualReasonPrompt() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const close = openModal({
      title: 'Manual entry reason',
      bodyHtml: `
        <div class="field">
          <label for="return-reason">Reason <span class="req">*</span></label>
          <textarea id="return-reason" placeholder="Why is this bag being entered manually?"></textarea>
          <div class="error" id="err-return-reason" hidden></div>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-act="confirm">Confirm</button>
        </div>`,
      onDismiss: () => { if (!settled) { settled = true; reject(new Error('Manual entry cancelled.')); } },
      onMount: (overlay) => {
        overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => {
          settled = true;
          close();
          reject(new Error('Manual entry cancelled.'));
        });
        overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => {
          const reason = overlay.querySelector('#return-reason').value.trim();
          const errEl = overlay.querySelector('#err-return-reason');
          if (!reason) { errEl.textContent = 'A reason is required for manual entry.'; errEl.hidden = false; return; }
          settled = true;
          close();
          resolve(reason);
        });
      },
    });
  });
}

/* ===================== Return trolley ===================== */

function renderTrolley() {
  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <h1 class="page-title" style="margin-block:var(--s3)">Return trolley</h1>
    <p class="fs-sm muted" style="margin-block-end:var(--s4)">All bags are accounted for. Scan the trolley to confirm its return.</p>
    <div class="card" style="margin-block-end:var(--s4)">
      <label class="checkbox-row" style="margin-block-end:var(--s3)">
        <input type="checkbox" id="trolley-damaged-toggle" />
        Trolley damaged
      </label>
      <div class="field" id="trolley-damage-reason-field" hidden>
        <label for="trolley-damage-reason">Damage reason <span class="req">*</span></label>
        <textarea id="trolley-damage-reason" placeholder="Describe the damage"></textarea>
        <div class="error" id="err-trolley-damage-reason" hidden></div>
      </div>
    </div>
    <div id="trolley-scan-root"></div>`;

  appEl.querySelector('#trolley-damaged-toggle').addEventListener('change', (e) => {
    trolleyDamaged = e.target.checked;
    const field = appEl.querySelector('#trolley-damage-reason-field');
    field.hidden = !trolleyDamaged;
    if (!trolleyDamaged) appEl.querySelector('#err-trolley-damage-reason').hidden = true;
  });

  trolleyScanInstance = createScanInput(appEl.querySelector('#trolley-scan-root'), {
    label: 'Scan trolley',
    placeholder: `e.g. ${run.trolleyId}`,
    onSubmit: async (code) => {
      let reason;
      if (trolleyDamaged) {
        reason = appEl.querySelector('#trolley-damage-reason').value.trim();
        const errEl = appEl.querySelector('#err-trolley-damage-reason');
        if (!reason) {
          errEl.textContent = 'A reason is required for a damaged trolley.';
          errEl.hidden = false;
          throw new Error('A reason is required for a damaged trolley.');
        }
        errEl.hidden = true;
      }
      run = await api.returnTrolley(runId, code, { damaged: trolleyDamaged, reason });
      setTimeout(() => { step = 'done'; renderStep(); }, 1000);
      return { message: 'Trolley returned.' };
    },
  });
}

/* ===================== Done ===================== */

function renderDone() {
  appEl.innerHTML = `
    <div class="card receipt-card">
      ${icon('check-circle', 48)}
      <h1 class="fs-xl" style="margin-block:var(--s4) var(--s2)">Return complete</h1>
      <p class="fs-sm text-2" style="margin-block-end:var(--s5)">All bags are in hold and the trolley has been returned. Reconcile the run to finish.</p>
      <button type="button" class="btn btn-primary btn-lg btn-block" data-action="to-reconcile">${icon('arrow-right', 18)} Continue to reconcile</button>
    </div>`;

  appEl.querySelector('[data-action="to-reconcile"]').addEventListener('click', () => navigate(`#/run/${runId}/reconcile`));
}
