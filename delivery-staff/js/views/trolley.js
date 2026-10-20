import * as api from '../api.js';
import { skeletonBlock, errorState, toast, esc, icon } from '../ui.js';
import { createScanInput } from '../components/scan-input.js';
import { navigate } from '../router.js';

let appEl = null;
let runId = null;
let run = null;
let checklist = [];
let trolleyScanInstance = null;
let collectScanInstance = null;

/**
 * Trolley pickup view: scan the trolley QR, then (once picked up) work
 * through the load checklist, collecting any bags still in hold, until the
 * whole load is verified.
 * @param {{id:string}} params
 * @param {HTMLElement} app
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function render(params, app) {
  appEl = app;
  runId = params.id;
  run = null;
  checklist = [];
  load();
  return { destroy, refresh: load };
}

/** Tears down any mounted scan-input instances and releases the view. */
export function destroy() {
  trolleyScanInstance?.destroy();
  collectScanInstance?.destroy();
  trolleyScanInstance = null;
  collectScanInstance = null;
  appEl = null;
}

async function load() {
  if (!appEl) return;
  appEl.innerHTML = skeletonBlock(6);
  try {
    const [runData, bags] = await Promise.all([api.getRun(runId), api.getTrolleyChecklist(runId)]);
    run = runData;
    checklist = bags;
    renderPage();
  } catch (err) {
    appEl.innerHTML = errorState({ message: err.message });
    appEl.querySelector('[data-action="retry"]')?.addEventListener('click', load);
  }
}

function missingBags() {
  return checklist.filter((b) => b.status === 'In hold (missing)');
}

function renderPage() {
  // Guards the deferred `setTimeout(renderPage, 500)` below (and any other
  // deferred call) firing after the user already navigated away and
  // destroy() nulled appEl — without this it throws setting innerHTML on null.
  if (!appEl) return;
  trolleyScanInstance?.destroy(); trolleyScanInstance = null;
  collectScanInstance?.destroy(); collectScanInstance = null;

  appEl.innerHTML = `
    <a class="btn btn-ghost" href="#/run/${esc(runId)}">${icon('arrow-left', 16)} Run overview</a>
    <div class="page-header">
      <div>
        <h1 class="page-title">Pick up trolley</h1>
        <p class="page-subtitle">${esc(run.code)} · ${esc(run.hotel)} · Building ${esc(run.building)}</p>
      </div>
    </div>
    ${!run.trolleyPickedUp ? `<div id="trolley-scan-root"></div>` : `
      <div class="card" style="margin-block-end:var(--s4)">
        <h2 class="section-title">Load checklist</h2>
        <div id="checklist-root"></div>
      </div>
      <div id="collect-scan-root" style="margin-block-end:var(--s4)"></div>
      <div id="verified-root"></div>
    `}`;

  if (!run.trolleyPickedUp) {
    trolleyScanInstance = createScanInput(appEl.querySelector('#trolley-scan-root'), {
      label: 'Scan trolley QR',
      placeholder: `e.g. ${run.trolleyId}`,
      onSubmit: async (code) => {
        await api.pickUpTrolley(runId, code);
        run.trolleyPickedUp = true;
        toast('Trolley picked up.', 'success');
        setTimeout(renderPage, 500);
        return { message: 'Trolley confirmed.' };
      },
    });
    return;
  }

  renderChecklist();
  renderVerified();
  mountCollectScanIfNeeded();
}

function renderChecklist() {
  const root = appEl.querySelector('#checklist-root');
  if (!root) return;
  root.innerHTML = `<div class="stack gap-0">${checklist.map(checklistRowHtml).join('')}</div>`;
}

function checklistRowHtml(b) {
  const checked = b.status !== 'In hold (missing)';
  return `
    <div class="trolley-checklist-row ${checked ? 'checked' : ''}">
      ${icon(checked ? 'check-circle' : 'circle', 20)}
      <div style="flex:1">
        <div class="fs-sm">${esc(b.tagNumber)} <span class="muted">— ${esc(b.pilgrimName)}</span></div>
        ${!checked ? `<div class="fs-xs" style="color:var(--warning)">${icon('alert-triangle', 12)} Missing from trolley</div>` : ''}
      </div>
    </div>`;
}

function renderVerified() {
  const root = appEl.querySelector('#verified-root');
  if (!root) return;
  if (missingBags().length > 0) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <div class="card" style="text-align:center;margin-block-end:var(--s4)">
      ${icon('check-circle', 40)}
      <h2 class="fs-lg" style="margin-block:var(--s3) var(--s2)">Load verified</h2>
      <p class="fs-sm muted">Every bag is accounted for on the trolley.</p>
    </div>
    <button type="button" class="btn btn-primary btn-lg btn-block" data-action="continue-out">${icon('arrow-right', 18)} Continue to scan out</button>`;
  root.querySelector('[data-action="continue-out"]').addEventListener('click', () => navigate(`#/run/${runId}/out`));
}

function mountCollectScanIfNeeded() {
  const root = appEl.querySelector('#collect-scan-root');
  if (!root) return;
  if (missingBags().length === 0) {
    collectScanInstance?.destroy();
    collectScanInstance = null;
    root.innerHTML = '';
    return;
  }
  if (collectScanInstance) return;
  root.innerHTML = `<h2 class="section-title">Collect missing bags</h2><div id="collect-scan-field"></div>`;
  collectScanInstance = createScanInput(root.querySelector('#collect-scan-field'), {
    label: 'Collect from hold',
    placeholder: 'Scan the bag tag',
    onSubmit: async (tag) => {
      const bag = await api.collectFromHold(runId, tag);
      checklist = checklist.map((b) => (b.id === bag.id ? { ...b, status: bag.status } : b));
      renderChecklist();
      renderVerified();
      if (missingBags().length === 0) scheduleCollectTeardown();
      return { message: `${bag.tagNumber} collected — now on trolley.` };
    },
  });
}

function scheduleCollectTeardown() {
  setTimeout(() => {
    if (!appEl) return;
    mountCollectScanIfNeeded();
  }, 900);
}
